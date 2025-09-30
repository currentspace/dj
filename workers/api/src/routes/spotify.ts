import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../index'
import { SpotifySearchResponseSchema } from '../lib/schemas'
import { safeParse, isSuccessResponse } from '../lib/guards'

const spotifyRouter = new Hono<{ Bindings: Env }>()

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const REDIRECT_URI = 'https://dj.current.space/api/spotify/callback'

// PKCE helper functions
function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode.apply(null, Array.from(array)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(digest))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

// Request validation schemas
const SearchRequestSchema = z.object({
  query: z.string().min(1),
  type: z.enum(['track', 'album', 'artist']).default('track')
})

const CreatePlaylistRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(300).optional(),
  public: z.boolean().optional().default(false),
  trackUris: z.array(z.string()).max(100)
})

const ModifyPlaylistRequestSchema = z.object({
  playlistId: z.string().min(1),
  action: z.enum(['add', 'remove']),
  trackUris: z.array(z.string()).min(1).max(100)
})

// Base64URL helpers (URL-safe encoding)
function base64urlEncode(data: string): string {
  return btoa(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function base64urlDecode(data: string): string {
  const pad = data.length % 4
  const padded = data + '='.repeat(pad === 0 ? 0 : 4 - pad)
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
}

// HMAC helper for cookie integrity
async function hmacSign(data: string, key: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(key)
  const dataBuffer = encoder.encode(data)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer)
  return base64urlEncode(String.fromCharCode(...new Uint8Array(signature)))
}

async function hmacVerify(data: string, signature: string, key: string): Promise<boolean> {
  const expectedSignature = await hmacSign(data, key)
  return expectedSignature === signature
}

spotifyRouter.get('/auth-url', async (c) => {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  // Generate random state for CSRF protection (no secrets in URL)
  const state = crypto.randomUUID()

  // Create signed cookie payload with verifier
  const cookieData = {
    state,
    verifier: codeVerifier,
    timestamp: Date.now()
  }

  const payload = base64urlEncode(JSON.stringify(cookieData))
  const signature = await hmacSign(payload, c.env.SPOTIFY_CLIENT_SECRET) // Use client secret as HMAC key
  const cookieValue = `${payload}.${signature}`

  const params = new URLSearchParams({
    client_id: c.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    scope: 'playlist-modify-public playlist-modify-private user-read-private user-read-playback-state user-read-currently-playing user-read-recently-played user-top-read playlist-read-private playlist-read-collaborative',
    show_dialog: 'true',
    state: state // Only random state in URL, no secrets
  })

  // Set secure, SameSite cookie with verifier
  c.header('Set-Cookie', `spotify_oauth=${cookieValue}; Max-Age=900; Secure; SameSite=Lax; Path=/; HttpOnly`)

  return c.json({
    url: `${SPOTIFY_AUTH_URL}?${params.toString()}`
  })
})

// OAuth callback endpoint - handles server-side token exchange with cookie verification
spotifyRouter.get('/callback', async (c) => {
  try {
    const code = c.req.query('code')
    const state = c.req.query('state')
    const error = c.req.query('error')

    if (error) {
      console.error('OAuth error:', error)
      return c.redirect(`${c.env.FRONTEND_URL || 'https://dj.current.space'}?error=${encodeURIComponent(error)}`)
    }

    if (!code || !state) {
      console.error('Missing code or state parameter')
      return c.redirect(`${c.env.FRONTEND_URL || 'https://dj.current.space'}?error=missing_parameters`)
    }

    // Retrieve and verify the signed cookie
    const cookieHeader = c.req.header('Cookie')
    const cookieMatch = cookieHeader?.match(/spotify_oauth=([^;]+)/)
    const cookieValue = cookieMatch?.[1]

    if (!cookieValue) {
      console.error('Missing OAuth cookie')
      return c.redirect(`${c.env.FRONTEND_URL || 'https://dj.current.space'}?error=missing_cookie`)
    }

    const [payload, signature] = cookieValue.split('.')
    if (!payload || !signature) {
      console.error('Invalid cookie format')
      return c.redirect(`${c.env.FRONTEND_URL || 'https://dj.current.space'}?error=invalid_cookie`)
    }

    // Verify HMAC signature
    const isValidSignature = await hmacVerify(payload, signature, c.env.SPOTIFY_CLIENT_SECRET)
    if (!isValidSignature) {
      console.error('Invalid cookie signature')
      return c.redirect(`${c.env.FRONTEND_URL || 'https://dj.current.space'}?error=tampered_cookie`)
    }

    // Decode and validate cookie data
    const cookieData = JSON.parse(base64urlDecode(payload))
    const { state: cookieState, verifier: codeVerifier, timestamp } = cookieData

    // Validate state matches (CSRF protection)
    if (state !== cookieState) {
      console.error('State mismatch - possible CSRF attack')
      return c.redirect(`${c.env.FRONTEND_URL || 'https://dj.current.space'}?error=state_mismatch`)
    }

    // Check cookie age (15 minutes max)
    const maxAge = 15 * 60 * 1000
    if (Date.now() - timestamp > maxAge) {
      console.error('OAuth cookie expired')
      return c.redirect(`${c.env.FRONTEND_URL || 'https://dj.current.space'}?error=expired_auth`)
    }

    // Exchange code for tokens server-side
    const tokenResponse = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: c.env.SPOTIFY_CLIENT_ID,
        client_secret: c.env.SPOTIFY_CLIENT_SECRET,
        code_verifier: codeVerifier,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('Token exchange failed:', tokenResponse.status, errorText)
      return c.redirect(`${c.env.FRONTEND_URL || 'https://dj.current.space'}?error=token_exchange_failed`)
    }

    const tokenData = await tokenResponse.json()

    if (!tokenData.access_token) {
      console.error('No access token in response')
      return c.redirect(`${c.env.FRONTEND_URL || 'https://dj.current.space'}?error=no_access_token`)
    }

    // Clear the OAuth cookie
    c.header('Set-Cookie', `spotify_oauth=; Max-Age=0; Secure; SameSite=Lax; Path=/; HttpOnly`)

    // Redirect back to SPA with success and token
    const redirectUrl = new URL(c.env.FRONTEND_URL || 'https://dj.current.space')
    redirectUrl.searchParams.set('spotify_token', tokenData.access_token)
    redirectUrl.searchParams.set('auth_success', 'true')

    return c.redirect(redirectUrl.toString())

  } catch (error) {
    console.error('Callback error:', error)
    return c.redirect(`${c.env.FRONTEND_URL || 'https://dj.current.space'}?error=callback_failed`)
  }
})

// Token exchange endpoint
spotifyRouter.post('/token', async (c) => {
  try {
    const { code, codeVerifier } = await c.req.json()

    if (!code || !codeVerifier) {
      return c.json({ error: 'Missing code or code_verifier' }, 400)
    }

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: c.env.SPOTIFY_CLIENT_ID,
        client_secret: c.env.SPOTIFY_CLIENT_SECRET,
        code_verifier: codeVerifier,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Token exchange failed:', error)
      return c.json({ error: 'Token exchange failed' }, 400)
    }

    const tokenData = await response.json()
    return c.json(tokenData)
  } catch (error) {
    console.error('Token exchange error:', error)
    return c.json({ error: 'Token exchange failed' }, 500)
  }
})

spotifyRouter.post('/search', async (c) => {
  try {
    const requestBody = await c.req.json()
    const searchRequest = safeParse(SearchRequestSchema, requestBody)

    if (!searchRequest) {
      return c.json({ error: 'Invalid search request' }, 400)
    }

    const token = c.req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return c.json({ error: 'No authorization token' }, 401)
    }

    const { query, type } = searchRequest

    const response = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    )

    if (!isSuccessResponse(response)) {
      console.error(`Spotify search failed: ${response.status} ${response.statusText}`)
      return c.json({ error: 'Spotify search failed' }, 500)
    }

    const responseData = await response.json()
    const spotifyData = safeParse(SpotifySearchResponseSchema, responseData)

    if (!spotifyData) {
      console.error('Invalid Spotify search response format')
      return c.json({ error: 'Invalid response from Spotify' }, 500)
    }

    return c.json(spotifyData)
  } catch (error) {
    console.error('Spotify search error:', error)
    const message = error instanceof Error ? error.message : 'Search failed'
    return c.json({ error: message }, 500)
  }
})

// Get user's playlists
spotifyRouter.get('/playlists', async (c) => {
  try {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return c.json({ error: 'No authorization token' }, 401)
    }

    const response = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!isSuccessResponse(response)) {
      console.error(`Get playlists failed: ${response.status} ${response.statusText}`)
      return c.json({ error: 'Failed to get playlists' }, 500)
    }

    const data = await response.json()
    return c.json(data)
  } catch (error) {
    console.error('Get playlists error:', error)
    const message = error instanceof Error ? error.message : 'Failed to get playlists'
    return c.json({ error: message }, 500)
  }
})

// Create a new playlist
spotifyRouter.post('/playlists', async (c) => {
  try {
    const requestBody = await c.req.json()
    const playlistRequest = safeParse(CreatePlaylistRequestSchema, requestBody)

    if (!playlistRequest) {
      return c.json({ error: 'Invalid playlist request' }, 400)
    }

    const token = c.req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return c.json({ error: 'No authorization token' }, 401)
    }

    // First, get the user's Spotify ID
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!isSuccessResponse(userResponse)) {
      return c.json({ error: 'Failed to get user info' }, 500)
    }

    const userData = await userResponse.json()
    const userId = userData.id

    // Create the playlist
    const createResponse = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: playlistRequest.name,
        description: playlistRequest.description,
        public: playlistRequest.public
      })
    })

    if (!isSuccessResponse(createResponse)) {
      console.error(`Create playlist failed: ${createResponse.status} ${createResponse.statusText}`)
      return c.json({ error: 'Failed to create playlist' }, 500)
    }

    const playlist = await createResponse.json()

    // Add tracks to the playlist if provided
    if (playlistRequest.trackUris.length > 0) {
      const addTracksResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uris: playlistRequest.trackUris
        })
      })

      if (!isSuccessResponse(addTracksResponse)) {
        console.error(`Add tracks failed: ${addTracksResponse.status} ${addTracksResponse.statusText}`)
        // Still return the created playlist even if adding tracks failed
        return c.json({
          ...playlist,
          warning: 'Playlist created but some tracks could not be added'
        })
      }
    }

    return c.json(playlist)
  } catch (error) {
    console.error('Create playlist error:', error)
    const message = error instanceof Error ? error.message : 'Failed to create playlist'
    return c.json({ error: message }, 500)
  }
})

// Modify playlist (add or remove tracks)
spotifyRouter.post('/playlists/modify', async (c) => {
  try {
    const requestBody = await c.req.json()
    const modifyRequest = safeParse(ModifyPlaylistRequestSchema, requestBody)

    if (!modifyRequest) {
      return c.json({ error: 'Invalid modify request' }, 400)
    }

    const token = c.req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return c.json({ error: 'No authorization token' }, 401)
    }

    const { playlistId, action, trackUris } = modifyRequest

    if (action === 'add') {
      // Add tracks to playlist
      const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uris: trackUris
        })
      })

      if (!isSuccessResponse(response)) {
        console.error(`Add tracks failed: ${response.status} ${response.statusText}`)
        return c.json({ error: 'Failed to add tracks' }, 500)
      }

      const result = await response.json()
      return c.json({ success: true, action: 'added', snapshot_id: result.snapshot_id })

    } else if (action === 'remove') {
      // Remove tracks from playlist
      const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tracks: trackUris.map(uri => ({ uri }))
        })
      })

      if (!isSuccessResponse(response)) {
        console.error(`Remove tracks failed: ${response.status} ${response.statusText}`)
        return c.json({ error: 'Failed to remove tracks' }, 500)
      }

      const result = await response.json()
      return c.json({ success: true, action: 'removed', snapshot_id: result.snapshot_id })
    }

    return c.json({ error: 'Invalid action' }, 400)
  } catch (error) {
    console.error('Modify playlist error:', error)
    const message = error instanceof Error ? error.message : 'Failed to modify playlist'
    return c.json({ error: message }, 500)
  }
})

// Get playlist tracks
spotifyRouter.get('/playlists/:id/tracks', async (c) => {
  try {
    const playlistId = c.req.param('id')
    const token = c.req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return c.json({ error: 'No authorization token' }, 401)
    }

    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!isSuccessResponse(response)) {
      console.error(`Get playlist tracks failed: ${response.status} ${response.statusText}`)
      return c.json({ error: 'Failed to get playlist tracks' }, 500)
    }

    const data = await response.json()
    return c.json(data)
  } catch (error) {
    console.error('Get playlist tracks error:', error)
    const message = error instanceof Error ? error.message : 'Failed to get playlist tracks'
    return c.json({ error: message }, 500)
  }
})

export { spotifyRouter }