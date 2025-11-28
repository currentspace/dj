/**
 * Authentication API contracts
 * Spotify OAuth flow with PKCE and token management
 */

import {createRoute, z} from '@hono/zod-openapi'

/**
 * GET /api/spotify/auth-url
 * Returns Spotify OAuth authorization URL with PKCE
 * Sets secure HttpOnly cookie with code_verifier
 */
export const getSpotifyAuthUrl = createRoute({
  description: 'Get Spotify OAuth authorization URL (PKCE flow)',
  method: 'get',
  path: '/api/spotify/auth-url',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            url: z.string().url(),
          }),
        },
      },
      description: 'OAuth URL generated successfully. Code verifier stored in secure cookie.',
    },
    500: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Server error',
    },
  },
  tags: ['Auth'],
})

/**
 * GET /api/spotify/callback
 * OAuth callback handler - exchanges code for token
 * Redirects back to frontend with token
 */
export const handleSpotifyCallback = createRoute({
  description: 'Handle OAuth callback and exchange code for token (server-side)',
  method: 'get',
  path: '/api/spotify/callback',
  request: {
    query: z.object({
      code: z.string().optional(),
      error: z.string().optional(),
      state: z.string().optional(),
    }),
  },
  responses: {
    302: {
      description: 'Redirect to frontend with token or error',
    },
  },
  tags: ['Auth'],
})

/**
 * POST /api/spotify/token
 * Exchange authorization code for access token (alternative flow)
 */
export const exchangeSpotifyToken = createRoute({
  description: 'Exchange authorization code for Spotify access token',
  method: 'post',
  path: '/api/spotify/token',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            code: z.string().min(1),
            codeVerifier: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            access_token: z.string(),
            expires_in: z.number(),
            refresh_token: z.string().optional(),
            scope: z.string(),
            token_type: z.literal('Bearer'),
          }),
        },
      },
      description: 'Token exchanged successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
            error_description: z.string().optional(),
          }),
        },
      },
      description: 'Invalid request',
    },
    500: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
            error_description: z.string().optional(),
          }),
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Auth'],
})

/**
 * GET /api/spotify/me
 * Get current user's Spotify profile (for token validation)
 */
export const getSpotifyMe = createRoute({
  description: 'Get current user profile (validates token)',
  method: 'get',
  path: '/api/spotify/me',
  request: {
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            country: z.string().optional(),
            display_name: z.string().nullable(),
            email: z.string().optional(),
            id: z.string(),
            product: z.string().optional(),
          }),
        },
      },
      description: 'User profile retrieved successfully',
    },
    401: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Invalid or expired token',
    },
  },
  tags: ['Auth'],
})

/**
 * GET /api/spotify/debug/scopes
 * Debug endpoint to check OAuth scopes and permissions
 */
export const getSpotifyDebugScopes = createRoute({
  description: 'Debug endpoint to check OAuth scopes and permissions',
  method: 'get',
  path: '/api/spotify/debug/scopes',
  request: {
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            instructions: z.object({
              if_audio_features_forbidden: z.string(),
              logout_method: z.string(),
            }),
            required_scopes: z.array(z.string()),
            scope_tests: z.object({
              'audio-features': z.object({
                accessible: z.boolean(),
                note: z.string(),
                status: z.number(),
              }),
              'playlist-read-private': z.boolean(),
              'user-read-private': z.boolean(),
            }),
            token_info: z.object({
              country: z.string(),
              display_name: z.string(),
              email: z.string(),
              product: z.string(),
              user_id: z.string(),
            }),
          }),
        },
      },
      description: 'Scope debug information',
    },
    401: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Invalid or expired token',
    },
  },
  tags: ['Auth'],
})

/**
 * POST /api/spotify/search
 * Search Spotify catalog
 */
export const searchSpotify = createRoute({
  description: 'Search Spotify for tracks, albums, or artists',
  method: 'post',
  path: '/api/spotify/search',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            query: z.string().min(1),
            type: z.enum(['track', 'album', 'artist']).default('track'),
          }),
        },
      },
    },
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            tracks: z
              .object({
                items: z.array(z.unknown()), // Use SpotifyTrackSchema from shared-types
              })
              .optional(),
          }),
        },
      },
      description: 'Search results',
    },
    400: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Invalid request',
    },
    401: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Unauthorized',
    },
    500: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Spotify'],
})
