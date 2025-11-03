/**
 * Playlist API contracts
 * CRUD operations for Spotify playlists
 */

import {SpotifyPlaylistSimpleSchema, UserPlaylistsResponseSchema} from '@dj/shared-types'
import {createRoute, z} from '@hono/zod-openapi'

/**
 * GET /api/spotify/playlists
 * Get current user's playlists
 */
export const getUserPlaylists = createRoute({
  description: "Get current user's Spotify playlists",
  method: 'get',
  path: '/api/spotify/playlists',
  request: {
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/),
    }),
    query: z.object({
      limit: z.coerce.number().min(1).max(50).default(20).optional(),
      offset: z.coerce.number().min(0).default(0).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {

          schema: UserPlaylistsResponseSchema,
        },
      },
      description: 'Playlists retrieved successfully',
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
  tags: ['Playlists'],
})

/**
 * GET /api/spotify/playlists/:id/tracks
 * Get tracks from a specific playlist
 */
export const getPlaylistTracks = createRoute({
  description: 'Get tracks from a specific playlist',
  method: 'get',
  path: '/api/spotify/playlists/{id}/tracks',
  request: {
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/),
    }),
    params: z.object({
      id: z.string().min(1),
    }),
    query: z.object({
      limit: z.coerce.number().min(1).max(100).default(50).optional(),
      offset: z.coerce.number().min(0).default(0).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(z.unknown()), // Track items
          }),
        },
      },
      description: 'Playlist tracks retrieved successfully',
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
    404: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Playlist not found',
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
  tags: ['Playlists'],
})

/**
 * POST /api/spotify/playlists
 * Create a new playlist
 */
export const createPlaylist = createRoute({
  description: 'Create a new Spotify playlist',
  method: 'post',
  path: '/api/spotify/playlists',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            description: z.string().max(300).optional(),
            name: z.string().min(1).max(100),
            public: z.boolean().default(false),
          }),
        },
      },
    },
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/),
    }),
  },
  responses: {
    201: {
      content: {
        'application/json': {

          schema: SpotifyPlaylistSimpleSchema,
        },
      },
      description: 'Playlist created successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: 'Invalid request body',
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
  tags: ['Playlists'],
})

/**
 * POST /api/spotify/playlists/modify
 * Add or remove tracks from a playlist
 */
export const modifyPlaylist = createRoute({
  description: 'Add or remove tracks from a Spotify playlist',
  method: 'post',
  path: '/api/spotify/playlists/modify',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            action: z.enum(['add', 'remove']),
            playlistId: z.string().min(1),
            trackUris: z.array(z.string()).min(1).max(100),
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
            action: z.string(),
            snapshot_id: z.string(),
            success: z.boolean(),
          }),
        },
      },
      description: 'Playlist modified successfully',
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
  tags: ['Playlists'],
})
