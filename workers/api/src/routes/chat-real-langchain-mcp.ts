import { ChatAnthropic } from "@langchain/anthropic";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "../index";

import { convertMCPToolsToLangChain } from "../lib/mcp-to-langchain";
import { SessionManager } from "../lib/session-manager";
import { withFetchLogging } from "../lib/withFetchLogging";
import { withLoopbackFetch } from "../lib/withLoopbackFetch";

const realLangChainMcpRouter = new Hono<{ Bindings: Env }>();

// Request schema
const RealLangChainMCPRequestSchema = z.object({
  conversationHistory: z
    .array(
      z.object({
        content: z.string(),
        role: z.enum(["user", "assistant"]),
      })
    )
    .max(20)
    .default([]),
  message: z.string().min(1).max(2000),
  mode: z.enum(["analyze", "create", "edit"]).default("analyze"),
});

// Session manager instance
let sessionManager: SessionManager;

// Initialize session manager
realLangChainMcpRouter.use("*", async (c, next) => {
  if (!sessionManager) {
    sessionManager = new SessionManager(c.env.SESSIONS);
  }
  await next();
});

/**
 * Real LangChain MCP integration using official MultiServerMCPClient
 */
realLangChainMcpRouter.post("/message", async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  const startTime = Date.now();

  console.log(`[RealLangChainMCP:${requestId}] === NEW CHAT REQUEST ===`);
  console.log(`[RealLangChainMCP:${requestId}] URL: ${c.req.url}`);

  try {
    // Parse request
    const body = await c.req.json();
    const request = RealLangChainMCPRequestSchema.parse(body);
    console.log(
      `[RealLangChainMCP:${requestId}] Mode: ${
        request.mode
      }, Message: "${request.message.substring(0, 50)}${
        request.message.length > 50 ? "..." : ""
      }"`
    );

    // Get authorization header
    const authorization = c.req.header("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      console.warn(
        `[RealLangChainMCP:${requestId}] No authorization header provided`
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    const spotifyToken = authorization.replace("Bearer ", "");
    console.log(
      `[RealLangChainMCP:${requestId}] Spotify token: ${spotifyToken.substring(
        0,
        8
      )}...`
    );

    // Check if it's an existing session token or a Spotify token
    const existingSession = await sessionManager.validateSession(spotifyToken);
    let sessionToken: string;

    if (existingSession) {
      console.log(
        `[RealLangChainMCP:${requestId}] Using existing session: ${existingSession.id}`
      );
      sessionToken = existingSession.id;
      await sessionManager.touchSession(existingSession.id);
    } else {
      // Create new session with the Spotify token
      // Note: createSession returns the session token string directly, not an object!
      sessionToken = await sessionManager.createSession(
        spotifyToken,
        "unknown"
      );
      console.log(
        `[RealLangChainMCP:${requestId}] Created new session token: ${sessionToken}`
      );
    }

    // Initialize MCP client URL
    const origin = new URL(c.req.url).origin;
    const mcpServerUrl = `${origin}/api/mcp`;
    console.log(
      `[RealLangChainMCP:${requestId}] MCP server URL: ${mcpServerUrl}`
    );

    // Get MCP tools using loopback fetch to intercept self-requests
    console.log(
      `[RealLangChainMCP:${requestId}] === INITIALIZING MCP CLIENT WITH LOOPBACK ===`
    );

    let tools: any[];
    const transportUsed = "http";

    try {
      // Use loopback fetch to intercept self-requests and route them internally
      tools = await withLoopbackFetch(
        c,
        () =>
          withFetchLogging(async () => {
            console.log(
              `[RealLangChainMCP:${requestId}] Creating MultiServerMCPClient...`
            );

            const client = new MultiServerMCPClient({
              spotify: {
                headers: {
                  Accept: "application/json",
                  Authorization: `Bearer ${sessionToken}`,
                  "MCP-Protocol-Version": "2025-06-18",
                  "User-Agent": "langchain-mcp-worker/1.0",
                },
                transport: "http", // Keep it simple; SSE not needed for tools
                url: mcpServerUrl,
              },
            });

            console.log(
              `[RealLangChainMCP:${requestId}] Calling getTools()...`
            );
            const toolsStartTime = Date.now();
            const mcpTools = await client.getTools();
            const toolsDuration = Date.now() - toolsStartTime;

            console.log(
              `[RealLangChainMCP:${requestId}] getTools() completed in ${toolsDuration}ms`
            );
            console.log(
              `[RealLangChainMCP:${requestId}] Discovered ${mcpTools.length} MCP tools`
            );

            if (mcpTools.length > 0) {
              console.log(
                `[RealLangChainMCP:${requestId}] MCP tool names: [${mcpTools
                  .map((t: any) => t.name || "unnamed")
                  .join(", ")}]`
              );
            }

            // Convert MCP tools to LangChain format
            console.log(
              `[RealLangChainMCP:${requestId}] Converting MCP tools to LangChain format...`
            );
            const langchainTools = convertMCPToolsToLangChain(
              mcpTools,
              sessionToken
            );
            console.log(
              `[RealLangChainMCP:${requestId}] Converted ${langchainTools.length} tools to LangChain format`
            );

            // Clean up
            try {
              await client.close();
            } catch {}

            return langchainTools;
          }),
        { pathPrefix: "/api/mcp" }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[RealLangChainMCP:${requestId}] Failed to get MCP tools: ${errorMessage}`
      );
      console.error(
        `[RealLangChainMCP:${requestId}] Error after ${
          Date.now() - startTime
        }ms`
      );

      return c.json(
        {
          duration: Date.now() - startTime,
          error: `Failed to initialize MCP tools: ${errorMessage}`,
          errorType: error instanceof Error ? error.name : "Error",
          requestId,
        },
        500
      );
    }

    if (!tools?.length) {
      console.error(`[RealLangChainMCP:${requestId}] No MCP tools available`);
      return c.json({ error: "No MCP tools available" }, 500);
    }

    console.log(
      `[RealLangChainMCP:${requestId}] Successfully initialized ${tools.length} MCP tools`
    );

    // Initialize ChatAnthropic model
    const llm = new ChatAnthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
      maxTokens: 2000,
      model: "claude-sonnet-4-5-20250929",
      temperature: 0.2,
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

Always explain your reasoning for changes.`,
    };

    // Build conversation history for LangChain
    const chatHistory = request.conversationHistory.map((m) =>
      m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)
    );

    console.log(
      `[RealLangChainMCP:${requestId}] Using Claude's native tool calling with ${tools.length} tools`
    );

    // Bind tools directly to the model (Claude supports native tool calling)
    const modelWithTools = llm.bindTools(tools);

    // Build messages array
    const messages = [
      new SystemMessage(systemPrompts[request.mode]),
      ...chatHistory,
      new HumanMessage(request.message),
    ];

    console.log(
      `[RealLangChainMCP:${requestId}] Invoking Claude with tools...`
    );
    const agentStartTime = Date.now();

    // Invoke the model with tools - Claude will handle tool calling automatically
    const result = await modelWithTools.invoke(messages);

    console.log(
      `[RealLangChainMCP:${requestId}] Claude response type:`,
      typeof result
    );
    console.log(
      `[RealLangChainMCP:${requestId}] Claude response keys:`,
      result ? Object.keys(result) : "null"
    );
    console.log(
      `[RealLangChainMCP:${requestId}] Tool calls present:`,
      !!result?.tool_calls
    );
    console.log(
      `[RealLangChainMCP:${requestId}] Tool calls count:`,
      result?.tool_calls?.length || 0
    );

    // If Claude called tools, execute them
    let finalResponse = result;
    if (result?.tool_calls && result.tool_calls.length > 0) {
      console.log(
        `[RealLangChainMCP:${requestId}] Claude called ${result.tool_calls.length} tool(s):`,
        result.tool_calls.map((tc: any) => tc.name)
      );

      // Execute each tool call
      const toolResults = [];
      for (const toolCall of result.tool_calls) {
        console.log(
          `[RealLangChainMCP:${requestId}] Executing tool: ${toolCall.name} with args:`,
          toolCall.args
        );
        const tool = tools.find((t: any) => t.name === toolCall.name);
        if (tool) {
          try {
            const toolResult = await tool.func(toolCall.args);
            console.log(
              `[RealLangChainMCP:${requestId}] Tool ${toolCall.name} result:`,
              JSON.stringify(toolResult).substring(0, 200)
            );
            toolResults.push({
              result: toolResult,
              tool_call_id: toolCall.id,
            });
            console.log(
              `[RealLangChainMCP:${requestId}] Tool ${toolCall.name} completed successfully`
            );
          } catch (error) {
            console.error(
              `[RealLangChainMCP:${requestId}] Tool ${toolCall.name} failed:`,
              error
            );
            toolResults.push({
              error: error instanceof Error ? error.message : String(error),
              tool_call_id: toolCall.id,
            });
          }
        } else {
          console.error(
            `[RealLangChainMCP:${requestId}] Tool ${toolCall.name} not found in available tools`
          );
          toolResults.push({
            error: `Tool ${toolCall.name} not found`,
            tool_call_id: toolCall.id,
          });
        }
      }

      // Send tool results back to Claude for final response
      const messagesWithTools = [
        ...messages,
        result, // The message with tool_calls
        new SystemMessage(`Tool results: ${JSON.stringify(toolResults)}`),
      ];

      console.log(
        `[RealLangChainMCP:${requestId}] Getting final response from Claude...`
      );
      finalResponse = await llm.invoke(messagesWithTools);
    }

    const agentDuration = Date.now() - agentStartTime;
    console.log(
      `[RealLangChainMCP:${requestId}] Agent completed in ${agentDuration}ms`
    );

    // Extract final response
    let finalMessage = "";
    if (typeof finalResponse?.content === "string") {
      finalMessage = finalResponse.content;
    } else if (typeof finalResponse === "string") {
      finalMessage = finalResponse;
    } else {
      console.warn(
        `[RealLangChainMCP:${requestId}] Unexpected response format:`,
        finalResponse
      );
      finalMessage = JSON.stringify(finalResponse);
    }

    console.log(
      `[RealLangChainMCP:${requestId}] Final response length: ${finalMessage.length} chars`
    );

    // Build conversation history
    const finalHistory = [
      ...request.conversationHistory,
      { content: request.message, role: "user" as const },
      { content: finalMessage, role: "assistant" as const },
    ];

    const duration = Date.now() - startTime;
    console.log(
      `[RealLangChainMCP:${requestId}] === REQUEST COMPLETE (${duration}ms) ===`
    );

    return c.json({
      conversationHistory: finalHistory,
      duration,
      message: finalMessage,
      requestId,
      transport: transportUsed,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[RealLangChainMCP:${requestId}] Error after ${duration}ms:`,
      error
    );

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error(`[RealLangChainMCP:${requestId}] Error details:`, {
      message: errorMessage,
      stack: errorStack?.substring(0, 1000),
      type: error instanceof Error ? error.name : typeof error,
    });

    return c.json(
      {
        duration,
        error: errorMessage,
        errorType: error instanceof Error ? error.name : "UnknownError",
        requestId,
      },
      500
    );
  }
});

/**
 * Test endpoint for MCP integration
 */
realLangChainMcpRouter.get("/test", async (c) => {
  const testId = crypto.randomUUID().substring(0, 8);
  console.log(`[RealLangChainMCP:${testId}] === TEST ENDPOINT HIT ===`);

  try {
    // Create test session (returns string token directly)
    const sessionToken = await sessionManager.createSession(
      "test-spotify-token",
      "test-user"
    );
    console.log(
      `[RealLangChainMCP:${testId}] Created test session: ${sessionToken}`
    );

    const origin = new URL(c.req.url).origin;
    const mcpServerUrl = `${origin}/api/mcp`;

    console.log(
      `[RealLangChainMCP:${testId}] Testing MCP with loopback fetch...`
    );

    // Test with loopback fetch
    const tools = await withLoopbackFetch(
      c,
      async () => {
        const client = new MultiServerMCPClient({
          spotify: {
            headers: {
              Authorization: `Bearer ${sessionToken}`,
              "MCP-Protocol-Version": "2025-06-18",
            },
            transport: "http",
            url: mcpServerUrl,
          },
        });

        const tools = await client.getTools();
        await client.close();
        return tools;
      },
      { pathPrefix: "/api/mcp" }
    );

    const toolNames = tools.map((t: any) => t.name);
    console.log(
      `[RealLangChainMCP:${testId}] Discovered ${tools.length} tools`
    );

    return c.json({
      serverUrl: mcpServerUrl,
      sessionId: sessionToken,
      success: true,
      testId,
      toolCount: tools.length,
      tools: toolNames,
    });
  } catch (error) {
    console.error(`[RealLangChainMCP:${testId}] Test failed:`, error);
    return c.json(
      {
        error: error instanceof Error ? error.message : String(error),
        success: false,
        testId,
      },
      500
    );
  }
});

export { realLangChainMcpRouter };
