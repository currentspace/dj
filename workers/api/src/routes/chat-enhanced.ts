// Enhanced Chat with MCP Tool Calling
import { Hono } from 'hono';
import { Anthropic } from '@anthropic-ai/sdk';
import type { Env } from '../index';
import { SessionManager } from '../lib/session-manager';
import { spotifyTools } from '../lib/spotify-tools';
import { z } from 'zod';

const enhancedChatRouter = new Hono<{ Bindings: Env }>();

// Request schema
const EnhancedChatRequestSchema = z.object({
  message: z.string().min(1).max(1000),
  conversationHistory: z.array(z.any()).optional().default([]),
  selectedPlaylistId: z.string().optional(),
  sessionToken: z.string().optional(), // MCP session token
  mode: z.enum(['create', 'edit', 'analyze']).optional().default('create')
});

enhancedChatRouter.post('/message', async (c) => {
  try {
    const body = await c.req.json();
    const request = EnhancedChatRequestSchema.parse(body);

    const spotifyToken = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!spotifyToken) {
      return c.json({ error: 'Spotify token required' }, 401);
    }

    // Create or get session for MCP
    let sessionToken = request.sessionToken;
    if (!sessionToken) {
      const sessionManager = new SessionManager(c.env.SESSIONS);
      sessionToken = await sessionManager.createSession(spotifyToken);
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
    });

    // Build messages with proper format
    const messages = [
      ...request.conversationHistory,
      { role: 'user', content: request.message }
    ];

    // Create message with tools
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: messages,
      tools: spotifyTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema as any
      })),
      tool_choice: { type: 'auto' },
      system: `You are an expert DJ and music curator with access to Spotify tools.
               Use the tools to search for tracks, analyze playlists, get recommendations,
               and create/modify playlists as needed. Be thoughtful and iterative -
               search first, verify audio features, then take action.

               MCP Server URL: ${new URL(c.req.url).origin}/api/mcp
               Session Token: ${sessionToken}

               You can call tools to:
               - search_spotify_tracks: Search for tracks with filters
               - get_audio_features: Analyze track characteristics
               - get_recommendations: Get AI-powered recommendations
               - create_playlist: Create new playlists
               - modify_playlist: Add/remove/reorder tracks
               - analyze_playlist: Deep dive into playlist characteristics`
    });

    // Process response and handle tool calls
    const assistantMessage = {
      role: 'assistant',
      content: '',
      tool_calls: []
    };

    // Handle streaming if tool calls are made
    if (response.content) {
      for (const block of response.content) {
        if (block.type === 'text') {
          assistantMessage.content += block.text;
        } else if (block.type === 'tool_use') {
          // Tool was called - this would be handled by MCP in Claude Desktop
          // For web app, we can execute it here
          assistantMessage.tool_calls.push({
            id: block.id,
            name: block.name,
            input: block.input
          });
        }
      }
    }

    // Update conversation history
    const newHistory = [
      ...request.conversationHistory,
      { role: 'user', content: request.message },
      assistantMessage
    ];

    return c.json({
      message: assistantMessage.content,
      conversationHistory: newHistory,
      sessionToken, // Return session token for future calls
      mcpServerUrl: `${new URL(c.req.url).origin}/api/mcp`,
      tool_calls: assistantMessage.tool_calls
    });

  } catch (error) {
    console.error('Enhanced chat error:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Chat failed'
    }, 500);
  }
});

export { enhancedChatRouter };