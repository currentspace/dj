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

    console.log(`[Chat:${requestId}] Calling Claude with tools defined directly (bypassing MCP connector)`);

    // Define tools directly instead of using MCP connector
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompts[request.mode],
      messages,
      tools: spotifyTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema
      }))
    });

    console.log(`[Chat:${requestId}] Claude response received with direct tool definitions`);

    // Handle tool calls when Claude uses tools
    let assistantResponse = '';
    const toolCallsDetected: string[] = [];
    const toolResults: any[] = [];
    let needsFollowUp = false;

    // Process initial response
    for (const contentBlock of response.content) {
      if (contentBlock.type === 'text') {
        assistantResponse += contentBlock.text;
      } else if (contentBlock.type === 'tool_use') {
        console.log(`[Chat:${requestId}] Tool call detected: ${contentBlock.name}`);
        toolCallsDetected.push(contentBlock.name);
        needsFollowUp = true;

        try {
          // Execute the Spotify tool
          const toolResult = await executeSpotifyTool(
            contentBlock.name,
            contentBlock.input,
            spotifyToken
          );

          toolResults.push({
            type: 'tool_result',
            tool_use_id: contentBlock.id,
            content: JSON.stringify(toolResult, null, 2)
          });

          console.log(`[Chat:${requestId}] Tool ${contentBlock.name} executed successfully`);
        } catch (toolError) {
          console.error(`[Chat:${requestId}] Tool ${contentBlock.name} failed:`, toolError);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: contentBlock.id,
            content: `Error: ${toolError instanceof Error ? toolError.message : 'Tool execution failed'}`,
            is_error: true
          });
        }
      }
    }

    // If there were tool calls, make a follow-up request to get the final response
    if (needsFollowUp && toolResults.length > 0) {
      console.log(`[Chat:${requestId}] Making follow-up request with ${toolResults.length} tool results`);

      const followUpMessages = [
        ...messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults }
      ];

      const followUpResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompts[request.mode],
        messages: followUpMessages,
        tools: spotifyTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema
        }))
      });

      // Extract final response
      assistantResponse = '';
      for (const contentBlock of followUpResponse.content) {
        if (contentBlock.type === 'text') {
          assistantResponse += contentBlock.text;
        }
      }

      console.log(`[Chat:${requestId}] Follow-up response received (${assistantResponse.length} chars)`);
    }

    console.log(`[Chat:${requestId}] Response content blocks: ${response.content.length}`);
    console.log(`[Chat:${requestId}] Tools used: ${toolCallsDetected.join(', ')}`);
    console.log(`[Chat:${requestId}] Final response length: ${assistantResponse.length} characters`);

    // Build response
    const finalHistory = [
      ...request.conversationHistory,
      { role: 'user', content: request.message },
      { role: 'assistant', content: assistantResponse }
    ];

    const duration = Date.now() - startTime;
    console.log(`[Chat:${requestId}] === CHAT COMPLETE === (${duration}ms, MCP integration active)`);

    return c.json({
      message: assistantResponse,
      conversationHistory: finalHistory,
      mcpServer: 'https://dj.current.space/api/mcp',
      mcpIntegration: true,
      toolCallsDetected: toolCallsDetected,
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

    // Create session for MCP authentication
    const sessionToken = await sessionManager.createSession(spotifyToken);
    console.log(`[Debug:${debugId}] Created session: ${sessionToken.substring(0, 8)}...`);

    console.log(`[Debug:${debugId}] Testing MCP connector with Claude...`);

    // Test with MCP connector
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are a music assistant with access to Spotify tools via MCP. You MUST use tools to answer questions about music. Search for tracks when asked.`,
      messages: [
        {
          role: 'user',
          content: 'Search for exactly 3 upbeat workout tracks. Use the search_spotify_tracks tool.'
        }
      ],
      mcp_servers: [
        {
          type: 'url',
          url: 'https://dj.current.space/api/mcp',
          name: 'spotify-debug',
          authorization_token: sessionToken,
          tool_configuration: {
            enabled: true,
            allowed_tools: ['search_spotify_tracks', 'get_audio_features']
          }
        }
      ]
    }, {
      headers: {
        'anthropic-beta': 'mcp-client-2025-04-04'
      }
    });

    console.log(`[Debug:${debugId}] Claude response received`);
    console.log(`[Debug:${debugId}] Content blocks:`, response.content.length);

    const result = {
      debugId,
      mcpServer: 'https://dj.current.space/api/mcp',
      sessionToken: sessionToken.substring(0, 8) + '...',
      mcpConnectorUsed: true,
      betaHeader: 'mcp-client-2025-04-04',
      contentBlocks: response.content.map(block => ({
        type: block.type,
        ...(block.type === 'text' ? { text: block.text.substring(0, 200) } : {}),
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
 * Test MCP Connector directly
 */
mcpChatRouter.post('/test-mcp-connector', async (c) => {
  const testId = crypto.randomUUID().substring(0, 8);
  console.log(`[MCPConnectorTest:${testId}] === TESTING MCP CONNECTOR ===`);

  try {
    const spotifyToken = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!spotifyToken) {
      return c.json({ error: 'Spotify token required' }, 401);
    }

    // Create session for MCP authentication
    const sessionToken = await sessionManager.createSession(spotifyToken);
    console.log(`[MCPConnectorTest:${testId}] Created session: ${sessionToken.substring(0, 8)}...`);

    // Initialize Anthropic
    const anthropic = new Anthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
    });

    console.log(`[MCPConnectorTest:${testId}] Testing MCP connector with very explicit instructions...`);

    // Test with MCP connector and very explicit instructions
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are a music assistant with access to Spotify tools via MCP server.

CRITICAL: You MUST use the search_spotify_tracks tool to search for music. Do NOT respond without using tools.

Available tools through MCP:
- search_spotify_tracks: Search for tracks
- get_audio_features: Analyze track characteristics

You MUST call search_spotify_tracks first before responding.`,
      messages: [
        {
          role: 'user',
          content: 'Search for exactly 2 rock tracks. You MUST use the search_spotify_tracks tool. Do not respond without calling the tool first.'
        }
      ],
      mcp_servers: [
        {
          type: 'url',
          url: 'https://dj.current.space/api/mcp',
          name: 'spotify-test',
          authorization_token: sessionToken,
          tool_configuration: {
            enabled: true,
            allowed_tools: ['search_spotify_tracks', 'get_audio_features']
          }
        }
      ]
    }, {
      headers: {
        'anthropic-beta': 'mcp-client-2025-04-04'
      }
    });

    console.log(`[MCPConnectorTest:${testId}] Claude response received`);
    console.log(`[MCPConnectorTest:${testId}] Content blocks:`, response.content.length);

    const result = {
      testId,
      mcpConnectorTest: true,
      mcpServer: 'https://dj.current.space/api/mcp',
      sessionToken: sessionToken.substring(0, 8) + '...',
      betaHeader: 'mcp-client-2025-04-04',
      contentBlocks: response.content.map((block, i) => ({
        index: i,
        type: block.type,
        ...(block.type === 'text' ? {
          text: block.text.substring(0, 300) + (block.text.length > 300 ? '...' : ''),
          fullLength: block.text.length
        } : {}),
        ...(block.type === 'tool_use' ? {
          tool_name: block.name,
          tool_input: block.input,
          tool_id: block.id
        } : {})
      })),
      hasToolCalls: response.content.some(block => block.type === 'tool_use'),
      responseText: response.content.find(block => block.type === 'text')?.text?.substring(0, 500) || '',
      anthropicModel: response.model,
      usage: response.usage
    };

    console.log(`[MCPConnectorTest:${testId}] MCP Connector working:`, result.hasToolCalls);
    if (!result.hasToolCalls) {
      console.log(`[MCPConnectorTest:${testId}] No tool calls detected - MCP connector may not be working`);
      console.log(`[MCPConnectorTest:${testId}] Response text:`, result.responseText);
    }

    return c.json(result);

  } catch (error) {
    console.error(`[MCPConnectorTest:${testId}] Test failed:`, error);
    return c.json({
      error: error instanceof Error ? error.message : 'Test failed',
      testId
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