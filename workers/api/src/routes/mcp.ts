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
  const method = c.req.method;
  const acceptHeader = c.req.header('Accept') || '';
  const sessionId = c.req.header('Mcp-Session-Id');
  const requestId = crypto.randomUUID().substring(0, 8);

  console.log(`[MCP:${requestId}] ${method} request to main endpoint`);
  console.log(`[MCP:${requestId}] Accept: ${acceptHeader}`);
  console.log(`[MCP:${requestId}] Session-Id: ${sessionId?.substring(0, 8) || 'none'}`);

  // Validate authorization
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    console.warn(`[MCP:${requestId}] No bearer token provided`);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionToken = authorization.replace('Bearer ', '');
  const spotifyToken = await sessionManager.validateSession(sessionToken);

  if (!spotifyToken) {
    console.warn(`[MCP:${requestId}] Invalid session: ${sessionToken.substring(0, 8)}...`);
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  if (method === 'GET') {
    // GET requests should support text/event-stream
    if (!acceptHeader.includes('text/event-stream')) {
      console.warn(`[MCP:${requestId}] GET without SSE accept header`);
      return c.json({ error: 'Method not allowed' }, 405);
    }

    // For now, return 405 as we don't support SSE streaming yet
    console.log(`[MCP:${requestId}] GET/SSE not implemented yet`);
    return c.json({ error: 'Method not allowed' }, 405);
  }

  if (method === 'POST') {
    // POST requests must support application/json
    if (!acceptHeader.includes('application/json')) {
      console.warn(`[MCP:${requestId}] POST without JSON accept header`);
      return c.json({ error: 'Bad Request' }, 400);
    }

    try {
      const body = await c.req.json();
      console.log(`[MCP:${requestId}] Request:`, JSON.stringify(body).substring(0, 200));

      // Handle single request or batch
      const requests = Array.isArray(body) ? body : [body];
      const responses: any[] = [];

      for (const request of requests) {
        try {
          const mcpRequest = MCPRequestSchema.parse(request);
          const response = await handleMCPRequest(mcpRequest, spotifyToken, requestId, sessionToken);
          responses.push(response);
        } catch (error) {
          console.error(`[MCP:${requestId}] Request validation error:`, error);
          responses.push({
            jsonrpc: '2.0',
            error: {
              code: -32602,
              message: 'Invalid params'
            },
            id: request.id || null
          });
        }
      }

      // Return single response or batch
      const result = Array.isArray(body) ? responses : responses[0];
      console.log(`[MCP:${requestId}] Responding with ${responses.length} message(s)`);

      return c.json(result);

    } catch (error) {
      console.error(`[MCP:${requestId}] POST error:`, error);
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

  return c.json({ error: 'Method not allowed' }, 405);
});

async function handleMCPRequest(request: any, spotifyToken: string, requestId: string, sessionToken?: string) {
  console.log(`[MCP:${requestId}] Handling method: ${request.method}`);

  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2025-03-26',
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

    case 'tools/list':
      return {
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

    case 'tools/call':
      const { name, arguments: args } = request.params;
      console.log(`[MCP:${requestId}] Executing tool: ${name}`);

      try {
        const result = await executeSpotifyTool(name, args, spotifyToken);
        if (sessionToken) {
          await sessionManager.touchSession(sessionToken);
        }
        console.log(`[MCP:${requestId}] Tool ${name} completed successfully`);

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
        console.error(`[MCP:${requestId}] Tool ${name} failed:`, toolError);
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
      console.warn(`[MCP:${requestId}] Unknown method: ${request.method}`);
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
  console.log('[MCP] Session creation request received');
  const startTime = Date.now();

  try {
    const spotifyToken = c.req.header('Authorization')?.replace('Bearer ', '');

    if (!spotifyToken) {
      console.warn('[MCP] Session creation failed: No Spotify token provided');
      return c.json({ error: 'Spotify token required' }, 400);
    }

    console.log(`[MCP] Validating Spotify token...`);

    // Validate Spotify token by making a test request
    const testResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${spotifyToken}`
      }
    });

    if (!testResponse.ok) {
      console.error(`[MCP] Invalid Spotify token, status: ${testResponse.status}`);
      return c.json({ error: 'Invalid Spotify token' }, 401);
    }

    const userData = await testResponse.json();
    console.log(`[MCP] Spotify token valid for user: ${userData.id} (${userData.display_name})`);

    // Create session
    const sessionToken = await sessionManager.createSession(spotifyToken, userData.id);

    const duration = Date.now() - startTime;
    console.log(`[MCP] Session created successfully in ${duration}ms`);
    console.log(`[MCP] Session token: ${sessionToken.substring(0, 8)}...`);

    return c.json({
      sessionToken,
      mcpServerUrl: `${new URL(c.req.url).origin}/api/mcp`,
      userId: userData.id,
      displayName: userData.display_name
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP] Session creation error after ${duration}ms:`, error);
    return c.json({ error: 'Failed to create session' }, 500);
  }
});

/**
 * Session Destroy Endpoint - Called on logout
 */
mcpRouter.post('/session/destroy', async (c) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionToken = authorization.replace('Bearer ', '');
  await sessionManager.destroySession(sessionToken);

  return c.json({ success: true });
});

export { mcpRouter };