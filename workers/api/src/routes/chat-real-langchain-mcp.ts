import { Hono } from 'hono';
import type { Env } from '../index';
import { z } from 'zod';
import { SessionManager } from '../lib/session-manager';
import { ChatAnthropic } from '@langchain/anthropic';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createReactAgent } from 'langchain/agents';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import app from '../index';

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

  // Comprehensive request logging
  console.log(`[RealLangChainMCP:${requestId}] === NEW CHAT REQUEST ===`);
  console.log(`[RealLangChainMCP:${requestId}] URL: ${c.req.url}`);
  console.log(`[RealLangChainMCP:${requestId}] Method: ${c.req.method}`);
  console.log(`[RealLangChainMCP:${requestId}] Content-Type: ${c.req.header('Content-Type')}`);
  console.log(`[RealLangChainMCP:${requestId}] Authorization present: ${!!c.req.header('Authorization')}`);

  try {
    // Parse request
    const body = await c.req.json();
    console.log(`[RealLangChainMCP:${requestId}] Body size: ${JSON.stringify(body).length} bytes`);

    const request = RealLangChainMCPRequestSchema.parse(body);
    console.log(`[RealLangChainMCP:${requestId}] Mode: ${request.mode}, Message: "${request.message.substring(0, 50)}${request.message.length > 50 ? '...' : ''}"`);
    console.log(`[RealLangChainMCP:${requestId}] Conversation history: ${request.conversationHistory.length} messages`);

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
      // Update session activity
      await sessionManager.touchSession(existingSession.id);
    } else {
      // Create new session with the Spotify token
      const session = await sessionManager.createSession(spotifyToken, 'unknown');
      sessionToken = session.id;
      console.log(`[RealLangChainMCP:${requestId}] Created session: ${sessionToken}`);
    }

    // === DEBUGGING HELPER FUNCTIONS ===

    // Loopback smoke test
    async function loopbackMcpInit(c: any, sessionToken: string) {
      const smokeId = crypto.randomUUID().slice(0, 8);
      const origin = new URL(c.req.url).origin;
      const url = `${origin}/api/mcp`;

      const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
        "Authorization": `Bearer ${sessionToken}`,
      };

      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      });

      console.log(`[Smoke:${smokeId}] POST ${url}`);
      console.log(`[Smoke:${smokeId}] Headers:`, Object.fromEntries(new Headers(headers).entries()));
      const t0 = Date.now();
      const res = await fetch(url, { method: "POST", headers, body });
      const t1 = Date.now();
      console.log(`[Smoke:${smokeId}] Status: ${res.status} in ${t1 - t0}ms`);

      const text = await res.text().catch(() => "");
      console.log(`[Smoke:${smokeId}] Body: ${text.slice(0, 500)}`);

      return { status: res.status, ok: res.ok, text };
    }

    // Wrap fetch to log adapter's HTTP calls
    async function withFetchLogging<T>(fn: () => Promise<T>): Promise<T> {
      const orig = fetch.bind(globalThis);
      // @ts-ignore
      globalThis.fetch = async (input: RequestInfo, init?: RequestInit) => {
        try {
          const url = typeof input === "string" ? input : (input as Request).url;
          const method = (init?.method ?? (typeof input !== "string" ? (input as Request).method : "GET")).toUpperCase();
          const hdrs = new Headers(
            init?.headers ?? (typeof input !== "string" ? (input as Request).headers : undefined)
          );
          const hObj = Object.fromEntries(hdrs.entries());
          if (hObj.authorization) hObj.authorization = "<redacted>";

          // Short body preview for POST/JSON
          let preview = "";
          if (init?.body && typeof init.body === "string") {
            preview = init.body.slice(0, 300);
          }

          const t0 = Date.now();
          const res = await orig(input as any, init);
          const t1 = Date.now();

          console.log(`[fetch] ${method} ${url} -> ${res.status} in ${t1 - t0}ms`);
          console.log(`[fetch] headers:`, hObj);
          if (preview) console.log(`[fetch] body: ${preview}`);

          // Peek at response text only for errors to avoid consuming bodies
          if (!res.ok) {
            const copy = res.clone();
            const text = await copy.text().catch(() => "");
            console.log(`[fetch] resp (first 500): ${text.slice(0, 500)}`);
          }
          return res;
        } catch (e) {
          console.error(`[fetch] threw:`, e);
          throw e;
        }
      };
      try {
        return await fn();
      } finally {
        // @ts-ignore
        globalThis.fetch = orig;
      }
    }

    // Internal dispatch (bypass network)
    async function internalDispatch(c: any, path: string, init: RequestInit) {
      const url = new URL(path, c.req.url);
      const req = new Request(url.toString(), init);
      // @ts-ignore
      return app.fetch(req, c.env, c.executionCtx);
    }

    // 1) Initialize official LangChain MCP client
    console.log(`[RealLangChainMCP:${requestId}] Preparing MCP client initialization...`);
    const origin = new URL(c.req.url).origin;
    const mcpServerUrl = `${origin}/api/mcp`;

    console.log(`[RealLangChainMCP:${requestId}] MCP server URL: ${mcpServerUrl}`);

    // === DEBUGGING STEP 1: Run loopback smoke test ===
    console.log(`[RealLangChainMCP:${requestId}] === RUNNING LOOPBACK SMOKE TEST ===`);
    const smoke = await loopbackMcpInit(c, sessionToken);
    if (!smoke.ok) {
      console.error(`[RealLangChainMCP:${requestId}] Loopback MCP initialize failed!`);
      console.error(`[RealLangChainMCP:${requestId}] Smoke test result:`, smoke);
      // Don't fail yet, let's see what the adapter does
    } else {
      console.log(`[RealLangChainMCP:${requestId}] ✓ Loopback smoke test PASSED`);
    }

    // === DEBUGGING STEP 2: Test internal dispatch ===
    console.log(`[RealLangChainMCP:${requestId}] === TESTING INTERNAL DISPATCH ===`);
    try {
      const internalRes = await internalDispatch(c, "/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "MCP-Protocol-Version": "2025-06-18",
          "Authorization": `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }),
      });
      const internalText = await internalRes.text();
      console.log(`[RealLangChainMCP:${requestId}] Internal dispatch status=${internalRes.status}`);
      console.log(`[RealLangChainMCP:${requestId}] Internal dispatch body=${internalText.slice(0, 300)}`);
    } catch (internalError) {
      console.error(`[RealLangChainMCP:${requestId}] Internal dispatch error:`, internalError);
    }

    // Try HTTP first for cleaner debugging (no SSE variables)
    let client: MultiServerMCPClient;
    let transportUsed = 'http';
    let tools: any[];

    // Log the exact configuration being used
    console.log(`[RealLangChainMCP:${requestId}] === MCP CLIENT CONFIG ===`);
    console.log(`[RealLangChainMCP:${requestId}] URL: ${mcpServerUrl}`);
    console.log(`[RealLangChainMCP:${requestId}] Session Token: ${sessionToken.substring(0, 8)}...`);
    console.log(`[RealLangChainMCP:${requestId}] Transport: Starting with HTTP only for debugging`);

    try {
      console.log(`[RealLangChainMCP:${requestId}] === ATTEMPTING HTTP TRANSPORT (DEBUGGING MODE) ===`);

      const result = await withFetchLogging(async () => {
        console.log(`[RealLangChainMCP:${requestId}] Creating MultiServerMCPClient with HTTP transport...`);

        client = new MultiServerMCPClient({
          spotify: {
            transport: 'http', // Start with HTTP for simpler debugging
            url: mcpServerUrl,
            headers: {
              'Authorization': `Bearer ${sessionToken}`,
              'MCP-Protocol-Version': '2025-06-18',
              'Accept': 'application/json', // Explicitly set for HTTP
              'User-Agent': 'langchain-mcp-worker/1.0' // Add UA for tracking
            }
          }
        });

        console.log(`[RealLangChainMCP:${requestId}] HTTP MCP client created, calling getTools()...`);
        const toolsStartTime = Date.now();

        const tools = await client.getTools();
        const toolsDuration = Date.now() - toolsStartTime;

        console.log(`[RealLangChainMCP:${requestId}] HTTP getTools() successful! (${toolsDuration}ms)`);
        console.log(`[RealLangChainMCP:${requestId}] Discovered ${tools.length} tools`);

        if (tools.length > 0) {
          console.log(`[RealLangChainMCP:${requestId}] Tool names: [${tools.map((t: any) => t.name || 'unnamed').join(', ')}]`);
        }

        return tools;
      });

      tools = result;
      transportUsed = 'http';

    } catch (httpError) {
      const httpErrorMessage = httpError instanceof Error ? httpError.message : String(httpError);
      console.error(`[RealLangChainMCP:${requestId}] === HTTP TRANSPORT FAILED ===`);
      console.error(`[RealLangChainMCP:${requestId}] HTTP error: ${httpErrorMessage}`);

      // Check for 522 error specifically
      if (httpErrorMessage.includes('522')) {
        console.error(`[RealLangChainMCP:${requestId}] ⚠️ 522 ERROR DETECTED - Cloudflare Connection Timeout`);
        console.error(`[RealLangChainMCP:${requestId}] Request never reached our MCP endpoint`);
        console.error(`[RealLangChainMCP:${requestId}] Compare [Smoke] vs [fetch] logs above to find the difference`);
      }

      // Try SSE as fallback
      console.log(`[RealLangChainMCP:${requestId}] === ATTEMPTING SSE TRANSPORT AS FALLBACK ===`);
      transportUsed = 'sse';

      try {
        await client?.close();
      } catch {}

      try {
        const sseResult = await withFetchLogging(async () => {
          console.log(`[RealLangChainMCP:${requestId}] Creating SSE MCP client...`);
          client = new MultiServerMCPClient({
            spotify: {
              transport: 'sse',
              url: mcpServerUrl,
              headers: {
                'Authorization': `Bearer ${sessionToken}`,
                'MCP-Protocol-Version': '2025-06-18',
                'User-Agent': 'langchain-mcp-worker-sse/1.0'
              }
            }
          });

          console.log(`[RealLangChainMCP:${requestId}] SSE client created, calling getTools()...`);
          return await client.getTools();
        });

        tools = sseResult;
      } catch (sseError) {
        const sseErrorMessage = sseError instanceof Error ? sseError.message : String(sseError);
        const errorMessage = `Both HTTP and SSE transports failed. HTTP: ${httpErrorMessage}, SSE: ${sseErrorMessage}`;
        console.error(`[RealLangChainMCP:${requestId}] ${errorMessage}`);
        console.error(`[RealLangChainMCP:${requestId}] Error after ${Date.now() - startTime}ms`);

        return c.json({
          error: errorMessage,
          errorType: 'Error',
          requestId
        }, 500);
      }
    }

    if (!tools || !tools.length) {
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
      { role: 'user' as const, content: request.message },
      { role: 'assistant' as const, content: finalMessage }
    ];

    const duration = Date.now() - startTime;
    console.log(`[RealLangChainMCP:${requestId}] === REQUEST COMPLETE (${duration}ms) ===`);
    console.log(`[RealLangChainMCP:${requestId}] Transport used: ${transportUsed}`);
    console.log(`[RealLangChainMCP:${requestId}] Total messages: ${finalHistory.length}`);

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
    // Create test session
    const testSession = await sessionManager.createSession('test-spotify-token', 'test-user');
    const sessionToken = testSession.id;

    console.log(`[RealLangChainMCP:${testId}] Created test session: ${sessionToken}`);

    const origin = new URL(c.req.url).origin;
    const mcpServerUrl = `${origin}/api/mcp`;

    console.log(`[RealLangChainMCP:${testId}] MCP server URL: ${mcpServerUrl}`);

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
      console.log(`[RealLangChainMCP:${testId}] SSE transport successful`);
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
      console.log(`[RealLangChainMCP:${testId}] HTTP transport successful`);
    }

    const toolNames = tools.map(t => t.name);
    console.log(`[RealLangChainMCP:${testId}] Discovered ${tools.length} tools`);

    // Clean up
    try { await client.close(); } catch {}

    return c.json({
      success: true,
      transport: transportUsed,
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