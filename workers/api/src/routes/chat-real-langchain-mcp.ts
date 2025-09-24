// Chat Route with Official LangChain MCP Adapters
import { Hono } from 'hono';
import type { Env } from '../index';
import { SessionManager } from '../lib/session-manager';
import { z } from 'zod';

import { ChatAnthropic } from '@langchain/anthropic';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createReactAgent } from 'langchain/agents';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';

const realLangChainMcpRouter = new Hono<{ Bindings: Env }>();

// Request schema
const RealLangChainMCPRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).optional().default([]),
  mode: z.enum(['create', 'edit', 'analyze']).optional().default('analyze')
});

// Session manager instance
let sessionManager: SessionManager;

realLangChainMcpRouter.use('*', async (c, next) => {
  if (!sessionManager) {
    sessionManager = new SessionManager(c.env.SESSIONS);
  }
  await next();
});

/**
 * Real LangChain MCP integration using official MultiServerMCPClient
 */
realLangChainMcpRouter.post('/message', async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  const startTime = Date.now();

  // Comprehensive request logging
  console.log(`[RealLangChainMCP:${requestId}] === NEW CHAT REQUEST ===`);
  console.log(`[RealLangChainMCP:${requestId}] URL: ${c.req.url}`);
  console.log(`[RealLangChainMCP:${requestId}] Method: ${c.req.method}`);
  console.log(`[RealLangChainMCP:${requestId}] Content-Type: ${c.req.header('Content-Type')}`);
  console.log(`[RealLangChainMCP:${requestId}] Authorization present: ${!!c.req.header('Authorization')}`);
  console.log(`[RealLangChainMCP:${requestId}] User-Agent: ${c.req.header('User-Agent')?.substring(0, 100)}`);

  try {
    console.log(`[RealLangChainMCP:${requestId}] Parsing request body...`);
    let body: any;
    try {
      body = await c.req.json();
      console.log(`[RealLangChainMCP:${requestId}] Body parsed successfully:`, JSON.stringify(body).substring(0, 200));
    } catch (jsonError) {
      console.error(`[RealLangChainMCP:${requestId}] JSON parsing failed:`, jsonError);
      return c.json({
        error: 'Invalid JSON in request body',
        details: jsonError instanceof Error ? jsonError.message : 'Unknown JSON error',
        requestId
      }, 400);
    }

    console.log(`[RealLangChainMCP:${requestId}] Validating request schema...`);
    let request: any;
    try {
      request = RealLangChainMCPRequestSchema.parse(body);
      console.log(`[RealLangChainMCP:${requestId}] Schema validation successful`);
    } catch (schemaError) {
      console.error(`[RealLangChainMCP:${requestId}] Schema validation failed:`, schemaError);
      return c.json({
        error: 'Invalid request format',
        details: schemaError instanceof Error ? schemaError.message : 'Schema validation failed',
        requestId
      }, 400);
    }

    console.log(`[RealLangChainMCP:${requestId}] Mode: ${request.mode}, Message: "${request.message.substring(0, 50)}..."`);

    // Get Spotify token
    console.log(`[RealLangChainMCP:${requestId}] Extracting Spotify token...`);
    const spotifyToken = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!spotifyToken) {
      console.warn(`[RealLangChainMCP:${requestId}] No Spotify token provided`);
      return c.json({ error: 'Spotify token required', requestId }, 401);
    }
    console.log(`[RealLangChainMCP:${requestId}] Spotify token extracted: ${spotifyToken.substring(0, 20)}...`);

    // Create session for MCP authentication
    console.log(`[RealLangChainMCP:${requestId}] Creating MCP session...`);
    let sessionToken: string;
    try {
      sessionToken = await sessionManager.createSession(spotifyToken);
      console.log(`[RealLangChainMCP:${requestId}] Session created successfully: ${sessionToken.substring(0, 8)}...`);
    } catch (sessionError) {
      console.error(`[RealLangChainMCP:${requestId}] Session creation failed:`, sessionError);
      return c.json({
        error: 'Failed to create session',
        details: sessionError instanceof Error ? sessionError.message : 'Session creation error',
        requestId
      }, 500);
    }

    // 1) Initialize official LangChain MCP client
    console.log(`[RealLangChainMCP:${requestId}] Preparing MCP client initialization...`);
    const origin = new URL(c.req.url).origin;
    const mcpServerUrl = `${origin}/api/mcp`;

    console.log(`[RealLangChainMCP:${requestId}] MCP server URL: ${mcpServerUrl}`);

    // Try SSE first, fallback to HTTP if it fails
    let client: MultiServerMCPClient;
    let transportUsed = 'sse';
    let tools: any[];

    try {
      console.log(`[RealLangChainMCP:${requestId}] === ATTEMPTING SSE TRANSPORT ===`);
      console.log(`[RealLangChainMCP:${requestId}] Creating MultiServerMCPClient with SSE transport...`);

      try {
        client = new MultiServerMCPClient({
          spotify: {
            transport: 'sse',
            url: mcpServerUrl,
            headers: {
              'Authorization': `Bearer ${sessionToken}`,
              'MCP-Protocol-Version': '2025-06-18',
            }
          }
        });
        console.log(`[RealLangChainMCP:${requestId}] SSE MCP client created successfully`);
      } catch (clientCreationError) {
        console.error(`[RealLangChainMCP:${requestId}] SSE client creation failed:`, clientCreationError);
        throw clientCreationError;
      }

      // 2) Discover MCP tools via official LangChain adapter
      console.log(`[RealLangChainMCP:${requestId}] Calling client.getTools() via SSE...`);
      const toolsStartTime = Date.now();

      try {
        tools = await client.getTools();
        const toolsDuration = Date.now() - toolsStartTime;
        console.log(`[RealLangChainMCP:${requestId}] SSE getTools() successful! (${toolsDuration}ms)`);
        console.log(`[RealLangChainMCP:${requestId}] Discovered ${tools.length} tools via SSE`);

        if (tools.length > 0) {
          console.log(`[RealLangChainMCP:${requestId}] Tool names: [${tools.map(t => t.name || 'unnamed').join(', ')}]`);
        }
      } catch (getToolsError) {
        console.error(`[RealLangChainMCP:${requestId}] SSE getTools() failed after ${Date.now() - toolsStartTime}ms:`, getToolsError);
        throw getToolsError;
      }

    } catch (sseError) {
      const sseErrorMessage = sseError instanceof Error ? sseError.message : String(sseError);
      console.warn(`[RealLangChainMCP:${requestId}] === SSE TRANSPORT FAILED, TRYING HTTP ===`);
      console.warn(`[RealLangChainMCP:${requestId}] SSE error: ${sseErrorMessage}`);
      transportUsed = 'http';

      try {
        await client?.close();
        console.log(`[RealLangChainMCP:${requestId}] Closed failed SSE client`);
      } catch (closeError) {
        console.warn(`[RealLangChainMCP:${requestId}] Error closing SSE client:`, closeError);
      }

      console.log(`[RealLangChainMCP:${requestId}] Creating HTTP MCP client...`);
      try {
        client = new MultiServerMCPClient({
          spotify: {
            transport: 'http',
            url: mcpServerUrl,
            headers: {
              'Authorization': `Bearer ${sessionToken}`,
              'MCP-Protocol-Version': '2025-06-18',
            }
          }
        });
        console.log(`[RealLangChainMCP:${requestId}] HTTP MCP client created successfully`);
      } catch (httpClientError) {
        console.error(`[RealLangChainMCP:${requestId}] HTTP client creation failed:`, httpClientError);
        throw new Error(`Both SSE and HTTP client creation failed. SSE: ${sseErrorMessage}, HTTP: ${httpClientError instanceof Error ? httpClientError.message : String(httpClientError)}`);
      }

      console.log(`[RealLangChainMCP:${requestId}] Calling client.getTools() via HTTP...`);
      const httpToolsStartTime = Date.now();

      try {
        tools = await client.getTools();
        const httpToolsDuration = Date.now() - httpToolsStartTime;
        console.log(`[RealLangChainMCP:${requestId}] HTTP getTools() successful! (${httpToolsDuration}ms)`);
        console.log(`[RealLangChainMCP:${requestId}] Discovered ${tools.length} tools via HTTP`);

        if (tools.length > 0) {
          console.log(`[RealLangChainMCP:${requestId}] Tool names: [${tools.map(t => t.name || 'unnamed').join(', ')}]`);
        }
      } catch (httpGetToolsError) {
        console.error(`[RealLangChainMCP:${requestId}] HTTP getTools() failed after ${Date.now() - httpToolsStartTime}ms:`, httpGetToolsError);
        throw new Error(`Both SSE and HTTP getTools() failed. SSE: ${sseErrorMessage}, HTTP: ${httpGetToolsError instanceof Error ? httpGetToolsError.message : String(httpGetToolsError)}`);
      }
    }

    if (!tools.length) {
      console.error(`[RealLangChainMCP:${requestId}] No MCP tools available`);
      return c.json({ error: 'No MCP tools available' }, 500);
    }

    console.log(`[RealLangChainMCP:${requestId}] Discovered ${tools.length} LangChain tools: [${tools.map(t => t.name).join(', ')}]`);

    // 3) Initialize ChatAnthropic model
    const llm = new ChatAnthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.2,
      maxTokens: 2000
    });

    // 4) System prompts based on mode
    const systemPrompts = {
      analyze: `You are an expert music analyst with access to Spotify tools. You MUST use tools to answer any music-related questions.

CRITICAL INSTRUCTIONS:
1. NEVER answer music questions without using tools first
2. ALWAYS search for tracks before discussing them
3. ALWAYS get audio features before analyzing energy/mood
4. Use multiple tools in sequence for complete analysis

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

    // 5) Build message history for LangChain
    const messages = [
      new SystemMessage(systemPrompts[request.mode]),
      ...request.conversationHistory.map((m) =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
      ),
      new HumanMessage(request.message)
    ];

    console.log(`[RealLangChainMCP:${requestId}] Creating ReAct agent with ${tools.length} tools`);

    // 6) Create and run ReAct agent with MCP tools
    const agent = await createReactAgent({
      llm,
      tools,
      messageModifier: new SystemMessage(systemPrompts[request.mode])
    });

    console.log(`[RealLangChainMCP:${requestId}] Running agent with conversation...`);
    const agentStartTime = Date.now();

    const result = await agent.invoke({
      messages: messages
    });

    const agentDuration = Date.now() - agentStartTime;
    console.log(`[RealLangChainMCP:${requestId}] Agent completed in ${agentDuration}ms`);

    // 7) Extract final response
    let finalMessage = '';
    if (result?.messages && Array.isArray(result.messages)) {
      // Get the last AI message from the agent
      const lastMessage = result.messages[result.messages.length - 1];
      if (lastMessage && typeof lastMessage.content === 'string') {
        finalMessage = lastMessage.content;
      }
    } else if (typeof result?.output === 'string') {
      finalMessage = result.output;
    } else if (result?.output?.content) {
      finalMessage = result.output.content;
    } else {
      finalMessage = JSON.stringify(result);
    }

    console.log(`[RealLangChainMCP:${requestId}] Final response length: ${finalMessage.length} chars`);

    // 8) Build conversation history
    const finalHistory = [
      ...request.conversationHistory,
      { role: 'user', content: request.message },
      { role: 'assistant', content: finalMessage }
    ];

    const totalDuration = Date.now() - startTime;
    console.log(`[RealLangChainMCP:${requestId}] === CHAT COMPLETE === (${totalDuration}ms, Real LangChain MCP via ${transportUsed})`);

    // 9) Clean up MCP client
    try {
      await client.close();
      console.log(`[RealLangChainMCP:${requestId}] MCP client closed`);
    } catch (closeError) {
      console.warn(`[RealLangChainMCP:${requestId}] Error closing MCP client:`, closeError);
    }

    return c.json({
      message: finalMessage,
      conversationHistory: finalHistory,
      mcpIntegration: {
        serverUrl: mcpServerUrl,
        toolsDiscovered: tools.length,
        toolNames: tools.map(t => t.name),
        transportUsed: transportUsed,
        sessionToken: sessionToken.substring(0, 8) + '...',
        usedRealLangChain: true
      },
      executionTime: totalDuration,
      agentExecutionTime: agentDuration,
      requestId
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[RealLangChainMCP:${requestId}] Error after ${duration}ms:`, error);

    // Log detailed error info
    if (error instanceof Error) {
      console.error(`[RealLangChainMCP:${requestId}] Error details:`, {
        name: error.name,
        message: error.message,
        stack: error.stack?.substring(0, 500)
      });
    }

    return c.json({
      error: error instanceof Error ? error.message : 'Chat request failed',
      errorType: error instanceof Error ? error.name : 'Unknown',
      requestId
    }, 500);
  }
});

/**
 * Debug endpoint to test MCP client connection
 */
realLangChainMcpRouter.post('/test-connection', async (c) => {
  const testId = crypto.randomUUID().substring(0, 8);
  console.log(`[RealLangChainMCP:${testId}] === TESTING MCP CONNECTION ===`);

  try {
    const spotifyToken = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!spotifyToken) {
      return c.json({ error: 'Spotify token required' }, 401);
    }

    const sessionToken = await sessionManager.createSession(spotifyToken);
    const origin = new URL(c.req.url).origin;
    const mcpServerUrl = `${origin}/api/mcp`;

    console.log(`[RealLangChainMCP:${testId}] Testing connection to: ${mcpServerUrl}`);

    // Try SSE first, fallback to HTTP
    let client: MultiServerMCPClient;
    let transportUsed = 'sse';
    let tools: any[];

    try {
      console.log(`[RealLangChainMCP:${testId}] Trying SSE transport...`);
      client = new MultiServerMCPClient({
        spotify: {
          transport: 'sse',
          url: mcpServerUrl,
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
            'MCP-Protocol-Version': '2025-06-18'
          }
        }
      });
      tools = await client.getTools();
    } catch (sseError) {
      console.warn(`[RealLangChainMCP:${testId}] SSE failed, trying HTTP:`, sseError);
      transportUsed = 'http';

      try { await client?.close(); } catch {}

      client = new MultiServerMCPClient({
        spotify: {
          transport: 'http',
          url: mcpServerUrl,
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
            'MCP-Protocol-Version': '2025-06-18'
          }
        }
      });
      tools = await client.getTools();
    }

    console.log(`[RealLangChainMCP:${testId}] Connection successful! Tools: ${tools.length}`);

    await client.close();

    return c.json({
      success: true,
      mcpServerUrl,
      transportUsed,
      toolsDiscovered: tools.length,
      toolNames: tools.map(t => t.name),
      sessionToken: sessionToken.substring(0, 8) + '...',
      testId
    });

  } catch (error) {
    console.error(`[RealLangChainMCP:${testId}] Connection test failed:`, error);
    return c.json({
      error: error instanceof Error ? error.message : 'Connection test failed',
      testId
    }, 500);
  }
});

export { realLangChainMcpRouter };