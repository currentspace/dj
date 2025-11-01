import { Hono } from 'hono';
import { z } from 'zod';

import type { Env } from '../index';

const fallbackRouter = new Hono<{ Bindings: Env }>();

// Request schema
const ChatRequestSchema = z.object({
  conversationHistory: z.array(z.object({
    content: z.string(),
    role: z.enum(['user', 'assistant'])
  })).max(20).default([]),
  message: z.string().min(1).max(2000),
  mode: z.enum(['analyze', 'create', 'edit']).default('analyze')
});

/**
 * Fallback chat endpoint without tools for when Anthropic is overloaded
 * Provides basic responses without Spotify integration
 */
fallbackRouter.post('/message', async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[Fallback:${requestId}] Handling request without tools due to service overload`);

  try {
    const body = await c.req.json();
    const request = ChatRequestSchema.parse(body);

    // Provide helpful fallback responses based on mode
    let response = '';

    if (request.mode === 'create') {
      response = `I'm experiencing high demand right now and can't create playlists directly. However, here's what you can do:

1. Try again in a few minutes when the service is less busy
2. Use Spotify's search to find playlists matching: "${request.message}"
3. Create a playlist manually with these search terms:
   - Genre/mood keywords from your request
   - Similar artists you mentioned
   - Time period or era if specified

The service usually recovers quickly, so please try again soon!`;
    } else if (request.mode === 'analyze') {
      response = `The AI service is currently overloaded and I can't analyze music right now.

You asked about: "${request.message}"

While I can't provide detailed analysis at the moment, you can:
- Check the track's audio features in Spotify (look for energy, danceability, tempo)
- Look at the "Song Radio" feature for similar tracks
- Check the artist's genre tags and related artists

Please try again in a few minutes for full analysis capabilities!`;
    } else {
      response = `The service is temporarily overloaded. Your request about editing playlists ("${request.message}") couldn't be processed right now.

Please try again in a few minutes. The service typically recovers quickly from high load.`;
    }

    return c.json({
      conversationHistory: [
        ...request.conversationHistory,
        { content: request.message, role: 'user' as const },
        { content: response, role: 'assistant' as const }
      ],
      fallbackMode: true,
      message: response,
      requestId
    });

  } catch (error) {
    console.error(`[Fallback:${requestId}] Error:`, error);
    return c.json({
      error: 'Service temporarily unavailable',
      requestId
    }, 503);
  }
});

export { fallbackRouter };