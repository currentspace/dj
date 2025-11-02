/**
 * Spotify API routes using OpenAPI contracts
 * Migrated from spotify.ts to use @hono/zod-openapi
 */

import type {OpenAPIHono} from '@hono/zod-openapi'

import {exchangeSpotifyToken, getSpotifyAuthUrl, handleSpotifyCallback, searchSpotify} from '@dj/api-contracts'

import {parse, SpotifySearchResponseSchema, SpotifyTokenResponseSchema} from '@dj/shared-types'

import type {Env} from '../index'

import {isSuccessResponse, safeParse} from '../lib/guards'

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

// Base64URL helpers (URL-safe encoding)
function base64urlEncode(data: string): string {
  return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
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

  const cryptoKey = await crypto.subtle.importKey('raw', keyData, {hash: 'SHA-256', name: 'HMAC'}, false, ['sign'])

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer)
  return base64urlEncode(String.fromCharCode(...new Uint8Array(signature)))
}

async function hmacVerify(data: string, signature: string, key: string): Promise<boolean> {
  const expectedSignature = await hmacSign(data, key)
  return expectedSignature === signature
}

/**
 * Register Spotify auth routes on the provided OpenAPI app
 */
export function registerSpotifyAuthRoutes(app: OpenAPIHono<{Bindings: Env}>) {
  // GET /api/spotify/auth-url - Generate OAuth URL with PKCE
  app.openapi(getSpotifyAuthUrl, async c => {
    const env = c.env as Env

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
        'playlist-modify-public playlist-modify-private user-read-private user-read-playback-state user-read-currently-playing user-read-recently-played user-top-read playlist-read-private playlist-read-collaborative',
      show_dialog: 'true',
      state: state, // Only random state in URL, no secrets
    })

    // Set secure, SameSite cookie with verifier
    c.header('Set-Cookie', `spotify_oauth=${cookieValue}; Max-Age=900; Secure; SameSite=Lax; Path=/; HttpOnly`)

    // Response automatically validated against contract schema
    return c.json({
      url: `${SPOTIFY_AUTH_URL}?${params.toString()}`,
    })
  })

  // GET /api/spotify/callback - OAuth callback handler
  app.openapi(handleSpotifyCallback, async c => {
    const env = c.env as Env

    try {
      // Query params automatically validated by contract
      const code = c.req.query('code')
      const state = c.req.query('state')
      const error = c.req.query('error')

      if (error) {
        console.error('OAuth error:', error)
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=${encodeURIComponent(error)}`)
      }

      if (!code || !state) {
        console.error('Missing code or state parameter')
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=missing_parameters`)
      }

      // Retrieve and verify the signed cookie
      const cookieHeader = c.req.header('Cookie')
      const cookieMatch = cookieHeader?.match(/spotify_oauth=([^;]+)/)
      const cookieValue = cookieMatch?.[1]

      if (!cookieValue) {
        console.error('Missing OAuth cookie')
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=missing_cookie`)
      }

      const [payload, signature] = cookieValue.split('.')
      if (!payload || !signature) {
        console.error('Invalid cookie format')
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=invalid_cookie`)
      }

      // Verify HMAC signature
      const isValidSignature = await hmacVerify(payload, signature, env.SPOTIFY_CLIENT_SECRET)
      if (!isValidSignature) {
        console.error('Invalid cookie signature')
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=tampered_cookie`)
      }

      // Decode and validate cookie data
      const cookieData = JSON.parse(base64urlDecode(payload))
      const {state: cookieState, timestamp, verifier: codeVerifier} = cookieData

      // Validate state matches (CSRF protection)
      if (state !== cookieState) {
        console.error('State mismatch - possible CSRF attack')
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=state_mismatch`)
      }

      // Check cookie age (15 minutes max)
      const maxAge = 15 * 60 * 1000
      if (Date.now() - timestamp > maxAge) {
        console.error('OAuth cookie expired')
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
        console.error('Token exchange failed:', tokenResponse.status, errorText)
        return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=token_exchange_failed`)
      }

      const data = await tokenResponse.json()
      let tokenData
      try {
        tokenData = parse(SpotifyTokenResponseSchema, data)
      } catch (error) {
        console.error('Invalid token response format:', error)
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
      console.error('Callback error:', error)
      return c.redirect(`${env.FRONTEND_URL ?? 'https://dj.current.space'}?error=callback_failed`)
    }
  })

  // POST /api/spotify/token - Exchange authorization code for token
  app.openapi(exchangeSpotifyToken, async c => {
    const env = c.env as Env

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
        console.error('Token exchange failed:', errorText)
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
        console.error('Invalid token response format:', error)
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
      })
    } catch (error) {
      console.error('Token exchange error:', error)
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
  app.openapi(searchSpotify, async c => {
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
        console.error(`Spotify search failed: ${response.status} ${response.statusText}`)
        return c.json({error: 'Spotify search failed'}, 400)
      }

      const responseData = await response.json()
      const spotifyData = safeParse(SpotifySearchResponseSchema, responseData)

      if (!spotifyData) {
        console.error('Invalid Spotify search response format')
        return c.json({error: 'Invalid response from Spotify'}, 400)
      }

      // Response automatically validated against contract schema
      return c.json(spotifyData)
    } catch (error) {
      console.error('Spotify search error:', error)
      const message = error instanceof Error ? error.message : 'Search failed'
      return c.json({error: message}, 401)
    }
  })
}
