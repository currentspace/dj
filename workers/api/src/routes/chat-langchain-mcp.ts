// Chat Route with LangChain-style MCP Integration
import { Hono } from 'hono';
import { Anthropic } from '@anthropic-ai/sdk';
import type { Env } from '../index';
import { SessionManager } from '../lib/session-manager';
import { executeSpotifyTool, spotifyTools } from '../lib/spotify-tools';
import { z } from 'zod';

const langchainMcpChatRouter = new Hono<{ Bindings: Env }>();

// Request schema
const LangChainMCPChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).optional().default([]),
  mode: z.enum(['create', 'edit', 'analyze']).optional().default('analyze')
});

// Session manager instance
let sessionManager: SessionManager;

langchainMcpChatRouter.use('*', async (c, next) => {
  if (!sessionManager) {
    sessionManager = new SessionManager(c.env.SESSIONS);
  }
  await next();
});

/**
 * MCP Client that mimics LangChain's MultiServerMCPClient behavior
 */
class MCPClient {
  private serverUrl: string;
  private headers: Record<string, string>;
  private sessionToken: string;

  constructor(config: { url: string; headers: Record<string, string> }) {
    this.serverUrl = config.url;
    this.headers = config.headers;
    this.sessionToken = config.headers.Authorization?.replace('Bearer ', '') || '';
  }

  /**
   * Introspect MCP server and get available tools
   */
  async introspectTools(): Promise<any[]> {
    const requestId = crypto.randomUUID().substring(0, 8);
    console.log(`[MCPClient:${requestId}] Introspecting MCP server: ${this.serverUrl}`);

    try {
      // Initialize connection
      const initResponse = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-03-26',
          ...this.headers
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {},
          id: 1
        })
      });

      if (!initResponse.ok) {
        throw new Error(`MCP initialization failed: ${initResponse.status}`);
      }

      const initResult = await initResponse.json();
      console.log(`[MCPClient:${requestId}] MCP server initialized:`, initResult.result.serverInfo);

      // Get available tools
      const toolsResponse = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-03-26',
          ...this.headers
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          params: {},
          id: 2
        })
      });

      if (!toolsResponse.ok) {
        throw new Error(`MCP tools/list failed: ${toolsResponse.status}`);
      }

      const toolsResult = await toolsResponse.json();
      const tools = toolsResult.result.tools || [];

      console.log(`[MCPClient:${requestId}] Discovered ${tools.length} tools: [${tools.map((t: any) => t.name).join(', ')}]`);

      return tools;
    } catch (error) {
      console.error(`[MCPClient:${requestId}] MCP introspection failed:`, error);
      return [];
    }
  }

  /**
   * Execute an MCP tool call
   */
  async callTool(name: string, arguments: any): Promise<any> {
    const requestId = crypto.randomUUID().substring(0, 8);
    console.log(`[MCPClient:${requestId}] Calling MCP tool: ${name}`);

    try {
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-03-26',
          ...this.headers
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name,
            arguments
          },
          id: requestId
        })
      });

      if (!response.ok) {
        throw new Error(`MCP tool call failed: ${response.status}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(`MCP tool error: ${result.error.message}`);
      }

      // Extract content from MCP response
      const content = result.result?.content?.[0]?.text;
      if (content) {
        return JSON.parse(content);
      } else {
        throw new Error('No content in MCP tool response');
      }
    } catch (error) {
      console.error(`[MCPClient:${requestId}] MCP tool call failed:`, error);
      throw error;
    }
  }
}

/**
 * Enhanced chat endpoint with LangChain-style MCP integration
 */
langchainMcpChatRouter.post('/message', async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[LangChainMCP:${requestId}] === NEW CHAT REQUEST ===`);
  const startTime = Date.now();

  try {
    const body = await c.req.json();
    const request = LangChainMCPChatRequestSchema.parse(body);
    console.log(`[LangChainMCP:${requestId}] Mode: ${request.mode}, Message: "${request.message.substring(0, 50)}..."`);

    // Get tokens
    const spotifyToken = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!spotifyToken) {
      console.warn(`[LangChainMCP:${requestId}] No Spotify token provided`);
      return c.json({ error: 'Spotify token required' }, 401);
    }

    // Create/validate session for MCP
    const sessionToken = await sessionManager.createSession(spotifyToken);
    console.log(`[LangChainMCP:${requestId}] Created session: ${sessionToken.substring(0, 8)}...`);

    // Initialize MCP client (LangChain-style)
    const mcpClient = new MCPClient({
      url: `${new URL(c.req.url).origin}/api/mcp`,
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    console.log(`[LangChainMCP:${requestId}] Introspecting MCP server...`);
    const availableTools = await mcpClient.introspectTools();

    if (availableTools.length === 0) {
      console.warn(`[LangChainMCP:${requestId}] No tools available from MCP server`);
      return c.json({ error: 'No tools available from MCP server' }, 500);
    }

    // Initialize Anthropic with discovered tools
    const anthropic = new Anthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
    });

    // Build system prompt based on mode
    const systemPrompts = {
      analyze: `You are an expert music analyst with access to Spotify tools via MCP. You MUST use tools to answer any music-related questions.

CRITICAL INSTRUCTIONS:
1. NEVER answer music questions without using tools first
2. ALWAYS search for tracks before discussing them
3. ALWAYS get audio features before analyzing energy/mood
4. Use multiple tools in sequence for complete analysis

AVAILABLE TOOLS:
${availableTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

WORKFLOW: search_spotify_tracks → get_audio_features → analyze → respond`,

      create: `You are an expert DJ with access to Spotify tools via MCP. Create perfect playlists using real-time data.

WORKFLOW FOR PLAYLIST CREATION:
1. Search for tracks using search_spotify_tracks
2. Analyze audio features with get_audio_features
3. Get recommendations with get_recommendations
4. Create the final playlist with create_playlist

Always validate tracks exist before adding them to playlists.`,

      edit: `You are a playlist curator with access to Spotify tools via MCP. Modify existing playlists intelligently.

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

    console.log(`[LangChainMCP:${requestId}] Calling Claude with ${availableTools.length} MCP tools`);

    // Call Claude with MCP-discovered tools
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompts[request.mode],
      messages,
      tools: availableTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema
      }))
    });

    console.log(`[LangChainMCP:${requestId}] Claude response received`);

    // Handle tool calls through MCP client
    let assistantResponse = '';
    const toolCallsDetected: string[] = [];
    const toolResults: any[] = [];
    let needsFollowUp = false;

    // Process initial response
    for (const contentBlock of response.content) {
      if (contentBlock.type === 'text') {
        assistantResponse += contentBlock.text;
      } else if (contentBlock.type === 'tool_use') {
        console.log(`[LangChainMCP:${requestId}] Tool call detected: ${contentBlock.name}`);
        toolCallsDetected.push(contentBlock.name);
        needsFollowUp = true;

        try {
          // Execute tool through MCP client
          const toolResult = await mcpClient.callTool(
            contentBlock.name,
            contentBlock.input
          );

          toolResults.push({
            type: 'tool_result',
            tool_use_id: contentBlock.id,
            content: JSON.stringify(toolResult, null, 2)
          });

          console.log(`[LangChainMCP:${requestId}] Tool ${contentBlock.name} executed successfully via MCP`);
        } catch (toolError) {
          console.error(`[LangChainMCP:${requestId}] Tool ${contentBlock.name} failed:`, toolError);
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
      console.log(`[LangChainMCP:${requestId}] Making follow-up request with ${toolResults.length} tool results`);

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
        tools: availableTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema
        }))
      });

      // Extract final response
      assistantResponse = '';
      for (const contentBlock of followUpResponse.content) {
        if (contentBlock.type === 'text') {
          assistantResponse += contentBlock.text;
        }
      }

      console.log(`[LangChainMCP:${requestId}] Follow-up response received (${assistantResponse.length} chars)`);
    }

    // Build response
    const finalHistory = [
      ...request.conversationHistory,
      { role: 'user', content: request.message },
      { role: 'assistant', content: assistantResponse }
    ];

    const duration = Date.now() - startTime;
    console.log(`[LangChainMCP:${requestId}] === CHAT COMPLETE === (${duration}ms, LangChain MCP integration)`);

    return c.json({
      message: assistantResponse,
      conversationHistory: finalHistory,
      mcpIntegration: {
        serverUrl: mcpClient['serverUrl'],
        toolsDiscovered: availableTools.length,
        toolsUsed: toolCallsDetected,
        sessionToken: sessionToken.substring(0, 8) + '...'
      },
      executionTime: duration,
      requestId
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[LangChainMCP:${requestId}] Error after ${duration}ms:`, error);
    return c.json({
      error: error instanceof Error ? error.message : 'Chat request failed',
      requestId
    }, 500);
  }
});

export { langchainMcpChatRouter };