// MCP Server - Streamable HTTP Transport (2025-03-26)
import { Hono } from 'hono';
import { z } from 'zod';

import type { Env } from '../index';

import { SessionManager } from '../lib/session-manager';
import { executeSpotifyTool, spotifyTools } from '../lib/spotify-tools';

const mcpRouter = new Hono<{ Bindings: Env }>();

// MCP Protocol Schemas
const MCPRequestSchema = z.object({
  id: z.union([z.string(), z.number()]).nullable().optional(), // Optional for notifications
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.any().optional()
});

// Check if method is a notification (no response expected)
const isNotification = (method: string) => method.startsWith('notifications/');

// Session manager instance
let sessionManager: SessionManager;

// Initialize session manager
mcpRouter.use('*', async (c, next) => {
  if (!sessionManager) {
    sessionManager = new SessionManager(c.env.SESSIONS);
  }

  // Add CORS headers for LangChain MCP client
  c.res.headers.set('Access-Control-Allow-Origin', '*');
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, Accept');
  c.res.headers.set('Access-Control-Max-Age', '86400');

  // Handle preflight OPTIONS requests
  if (c.req.method === 'OPTIONS') {
    return c.text('', 204);
  }

  await next();
});

/**
 * STREAMABLE HTTP TRANSPORT (2025-03-26) - Main MCP Endpoint
 * Single endpoint handling both POST and GET with proper headers
 */
mcpRouter.all('/', async (c) => {
  const startTime = Date.now();
  const requestId = crypto.randomUUID().substring(0, 8);

  try {
    const method = c.req.method;
    const acceptHeader = c.req.header('Accept') || '';
    const sessionId = c.req.header('Mcp-Session-Id');
    const userAgent = c.req.header('User-Agent') || '';
    const origin = c.req.header('Origin') || '';

    console.log(`[MCP:${requestId}] === MCP ENDPOINT HIT ===`);
    console.log(`[MCP:${requestId}] URL: ${c.req.url}`);
    console.log(`[MCP:${requestId}] Method: ${method}`);
    console.log(`[MCP:${requestId}] Accept: ${acceptHeader}`);
    console.log(`[MCP:${requestId}] User-Agent: ${userAgent.substring(0, 100)}${userAgent.length > 100 ? '...' : ''}`);
    console.log(`[MCP:${requestId}] Origin: ${origin}`);
    console.log(`[MCP:${requestId}] Session-Id: ${sessionId?.substring(0, 8) || 'none'}`);

  // Helper functions for safe header handling
  const getHeader = (name: string) => c.req.header(name) ?? c.req.raw.headers.get(name);

  const dumpHeaders = () => {
    const entries = Array.from(c.req.raw.headers.entries());
    return Object.fromEntries(
      entries.map(([k, v]) => [
        k,
        k.toLowerCase() === 'authorization' ? '<redacted>' : v,
      ])
    );
  };

  // Validate authorization
  const authorization = getHeader('authorization');
  console.log(`[MCP:${requestId}] Authorization header present: ${!!authorization}`);
  console.log(`[MCP:${requestId}] Authorization format correct: ${authorization?.startsWith('Bearer ')}`);

  if (!authorization?.startsWith('Bearer ')) {
    const duration = Date.now() - startTime;
    console.warn(`[MCP:${requestId}] UNAUTHORIZED - No bearer token provided (${duration}ms)`);
    console.log(`[MCP:${requestId}] Authorization header value: ${authorization ?? 'undefined'}`);
    console.log(`[MCP:${requestId}] Available headers:`, dumpHeaders());

    return c.json({
      details: 'Missing or invalid Authorization header',
      error: 'Unauthorized',
      expected: 'Authorization: Bearer <session-token>',
      received: authorization || 'none',
      requestId,
      timestamp: Date.now()
    }, 401);
  }

  const sessionToken = authorization.replace('Bearer ', '');
  console.log(`[MCP:${requestId}] Session token: ${sessionToken.substring(0, 8)}...${sessionToken.substring(-4)}`);

  console.log(`[MCP:${requestId}] Validating session with session manager...`);
  let spotifyToken: null | string = null;

  try {
    spotifyToken = await sessionManager.validateSession(sessionToken);
    console.log(`[MCP:${requestId}] Session validation completed, token found: ${!!spotifyToken}`);
  } catch (sessionError) {
    const duration = Date.now() - startTime;
    console.error(`[MCP:${requestId}] SESSION VALIDATION ERROR after ${duration}ms:`, sessionError);
    return c.json({
      details: sessionError instanceof Error ? sessionError.message : 'Unknown session error',
      error: 'Session validation failed',
      requestId
    }, 500);
  }

  if (!spotifyToken) {
    const duration = Date.now() - startTime;
    console.warn(`[MCP:${requestId}] INVALID SESSION - Token not found or expired (${duration}ms)`);
    console.log(`[MCP:${requestId}] Session validation failed for: ${sessionToken.substring(0, 8)}...`);
    return c.json({
      details: 'Session token not found or has expired',
      error: 'Invalid or expired session',
      requestId,
      timestamp: Date.now()
    }, 401);
  }

  console.log(`[MCP:${requestId}] Session validated successfully`);
  console.log(`[MCP:${requestId}] Spotify token: ${spotifyToken.substring(0, 20)}...`)

  if (method === 'GET') {
    // GET requests should support text/event-stream
    console.log(`[MCP:${requestId}] Processing GET request for SSE`);
    console.log(`[MCP:${requestId}] All headers:`, Object.fromEntries(c.req.headers.entries()));

    if (!acceptHeader.includes('text/event-stream')) {
      const duration = Date.now() - startTime;
      console.warn(`[MCP:${requestId}] GET REJECTED - Missing text/event-stream accept header (${duration}ms)`);
      console.log(`[MCP:${requestId}] Expected: text/event-stream, Got: ${acceptHeader}`);

      // For debugging, also try to serve SSE even without the header
      if (c.req.url.includes('debug-sse')) {
        console.log(`[MCP:${requestId}] DEBUG MODE - Serving SSE anyway`);
      } else {
        return c.json({ error: 'Method not allowed', expected: 'Accept: text/event-stream', received: acceptHeader }, 405);
      }
    }

    // Initialize Worker-safe SSE stream
    const duration = Date.now() - startTime;
    console.log(`[MCP:${requestId}] Initializing Worker-safe SSE stream (${duration}ms)`);

    const headers = {
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'text/event-stream; charset=utf-8'
    };

    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();

        const send = (data: unknown, event?: string) => {
          let message = '';
          if (event) {
            message += `event: ${event}\n`;
          }
          message += `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(enc.encode(message));
        };

        // Send initialization event immediately
        send({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {
            capabilities: {
              resources: {},
              tools: {}
            },
            protocolVersion: '2025-06-18',
            serverInfo: {
              name: 'spotify-mcp-server',
              version: '2.0.0'
            }
          }
        }, 'initialized');

        // Send ready event
        send({ timestamp: Date.now(), type: 'ready' }, 'ready');

        console.log(`[MCP:${requestId}] SSE connection established, events sent`);

        // Heartbeat every 20 seconds to prevent 522s
        const heartbeat = setInterval(() => {
          try {
            send({ timestamp: Date.now(), type: 'heartbeat' }, 'ping');
          } catch (error) {
            console.log(`[MCP:${requestId}] Heartbeat failed, client likely disconnected`);
            clearInterval(heartbeat);
          }
        }, 20000);

        // Clean up on client disconnect
        c.req.raw.signal?.addEventListener('abort', () => {
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {}
          console.log(`[MCP:${requestId}] SSE connection closed`);
        });
      }
    });

    return new Response(stream, { headers, status: 200 });
  }

  if (method === 'POST') {
    console.log(`[MCP:${requestId}] Processing POST request`);

    // POST requests must support application/json
    if (!acceptHeader.includes('application/json')) {
      const duration = Date.now() - startTime;
      console.error(`[MCP:${requestId}] POST REJECTED - Missing application/json accept header (${duration}ms)`);
      console.log(`[MCP:${requestId}] Expected: application/json, Got: ${acceptHeader}`);
      return c.json({ error: 'Bad Request' }, 400);
    }

    try {
      const body = await c.req.json();
      const bodyStr = JSON.stringify(body);
      console.log(`[MCP:${requestId}] Request body (${bodyStr.length} chars):`, bodyStr.substring(0, 300) + (bodyStr.length > 300 ? '...' : ''));

      // Handle single request or batch
      const requests = Array.isArray(body) ? body : [body];
      const responses: any[] = [];

      console.log(`[MCP:${requestId}] Processing ${requests.length} request(s) ${Array.isArray(body) ? '(batch)' : '(single)'}`);

      for (let i = 0; i < requests.length; i++) {
        const request = requests[i];
        console.log(`[MCP:${requestId}] Processing request ${i + 1}/${requests.length}: ${request?.method || 'unknown'}`);

        try {
          const mcpRequest = MCPRequestSchema.parse(request);

          // Check if this is a notification
          if (isNotification(mcpRequest.method)) {
            console.log(`[MCP:${requestId}] Notification received: ${mcpRequest.method} (no response will be sent)`);
            // Notifications don't get responses, skip to next
            continue;
          }

          // For non-notifications, require an id
          if (mcpRequest.id === undefined || mcpRequest.id === null) {
            console.error(`[MCP:${requestId}] Non-notification ${mcpRequest.method} missing required id`);
            responses.push({
              error: {
                code: -32600,
                message: 'Invalid Request: id required for non-notifications'
              },
              id: null,
              jsonrpc: '2.0'
            });
            continue;
          }

          const response = await handleMCPRequest(mcpRequest, spotifyToken, requestId, sessionToken);
          responses.push(response);
          console.log(`[MCP:${requestId}] Request ${i + 1} completed successfully`);
        } catch (error) {
          console.error(`[MCP:${requestId}] Request ${i + 1} validation error:`, error);
          console.log(`[MCP:${requestId}] Invalid request data:`, JSON.stringify(request).substring(0, 200));
          responses.push({
            error: {
              code: -32602,
              message: 'Invalid params'
            },
            id: request?.id || null,
            jsonrpc: '2.0'
          });
        }
      }

      // Return single response or batch (or 204 for notifications only)
      if (responses.length === 0) {
        // All were notifications, return 204 No Content
        console.log(`[MCP:${requestId}] All requests were notifications, returning 204`);
        return new Response(null, { status: 204 });
      }

      const result = Array.isArray(body) ? responses : responses[0];
      const duration = Date.now() - startTime;
      const resultStr = JSON.stringify(result);

      console.log(`[MCP:${requestId}] === REQUEST COMPLETE (${duration}ms) ===`);
      console.log(`[MCP:${requestId}] Processed: ${requests.length} request(s)`);
      console.log(`[MCP:${requestId}] Response size: ${resultStr.length} chars`);
      console.log(`[MCP:${requestId}] Response preview:`, resultStr.substring(0, 200) + (resultStr.length > 200 ? '...' : ''));

      return c.json(result);

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[MCP:${requestId}] POST FATAL ERROR after ${duration}ms:`, error);
      console.log(`[MCP:${requestId}] Error details:`, {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
      });

      return c.json({
        error: {
          code: -32603,
          message: 'Internal error'
        },
        id: null,
        jsonrpc: '2.0'
      }, 500);
    }
  }

    const duration = Date.now() - startTime;
    console.error(`[MCP:${requestId}] UNSUPPORTED METHOD: ${method} (${duration}ms)`);
    return c.json({ error: 'Method not allowed' }, 405);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP:${requestId}] FATAL ERROR after ${duration}ms:`, error);

    if (error instanceof Error) {
      console.error(`[MCP:${requestId}] Error name: ${error.name}`);
      console.error(`[MCP:${requestId}] Error message: ${error.message}`);
      console.error(`[MCP:${requestId}] Error stack: ${error.stack?.substring(0, 1000)}`);
    } else {
      console.error(`[MCP:${requestId}] Non-Error exception:`, String(error));
    }

    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
      requestId,
      timestamp: Date.now()
    }, 500);
  }
});

async function handleMCPRequest(request: any, spotifyToken: string, requestId: string, sessionToken?: string) {
  const methodStartTime = Date.now();
  const method = request.method;
  const requestIdHeader = request.id;

  console.log(`[MCP:${requestId}] === HANDLING METHOD: ${method} ===`);
  console.log(`[MCP:${requestId}] Request ID: ${requestIdHeader}`);
  console.log(`[MCP:${requestId}] Has session token: ${!!sessionToken}`);

  switch (method) {
    case 'initialize':
      console.log(`[MCP:${requestId}] INITIALIZE - Setting up MCP connection`);
      const initResult = {
        id: request.id,
        jsonrpc: '2.0',
        result: {
          capabilities: {
            resources: {},
            tools: {}
          },
          protocolVersion: '2025-06-18',
          serverInfo: {
            name: 'spotify-mcp-server',
            version: '2.0.0'
          }
        }
      };

      const initDuration = Date.now() - methodStartTime;
      console.log(`[MCP:${requestId}] INITIALIZE completed in ${initDuration}ms`);
      console.log(`[MCP:${requestId}] Protocol version: ${initResult.result.protocolVersion}`);
      console.log(`[MCP:${requestId}] Server: ${initResult.result.serverInfo.name} v${initResult.result.serverInfo.version}`);

      return initResult;

    case 'tools/list':
      console.log(`[MCP:${requestId}] TOOLS/LIST - Fetching available tools`);

      const toolsResult = {
        id: request.id,
        jsonrpc: '2.0',
        result: {
          tools: spotifyTools.map(tool => ({
            description: tool.description,
            inputSchema: tool.input_schema,
            name: tool.name
          }))
        }
      };

      const listDuration = Date.now() - methodStartTime;
      console.log(`[MCP:${requestId}] TOOLS/LIST completed in ${listDuration}ms`);
      console.log(`[MCP:${requestId}] Available tools: ${toolsResult.result.tools.length}`);
      console.log(`[MCP:${requestId}] Tool names: [${toolsResult.result.tools.map(t => t.name).join(', ')}]`);

      return toolsResult;

    case 'tools/call':
      const { arguments: args, name } = request.params || {};

      console.log(`[MCP:${requestId}] TOOLS/CALL - Executing: ${name}`);
      console.log(`[MCP:${requestId}] Tool arguments:`, JSON.stringify(args).substring(0, 200));
      console.log(`[MCP:${requestId}] Spotify token available: ${!!spotifyToken}`);

      if (!name) {
        console.error(`[MCP:${requestId}] TOOLS/CALL ERROR - No tool name provided`);
        return {
          error: {
            code: -32602,
            message: 'Missing tool name'
          },
          id: request.id,
          jsonrpc: '2.0'
        };
      }

      try {
        const toolStartTime = Date.now();
        const result = await executeSpotifyTool(name, args, spotifyToken);
        const toolDuration = Date.now() - toolStartTime;

        // Touch session to keep it alive
        if (sessionToken) {
          await sessionManager.touchSession(sessionToken);
          console.log(`[MCP:${requestId}] Session refreshed`);
        }

        const totalDuration = Date.now() - methodStartTime;
        const resultStr = JSON.stringify(result);

        console.log(`[MCP:${requestId}] TOOLS/CALL SUCCESS - ${name} completed`);
        console.log(`[MCP:${requestId}] Tool execution time: ${toolDuration}ms`);
        console.log(`[MCP:${requestId}] Total method time: ${totalDuration}ms`);
        console.log(`[MCP:${requestId}] Result size: ${resultStr.length} chars`);
        console.log(`[MCP:${requestId}] Result preview:`, resultStr.substring(0, 200) + (resultStr.length > 200 ? '...' : ''));

        return {
          id: request.id,
          jsonrpc: '2.0',
          result: {
            content: [
              {
                text: JSON.stringify(result, null, 2),
                type: 'text'
              }
            ]
          }
        };
      } catch (toolError) {
        const totalDuration = Date.now() - methodStartTime;
        console.error(`[MCP:${requestId}] TOOLS/CALL FAILED - ${name} error after ${totalDuration}ms:`, toolError);
        console.log(`[MCP:${requestId}] Tool error details:`, {
          message: toolError instanceof Error ? toolError.message : String(toolError),
          name: toolError instanceof Error ? toolError.name : 'Unknown',
          stack: toolError instanceof Error ? toolError.stack?.substring(0, 300) : undefined
        });

        return {
          error: {
            code: -32603,
            message: toolError instanceof Error ? toolError.message : 'Tool execution failed'
          },
          id: request.id,
          jsonrpc: '2.0'
        };
      }

    default:
      const duration = Date.now() - methodStartTime;
      console.error(`[MCP:${requestId}] UNKNOWN METHOD: ${method} (${duration}ms)`);
      console.log(`[MCP:${requestId}] Available methods: initialize, tools/list, tools/call`);
      console.log(`[MCP:${requestId}] Request data:`, JSON.stringify(request).substring(0, 200));

      return {
        error: {
          code: -32601,
          message: 'Method not found'
        },
        id: request.id,
        jsonrpc: '2.0'
      };
  }
}

/**
 * Session Creation Endpoint - Called after Spotify auth
 */
mcpRouter.post('/session/create', async (c) => {
  const sessionRequestId = crypto.randomUUID().substring(0, 8);
  const startTime = Date.now();

  console.log(`[MCP:${sessionRequestId}] === SESSION CREATE REQUEST ===`);
  console.log(`[MCP:${sessionRequestId}] URL: ${c.req.url}`);
  console.log(`[MCP:${sessionRequestId}] User-Agent: ${c.req.header('User-Agent')?.substring(0, 100) || 'unknown'}`);

  try {
    const authorization = c.req.header('Authorization');
    const spotifyToken = authorization?.replace('Bearer ', '');

    console.log(`[MCP:${sessionRequestId}] Authorization header present: ${!!authorization}`);
    console.log(`[MCP:${sessionRequestId}] Spotify token length: ${spotifyToken?.length || 0}`);

    if (!spotifyToken) {
      const duration = Date.now() - startTime;
      console.error(`[MCP:${sessionRequestId}] SESSION CREATE FAILED - No Spotify token provided (${duration}ms)`);
      return c.json({ error: 'Spotify token required' }, 400);
    }

    console.log(`[MCP:${sessionRequestId}] Spotify token: ${spotifyToken.substring(0, 20)}...`);
    console.log(`[MCP:${sessionRequestId}] Validating with Spotify API...`);

    // Validate Spotify token by making a test request
    const spotifyStartTime = Date.now();
    const testResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${spotifyToken}`
      }
    });
    const spotifyDuration = Date.now() - spotifyStartTime;

    console.log(`[MCP:${sessionRequestId}] Spotify API response: ${testResponse.status} (${spotifyDuration}ms)`);

    if (!testResponse.ok) {
      const duration = Date.now() - startTime;
      const errorText = await testResponse.text().catch(() => 'unknown');
      console.error(`[MCP:${sessionRequestId}] SESSION CREATE FAILED - Invalid Spotify token`);
      console.log(`[MCP:${sessionRequestId}] Status: ${testResponse.status}, Duration: ${duration}ms`);
      console.log(`[MCP:${sessionRequestId}] Spotify error: ${errorText.substring(0, 200)}`);
      return c.json({ error: 'Invalid Spotify token' }, 401);
    }

    const userData = await testResponse.json();
    console.log(`[MCP:${sessionRequestId}] Spotify user validated: ${userData.id}`);
    console.log(`[MCP:${sessionRequestId}] Display name: ${userData.display_name || 'none'}`);
    console.log(`[MCP:${sessionRequestId}] Country: ${userData.country || 'unknown'}`);
    console.log(`[MCP:${sessionRequestId}] Followers: ${userData.followers?.total || 0}`);

    // Create session
    console.log(`[MCP:${sessionRequestId}] Creating session...`);
    const sessionStartTime = Date.now();
    const sessionToken = await sessionManager.createSession(spotifyToken, userData.id);
    const sessionCreationTime = Date.now() - sessionStartTime;

    const totalDuration = Date.now() - startTime;
    const mcpServerUrl = `${new URL(c.req.url).origin}/api/mcp`;

    console.log(`[MCP:${sessionRequestId}] === SESSION CREATE SUCCESS ===`);
    console.log(`[MCP:${sessionRequestId}] Session creation time: ${sessionCreationTime}ms`);
    console.log(`[MCP:${sessionRequestId}] Total duration: ${totalDuration}ms`);
    console.log(`[MCP:${sessionRequestId}] Session token: ${sessionToken.substring(0, 8)}...${sessionToken.substring(-4)}`);
    console.log(`[MCP:${sessionRequestId}] MCP server URL: ${mcpServerUrl}`);

    return c.json({
      displayName: userData.display_name,
      mcpServerUrl,
      requestId: sessionRequestId,
      sessionToken,
      userId: userData.id
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP:${sessionRequestId}] SESSION CREATE ERROR after ${duration}ms:`, error);
    console.log(`[MCP:${sessionRequestId}] Error details:`, {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Unknown',
      stack: error instanceof Error ? error.stack?.substring(0, 300) : undefined
    });

    return c.json({
      error: 'Failed to create session',
      requestId: sessionRequestId
    }, 500);
  }
});

/**
 * Simple health check endpoint (no auth required)
 */
mcpRouter.get('/health', async (c) => {
  const healthId = crypto.randomUUID().substring(0, 8);
  console.log(`[MCP-Health:${healthId}] Health check requested`);

  return c.json({
    healthId,
    server: 'spotify-mcp-server',
    status: 'healthy',
    timestamp: Date.now(),
    version: '2.0.0'
  });
});

/**
 * Simple SSE test endpoint (no auth required)
 */
mcpRouter.get('/test-sse', async (c) => {
  const testId = crypto.randomUUID().substring(0, 8);
  console.log(`[SSE-Test:${testId}] === SSE TEST ENDPOINT ===`);

  const headers = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-transform',
    'Content-Type': 'text/event-stream; charset=utf-8'
  };

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let counter = 0;

      const send = (data: unknown, event?: string) => {
        let message = '';
        if (event) {
          message += `event: ${event}\n`;
        }
        message += `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(enc.encode(message));
        console.log(`[SSE-Test:${testId}] Sent: ${event || 'data'} - ${JSON.stringify(data).substring(0, 100)}`);
      };

      // Send immediate events
      send({ testId, timestamp: Date.now(), type: 'connected' }, 'connected');
      send({ message: 'SSE test endpoint ready', type: 'ready' }, 'ready');

      // Send periodic test events
      const interval = setInterval(() => {
        counter++;
        try {
          send({
            counter,
            message: `Test event #${counter}`,
            timestamp: Date.now(),
            type: 'test'
          }, 'test');

          if (counter >= 5) {
            send({ message: 'Test complete', type: 'complete' }, 'complete');
            clearInterval(interval);
            controller.close();
            console.log(`[SSE-Test:${testId}] Test completed, connection closed`);
          }
        } catch (error) {
          console.log(`[SSE-Test:${testId}] Send failed:`, error);
          clearInterval(interval);
          controller.close();
        }
      }, 2000);

      // Cleanup on disconnect
      c.req.raw.signal?.addEventListener('abort', () => {
        console.log(`[SSE-Test:${testId}] Client disconnected`);
        clearInterval(interval);
        try { controller.close(); } catch {}
      });

      console.log(`[SSE-Test:${testId}] SSE stream started`);
    }
  });

  return new Response(stream, { headers, status: 200 });
});

/**
 * Session Destroy Endpoint - Called on logout
 */
mcpRouter.post('/session/destroy', async (c) => {
  const destroyRequestId = crypto.randomUUID().substring(0, 8);
  const startTime = Date.now();

  console.log(`[MCP:${destroyRequestId}] === SESSION DESTROY REQUEST ===`);

  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    const duration = Date.now() - startTime;
    console.error(`[MCP:${destroyRequestId}] SESSION DESTROY FAILED - No bearer token (${duration}ms)`);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionToken = authorization.replace('Bearer ', '');
  console.log(`[MCP:${destroyRequestId}] Destroying session: ${sessionToken.substring(0, 8)}...${sessionToken.substring(-4)}`);

  try {
    await sessionManager.destroySession(sessionToken);
    const duration = Date.now() - startTime;

    console.log(`[MCP:${destroyRequestId}] === SESSION DESTROY SUCCESS (${duration}ms) ===`);

    return c.json({
      requestId: destroyRequestId,
      success: true
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP:${destroyRequestId}] SESSION DESTROY ERROR after ${duration}ms:`, error);

    return c.json({
      error: 'Failed to destroy session',
      requestId: destroyRequestId
    }, 500);
  }
});

export { mcpRouter };