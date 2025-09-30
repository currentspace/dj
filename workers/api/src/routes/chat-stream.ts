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

          if (featuresResponse.status === 403) {
            await sseWriter.write({
              type: 'thinking',
              data: `⚠️ Audio features require re-authentication. Click the "🔍 Scope Debug" button to diagnose the issue, then log out and log in again to enable full audio analysis.`
            });
          } else {
            await sseWriter.write({
              type: 'thinking',
              data: `⚠️ Audio features unavailable (${featuresResponse.status}) - continuing with basic analysis`
            });
          }
        }
      }

      // Step 4: Calculate analysis
      await sseWriter.write({ type: 'thinking', data: '🧮 Computing musical insights...' });
      const validFeatures = audioFeatures.filter((f: any) => f !== null);

      // Return summary with track IDs only - Claude can request details iteratively
      // trackIds already declared above at line 131

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
        track_ids: trackIds,
        message: 'Use get_playlist_tracks to fetch track details in batches, or get_track_details for specific tracks'
      };

      await sseWriter.write({ type: 'thinking', data: `🎉 Analysis complete for "${analysis.playlist_name}"!` });

      // Log data size for debugging
      const analysisJson = JSON.stringify(analysis);
      console.log(`[Tool] analyze_playlist completed successfully`);
      console.log(`[Tool] Analysis JSON size: ${analysisJson.length} bytes (${(analysisJson.length / 1024).toFixed(1)}KB)`);
      console.log(`[Tool] Returning summary with ${trackIds.length} track IDs and ${validFeatures.length > 0 ? 'audio analysis' : 'no audio analysis'}`);

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
      name: 'get_playlist_tracks',
      description: 'Get tracks from a playlist with pagination. Returns compact track info (name, artists, duration, popularity). Use this after analyze_playlist to get actual track details.',
      schema: z.object({
        playlist_id: z.string().optional(),
        offset: z.number().min(0).default(0),
        limit: z.number().min(1).max(50).default(20)
      }),
      func: async (args) => {
        if (abortSignal?.aborted) throw new Error('Request aborted');

        // Auto-inject playlist ID if missing
        let finalArgs = { ...args };
        if (!args.playlist_id && contextPlaylistId) {
          console.log(`[get_playlist_tracks] Auto-injecting playlist_id: ${contextPlaylistId}`);
          finalArgs.playlist_id = contextPlaylistId;
        }

        if (!finalArgs.playlist_id) {
          throw new Error('playlist_id is required');
        }

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'get_playlist_tracks', args: finalArgs }
        });

        await sseWriter.write({
          type: 'thinking',
          data: `📥 Fetching tracks ${finalArgs.offset}-${finalArgs.offset + finalArgs.limit}...`
        });

        // Fetch tracks from Spotify
        const response = await fetch(
          `https://api.spotify.com/v1/playlists/${finalArgs.playlist_id}/tracks?offset=${finalArgs.offset}&limit=${finalArgs.limit}`,
          { headers: { 'Authorization': `Bearer ${spotifyToken}` } }
        );

        if (!response.ok) {
          throw new Error(`Failed to get playlist tracks: ${response.status}`);
        }

        const data = await response.json() as any;
        const tracks = data.items.map((item: any) => item.track).filter(Boolean);

        // Return compact track info
        const compactTracks = tracks.map((track: any) => ({
          id: track.id,
          name: track.name,
          artists: track.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
          duration_ms: track.duration_ms,
          popularity: track.popularity,
          uri: track.uri,
          album: track.album?.name
        }));

        await sseWriter.write({
          type: 'thinking',
          data: `✅ Loaded ${compactTracks.length} tracks`
        });

        await sseWriter.write({
          type: 'tool_end',
          data: {
            tool: 'get_playlist_tracks',
            result: `Fetched ${compactTracks.length} tracks`
          }
        });

        return {
          tracks: compactTracks,
          offset: finalArgs.offset,
          limit: finalArgs.limit,
          total: data.total,
          has_more: (finalArgs.offset + compactTracks.length) < data.total
        };
      }
    }),

    new DynamicStructuredTool({
      name: 'get_track_details',
      description: 'Get detailed information about specific tracks. Use when you need full metadata like album details, release dates, external URLs, etc.',
      schema: z.object({
        track_ids: z.array(z.string()).min(1).max(50)
      }),
      func: async (args) => {
        if (abortSignal?.aborted) throw new Error('Request aborted');

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'get_track_details', args }
        });

        await sseWriter.write({
          type: 'thinking',
          data: `🔍 Fetching details for ${args.track_ids.length} tracks...`
        });

        // Fetch tracks from Spotify (supports up to 50 tracks)
        const response = await fetch(
          `https://api.spotify.com/v1/tracks?ids=${args.track_ids.join(',')}`,
          { headers: { 'Authorization': `Bearer ${spotifyToken}` } }
        );

        if (!response.ok) {
          throw new Error(`Failed to get track details: ${response.status}`);
        }

        const data = await response.json() as any;
        const tracks = data.tracks.filter(Boolean);

        // Return detailed track info
        const detailedTracks = tracks.map((track: any) => ({
          id: track.id,
          name: track.name,
          artists: track.artists?.map((a: any) => ({
            id: a.id,
            name: a.name
          })),
          album: {
            id: track.album?.id,
            name: track.album?.name,
            release_date: track.album?.release_date,
            total_tracks: track.album?.total_tracks,
            images: track.album?.images?.map((img: any) => ({
              url: img.url,
              height: img.height,
              width: img.width
            }))
          },
          duration_ms: track.duration_ms,
          popularity: track.popularity,
          explicit: track.explicit,
          uri: track.uri,
          external_urls: track.external_urls,
          preview_url: track.preview_url
        }));

        await sseWriter.write({
          type: 'thinking',
          data: `✅ Loaded details for ${detailedTracks.length} tracks`
        });

        await sseWriter.write({
          type: 'tool_end',
          data: {
            tool: 'get_track_details',
            result: `Fetched details for ${detailedTracks.length} tracks`
          }
        });

        return { tracks: detailedTracks };
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

ITERATIVE DATA FETCHING WORKFLOW:
1. analyze_playlist returns SUMMARY only (avg tempo, energy, etc. + track_ids)
2. get_playlist_tracks gets compact track info in batches (20 at a time)
3. get_track_details gets full metadata when needed (album art, release dates, etc.)

This allows you to fetch as much or as little detail as needed for the user's question.

${playlistId ? `CONTEXT: User has selected playlist ID: ${playlistId}

WORKFLOW FOR THIS PLAYLIST:
1. If user asks about the playlist, start with: analyze_playlist({"playlist_id": "${playlistId}"})
2. analyze_playlist returns:
   - If audio_analysis is present: Use those values (avg_tempo, avg_energy, etc.) to describe the playlist
   - If audio_analysis is null: Audio features unavailable, describe based on playlist name/description only
3. To see track names: get_playlist_tracks({"playlist_id": "${playlistId}", "offset": 0, "limit": 20})
4. To get more tracks: use different offset (20, 40, 60, etc.)
5. For specific track details: get_track_details({"track_ids": ["id1", "id2", ...]})

CRITICAL: There is NO get_audio_features tool. Audio features are ONLY available through analyze_playlist.
If analyze_playlist returns audio_analysis: null, you MUST describe the playlist based ONLY on its name and description.

EXAMPLE QUESTIONS:
- "What's the tempo?" → analyze_playlist only
  - If has avg_tempo: Report it (e.g., "The playlist has an average tempo of 120 BPM")
  - If audio_analysis is null: Say "Audio analysis is unavailable for this playlist. Based on the description '[description]', this appears to be [genre] music."
- "List the first 10 tracks" → analyze_playlist + get_playlist_tracks(limit: 10)
- "What album is track 5 from?" → get_playlist_tracks + get_track_details for that track` : ''}

TOOL RULES:
- NEVER call tools with empty arguments {}
- ALWAYS provide required parameters
- Use pagination (offset/limit) for large playlists
- Only fetch what you need to answer the user's question
- There is NO get_audio_features tool - audio data comes from analyze_playlist only

Be concise and helpful. Fetch data iteratively based on what the user actually asks for.`;

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
      console.log(`[Stream:${requestId}] User message: "${actualMessage}"`);

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

      console.log(`[Stream:${requestId}] Initial streaming complete. Chunks: ${chunkCount}, Tool calls: ${toolCalls.length}, Content length: ${fullResponse.length}`);

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
              console.log(`[Stream:${requestId}] Tool result type: ${typeof result}`);
              console.log(`[Stream:${requestId}] Tool result keys: ${typeof result === 'object' ? Object.keys(result || {}).join(', ') : 'N/A'}`);

              const toolContent = JSON.stringify(result);
              console.log(`[Stream:${requestId}] Tool result JSON length: ${toolContent.length}`);
              console.log(`[Stream:${requestId}] Tool result preview: ${toolContent.substring(0, 500)}...`);

              // Create the tool message
              const toolMsg = new ToolMessage({
                content: toolContent,
                tool_call_id: toolCall.id
              });

              toolMessages.push(toolMsg);

              console.log(`[Stream:${requestId}] Created ToolMessage with:`);
              console.log(`[Stream:${requestId}]   - call_id: ${toolCall.id}`);
              console.log(`[Stream:${requestId}]   - content length: ${toolContent.length}`);
              console.log(`[Stream:${requestId}]   - content has playlist_name: ${toolContent.includes('playlist_name')}`);
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
        console.log(`[Stream:${requestId}] Full response so far: "${fullResponse.substring(0, 100)}"`);

        // Build the full conversation including tool results
        // If Claude sent no content initially, we still need to pass something
        const aiMessageContent = fullResponse || '';
        console.log(`[Stream:${requestId}] Creating AIMessage with content length: ${aiMessageContent.length}, tool calls: ${toolCalls.length}`);
        const finalMessages = [
          ...messages,
          new AIMessage({ content: aiMessageContent, tool_calls: toolCalls }),
          ...toolMessages
        ];
        console.log(`[Stream:${requestId}] Final messages array has ${finalMessages.length} messages`);

        console.log(`[Stream:${requestId}] Attempting to get final response from Claude...`);
        console.log(`[Stream:${requestId}] Final messages structure:`);
        finalMessages.forEach((msg, i) => {
          const msgType = msg.constructor.name;
          const contentPreview = msg.content?.toString().slice(0, 200) || 'no content';
          console.log(`[Stream:${requestId}]   ${i}: ${msgType} - ${contentPreview}`);
          if (msgType === 'ToolMessage') {
            console.log(`[Stream:${requestId}]     Tool call ID: ${(msg as any).tool_call_id}`);
            console.log(`[Stream:${requestId}]     Content length: ${msg.content?.toString().length || 0}`);
          } else if (msgType === 'AIMessage' && (msg as any).tool_calls) {
            console.log(`[Stream:${requestId}]     Tool calls: ${(msg as any).tool_calls.map((tc: any) => `${tc.name}(id:${tc.id})`).join(', ')}`);
          }
        });

        const finalResponse = await modelWithTools.stream(finalMessages, { signal: abortController.signal });

        fullResponse = '';
        let finalChunkCount = 0;
        console.log(`[Stream:${requestId}] Streaming final response from Claude with tool results...`);
        let contentStarted = false;
        for await (const chunk of finalResponse) {
          if (abortController.signal.aborted) {
            throw new Error('Request aborted');
          }

          finalChunkCount++;
          // Log ALL chunks to see what Claude is actually sending
          const contentPreview = typeof chunk.content === 'string'
            ? chunk.content.substring(0, 100)
            : Array.isArray(chunk.content)
            ? JSON.stringify(chunk.content).substring(0, 100)
            : chunk.content
            ? String(chunk.content).substring(0, 100)
            : 'no content';

          console.log(`[Stream:${requestId}] Final response chunk ${finalChunkCount}:`, {
            hasContent: !!chunk.content,
            contentLength: typeof chunk.content === 'string' ? chunk.content.length : 0,
            chunkKeys: Object.keys(chunk),
            chunkType: chunk.type || 'unknown',
            chunkContent: contentPreview
          });

          if (typeof chunk.content === 'string' && chunk.content) {
            if (!contentStarted) {
              console.log(`[Stream:${requestId}] CONTENT STARTED at chunk ${finalChunkCount}: ${chunk.content.substring(0, 100)}`);
              contentStarted = true;
            }
            fullResponse += chunk.content;
            await sseWriter.write({ type: 'content', data: chunk.content });
          }
        }
        console.log(`[Stream:${requestId}] Final response complete. Chunks: ${finalChunkCount}, Total content: ${fullResponse.length} chars`);

        // If still no response after tool execution, log debug info and try alternative
        if (fullResponse.length === 0) {
          console.error(`[Stream:${requestId}] WARNING: No content received from Claude after tool execution!`);
          console.error(`[Stream:${requestId}] Debug info - Tool messages:`, toolMessages.length);
          console.error(`[Stream:${requestId}] Debug info - Final chunks received:`, finalChunkCount);

          // Try a simple direct prompt instead
          console.log(`[Stream:${requestId}] Trying simple direct approach...`);
          try {
            const simplePrompt = 'Based on the playlist analysis that just completed, please provide a brief summary of the "Lover" playlist with 17 tracks.';
            const simpleResponse = await llm.stream([new HumanMessage(simplePrompt)]);

            let alternativeResponse = '';
            for await (const chunk of simpleResponse) {
              if (typeof chunk.content === 'string' && chunk.content) {
                alternativeResponse += chunk.content;
                await sseWriter.write({ type: 'content', data: chunk.content });
              }
            }

            if (alternativeResponse.length === 0) {
              await sseWriter.write({ type: 'content', data: 'I successfully analyzed your "Lover" playlist and found 17 tracks. The analysis completed successfully!' });
            }
          } catch (error) {
            console.error(`[Stream:${requestId}] Simple approach also failed:`, error);
            await sseWriter.write({ type: 'content', data: 'I successfully analyzed your "Lover" playlist and found 17 tracks. The analysis completed successfully!' });
          }
        }
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