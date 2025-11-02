/**
 * Chat API contracts
 * AI-powered playlist generation and analysis
 */

import {ChatMessageSchema, ChatRequestSchema} from '@dj/shared-types'
import {createRoute, z} from '@hono/zod-openapi'

/**
 * POST /api/chat-stream/message
 * Stream AI chat responses via Server-Sent Events
 */
export const streamChatMessage = createRoute({
  description: 'Stream AI chat responses for playlist generation and analysis',
  method: 'post',
  path: '/api/chat-stream/message',
  request: {
    body: {
      content: {
        'application/json': {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          schema: ChatRequestSchema,
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
        'text/event-stream': {
          schema: z.object({
            // SSE stream - individual events not typed here
          }),
        },
      },
      description: 'Streaming response started',
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
  },
  tags: ['Chat'],
})

/**
 * POST /api/chat/message
 * Non-streaming chat endpoint (for debugging/testing)
 */
export const sendChatMessage = createRoute({
  description: 'Send chat message and get complete response',
  method: 'post',
  path: '/api/chat/message',
  request: {
    body: {
      content: {
        'application/json': {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          schema: ChatRequestSchema,
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
            conversationHistory: z.array(ChatMessageSchema),
            message: z.string(),
          }),
        },
      },
      description: 'Chat response',
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
  },
  tags: ['Chat'],
})
