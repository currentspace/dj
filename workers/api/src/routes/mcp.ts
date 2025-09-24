// MCP Server - Streamable HTTP Transport (2025-03-26)
import { Hono } from 'hono';
import type { Env } from '../index';
import { SessionManager } from '../lib/session-manager';
import { executeSpotifyTool, spotifyTools } from '../lib/spotify-tools';
import { z } from 'zod';

const mcpRouter = new Hono<{ Bindings: Env }>();

// MCP Protocol Schemas
const MCPRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.any().optional(),
  id: z.union([z.string(), z.number()])
});

// Session manager instance
let sessionManager: SessionManager;

// Initialize session manager
mcpRouter.use('*', async (c, next) => {
  if (!sessionManager) {
    sessionManager = new SessionManager(c.env.SESSIONS);
  }
  await next();
});

/**
 * STREAMABLE HTTP TRANSPORT (2025-03-26) - Main MCP Endpoint
 * Single endpoint handling both POST and GET with proper headers
 */
mcpRouter.all('/', async (c) => {
  const startTime = Date.now();
  const method = c.req.method;
  const acceptHeader = c.req.header('Accept') || '';
  const sessionId = c.req.header('Mcp-Session-Id');
  const userAgent = c.req.header('User-Agent') || '';
  const origin = c.req.header('Origin') || '';
  const requestId = crypto.randomUUID().substring(0, 8);

  console.log(`[MCP:${requestId}] === STREAMABLE HTTP REQUEST ===`);
  console.log(`[MCP:${requestId}] Method: ${method}`);
  console.log(`[MCP:${requestId}] Accept: ${acceptHeader}`);
  console.log(`[MCP:${requestId}] User-Agent: ${userAgent.substring(0, 100)}${userAgent.length > 100 ? '...' : ''}`);
  console.log(`[MCP:${requestId}] Origin: ${origin}`);
  console.log(`[MCP:${requestId}] Session-Id: ${sessionId?.substring(0, 8) || 'none'}`);
  console.log(`[MCP:${requestId}] URL: ${c.req.url}`);

  // Validate authorization
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    const duration = Date.now() - startTime;
    console.error(`[MCP:${requestId}] UNAUTHORIZED - No bearer token provided (${duration}ms)`);
    console.log(`[MCP:${requestId}] Available headers:`, Object.fromEntries(c.req.headers.entries()));
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionToken = authorization.replace('Bearer ', '');
  console.log(`[MCP:${requestId}] Session token: ${sessionToken.substring(0, 8)}...${sessionToken.substring(-4)}`);

  const spotifyToken = await sessionManager.validateSession(sessionToken);

  if (!spotifyToken) {
    const duration = Date.now() - startTime;
    console.error(`[MCP:${requestId}] INVALID SESSION - Token not found or expired (${duration}ms)`);
    console.log(`[MCP:${requestId}] Session validation failed for: ${sessionToken.substring(0, 8)}...`);
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  console.log(`[MCP:${requestId}] Session validated successfully`);
  console.log(`[MCP:${requestId}] Spotify token: ${spotifyToken.substring(0, 20)}...`)

  if (method === 'GET') {
    // GET requests should support text/event-stream
    console.log(`[MCP:${requestId}] Processing GET request`);

    if (!acceptHeader.includes('text/event-stream')) {
      const duration = Date.now() - startTime;
      console.warn(`[MCP:${requestId}] GET REJECTED - Missing text/event-stream accept header (${duration}ms)`);
      console.log(`[MCP:${requestId}] Expected: text/event-stream, Got: ${acceptHeader}`);
      return c.json({ error: 'Method not allowed' }, 405);
    }

    // Initialize SSE stream
    const duration = Date.now() - startTime;
    console.log(`[MCP:${requestId}] Initializing SSE stream (${duration}ms)`);

    // Set up SSE headers
    const headers = new Headers({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Create a readable stream for SSE
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Send initial connection message
    const writeSSEMessage = async (data: any, event?: string) => {
      let message = '';
      if (event) {
        message += `event: ${event}\n`;
      }
      message += `data: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(message));
    };

    // Send initial connection established message
    try {
      await writeSSEMessage({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {
          serverInfo: {
            name: 'spotify-mcp-server',
            version: '2.0.0'
          },
          protocolVersion: '2025-06-18'
        }
      }, 'initialized');

      console.log(`[MCP:${requestId}] SSE connection established successfully`);

      // Keep the connection alive with periodic pings
      const keepAlive = setInterval(async () => {
        try {
          await writeSSEMessage({ type: 'ping' }, 'ping');
        } catch (error) {
          console.log(`[MCP:${requestId}] SSE keepalive failed, client likely disconnected`);
          clearInterval(keepAlive);
        }
      }, 30000); // Ping every 30 seconds

      // Handle cleanup when client disconnects
      const cleanup = () => {
        clearInterval(keepAlive);
        writer.close().catch(() => {});
        console.log(`[MCP:${requestId}] SSE connection closed`);
      };

      // Set up connection close handler
      c.req.raw.signal?.addEventListener('abort', cleanup);

    } catch (error) {
      console.error(`[MCP:${requestId}] SSE initialization error:`, error);
      await writer.close();
      return c.json({ error: 'SSE initialization failed' }, 500);
    }

    return new Response(readable, { headers });
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
          const response = await handleMCPRequest(mcpRequest, spotifyToken, requestId, sessionToken);
          responses.push(response);
          console.log(`[MCP:${requestId}] Request ${i + 1} completed successfully`);
        } catch (error) {
          console.error(`[MCP:${requestId}] Request ${i + 1} validation error:`, error);
          console.log(`[MCP:${requestId}] Invalid request data:`, JSON.stringify(request).substring(0, 200));
          responses.push({
            jsonrpc: '2.0',
            error: {
              code: -32602,
              message: 'Invalid params'
            },
            id: request?.id || null
          });
        }
      }

      // Return single response or batch
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
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
      });

      return c.json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error'
        },
        id: null
      }, 500);
    }
  }

  const duration = Date.now() - startTime;
  console.error(`[MCP:${requestId}] UNSUPPORTED METHOD: ${method} (${duration}ms)`);
  return c.json({ error: 'Method not allowed' }, 405);
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
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: 'spotify-mcp-server',
            version: '2.0.0'
          }
        },
        id: request.id
      };

      const initDuration = Date.now() - methodStartTime;
      console.log(`[MCP:${requestId}] INITIALIZE completed in ${initDuration}ms`);
      console.log(`[MCP:${requestId}] Protocol version: ${initResult.result.protocolVersion}`);
      console.log(`[MCP:${requestId}] Server: ${initResult.result.serverInfo.name} v${initResult.result.serverInfo.version}`);

      return initResult;

    case 'tools/list':
      console.log(`[MCP:${requestId}] TOOLS/LIST - Fetching available tools`);

      const toolsResult = {
        jsonrpc: '2.0',
        result: {
          tools: spotifyTools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.input_schema
          }))
        },
        id: request.id
      };

      const listDuration = Date.now() - methodStartTime;
      console.log(`[MCP:${requestId}] TOOLS/LIST completed in ${listDuration}ms`);
      console.log(`[MCP:${requestId}] Available tools: ${toolsResult.result.tools.length}`);
      console.log(`[MCP:${requestId}] Tool names: [${toolsResult.result.tools.map(t => t.name).join(', ')}]`);

      return toolsResult;

    case 'tools/call':
      const { name, arguments: args } = request.params || {};

      console.log(`[MCP:${requestId}] TOOLS/CALL - Executing: ${name}`);
      console.log(`[MCP:${requestId}] Tool arguments:`, JSON.stringify(args).substring(0, 200));
      console.log(`[MCP:${requestId}] Spotify token available: ${!!spotifyToken}`);

      if (!name) {
        console.error(`[MCP:${requestId}] TOOLS/CALL ERROR - No tool name provided`);
        return {
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: 'Missing tool name'
          },
          id: request.id
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
          jsonrpc: '2.0',
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          },
          id: request.id
        };
      } catch (toolError) {
        const totalDuration = Date.now() - methodStartTime;
        console.error(`[MCP:${requestId}] TOOLS/CALL FAILED - ${name} error after ${totalDuration}ms:`, toolError);
        console.log(`[MCP:${requestId}] Tool error details:`, {
          name: toolError instanceof Error ? toolError.name : 'Unknown',
          message: toolError instanceof Error ? toolError.message : String(toolError),
          stack: toolError instanceof Error ? toolError.stack?.substring(0, 300) : undefined
        });

        return {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: toolError instanceof Error ? toolError.message : 'Tool execution failed'
          },
          id: request.id
        };
      }

    default:
      const duration = Date.now() - methodStartTime;
      console.error(`[MCP:${requestId}] UNKNOWN METHOD: ${method} (${duration}ms)`);
      console.log(`[MCP:${requestId}] Available methods: initialize, tools/list, tools/call`);
      console.log(`[MCP:${requestId}] Request data:`, JSON.stringify(request).substring(0, 200));

      return {
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Method not found'
        },
        id: request.id
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
      sessionToken,
      mcpServerUrl,
      userId: userData.id,
      displayName: userData.display_name,
      requestId: sessionRequestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP:${sessionRequestId}] SESSION CREATE ERROR after ${duration}ms:`, error);
    console.log(`[MCP:${sessionRequestId}] Error details:`, {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.substring(0, 300) : undefined
    });

    return c.json({
      error: 'Failed to create session',
      requestId: sessionRequestId
    }, 500);
  }
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
      success: true,
      requestId: destroyRequestId
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