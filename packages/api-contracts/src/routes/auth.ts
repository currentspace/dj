/**
 * Authentication API contracts
 * Spotify OAuth flow and token management
 */

import { createRoute, z } from '@hono/zod-openapi';
import { SpotifyAuthResponseSchema } from '@dj/shared-types';

/**
 * GET /api/spotify/auth
 * Returns Spotify OAuth authorization URL
 */
export const getSpotifyAuthUrl = createRoute({
  description: 'Get Spotify OAuth authorization URL',
  method: 'get',
  path: '/api/spotify/auth',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SpotifyAuthResponseSchema,
        },
      },
      description: 'OAuth URL generated successfully',
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
});

/**
 * POST /api/spotify/token
 * Exchange authorization code for access token
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
            redirect_uri: z.string().url(),
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
      description: 'Invalid authorization code',
    },
  },
  tags: ['Auth'],
});

/**
 * GET /api/spotify/me
 * Get current user profile (requires auth)
 */
export const getCurrentUser = createRoute({
  description: 'Get current Spotify user profile',
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
            email: z.string().email().optional(),
            id: z.string(),
            images: z.array(z.object({
              height: z.number().nullable(),
              url: z.string().url(),
              width: z.number().nullable(),
            })),
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
      description: 'Unauthorized - invalid or expired token',
    },
  },
  tags: ['Auth'],
});
