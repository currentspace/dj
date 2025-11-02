/**
 * Playlist API contracts
 * CRUD operations for Spotify playlists
 */

import { createRoute, z } from '@hono/zod-openapi';
import {
  SpotifyPlaylistSimpleSchema,
  UserPlaylistsResponseSchema,
} from '@dj/shared-types';

/**
 * GET /api/spotify/playlists
 * Get current user's playlists
 */
export const getUserPlaylists = createRoute({
  description: 'Get current user\'s Spotify playlists',
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
  },
  tags: ['Playlists'],
});

/**
 * GET /api/spotify/playlists/:id
 * Get specific playlist details
 */
export const getPlaylist = createRoute({
  description: 'Get detailed information about a specific playlist',
  method: 'get',
  path: '/api/spotify/playlists/{id}',
  request: {
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/),
    }),
    params: z.object({
      id: z.string().min(1),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SpotifyPlaylistSimpleSchema,
        },
      },
      description: 'Playlist retrieved successfully',
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
  },
  tags: ['Playlists'],
});

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
  },
  tags: ['Playlists'],
});

/**
 * POST /api/spotify/playlists/:id/tracks
 * Add tracks to a playlist
 */
export const addTracksToPlaylist = createRoute({
  description: 'Add tracks to a Spotify playlist',
  method: 'post',
  path: '/api/spotify/playlists/{id}/tracks',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            position: z.number().min(0).optional(),
            uris: z.array(z.string().startsWith('spotify:track:')).min(1).max(100),
          }),
        },
      },
    },
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/),
    }),
    params: z.object({
      id: z.string().min(1),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            snapshot_id: z.string(),
          }),
        },
      },
      description: 'Tracks added successfully',
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
  },
  tags: ['Playlists'],
});
