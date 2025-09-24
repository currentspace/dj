import { Hono } from 'hono';
import type { Env } from '../index';
import { z } from 'zod';
import { SessionManager } from '../lib/session-manager';
import { ChatAnthropic } from '@langchain/anthropic';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createReactAgent } from 'langchain/agents';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { withLoopbackFetch } from '../lib/withLoopbackFetch';
import { withFetchLogging } from '../lib/withFetchLogging';

const realLangChainMcpRouter = new Hono<{ Bindings: Env }>();

// Request schema
const RealLangChainMCPRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).max(20).default([]),
  mode: z.enum(['analyze', 'create', 'edit']).default('analyze')
});

// Session manager instance
let sessionManager: SessionManager;

// Initialize session manager
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

  console.log(`[RealLangChainMCP:${requestId}] === NEW CHAT REQUEST ===`);
  console.log(`[RealLangChainMCP:${requestId}] URL: ${c.req.url}`);

  try {
    // Parse request
    const body = await c.req.json();
    const request = RealLangChainMCPRequestSchema.parse(body);
    console.log(`[RealLangChainMCP:${requestId}] Mode: ${request.mode}, Message: "${request.message.substring(0, 50)}${request.message.length > 50 ? '...' : ''}"`);

    // Get authorization header
    const authorization = c.req.header('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      console.warn(`[RealLangChainMCP:${requestId}] No authorization header provided`);
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const spotifyToken = authorization.replace('Bearer ', '');
    console.log(`[RealLangChainMCP:${requestId}] Spotify token: ${spotifyToken.substring(0, 8)}...`);

    // Check if it's an existing session token or a Spotify token
    const existingSession = await sessionManager.validateSession(spotifyToken);
    let sessionToken: string;

    if (existingSession) {
      console.log(`[RealLangChainMCP:${requestId}] Using existing session: ${existingSession.id}`);
      sessionToken = existingSession.id;
      await sessionManager.touchSession(existingSession.id);
    } else {
      // Create new session with the Spotify token
      // Note: createSession returns the session token string directly, not an object!
      sessionToken = await sessionManager.createSession(spotifyToken, 'unknown');
      console.log(`[RealLangChainMCP:${requestId}] Created new session token: ${sessionToken}`);
    }

    // Initialize MCP client URL
    const origin = new URL(c.req.url).origin;
    const mcpServerUrl = `${origin}/api/mcp`;
    console.log(`[RealLangChainMCP:${requestId}] MCP server URL: ${mcpServerUrl}`);

    // Get MCP tools using loopback fetch to intercept self-requests
    console.log(`[RealLangChainMCP:${requestId}] === INITIALIZING MCP CLIENT WITH LOOPBACK ===`);

    let tools: any[];
    let transportUsed = 'http';

    try {
      // Use loopback fetch to intercept self-requests and route them internally
      tools = await withLoopbackFetch(
        c,
        () =>
          withFetchLogging(async () => {
            console.log(`[RealLangChainMCP:${requestId}] Creating MultiServerMCPClient...`);

            const client = new MultiServerMCPClient({
              spotify: {
                transport: 'http', // Keep it simple; SSE not needed for tools
                url: mcpServerUrl,
                headers: {
                  'Authorization': `Bearer ${sessionToken}`,
                  'MCP-Protocol-Version': '2025-06-18',
                  'Accept': 'application/json',
                  'User-Agent': 'langchain-mcp-worker/1.0'
                }
              }
            });

            console.log(`[RealLangChainMCP:${requestId}] Calling getTools()...`);
            const toolsStartTime = Date.now();
            const tools = await client.getTools();
            const toolsDuration = Date.now() - toolsStartTime;

            console.log(`[RealLangChainMCP:${requestId}] getTools() completed in ${toolsDuration}ms`);
            console.log(`[RealLangChainMCP:${requestId}] Discovered ${tools.length} tools`);

            if (tools.length > 0) {
              console.log(`[RealLangChainMCP:${requestId}] Tool names: [${tools.map((t: any) => t.name || 'unnamed').join(', ')}]`);
            }

            // Clean up
            try {
              await client.close();
            } catch {}

            return tools;
          }),
        { pathPrefix: '/api/mcp' }
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[RealLangChainMCP:${requestId}] Failed to get MCP tools: ${errorMessage}`);
      console.error(`[RealLangChainMCP:${requestId}] Error after ${Date.now() - startTime}ms`);

      return c.json({
        error: `Failed to initialize MCP tools: ${errorMessage}`,
        errorType: error instanceof Error ? error.name : 'Error',
        requestId,
        duration: Date.now() - startTime
      }, 500);
    }

    if (!tools || !tools.length) {
      console.error(`[RealLangChainMCP:${requestId}] No MCP tools available`);
      return c.json({ error: 'No MCP tools available' }, 500);
    }

    console.log(`[RealLangChainMCP:${requestId}] Successfully initialized ${tools.length} MCP tools`);

    // Initialize ChatAnthropic model
    const llm = new ChatAnthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.2,
      maxTokens: 2000
    });

    // System prompts based on mode
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

    // Build message history for LangChain
    const messages = [
      new SystemMessage(systemPrompts[request.mode]),
      ...request.conversationHistory.map((m) =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
      ),
      new HumanMessage(request.message)
    ];

    console.log(`[RealLangChainMCP:${requestId}] Creating ReAct agent with ${tools.length} tools`);

    // Create and run ReAct agent with MCP tools
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

    // Extract final response
    let finalMessage = '';
    if (result?.messages && Array.isArray(result.messages)) {
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

    // Build conversation history
    const finalHistory = [
      ...request.conversationHistory,
      { role: 'user' as const, content: request.message },
      { role: 'assistant' as const, content: finalMessage }
    ];

    const duration = Date.now() - startTime;
    console.log(`[RealLangChainMCP:${requestId}] === REQUEST COMPLETE (${duration}ms) ===`);

    return c.json({
      message: finalMessage,
      conversationHistory: finalHistory,
      requestId,
      duration,
      transport: transportUsed
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[RealLangChainMCP:${requestId}] Error after ${duration}ms:`, error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error(`[RealLangChainMCP:${requestId}] Error details:`, {
      message: errorMessage,
      stack: errorStack?.substring(0, 1000),
      type: error instanceof Error ? error.name : typeof error
    });

    return c.json({
      error: errorMessage,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      requestId,
      duration
    }, 500);
  }
});

/**
 * Test endpoint for MCP integration
 */
realLangChainMcpRouter.get('/test', async (c) => {
  const testId = crypto.randomUUID().substring(0, 8);
  console.log(`[RealLangChainMCP:${testId}] === TEST ENDPOINT HIT ===`);

  try {
    // Create test session (returns string token directly)
    const sessionToken = await sessionManager.createSession('test-spotify-token', 'test-user');
    console.log(`[RealLangChainMCP:${testId}] Created test session: ${sessionToken}`);

    const origin = new URL(c.req.url).origin;
    const mcpServerUrl = `${origin}/api/mcp`;

    console.log(`[RealLangChainMCP:${testId}] Testing MCP with loopback fetch...`);

    // Test with loopback fetch
    const tools = await withLoopbackFetch(
      c,
      async () => {
        const client = new MultiServerMCPClient({
          spotify: {
            transport: 'http',
            url: mcpServerUrl,
            headers: {
              'Authorization': `Bearer ${sessionToken}`,
              'MCP-Protocol-Version': '2025-06-18'
            }
          }
        });

        const tools = await client.getTools();
        await client.close();
        return tools;
      },
      { pathPrefix: '/api/mcp' }
    );

    const toolNames = tools.map((t: any) => t.name);
    console.log(`[RealLangChainMCP:${testId}] Discovered ${tools.length} tools`);

    return c.json({
      success: true,
      serverUrl: mcpServerUrl,
      sessionId: sessionToken,
      toolCount: tools.length,
      tools: toolNames,
      testId
    });

  } catch (error) {
    console.error(`[RealLangChainMCP:${testId}] Test failed:`, error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      testId
    }, 500);
  }
});

export { realLangChainMcpRouter };