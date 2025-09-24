// Chat Route with Direct MCP Integration
import { Hono } from 'hono';
import { Anthropic } from '@anthropic-ai/sdk';
import type { Env } from '../index';
import { SessionManager } from '../lib/session-manager';
import { executeSpotifyTool, spotifyTools } from '../lib/spotify-tools';
import { z } from 'zod';

const mcpChatRouter = new Hono<{ Bindings: Env }>();

// Request schema
const MCPChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).optional().default([]),
  selectedPlaylistId: z.string().optional(),
  mode: z.enum(['create', 'edit', 'analyze']).optional().default('analyze')
});

// Session manager instance
let sessionManager: SessionManager;

mcpChatRouter.use('*', async (c, next) => {
  if (!sessionManager) {
    sessionManager = new SessionManager(c.env.SESSIONS);
  }
  await next();
});

/**
 * Enhanced chat endpoint with direct MCP tool calling
 */
mcpChatRouter.post('/message', async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[Chat:${requestId}] === NEW CHAT REQUEST ===`);
  const startTime = Date.now();

  try {
    const body = await c.req.json();
    const request = MCPChatRequestSchema.parse(body);
    console.log(`[Chat:${requestId}] Mode: ${request.mode}, Message: "${request.message.substring(0, 50)}..."`);

    // Get tokens
    const spotifyToken = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!spotifyToken) {
      console.warn(`[Chat:${requestId}] No Spotify token provided`);
      return c.json({ error: 'Spotify token required' }, 401);
    }

    // Create/validate session for internal MCP calls
    const sessionToken = await sessionManager.createSession(spotifyToken);
    console.log(`[Chat:${requestId}] Created session: ${sessionToken.substring(0, 8)}...`);

    // Initialize Anthropic with tool definitions
    const anthropic = new Anthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
    });

    // Build system prompt based on mode
    const systemPrompts = {
      analyze: `You are an expert music analyst with access to Spotify tools. You MUST use tools to answer any music-related questions.

CRITICAL INSTRUCTIONS:
1. NEVER answer music questions without using tools first
2. ALWAYS search for tracks before discussing them
3. ALWAYS get audio features before analyzing energy/mood
4. Use multiple tools in sequence for complete analysis

AVAILABLE TOOLS - USE THEM FOR EVERY RESPONSE:
- search_spotify_tracks: Search for tracks with filters
- get_audio_features: Get detailed audio analysis
- get_recommendations: Get AI recommendations
- analyze_playlist: Deep dive into playlists
- create_playlist: Create new playlists
- modify_playlist: Add/remove tracks

WORKFLOW: search_spotify_tracks → get_audio_features → analyze → respond`,

      create: `You are an expert DJ with access to Spotify tools. Create perfect playlists using real-time data.

WORKFLOW FOR PLAYLIST CREATION:
1. Search for tracks using search_spotify_tracks
2. Analyze audio features with get_audio_features
3. Get recommendations with get_recommendations
4. Create the final playlist with create_playlist

Always validate tracks exist before adding them to playlists.`,

      edit: `You are a playlist curator with access to Spotify tools. Modify existing playlists intelligently.

WORKFLOW FOR PLAYLIST EDITING:
1. Analyze current playlist with analyze_playlist
2. Search for new tracks with search_spotify_tracks
3. Check audio compatibility with get_audio_features
4. Modify playlist with modify_playlist

Always explain your reasoning for changes.`
    };

    // Build conversation messages
    const messages: any[] = [
      { role: 'user', content: request.message }
    ];

    // Add conversation history
    if (request.conversationHistory.length > 0) {
      messages.unshift(...request.conversationHistory);
    }

    console.log(`[Chat:${requestId}] Calling Claude with ${messages.length} messages and ${spotifyTools.length} tools`);

    // Call Claude with tools
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompts[request.mode],
      messages,
      tools: spotifyTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema
      })),
      tool_choice: { type: 'any' } // Force tool usage
    });

    console.log(`[Chat:${requestId}] Claude response received, processing...`);

    // Process response and handle tool calls
    let assistantResponse = '';
    const toolCalls: any[] = [];
    const toolResults: any[] = [];

    for (const contentBlock of response.content) {
      if (contentBlock.type === 'text') {
        assistantResponse += contentBlock.text;
      } else if (contentBlock.type === 'tool_use') {
        console.log(`[Chat:${requestId}] Tool call requested: ${contentBlock.name}`);

        const toolCall = {
          id: contentBlock.id,
          name: contentBlock.name,
          input: contentBlock.input
        };
        toolCalls.push(toolCall);

        try {
          // Execute tool directly through our MCP implementation
          const toolResult = await executeSpotifyTool(
            contentBlock.name,
            contentBlock.input,
            spotifyToken
          );

          console.log(`[Chat:${requestId}] Tool ${contentBlock.name} completed successfully`);

          toolResults.push({
            tool_call_id: contentBlock.id,
            output: JSON.stringify(toolResult, null, 2)
          });

        } catch (toolError) {
          console.error(`[Chat:${requestId}] Tool ${contentBlock.name} failed:`, toolError);
          toolResults.push({
            tool_call_id: contentBlock.id,
            output: `Error: ${toolError instanceof Error ? toolError.message : 'Tool execution failed'}`,
            is_error: true
          });
        }
      }
    }

    // If tools were called, make follow-up request to Claude with results
    if (toolCalls.length > 0) {
      console.log(`[Chat:${requestId}] Making follow-up call to Claude with ${toolResults.length} tool results`);

      const followUpMessages = [
        ...messages,
        {
          role: 'assistant',
          content: response.content
        },
        {
          role: 'user',
          content: toolResults.map(result =>
            `Tool ${result.tool_call_id} result:\n${result.output}`
          ).join('\n\n')
        }
      ];

      const followUpResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompts[request.mode],
        messages: followUpMessages
      });

      // Extract final response
      assistantResponse = '';
      for (const contentBlock of followUpResponse.content) {
        if (contentBlock.type === 'text') {
          assistantResponse += contentBlock.text;
        }
      }
    }

    // Build response
    const finalHistory = [
      ...request.conversationHistory,
      { role: 'user', content: request.message },
      { role: 'assistant', content: assistantResponse }
    ];

    const duration = Date.now() - startTime;
    console.log(`[Chat:${requestId}] === CHAT COMPLETE === (${duration}ms, ${toolCalls.length} tools used)`);

    return c.json({
      message: assistantResponse,
      conversationHistory: finalHistory,
      toolsUsed: toolCalls.map(tc => tc.name),
      executionTime: duration,
      requestId
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Chat:${requestId}] Error after ${duration}ms:`, error);
    return c.json({
      error: error instanceof Error ? error.message : 'Chat request failed',
      requestId
    }, 500);
  }
});

/**
 * Debug endpoint to verify tool setup
 */
mcpChatRouter.post('/debug', async (c) => {
  const debugId = crypto.randomUUID().substring(0, 8);
  console.log(`[Debug:${debugId}] === DEBUGGING TOOL SETUP ===`);

  try {
    const spotifyToken = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!spotifyToken) {
      return c.json({ error: 'Spotify token required' }, 401);
    }

    // Initialize Anthropic
    const anthropic = new Anthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
    });

    console.log(`[Debug:${debugId}] Testing basic Claude call with tools...`);

    // Test with explicit tool request
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are a music assistant with access to Spotify tools. You MUST use tools to answer questions.

AVAILABLE TOOLS:
- search_spotify_tracks: Search for tracks on Spotify
- get_audio_features: Get detailed audio analysis

IMPORTANT: When a user asks about music, ALWAYS use the search_spotify_tracks tool first.`,
      messages: [
        {
          role: 'user',
          content: 'Search for exactly 3 rock tracks from the 90s. Use the search tool.'
        }
      ],
      tools: [
        {
          name: 'search_spotify_tracks',
          description: 'Search for tracks on Spotify with optional filters',
          input_schema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query (artist, song, genre, etc.)'
              },
              limit: {
                type: 'number',
                description: 'Number of results (1-50)',
                default: 10
              }
            },
            required: ['query']
          }
        }
      ],
      tool_choice: { type: 'any' } // Force tool usage
    });

    console.log(`[Debug:${debugId}] Claude response received`);
    console.log(`[Debug:${debugId}] Content blocks:`, response.content.length);

    const result = {
      debugId,
      contentBlocks: response.content.map(block => ({
        type: block.type,
        ...(block.type === 'text' ? { text: block.text.substring(0, 100) } : {}),
        ...(block.type === 'tool_use' ? { tool_name: block.name, tool_input: block.input } : {})
      })),
      hasToolCalls: response.content.some(block => block.type === 'tool_use'),
      anthropicModel: 'claude-sonnet-4-20250514'
    };

    console.log(`[Debug:${debugId}] Tool calls detected:`, result.hasToolCalls);

    return c.json(result);

  } catch (error) {
    console.error(`[Debug:${debugId}] Debug failed:`, error);
    return c.json({
      error: error instanceof Error ? error.message : 'Debug failed',
      debugId
    }, 500);
  }
});

/**
 * Test endpoint to verify E2E tool calling
 */
mcpChatRouter.post('/test-tools', async (c) => {
  const testId = crypto.randomUUID().substring(0, 8);
  console.log(`[Test:${testId}] === TOOL TEST STARTED ===`);

  try {
    const spotifyToken = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!spotifyToken) {
      return c.json({ error: 'Spotify token required' }, 401);
    }

    console.log(`[Test:${testId}] Testing search_spotify_tracks...`);

    // Test search
    const searchResult = await executeSpotifyTool(
      'search_spotify_tracks',
      { query: 'test search', limit: 3 },
      spotifyToken
    );

    console.log(`[Test:${testId}] Search completed, found ${searchResult.length} tracks`);

    // Test audio features if we got tracks
    let audioFeatures = null;
    if (searchResult.length > 0) {
      console.log(`[Test:${testId}] Testing get_audio_features...`);
      const trackIds = searchResult.map((t: any) => t.id).slice(0, 2);
      audioFeatures = await executeSpotifyTool(
        'get_audio_features',
        { track_ids: trackIds },
        spotifyToken
      );
      console.log(`[Test:${testId}] Audio features completed for ${audioFeatures.length} tracks`);
    }

    console.log(`[Test:${testId}] === TOOL TEST COMPLETE ===`);

    return c.json({
      success: true,
      searchResult: searchResult.slice(0, 3),
      audioFeatures: audioFeatures?.slice(0, 2),
      testId
    });

  } catch (error) {
    console.error(`[Test:${testId}] Tool test failed:`, error);
    return c.json({
      error: error instanceof Error ? error.message : 'Tool test failed',
      testId
    }, 500);
  }
});

export { mcpChatRouter };