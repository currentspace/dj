import { Hono } from 'hono';
import type { Env } from '../index';
import { z } from 'zod';
import { ChatAnthropic } from '@langchain/anthropic';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { executeSpotifyTool } from '../lib/spotify-tools';
import type { StreamToolData, StreamToolResult, StreamDebugData, StreamLogData } from '@dj/shared-types';

const chatStreamRouter = new Hono<{ Bindings: Env }>();

// Request schema
const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).max(20).default([]),
  mode: z.enum(['analyze', 'create', 'edit']).default('analyze')
});

// SSE message types
type StreamEvent =
  | { type: 'thinking'; data: string }
  | { type: 'tool_start'; data: StreamToolData }
  | { type: 'tool_end'; data: StreamToolResult }
  | { type: 'content'; data: string }
  | { type: 'error'; data: string }
  | { type: 'done'; data: null }
  | { type: 'log'; data: StreamLogData }
  | { type: 'debug'; data: StreamDebugData };

// Writer queue to prevent concurrent writes
class SSEWriter {
  private writer: WritableStreamDefaultWriter;
  private encoder: TextEncoder;
  private writeQueue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(writer: WritableStreamDefaultWriter) {
    this.writer = writer;
    this.encoder = new TextEncoder();
  }

  async write(event: StreamEvent): Promise<void> {
    if (this.closed) return;

    this.writeQueue = this.writeQueue.then(async () => {
      if (this.closed) return;
      try {
        const message = `data: ${JSON.stringify(event)}\n\n`;
        await this.writer.write(this.encoder.encode(message));
      } catch (error) {
        console.error('SSE write error:', error);
        this.closed = true;
      }
    });

    return this.writeQueue;
  }

  async writeHeartbeat(): Promise<void> {
    if (this.closed) return;

    this.writeQueue = this.writeQueue.then(async () => {
      if (this.closed) return;
      try {
        await this.writer.write(this.encoder.encode(': heartbeat\n\n'));
      } catch (error) {
        console.error('Heartbeat write error:', error);
        this.closed = true;
      }
    });

    return this.writeQueue;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.writeQueue;
    await this.writer.close();
  }
}

/**
 * Create Spotify tools with streaming callbacks
 */

// Enhanced tool executor with progress streaming
async function executeSpotifyToolWithProgress(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
  sseWriter: SSEWriter
): Promise<unknown> {
  console.log(`[Tool] Executing ${toolName} with args:`, JSON.stringify(args).substring(0, 200));

  if (toolName === 'analyze_playlist') {
    const { playlist_id } = args;

    try {
      await sseWriter.write({ type: 'thinking', data: '📊 Starting playlist analysis...' });

      // Step 1: Get playlist details
      await sseWriter.write({ type: 'thinking', data: '🔍 Fetching playlist information...' });
      const playlistResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlist_id}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!playlistResponse.ok) {
        throw new Error(`Failed to get playlist: ${playlistResponse.status}`);
      }

      const playlist = await playlistResponse.json() as any;
      await sseWriter.write({ type: 'thinking', data: `🎼 Found "${playlist.name}" with ${playlist.tracks?.total || 0} tracks` });

      // Step 2: Get tracks
      await sseWriter.write({ type: 'thinking', data: '🎵 Fetching track details...' });
      const tracksResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlist_id}/tracks?limit=100`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!tracksResponse.ok) {
        throw new Error(`Failed to get tracks: ${tracksResponse.status}`);
      }

      const tracksData = await tracksResponse.json() as any;
      const tracks = tracksData.items.map((item: any) => item.track).filter(Boolean);
      const trackIds = tracks.map((t: any) => t.id).filter(Boolean);

      await sseWriter.write({ type: 'thinking', data: `✅ Loaded ${tracks.length} tracks successfully` });

      // Step 3: Get audio features
      let audioFeatures = [];
      if (trackIds.length > 0) {
        await sseWriter.write({ type: 'thinking', data: `🎚️ Analyzing audio characteristics of ${trackIds.length} tracks...` });

        const featuresResponse = await fetch(
          `https://api.spotify.com/v1/audio-features?ids=${trackIds.slice(0, 100).join(',')}`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (featuresResponse.ok) {
          const featuresData = await featuresResponse.json() as any;
          audioFeatures = featuresData.audio_features || [];
          const validFeatures = audioFeatures.filter((f: any) => f !== null);
          await sseWriter.write({ type: 'thinking', data: `🎯 Audio analysis complete! Got data for ${validFeatures.length} tracks` });
        } else {
          const errorText = await featuresResponse.text();
          console.error(`[analyze_playlist] Audio features failed: ${featuresResponse.status} - ${errorText}`);
          await sseWriter.write({ type: 'thinking', data: `⚠️ Audio features unavailable (${featuresResponse.status}) - continuing with basic analysis` });
        }
      }

      // Step 4: Calculate analysis
      await sseWriter.write({ type: 'thinking', data: '🧮 Computing musical insights...' });
      const validFeatures = audioFeatures.filter((f: any) => f !== null);

      const analysis = {
        playlist_name: playlist.name,
        playlist_description: playlist.description,
        total_tracks: tracks.length,
        audio_analysis: validFeatures.length > 0 ? {
          avg_energy: validFeatures.reduce((sum: number, f: any) => sum + f.energy, 0) / validFeatures.length,
          avg_danceability: validFeatures.reduce((sum: number, f: any) => sum + f.danceability, 0) / validFeatures.length,
          avg_valence: validFeatures.reduce((sum: number, f: any) => sum + f.valence, 0) / validFeatures.length,
          avg_tempo: validFeatures.reduce((sum: number, f: any) => sum + f.tempo, 0) / validFeatures.length,
          avg_acousticness: validFeatures.reduce((sum: number, f: any) => sum + f.acousticness, 0) / validFeatures.length,
          avg_instrumentalness: validFeatures.reduce((sum: number, f: any) => sum + f.instrumentalness, 0) / validFeatures.length,
        } : null,
        tracks: tracks.slice(0, 20),
        audio_features: audioFeatures.slice(0, 20)
      };

      await sseWriter.write({ type: 'thinking', data: `🎉 Analysis complete for "${analysis.playlist_name}"!` });
      console.log(`[Tool] analyze_playlist completed successfully`);
      return analysis;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await sseWriter.write({ type: 'thinking', data: `❌ Analysis failed: ${errorMsg}` });
      console.error(`[Tool] analyze_playlist failed:`, error);
      throw error;
    }
  }

  // Fall back to original tool executor for other tools
  return await executeSpotifyTool(toolName, args, token);
}

function createStreamingSpotifyTools(
  spotifyToken: string,
  sseWriter: SSEWriter,
  contextPlaylistId?: string,
  mode?: string,
  abortSignal?: AbortSignal
): DynamicStructuredTool[] {

  const tools: DynamicStructuredTool[] = [
    new DynamicStructuredTool({
      name: 'search_spotify_tracks',
      description: 'Search for tracks on Spotify',
      schema: z.object({
        query: z.string(),
        limit: z.number().min(1).max(50).default(10)
      }),
      func: async (args) => {
        if (abortSignal?.aborted) throw new Error('Request aborted');

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'search_spotify_tracks', args }
        });

        const result = await executeSpotifyTool('search_spotify_tracks', args, spotifyToken);

        await sseWriter.write({
          type: 'tool_end',
          data: {
            tool: 'search_spotify_tracks',
            result: Array.isArray(result) ? `Found ${result.length} tracks` : 'Search complete'
          }
        });

        return result;
      }
    }),

    new DynamicStructuredTool({
      name: 'analyze_playlist',
      description: 'Analyze a playlist',
      schema: z.object({
        playlist_id: z.string().optional()
      }),
      func: async (args) => {
        if (abortSignal?.aborted) throw new Error('Request aborted');

        // Auto-inject playlist ID if missing or empty
        let finalArgs = { ...args };
        if (!args.playlist_id && contextPlaylistId) {
          console.log(`[analyze_playlist] Auto-injecting playlist_id: ${contextPlaylistId}`);
          finalArgs.playlist_id = contextPlaylistId;
        }

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'analyze_playlist', args: finalArgs }
        });

        // Use enhanced executeSpotifyTool with progress streaming
        const result = await executeSpotifyToolWithProgress('analyze_playlist', finalArgs, spotifyToken, sseWriter);

        await sseWriter.write({
          type: 'tool_end',
          data: {
            tool: 'analyze_playlist',
            result: (result as any)?.playlist_name ? `Analyzed "${(result as any).playlist_name}"` : 'Analysis complete'
          }
        });

        return result;
      }
    }),

    new DynamicStructuredTool({
      name: 'get_audio_features',
      description: 'Get audio features for tracks',
      schema: z.object({
        track_ids: z.array(z.string()).max(100).optional()
      }),
      func: async (args) => {
        let finalArgs = { ...args };

        // Smart context inference: if no track_ids but we have playlist context
        if ((!args.track_ids || args.track_ids.length === 0) && contextPlaylistId && mode === 'analyze') {
          console.log(`[get_audio_features] Auto-fetching tracks from playlist: ${contextPlaylistId}`);

          try {
            // Fetch playlist tracks
            const playlistResponse = await fetch(
              `https://api.spotify.com/v1/playlists/${contextPlaylistId}/tracks?limit=100`,
              { headers: { 'Authorization': `Bearer ${spotifyToken}` } }
            );

            if (playlistResponse.ok) {
              const playlistData = await playlistResponse.json() as any;
              const trackIds = playlistData.items
                ?.map((item: any) => item.track?.id)
                .filter((id: string) => id) || [];

              if (trackIds.length > 0) {
                finalArgs.track_ids = trackIds.slice(0, 100); // Limit to 100 tracks
                console.log(`[get_audio_features] Auto-injected ${finalArgs.track_ids.length} track IDs from playlist`);
              }
            }
          } catch (error) {
            console.error(`[get_audio_features] Failed to auto-fetch playlist tracks:`, error);
          }
        }

        if (abortSignal?.aborted) throw new Error('Request aborted');

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'get_audio_features', args: finalArgs }
        });

        const result = await executeSpotifyTool('get_audio_features', finalArgs, spotifyToken);

        await sseWriter.write({
          type: 'tool_end',
          data: {
            tool: 'get_audio_features',
            result: finalArgs.track_ids ? `Analyzed ${finalArgs.track_ids.length} tracks` : 'Analysis complete'
          }
        });

        return result;
      }
    }),

    new DynamicStructuredTool({
      name: 'get_recommendations',
      description: 'Get track recommendations',
      schema: z.object({
        seed_tracks: z.array(z.string()).max(5).optional(),
        seed_artists: z.array(z.string()).max(5).optional(),
        limit: z.number().min(1).max(100).default(20)
      }),
      func: async (args) => {
        let finalArgs = { ...args };

        // Smart context inference: if no seeds but we have playlist context
        if ((!args.seed_tracks || args.seed_tracks.length === 0) &&
            (!args.seed_artists || args.seed_artists.length === 0) &&
            contextPlaylistId && (mode === 'analyze' || mode === 'create')) {
          console.log(`[get_recommendations] Auto-fetching seed tracks from playlist: ${contextPlaylistId}`);

          try {
            // Fetch playlist tracks to use as seeds
            const playlistResponse = await fetch(
              `https://api.spotify.com/v1/playlists/${contextPlaylistId}/tracks?limit=50`,
              { headers: { 'Authorization': `Bearer ${spotifyToken}` } }
            );

            if (playlistResponse.ok) {
              const playlistData = await playlistResponse.json() as any;
              const trackIds = playlistData.items
                ?.map((item: any) => item.track?.id)
                .filter((id: string) => id)
                .slice(0, 5) || []; // Use up to 5 tracks as seeds

              if (trackIds.length > 0) {
                finalArgs.seed_tracks = trackIds;
                console.log(`[get_recommendations] Auto-injected ${finalArgs.seed_tracks.length} seed tracks from playlist`);
              }
            }
          } catch (error) {
            console.error(`[get_recommendations] Failed to auto-fetch seed tracks:`, error);
          }
        }

        if (abortSignal?.aborted) throw new Error('Request aborted');

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'get_recommendations', args: finalArgs }
        });

        const result = await executeSpotifyTool('get_recommendations', finalArgs, spotifyToken);

        await sseWriter.write({
          type: 'tool_end',
          data: {
            tool: 'get_recommendations',
            result: Array.isArray(result) ? `Found ${result.length} recommendations` : 'Complete'
          }
        });

        return result;
      }
    }),

    new DynamicStructuredTool({
      name: 'create_playlist',
      description: 'Create a new Spotify playlist',
      schema: z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(300).optional(),
        track_uris: z.array(z.string())
      }),
      func: async (args) => {
        if (abortSignal?.aborted) throw new Error('Request aborted');

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'create_playlist', args: { name: args.name, tracks: args.track_uris.length } }
        });

        const result = await executeSpotifyTool('create_playlist', args, spotifyToken);

        await sseWriter.write({
          type: 'tool_end',
          data: {
            tool: 'create_playlist',
            result: (result as any)?.id ? `Created playlist: ${args.name}` : 'Playlist created'
          }
        });

        return result;
      }
    })
  ];

  return tools;
}

/**
 * Streaming chat endpoint using Server-Sent Events
 * Uses query token for auth since EventSource can't send headers
 */
chatStreamRouter.post('/message', async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[Stream:${requestId}] ========== NEW STREAMING REQUEST ==========`);
  console.log(`[Stream:${requestId}] Method: ${c.req.method}`);
  console.log(`[Stream:${requestId}] URL: ${c.req.url}`);
  console.log(`[Stream:${requestId}] Headers:`, Object.fromEntries(c.req.raw.headers.entries()));

  // Create abort controller for client disconnect handling
  const abortController = new AbortController();
  const onAbort = () => {
    console.log(`[Stream:${requestId}] Client disconnected, aborting...`);
    abortController.abort();
  };

  // Listen for client disconnect
  c.req.raw.signal.addEventListener('abort', onAbort);

  // Create a TransformStream for proper SSE handling in Cloudflare Workers
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const sseWriter = new SSEWriter(writer);

  // Set proper SSE headers for Cloudflare
  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Content-Encoding': 'identity',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });

  // Get request body, authorization, and environment before starting async processing
  let requestBody;
  try {
    requestBody = await c.req.json();
    console.log(`[Stream:${requestId}] Request body parsed:`, JSON.stringify(requestBody).slice(0, 200));
  } catch (error) {
    console.error(`[Stream:${requestId}] Failed to parse request body:`, error);
    return c.text('Invalid JSON', 400);
  }

  // Get auth token from header (we'll migrate to query param later)
  const authorization = c.req.header('Authorization');
  const env = c.env;

  console.log(`[Stream:${requestId}] Auth header present: ${!!authorization}`);
  console.log(`[Stream:${requestId}] Env keys:`, Object.keys(env));

  // Process the request and stream responses
  const processStream = async () => {
    console.log(`[Stream:${requestId}] Starting async stream processing`);
    console.log(`[Stream:${requestId}] SSEWriter created, starting heartbeat`);

    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(async () => {
      if (abortController.signal.aborted) {
        clearInterval(heartbeatInterval);
        return;
      }
      console.log(`[Stream:${requestId}] Sending heartbeat`);
      await sseWriter.writeHeartbeat();
    }, 15000);

    try {
      // Check abort signal early
      if (abortController.signal.aborted) {
        throw new Error('Request aborted');
      }

      console.log(`[Stream:${requestId}] Sending initial debug event`);
      // Send debug info as first event
      await sseWriter.write({
        type: 'debug',
        data: {
          buildInfo: {
            commitHash: 'current',
            buildTime: new Date().toISOString(),
            branch: 'main',
            version: '1.0.0'
          },
          requestId,
          serverTime: new Date().toISOString()
        }
      });

      // Parse request
      const body = requestBody;
      await sseWriter.write({
        type: 'log',
        data: {
          level: 'info',
          message: `[${requestId}] Request received - Body size: ${JSON.stringify(body).length} bytes`
        }
      });

      const request = ChatRequestSchema.parse(body);

      await sseWriter.write({
        type: 'debug',
        data: {
          requestId,
          mode: request.mode,
          messageLength: request.message.length,
          historyLength: request.conversationHistory.length,
          rawMessage: request.message.substring(0, 100)
        }
      });

      // Extract playlist ID if present
      let playlistId: string | null = null;
      let actualMessage = request.message;
      const playlistIdMatch = request.message.match(/^\[Playlist ID: ([^\]]+)\] (.+)$/);

      if (playlistIdMatch) {
        playlistId = playlistIdMatch[1];
        actualMessage = playlistIdMatch[2];
        await sseWriter.write({
          type: 'log',
          data: {
            level: 'info',
            message: `[${requestId}] ✅ Playlist ID extracted: ${playlistId}`
          }
        });
      } else {
        await sseWriter.write({
          type: 'log',
          data: {
            level: 'warn',
            message: `[${requestId}] ⚠️ No playlist ID found in message: "${request.message.substring(0, 50)}..."`
          }
        });
      }

      // Get Spotify token
      if (!authorization?.startsWith('Bearer ')) {
        await sseWriter.write({ type: 'error', data: 'Unauthorized - Missing or invalid Authorization header' });
        return;
      }
      const spotifyToken = authorization.replace('Bearer ', '');

      await sseWriter.write({
        type: 'log',
        data: {
          level: 'info',
          message: `[${requestId}] Auth token present`
        }
      });

      // Send initial thinking message
      await sseWriter.write({ type: 'thinking', data: 'Processing your request...' });

      // Create tools with streaming callbacks
      const tools = createStreamingSpotifyTools(spotifyToken, sseWriter, playlistId || undefined, request.mode, abortController.signal);

      // Initialize Claude with streaming
      if (!env.ANTHROPIC_API_KEY) {
        console.error(`[Stream:${requestId}] CRITICAL: ANTHROPIC_API_KEY is not set`);
        throw new Error('Anthropic API key is not configured');
      }

      console.log(`[Stream:${requestId}] Initializing Claude with API key`);

      const llm = new ChatAnthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        model: 'claude-3-5-sonnet-20241022',
        temperature: 0.2,
        maxTokens: 2000,
        streaming: true,
        maxRetries: 0,
      });

      const modelWithTools = llm.bindTools(tools);

      // Build system prompt
      const systemPrompt = `You are an AI DJ assistant with access to Spotify.
${playlistId ? `IMPORTANT: The user has selected a playlist. Playlist ID: ${playlistId}

CRITICAL INSTRUCTIONS:
- When the user asks ANYTHING about this playlist, IMMEDIATELY call analyze_playlist with: {"playlist_id": "${playlistId}"}
- NEVER call any tool with empty arguments {}
- ALL tools require specific parameters - do not guess or call with {}

TOOL USAGE EXAMPLES:
- analyze_playlist: ALWAYS use {"playlist_id": "${playlistId}"}
- search_spotify_tracks: ALWAYS use {"query": "search term", "limit": 10}
- get_audio_features: ALWAYS use {"track_ids": ["track_id_1", "track_id_2"]}

If you don't have the required parameters for a tool, explain what you need from the user instead of calling the tool with empty args.` : ''}

Be concise and helpful. Use tools to get real data.`;

      await sseWriter.write({
        type: 'log',
        data: {
          level: 'info',
          message: `[${requestId}] System prompt includes playlist: ${playlistId ? 'YES' : 'NO'}`
        }
      });

      await sseWriter.write({
        type: 'debug',
        data: {
          systemPromptLength: systemPrompt.length,
          hasPlaylistContext: !!playlistId,
          playlistId: playlistId
        }
      });

      // Build messages
      const messages = [
        new SystemMessage(systemPrompt),
        ...request.conversationHistory.map((m) =>
          m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
        ),
        new HumanMessage(actualMessage)
      ];

      await sseWriter.write({
        type: 'log',
        data: {
          level: 'info',
          message: `[${requestId}] Messages prepared: ${messages.length} total, sending to Claude...`
        }
      });

      // Stream the response
      let fullResponse = '';
      let toolCalls: any[] = [];

      console.log(`[Stream:${requestId}] Starting Claude streaming...`);
      await sseWriter.write({ type: 'thinking', data: 'Analyzing your request...' });

      // Check for abort before API call
      if (abortController.signal.aborted) {
        throw new Error('Request aborted');
      }

      let response;
      try {
        console.log(`[Stream:${requestId}] Calling modelWithTools.stream() with ${messages.length} messages`);
        response = await modelWithTools.stream(messages, { signal: abortController.signal });
        console.log(`[Stream:${requestId}] Claude stream initialized`);
      } catch (apiError) {
        if (abortController.signal.aborted) {
          throw new Error('Request aborted');
        }
        console.error(`[Stream:${requestId}] Anthropic API call failed:`, apiError);
        if (apiError instanceof Error) {
          console.error(`[Stream:${requestId}] Error details:`, {
            name: apiError.name,
            message: apiError.message,
            stack: apiError.stack?.substring(0, 500)
          });
        }
        // Try to parse and provide more details
        const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown API error';
        throw new Error(`Claude API failed: ${errorMessage}`);
      }

      let chunkCount = 0;
      for await (const chunk of response) {
        if (abortController.signal.aborted) {
          throw new Error('Request aborted');
        }

        chunkCount++;
        // Handle content chunks
        if (typeof chunk.content === 'string' && chunk.content) {
          fullResponse += chunk.content;
          await sseWriter.write({ type: 'content', data: chunk.content });
          console.log(`[Stream:${requestId}] Content chunk ${chunkCount}: ${chunk.content.substring(0, 50)}...`);
        }

        // Handle tool calls
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          toolCalls = chunk.tool_calls;
          console.log(`[Stream:${requestId}] Tool calls received: ${chunk.tool_calls.map(tc => tc.name).join(', ')}`);
        }
      }

      console.log(`[Stream:${requestId}] Initial streaming complete. Chunks: ${chunkCount}, Tool calls: ${toolCalls.length}`);

      // If there were tool calls, execute them
      if (toolCalls.length > 0) {
        console.log(`[Stream:${requestId}] Executing ${toolCalls.length} tool calls...`);
        await sseWriter.write({ type: 'thinking', data: 'Using Spotify tools...' });

        // Execute tools and build ToolMessages properly
        const toolMessages = [];
        for (const toolCall of toolCalls) {
          if (abortController.signal.aborted) {
            throw new Error('Request aborted');
          }

          console.log(`[Stream:${requestId}] Looking for tool: ${toolCall.name}`);
          const tool = tools.find(t => t.name === toolCall.name);
          if (tool) {
            console.log(`[Stream:${requestId}] Executing tool: ${toolCall.name} with args:`, JSON.stringify(toolCall.args).substring(0, 200));
            try {
              const result = await tool.func(toolCall.args);
              console.log(`[Stream:${requestId}] Tool ${toolCall.name} completed successfully`);
              toolMessages.push(
                new ToolMessage({
                  content: JSON.stringify(result),
                  tool_call_id: toolCall.id
                })
              );
            } catch (error) {
              if (abortController.signal.aborted) {
                throw new Error('Request aborted');
              }
              console.error(`[Stream:${requestId}] Tool ${toolCall.name} failed:`, error);
              toolMessages.push(
                new ToolMessage({
                  content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  tool_call_id: toolCall.id
                })
              );
            }
          } else {
            console.warn(`[Stream:${requestId}] Tool not found: ${toolCall.name}`);
            toolMessages.push(
              new ToolMessage({
                content: `Error: Tool ${toolCall.name} not found`,
                tool_call_id: toolCall.id
              })
            );
          }
        }
        console.log(`[Stream:${requestId}] All tools executed. Results: ${toolMessages.length}`);

        // Get final response with tool results - keep using modelWithTools for consistency
        console.log(`[Stream:${requestId}] Getting final response from Claude...`);
        await sseWriter.write({ type: 'thinking', data: 'Preparing response...' });

        console.log(`[Stream:${requestId}] Sending tool results back to Claude...`);

        // Build the full conversation including tool results
        const finalMessages = [
          ...messages,
          new AIMessage({ content: fullResponse, tool_calls: toolCalls }),
          ...toolMessages
        ];

        const finalResponse = await modelWithTools.stream(finalMessages, { signal: abortController.signal });

        fullResponse = '';
        let finalChunkCount = 0;
        console.log(`[Stream:${requestId}] Streaming final response...`);
        for await (const chunk of finalResponse) {
          if (abortController.signal.aborted) {
            throw new Error('Request aborted');
          }

          finalChunkCount++;
          if (typeof chunk.content === 'string' && chunk.content) {
            fullResponse += chunk.content;
            await sseWriter.write({ type: 'content', data: chunk.content });
            console.log(`[Stream:${requestId}] Final chunk ${finalChunkCount}: ${chunk.content.substring(0, 50)}...`);
          }
        }
        console.log(`[Stream:${requestId}] Final response complete. Chunks: ${finalChunkCount}`);
      }

      // Send completion
      console.log(`[Stream:${requestId}] Sending done event`);
      await sseWriter.write({ type: 'done', data: null });
      console.log(`[Stream:${requestId}] Stream complete - all events sent`);

    } catch (error) {
      if (error instanceof Error && error.message === 'Request aborted') {
        console.log(`[Stream:${requestId}] Request was aborted by client`);
      } else {
        console.error(`[Stream:${requestId}] Error:`, error);
        await sseWriter.write({
          type: 'error',
          data: error instanceof Error ? error.message : 'An error occurred'
        });
      }
    } finally {
      clearInterval(heartbeatInterval);
      c.req.raw.signal.removeEventListener('abort', onAbort);
      console.log(`[Stream:${requestId}] Closing writer...`);
      await sseWriter.close();
      console.log(`[Stream:${requestId}] Stream cleanup complete, heartbeat cleared`);
    }
  };

  // Start processing without blocking the response
  processStream().catch(error => {
    console.error(`[Stream:${requestId}] Unhandled error in processStream:`, error);
  });

  // Return the SSE response immediately
  console.log(`[Stream:${requestId}] Returning Response with SSE headers`);
  const response = new Response(readable, { headers });
  console.log(`[Stream:${requestId}] Response created, headers:`, Object.fromEntries(headers.entries()));
  return response;
});

/**
 * GET endpoint for SSE with query token authentication
 * This allows EventSource to work since it can't send custom headers
 */
chatStreamRouter.get('/events', async (c) => {
  const token = c.req.query('token');

  if (!token) {
    return c.text('Unauthorized', 401);
  }

  // Validate token (you might want to verify this is a valid Spotify token)
  // For now, we'll just check it exists

  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[SSE:${requestId}] EventSource connection established`);

  // Create abort controller for client disconnect
  const abortController = new AbortController();
  const onAbort = () => {
    console.log(`[SSE:${requestId}] Client disconnected`);
    abortController.abort();
  };

  c.req.raw.signal.addEventListener('abort', onAbort);

  // Create SSE stream
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Set proper SSE headers
  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Content-Encoding': 'identity',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });

  // Simple heartbeat to demonstrate connection
  const processStream = async () => {
    const heartbeatInterval = setInterval(async () => {
      if (abortController.signal.aborted) {
        clearInterval(heartbeatInterval);
        return;
      }
      try {
        await writer.write(encoder.encode(': heartbeat\n\n'));
      } catch (error) {
        clearInterval(heartbeatInterval);
      }
    }, 15000);

    try {
      // Send initial event
      await writer.write(encoder.encode(`data: {"type":"connected","requestId":"${requestId}"}\n\n`));

      // Keep connection open until client disconnects
      await new Promise((resolve) => {
        abortController.signal.addEventListener('abort', resolve);
      });
    } finally {
      clearInterval(heartbeatInterval);
      c.req.raw.signal.removeEventListener('abort', onAbort);
      await writer.close();
    }
  };

  processStream().catch(console.error);

  return new Response(readable, { headers });
});

export { chatStreamRouter };