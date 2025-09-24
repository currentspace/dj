import { Hono } from 'hono';
import { stream } from 'hono/streaming';
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

interface HonoStreamWriter {
  write: (data: string) => void;
}

function sendSSE(stream: HonoStreamWriter, event: StreamEvent) {
  const message = `data: ${JSON.stringify(event)}\n\n`;
  stream.write(message);
}

/**
 * Create Spotify tools with streaming callbacks
 */
// Helper function to send progress updates to UI
function sendProgress(stream: HonoStreamWriter, message: string) {
  sendSSE(stream, { type: 'thinking', data: message });
}

function createStreamingSpotifyTools(
  spotifyToken: string,
  stream: HonoStreamWriter,
  contextPlaylistId?: string,
  mode?: string
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
        sendSSE(stream, {
          type: 'tool_start',
          data: { tool: 'search_spotify_tracks', args }
        });

        const result = await executeSpotifyTool('search_spotify_tracks', args, spotifyToken);

        sendSSE(stream, {
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
        // Auto-inject playlist ID if missing or empty
        let finalArgs = { ...args };
        if (!args.playlist_id && contextPlaylistId) {
          console.log(`[analyze_playlist] Auto-injecting playlist_id: ${contextPlaylistId}`);
          sendProgress(stream, `🎵 Using selected playlist for analysis...`);
          finalArgs.playlist_id = contextPlaylistId;
        }

        sendSSE(stream, {
          type: 'tool_start',
          data: { tool: 'analyze_playlist', args: finalArgs }
        });

        // Enhanced progress tracking
        sendProgress(stream, '📊 Starting playlist analysis...');

        try {
          // Step 1: Get playlist details
          sendProgress(stream, '🔍 Fetching playlist information...');
          const playlistResponse = await fetch(
            `https://api.spotify.com/v1/playlists/${finalArgs.playlist_id}`,
            { headers: { 'Authorization': `Bearer ${spotifyToken}` } }
          );

          if (!playlistResponse.ok) {
            throw new Error(`Failed to get playlist: ${playlistResponse.status}`);
          }

          const playlist = await playlistResponse.json() as any;
          sendProgress(stream, `🎼 Found "${playlist.name}" with ${playlist.tracks?.total || 0} tracks`);

          // Step 2: Get tracks
          sendProgress(stream, '🎵 Fetching track details...');
          const tracksResponse = await fetch(
            `https://api.spotify.com/v1/playlists/${finalArgs.playlist_id}/tracks?limit=100`,
            { headers: { 'Authorization': `Bearer ${spotifyToken}` } }
          );

          if (!tracksResponse.ok) {
            throw new Error(`Failed to get tracks: ${tracksResponse.status}`);
          }

          const tracksData = await tracksResponse.json() as any;
          const tracks = tracksData.items.map((item: any) => item.track).filter(Boolean);
          const trackIds = tracks.map((t: any) => t.id).filter(Boolean);

          sendProgress(stream, `✅ Loaded ${tracks.length} tracks successfully`);

          // Step 3: Get audio features
          let audioFeatures = [];
          if (trackIds.length > 0) {
            sendProgress(stream, `🎚️ Analyzing audio characteristics of ${trackIds.length} tracks...`);

            const featuresResponse = await fetch(
              `https://api.spotify.com/v1/audio-features?ids=${trackIds.slice(0, 100).join(',')}`,
              { headers: { 'Authorization': `Bearer ${spotifyToken}` } }
            );

            if (featuresResponse.ok) {
              const featuresData = await featuresResponse.json() as any;
              audioFeatures = featuresData.audio_features || [];
              const validFeatures = audioFeatures.filter((f: any) => f !== null);
              sendProgress(stream, `🎯 Audio analysis complete! Got data for ${validFeatures.length} tracks`);
            } else {
              sendProgress(stream, `⚠️ Audio features unavailable (${featuresResponse.status}) - continuing with basic analysis`);
            }
          }

          // Step 4: Calculate analysis
          sendProgress(stream, '🧮 Computing musical insights...');
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

          sendProgress(stream, `🎉 Analysis complete for "${analysis.playlist_name}"!`);

          sendSSE(stream, {
            type: 'tool_end',
            data: {
              tool: 'analyze_playlist',
              result: `Analyzed "${analysis.playlist_name}" with ${analysis.total_tracks} tracks`
            }
          });

          return analysis;

        } catch (error) {
          sendProgress(stream, `❌ Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          throw error;
        }
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

        sendSSE(stream, {
          type: 'tool_start',
          data: { tool: 'get_audio_features', args: finalArgs }
        });

        const result = await executeSpotifyTool('get_audio_features', finalArgs, spotifyToken);

        sendSSE(stream, {
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

        sendSSE(stream, {
          type: 'tool_start',
          data: { tool: 'get_recommendations', args: finalArgs }
        });

        const result = await executeSpotifyTool('get_recommendations', finalArgs, spotifyToken);

        sendSSE(stream, {
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
        sendSSE(stream, {
          type: 'tool_start',
          data: { tool: 'create_playlist', args: { name: args.name, tracks: args.track_uris.length } }
        });

        const result = await executeSpotifyTool('create_playlist', args, spotifyToken);

        sendSSE(stream, {
          type: 'tool_end',
          data: {
            tool: 'create_playlist',
            result: result?.id ? `Created playlist: ${args.name}` : 'Playlist created'
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
 */
chatStreamRouter.post('/message', async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[Stream:${requestId}] Starting streaming response`);

  return stream(c, async (stream) => {

    try {
      // Send build info as first event
      let buildInfo = {
        commitHash: 'unknown',
        buildTime: new Date().toISOString(),
        branch: 'unknown',
        version: 'unknown'
      };

      try {
        const info = await import('../build-info.json');
        buildInfo = info.default;
      } catch {
        // Use defaults if not available
      }

      sendSSE(stream, {
        type: 'debug',
        data: {
          buildInfo,
          requestId,
          serverTime: new Date().toISOString()
        }
      });

      // Parse request
      const body = await c.req.json();
      sendSSE(stream, {
        type: 'log',
        data: {
          level: 'info',
          message: `[${requestId}] Request received - Body size: ${JSON.stringify(body).length} bytes`
        }
      });

      const request = ChatRequestSchema.parse(body);

      sendSSE(stream, {
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
        sendSSE(stream, {
          type: 'log',
          data: {
            level: 'info',
            message: `[${requestId}] ✅ Playlist ID extracted: ${playlistId}`
          }
        });
      } else {
        sendSSE(stream, {
          type: 'log',
          data: {
            level: 'warn',
            message: `[${requestId}] ⚠️ No playlist ID found in message: "${request.message.substring(0, 50)}..."`
          }
        });
      }

      // Get Spotify token
      const authorization = c.req.header('Authorization');
      if (!authorization?.startsWith('Bearer ')) {
        sendSSE(stream, { type: 'error', data: 'Unauthorized - Missing or invalid Authorization header' });
        return;
      }
      const spotifyToken = authorization.replace('Bearer ', '');

      sendSSE(stream, {
        type: 'log',
        data: {
          level: 'info',
          message: `[${requestId}] Auth token present: ${spotifyToken.substring(0, 10)}...`
        }
      });

      // Send initial thinking message
      sendSSE(stream, { type: 'thinking', data: 'Processing your request...' });

      // Create tools with streaming callbacks
      const tools = createStreamingSpotifyTools(spotifyToken, stream, playlistId, request.mode);

      // Initialize Claude with streaming
      const llm = new ChatAnthropic({
        apiKey: c.env.ANTHROPIC_API_KEY,
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

      sendSSE(stream, {
        type: 'log',
        data: {
          level: 'info',
          message: `[${requestId}] System prompt includes playlist: ${playlistId ? 'YES - ' + playlistId : 'NO'}`
        }
      });

      sendSSE(stream, {
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

      sendSSE(stream, {
        type: 'log',
        data: {
          level: 'info',
          message: `[${requestId}] Messages prepared: ${messages.length} total, sending to Claude...`
        }
      });

      // Stream the response
      let fullResponse = '';
      let toolCalls: any[] = [];

      sendSSE(stream, { type: 'thinking', data: 'Analyzing your request...' });

      const response = await modelWithTools.stream(messages);

      for await (const chunk of response) {
        // Handle content chunks
        if (typeof chunk.content === 'string' && chunk.content) {
          fullResponse += chunk.content;
          sendSSE(stream, { type: 'content', data: chunk.content });
        }

        // Handle tool calls
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          toolCalls = chunk.tool_calls;
        }
      }

      // If there were tool calls, execute them
      if (toolCalls.length > 0) {
        sendSSE(stream, { type: 'thinking', data: 'Using Spotify tools...' });

        // Execute tools
        const toolResults = [];
        for (const toolCall of toolCalls) {
          const tool = tools.find(t => t.name === toolCall.name);
          if (tool) {
            try {
              const result = await tool.func(toolCall.args);
              toolResults.push({
                tool_call_id: toolCall.id,
                output: result
              });
            } catch (error) {
              toolResults.push({
                tool_call_id: toolCall.id,
                output: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
              });
            }
          }
        }

        // Get final response with tool results
        sendSSE(stream, { type: 'thinking', data: 'Preparing response...' });

        const toolMessage = new ToolMessage({
          content: JSON.stringify(toolResults),
          tool_call_id: toolCalls[0].id
        });

        const finalResponse = await llm.stream([
          ...messages,
          new AIMessage({ content: fullResponse, tool_calls: toolCalls }),
          toolMessage
        ]);

        fullResponse = '';
        for await (const chunk of finalResponse) {
          if (typeof chunk.content === 'string' && chunk.content) {
            fullResponse += chunk.content;
            sendSSE(stream, { type: 'content', data: chunk.content });
          }
        }
      }

      // Send completion
      sendSSE(stream, { type: 'done', data: null });

    } catch (error) {
      console.error(`[Stream:${requestId}] Error:`, error);
      sendSSE(stream, {
        type: 'error',
        data: error instanceof Error ? error.message : 'An error occurred'
      });
    } finally {
      // Stream will be automatically closed by Hono
    }
  });
});

export { chatStreamRouter };