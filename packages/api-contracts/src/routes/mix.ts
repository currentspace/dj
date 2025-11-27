/**
 * Mix API contracts
 * Live DJ Mode mix session management
 */

import {
  AddToQueueRequestSchema,
  AddToQueueResponseSchema,
  EndMixResponseSchema,
  GetMixSessionResponseSchema,
  GetQueueResponseSchema,
  GetSuggestionsResponseSchema,
  GetVibeResponseSchema,
  RemoveFromQueueResponseSchema,
  ReorderQueueRequestSchema,
  ReorderQueueResponseSchema,
  SaveMixRequestSchema,
  SaveMixResponseSchema,
  StartMixRequestSchema,
  StartMixResponseSchema,
  SteerVibeRequestSchema,
  SteerVibeResponseSchema,
  UpdateVibeRequestSchema,
  UpdateVibeResponseSchema,
} from '@dj/shared-types'
import {createRoute, z} from '@hono/zod-openapi'

const ErrorResponseSchema = z.object({
  error: z.string(),
})

const authHeaders = z.object({
  authorization: z.string().regex(/^Bearer .+$/),
})

/**
 * POST /api/mix/start
 * Create a new mix session
 */
export const startMix = createRoute({
  description: 'Start a new Live DJ Mode mix session',
  method: 'post',
  path: '/api/mix/start',
  request: {
    body: {
      content: {
        'application/json': {
          schema: StartMixRequestSchema,
        },
      },
    },
    headers: authHeaders,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: StartMixResponseSchema,
        },
      },
      description: 'Mix session created successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid request body',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})

/**
 * GET /api/mix/current
 * Get current mix session state
 */
export const getCurrentMix = createRoute({
  description: 'Get current mix session state',
  method: 'get',
  path: '/api/mix/current',
  request: {
    headers: authHeaders,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: GetMixSessionResponseSchema,
        },
      },
      description: 'Current mix session',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})

/**
 * DELETE /api/mix/end
 * End current mix session
 */
export const endMix = createRoute({
  description: 'End current mix session',
  method: 'delete',
  path: '/api/mix/end',
  request: {
    headers: authHeaders,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: EndMixResponseSchema,
        },
      },
      description: 'Mix session ended successfully',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'No active session',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})

/**
 * GET /api/mix/queue
 * Get current queue
 */
export const getQueue = createRoute({
  description: 'Get current mix queue',
  method: 'get',
  path: '/api/mix/queue',
  request: {
    headers: authHeaders,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: GetQueueResponseSchema,
        },
      },
      description: 'Current queue',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'No active session',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})

/**
 * POST /api/mix/queue/add
 * Add track to queue
 */
export const addToQueue = createRoute({
  description: 'Add a track to the mix queue',
  method: 'post',
  path: '/api/mix/queue/add',
  request: {
    body: {
      content: {
        'application/json': {
          schema: AddToQueueRequestSchema,
        },
      },
    },
    headers: authHeaders,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: AddToQueueResponseSchema,
        },
      },
      description: 'Track added to queue successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid request or queue full',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'No active session',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})

/**
 * DELETE /api/mix/queue/:position
 * Remove track from queue
 */
export const removeFromQueue = createRoute({
  description: 'Remove a track from the mix queue',
  method: 'delete',
  path: '/api/mix/queue/{position}',
  request: {
    headers: authHeaders,
    params: z.object({
      position: z.coerce.number().int().min(0),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: RemoveFromQueueResponseSchema,
        },
      },
      description: 'Track removed from queue successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid position',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'No active session',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})

/**
 * PUT /api/mix/queue/reorder
 * Reorder queue items
 */
export const reorderQueue = createRoute({
  description: 'Reorder tracks in the mix queue',
  method: 'put',
  path: '/api/mix/queue/reorder',
  request: {
    body: {
      content: {
        'application/json': {
          schema: ReorderQueueRequestSchema,
        },
      },
    },
    headers: authHeaders,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ReorderQueueResponseSchema,
        },
      },
      description: 'Queue reordered successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid positions',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'No active session',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})

/**
 * GET /api/mix/vibe
 * Get current vibe profile
 */
export const getVibe = createRoute({
  description: 'Get current vibe profile',
  method: 'get',
  path: '/api/mix/vibe',
  request: {
    headers: authHeaders,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: GetVibeResponseSchema,
        },
      },
      description: 'Current vibe profile',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'No active session',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})

/**
 * PUT /api/mix/vibe
 * Update vibe preferences
 */
export const updateVibe = createRoute({
  description: 'Update vibe preferences',
  method: 'put',
  path: '/api/mix/vibe',
  request: {
    body: {
      content: {
        'application/json': {
          schema: UpdateVibeRequestSchema,
        },
      },
    },
    headers: authHeaders,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: UpdateVibeResponseSchema,
        },
      },
      description: 'Vibe updated successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid request',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'No active session',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})

/**
 * POST /api/mix/vibe/steer
 * Natural language vibe steering (placeholder for Agent 7)
 */
export const steerVibe = createRoute({
  description: 'Steer vibe using natural language (AI-powered)',
  method: 'post',
  path: '/api/mix/vibe/steer',
  request: {
    body: {
      content: {
        'application/json': {
          schema: SteerVibeRequestSchema,
        },
      },
    },
    headers: authHeaders,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SteerVibeResponseSchema,
        },
      },
      description: 'Vibe steered successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid request',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'No active session',
    },
    501: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Not implemented yet (placeholder for Agent 7)',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})

/**
 * GET /api/mix/suggestions
 * Get AI suggestions for next tracks
 */
export const getSuggestions = createRoute({
  description: 'Get AI-powered track suggestions based on current vibe',
  method: 'get',
  path: '/api/mix/suggestions',
  request: {
    headers: authHeaders,
    query: z.object({
      count: z.coerce.number().int().min(1).max(10).default(5).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: GetSuggestionsResponseSchema,
        },
      },
      description: 'Suggestions generated successfully',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'No active session',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})

/**
 * POST /api/mix/save
 * Save mix as Spotify playlist
 */
export const saveMix = createRoute({
  description: 'Save current mix as a Spotify playlist',
  method: 'post',
  path: '/api/mix/save',
  request: {
    body: {
      content: {
        'application/json': {
          schema: SaveMixRequestSchema,
        },
      },
    },
    headers: authHeaders,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SaveMixResponseSchema,
        },
      },
      description: 'Mix saved successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid request',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'No active session',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Mix'],
})
