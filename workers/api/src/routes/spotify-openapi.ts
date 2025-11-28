/**
 * Spotify API routes using OpenAPI contracts
 * Migrated from spotify.ts to use @hono/zod-openapi
 */

import type {OpenAPIHono} from '@hono/zod-openapi'

import {
  exchangeSpotifyToken,
  getSpotifyAuthUrl,
  getSpotifyDebugScopes,
  getSpotifyMe,
  handleSpotifyCallback,
  searchSpotify,
} from '@dj/api-contracts'
import {SpotifySearchResponseSchema, SpotifyTokenResponseSchema} from '@dj/shared-types'

import type {Env} from '../index'

import {isSuccessResponse, parse, safeParse} from '../lib/guards'
import {getLogger} from '../utils/LoggerContext'

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const REDIRECT_URI = 'https://dj.current.space/api/spotify/callback'

/**
 * Register Spotify auth routes on the provided OpenAPI app
 */
export function registerSpotifyAuthRoutes(app: OpenAPIHono<{Bindings: Env}>) {
  // GET /api/spotify/auth-url - Generate OAuth URL with PKCE
  app.openapi(getSpotifyAuthUrl, async (c) => {
    const env = c.env

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)

    // Generate random state for CSRF protection (no secrets in URL)
    const state = crypto.randomUUID()

    // Create signed cookie payload with verifier
    const cookieData = {
      state,
      timestamp: Date.now(),
      verifier: codeVerifier,
    }

    const payload = base64urlEncode(JSON.stringify(cookieData))
    const signature = await hmacSign(payload, env.SPOTIFY_CLIENT_SECRET) // Use client secret as HMAC key
    const cookieValue = `${payload}.${signature}`

    const params = new URLSearchParams({
      client_id: env.SPOTIFY_CLIENT_ID,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope:
        'playlist-modify-public playlist-modify-private user-read-private user-read-playback-state user-read-currently-playing user-read-recently-played user-top-read playlist-read-private playlist-read-collaborative user-modify-playback-state streaming',
      show_dialog: 'true',
      state: state, // Only random state in URL, no secrets
    })

    // Set secure, SameSite cookie with verifier
    c.header('Set-Cookie', `spotify_oauth=${cookieValue}; Max-Age=900; Secure; SameSite=Lax; Path=/; HttpOnly`)

    // Response automatically validated against contract schema
    return c.json({
      url: `${SPOTIFY_AUTH_URL}?${params.toString()}`,
    }, 200)
  })

  // GET /api/spotify/callback - OAuth callback handler
  app.openapi(handleSpotifyCallback, async c => {
    const env = c.env

    try {
      // Query params automatically validated by contract
      const code = c.req.query('code')
      const state = c.req.query('state')
      const error = c.req.query('error')

      if (error) {
        getLogger()?.error('OAuth error:', error)
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=${encodeURIComponent(error)}`)
      }

      if (!code || !state) {
        getLogger()?.error('Missing code or state parameter')
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=missing_parameters`)
      }

      // Retrieve and verify the signed cookie
      const cookieHeader = c.req.header('Cookie')
      const cookieMatch = cookieHeader?.match(/spotify_oauth=([^;]+)/)
      const cookieValue = cookieMatch?.[1]

      if (!cookieValue) {
        getLogger()?.error('Missing OAuth cookie')
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=missing_cookie`)
      }

      const [payload, signature] = cookieValue.split('.')
      if (!payload || !signature) {
        getLogger()?.error('Invalid cookie format')
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=invalid_cookie`)
      }

      // Verify HMAC signature
      const isValidSignature = await hmacVerify(payload, signature, env.SPOTIFY_CLIENT_SECRET)
      if (!isValidSignature) {
        getLogger()?.error('Invalid cookie signature')
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=tampered_cookie`)
      }

      // Decode and validate cookie data
      const cookieData = JSON.parse(base64urlDecode(payload))
      const {state: cookieState, timestamp, verifier: codeVerifier} = cookieData

      // Validate state matches (CSRF protection)
      if (state !== cookieState) {
        getLogger()?.error('State mismatch - possible CSRF attack')
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=state_mismatch`)
      }

      // Check cookie age (15 minutes max)
      const maxAge = 15 * 60 * 1000
      if (Date.now() - timestamp > maxAge) {
        getLogger()?.error('OAuth cookie expired')
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=expired_auth`)
      }

      // Exchange code for tokens server-side
      const tokenResponse = await fetch(SPOTIFY_TOKEN_URL, {
        body: new URLSearchParams({
          client_id: env.SPOTIFY_CLIENT_ID,
          client_secret: env.SPOTIFY_CLIENT_SECRET,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        getLogger()?.error('Token exchange failed:', tokenResponse.status, {errorText})
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=token_exchange_failed`)
      }

      const data = await tokenResponse.json()
      let tokenData
      try {
        tokenData = parse(SpotifyTokenResponseSchema, data)
      } catch (error) {
        getLogger()?.error('Invalid token response format:', error)
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=invalid_token_response`)
      }

      // Clear the OAuth cookie
      c.header('Set-Cookie', `spotify_oauth=; Max-Age=0; Secure; SameSite=Lax; Path=/; HttpOnly`)

      // Redirect back to SPA with success and token
      const redirectUrl = new URL(env.FRONTEND_URL ?? 'https://dj.current.space')
      redirectUrl.searchParams.set('spotify_token', tokenData.access_token)
      redirectUrl.searchParams.set('auth_success', 'true')

      return c.redirect(redirectUrl.toString())
    } catch (error) {
      getLogger()?.error('Callback error:', error)
      return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=callback_failed`)
    }
  })

  // POST /api/spotify/token - Exchange authorization code for token
  app.openapi(exchangeSpotifyToken, async (c) => {
    const env = c.env

    try {
      // Request body automatically validated by contract
      const {code, codeVerifier} = await c.req.json()

      const response = await fetch(SPOTIFY_TOKEN_URL, {
        body: new URLSearchParams({
          client_id: env.SPOTIFY_CLIENT_ID,
          client_secret: env.SPOTIFY_CLIENT_SECRET,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
      })

      if (!response.ok) {
        const errorText = await response.text()
        getLogger()?.error('Token exchange failed:', errorText)
        return c.json(
          {
            error: 'Token exchange failed',
            error_description: errorText,
          },
          400,
        )
      }

      const data = await response.json()
      let tokenData
      try {
        tokenData = parse(SpotifyTokenResponseSchema, data)
      } catch (error) {
        getLogger()?.error('Invalid token response format:', error)
        return c.json(
          {
            error: 'Invalid token response',
            error_description: error instanceof Error ? error.message : 'Unknown error',
          },
          400,
        )
      }

      // Response automatically validated against contract schema
      return c.json({
        access_token: tokenData.access_token,
        expires_in: tokenData.expires_in,
        refresh_token: tokenData.refresh_token,
        scope: tokenData.scope,
        token_type: 'Bearer' as const,
      }, 200)
    } catch (error) {
      getLogger()?.error('Token exchange error:', error)
      return c.json(
        {
          error: 'Token exchange failed',
          error_description: error instanceof Error ? error.message : 'Unknown error',
        },
        400,
      )
    }
  })

  // POST /api/spotify/search - Search Spotify catalog
  app.openapi(searchSpotify, async (c) => {
    try {
      // Headers and body automatically validated by contract
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      const {query, type} = await c.req.json()

      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const response = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=10`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      )

      if (!isSuccessResponse(response)) {
        getLogger()?.error(`Spotify search failed: ${response.status} ${response.statusText}`)
        return c.json({error: 'Spotify search failed'}, 400)
      }

      const responseData = await response.json()
      const spotifyResult = safeParse(SpotifySearchResponseSchema, responseData)

      if (!spotifyResult.success) {
        getLogger()?.error('Invalid Spotify search response format')
        return c.json({error: 'Invalid response from Spotify'}, 400)
      }

      // Response automatically validated against contract schema
      return c.json(spotifyResult.data, 200)
    } catch (error) {
      getLogger()?.error('Spotify search error:', error)
      const message = error instanceof Error ? error.message : 'Search failed'
      return c.json({error: message}, 401)
    }
  })

  // GET /api/spotify/me - Get current user profile (token validation)
  app.openapi(getSpotifyMe, async (c) => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')

      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!isSuccessResponse(response)) {
        getLogger()?.error(`Get user profile failed: ${response.status}`)
        return c.json({error: 'Invalid or expired token'}, 401)
      }

      const data = await response.json() as {
        country?: string
        display_name: string | null
        email?: string
        id: string
        product?: string
      }

      return c.json({
        country: data.country,
        display_name: data.display_name,
        email: data.email,
        id: data.id,
        product: data.product,
      }, 200)
    } catch (error) {
      getLogger()?.error('Get user profile error:', error)
      return c.json({error: 'Failed to get user profile'}, 401)
    }
  })

  // GET /api/spotify/debug/scopes - Debug OAuth scopes
  app.openapi(getSpotifyDebugScopes, async (c) => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')

      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      // Test user-read-private scope
      const userResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (!isSuccessResponse(userResponse)) {
        return c.json({error: 'Invalid or expired token'}, 401)
      }

      const userData = await userResponse.json() as {
        country?: string
        display_name?: string
        email?: string
        id: string
        product?: string
      }

      // Test playlist-read-private scope
      const playlistResponse = await fetch('https://api.spotify.com/v1/me/playlists?limit=1', {
        headers: {Authorization: `Bearer ${token}`},
      })

      // Test audio-features scope (requires user-read-private and potentially premium)
      // Use a known track ID to test
      const audioFeaturesResponse = await fetch(
        'https://api.spotify.com/v1/audio-features/4iV5W9uYEdYUVa79Axb7Rh',
        {headers: {Authorization: `Bearer ${token}`}},
      )

      const requiredScopes = [
        'playlist-modify-public',
        'playlist-modify-private',
        'user-read-private',
        'user-read-playback-state',
        'user-read-currently-playing',
        'user-read-recently-played',
        'user-top-read',
        'playlist-read-private',
        'playlist-read-collaborative',
        'user-modify-playback-state',
        'streaming',
      ]

      return c.json({
        instructions: {
          if_audio_features_forbidden:
            'Audio features API may require app authorization. Contact Spotify developer support if needed.',
          logout_method: 'Click the logout button in the app header to clear your session.',
        },
        required_scopes: requiredScopes,
        scope_tests: {
          'audio-features': {
            accessible: audioFeaturesResponse.ok,
            note: audioFeaturesResponse.ok
              ? 'Audio features accessible'
              : `Status ${audioFeaturesResponse.status}: ${audioFeaturesResponse.status === 403 ? 'Forbidden - may need app authorization' : 'Not accessible'}`,
            status: audioFeaturesResponse.status,
          },
          'playlist-read-private': playlistResponse.ok,
          'user-read-private': userResponse.ok,
        },
        token_info: {
          country: userData.country ?? 'Unknown',
          display_name: userData.display_name ?? 'Unknown',
          email: userData.email ?? 'Not provided',
          product: userData.product ?? 'Unknown',
          user_id: userData.id,
        },
      }, 200)
    } catch (error) {
      getLogger()?.error('Scope debug error:', error)
      return c.json({error: 'Failed to check scopes'}, 401)
    }
  })
}

function base64urlDecode(data: string): string {
  const pad = data.length % 4
  const padded = data + '='.repeat(pad === 0 ? 0 : 4 - pad)
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
}

// Base64URL helpers (URL-safe encoding)
function base64urlEncode(data: string): string {
  return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
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

// PKCE helper functions
function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode.apply(null, Array.from(array)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

// HMAC helper for cookie integrity
async function hmacSign(data: string, key: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(key)
  const dataBuffer = encoder.encode(data)

  const cryptoKey = await crypto.subtle.importKey('raw', keyData, {hash: 'SHA-256', name: 'HMAC'}, false, ['sign'])

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer)
  return base64urlEncode(String.fromCharCode(...new Uint8Array(signature)))
}

async function hmacVerify(data: string, signature: string, key: string): Promise<boolean> {
  const expectedSignature = await hmacSign(data, key)
  return expectedSignature === signature
}
