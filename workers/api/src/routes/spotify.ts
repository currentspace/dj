import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../index'
import { SpotifySearchResponseSchema } from '../lib/schemas'
import { safeParse, isSuccessResponse } from '../lib/guards'

const spotifyRouter = new Hono<{ Bindings: Env }>()

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const REDIRECT_URI = 'https://dj.current.space/callback'

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

spotifyRouter.get('/auth-url', async (c) => {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  const params = new URLSearchParams({
    client_id: c.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    scope: 'playlist-modify-public playlist-modify-private user-read-private',
    show_dialog: 'true'
  })

  return c.json({
    url: `${SPOTIFY_AUTH_URL}?${params.toString()}`,
    codeVerifier // Frontend needs this to exchange the code for tokens
  })
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

export { spotifyRouter }