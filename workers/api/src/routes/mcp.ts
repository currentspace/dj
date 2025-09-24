// MCP Server Implementation for Cloudflare Workers
import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
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

const ToolCallSchema = z.object({
  name: z.string(),
  arguments: z.any()
});

// Session manager instance (reused across requests)
let sessionManager: SessionManager;

// Initialize session manager
mcpRouter.use('*', async (c, next) => {
  if (!sessionManager) {
    sessionManager = new SessionManager(c.env.SESSIONS);
  }
  await next();
});

/**
 * MCP Initialize - Called when Claude connects
 */
mcpRouter.post('/initialize', async (c) => {
  console.log('[MCP] Initialize request received');

  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    console.warn('[MCP] Initialize failed: No bearer token');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionToken = authorization.replace('Bearer ', '');
  console.log(`[MCP] Validating session: ${sessionToken.substring(0, 8)}...`);

  const spotifyToken = await sessionManager.validateSession(sessionToken);

  if (!spotifyToken) {
    console.warn(`[MCP] Invalid or expired session: ${sessionToken.substring(0, 8)}...`);
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  console.log('[MCP] Session validated, returning capabilities');

  return c.json({
    jsonrpc: '2.0',
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      serverInfo: {
        name: 'spotify-mcp-server',
        version: '1.0.0'
      }
    },
    id: 1
  });
});

/**
 * MCP List Tools - Returns available Spotify tools
 */
mcpRouter.post('/tools/list', async (c) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionToken = authorization.replace('Bearer ', '');
  const spotifyToken = await sessionManager.validateSession(sessionToken);

  if (!spotifyToken) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  return c.json({
    jsonrpc: '2.0',
    result: {
      tools: spotifyTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema
      }))
    },
    id: c.req.header('X-Request-Id') || '1'
  });
});

/**
 * MCP Call Tool - Execute a Spotify tool
 */
mcpRouter.post('/tools/call', async (c) => {
  const startTime = Date.now();
  let toolName = 'unknown';

  try {
    const authorization = c.req.header('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      console.warn('[MCP] Tool call failed: No bearer token');
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sessionToken = authorization.replace('Bearer ', '');
    const spotifyToken = await sessionManager.validateSession(sessionToken);

    if (!spotifyToken) {
      console.warn(`[MCP] Tool call failed: Invalid session ${sessionToken.substring(0, 8)}...`);
      return c.json({ error: 'Invalid or expired session' }, 401);
    }

    const body = await c.req.json();
    const request = MCPRequestSchema.parse(body);

    if (request.method !== 'tools/call') {
      console.warn(`[MCP] Invalid method: ${request.method}`);
      return c.json({
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Method not found'
        },
        id: request.id
      });
    }

    const { name, arguments: args } = request.params as any;
    toolName = name;

    console.log(`[MCP] Executing tool: ${toolName}`);
    console.log(`[MCP] Tool args:`, JSON.stringify(args).substring(0, 200));

    // Execute the Spotify tool
    try {
      const result = await executeSpotifyTool(name, args, spotifyToken);

      // Touch session to keep it alive
      await sessionManager.touchSession(sessionToken);

      const duration = Date.now() - startTime;
      console.log(`[MCP] Tool ${toolName} completed in ${duration}ms`);

      return c.json({
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
      });
    } catch (toolError) {
      const duration = Date.now() - startTime;
      console.error(`[MCP] Tool ${toolName} execution error after ${duration}ms:`, toolError);
      return c.json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: toolError instanceof Error ? toolError.message : 'Tool execution failed'
        },
        id: request.id
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP] Request error after ${duration}ms:`, error);
    return c.json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal error'
      },
      id: body?.id || null
    });
  }
});

/**
 * MCP List Resources - Returns available playlists as resources
 */
mcpRouter.post('/resources/list', async (c) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionToken = authorization.replace('Bearer ', '');
  const spotifyToken = await sessionManager.validateSession(sessionToken);

  if (!spotifyToken) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  try {
    // Get user's playlists
    const response = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: {
        'Authorization': `Bearer ${spotifyToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch playlists');
    }

    const data = await response.json();
    const playlists = data.items || [];

    return c.json({
      jsonrpc: '2.0',
      result: {
        resources: playlists.map((playlist: any) => ({
          uri: `spotify:playlist:${playlist.id}`,
          name: playlist.name,
          description: playlist.description || `${playlist.tracks.total} tracks`,
          mimeType: 'application/json'
        }))
      },
      id: c.req.header('X-Request-Id') || '1'
    });
  } catch (error) {
    console.error('Error fetching playlists:', error);
    return c.json({
      jsonrpc: '2.0',
      result: { resources: [] },
      id: c.req.header('X-Request-Id') || '1'
    });
  }
});

/**
 * MCP Read Resource - Get playlist details
 */
mcpRouter.post('/resources/read', async (c) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionToken = authorization.replace('Bearer ', '');
  const spotifyToken = await sessionManager.validateSession(sessionToken);

  if (!spotifyToken) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  try {
    const body = await c.req.json();
    const { uri } = body.params;

    // Extract playlist ID from URI (spotify:playlist:ID)
    const playlistId = uri.split(':').pop();

    // Get playlist details
    const response = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}`,
      {
        headers: {
          'Authorization': `Bearer ${spotifyToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch playlist');
    }

    const playlist = await response.json();

    return c.json({
      jsonrpc: '2.0',
      result: {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(playlist, null, 2)
          }
        ]
      },
      id: body.id
    });
  } catch (error) {
    console.error('Error reading resource:', error);
    return c.json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Failed to read resource'
      },
      id: body?.id || null
    });
  }
});

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