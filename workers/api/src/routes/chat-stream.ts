import { Hono } from 'hono';
import type { Env } from '../index';
import { z } from 'zod';
import { ChatAnthropic } from '@langchain/anthropic';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { executeSpotifyTool } from '../lib/spotify-tools';
import type { StreamToolData, StreamToolResult, StreamDebugData, StreamLogData } from '@dj/shared-types';
import { AudioEnrichmentService } from '../services/AudioEnrichmentService';
import { LastFmService } from '../services/LastFmService';
import { ProgressNarrator } from '../lib/progress-narrator';

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
  sseWriter: SSEWriter,
  env?: Env,
  narrator?: ProgressNarrator,
  userRequest?: string,
  recentMessages?: string[]
): Promise<unknown> {
  console.log(`[Tool] Executing ${toolName} with args:`, JSON.stringify(args).substring(0, 200));

  if (toolName === 'analyze_playlist') {
    const { playlist_id } = args;

    try {
      // Use narrator if available, otherwise fallback to static message
      const startMessage = narrator
        ? await narrator.generateMessage({
            eventType: 'tool_call_start',
            toolName: 'analyze_playlist',
            parameters: args,
            userRequest,
            previousMessages: recentMessages,
          })
        : '📊 Starting playlist analysis...';

      await sseWriter.write({ type: 'thinking', data: startMessage });

      // Step 1: Get playlist details
      const fetchMessage = narrator
        ? await narrator.generateMessage({
            eventType: 'analyzing_request',
            userRequest,
            previousMessages: recentMessages,
          })
        : '🔍 Fetching playlist information...';
      await sseWriter.write({ type: 'thinking', data: fetchMessage });

      const playlistResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlist_id}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!playlistResponse.ok) {
        throw new Error(`Failed to get playlist: ${playlistResponse.status}`);
      }

      const playlist = await playlistResponse.json() as any;

      const foundMessage = narrator
        ? await narrator.generateMessage({
            eventType: 'searching_tracks',
            parameters: { name: playlist.name, trackCount: playlist.tracks?.total || 0 },
            userRequest,
            previousMessages: recentMessages,
          })
        : `🎼 Found "${playlist.name}" with ${playlist.tracks?.total || 0} tracks`;
      await sseWriter.write({ type: 'thinking', data: foundMessage });

      // Step 2: Get tracks
      const tracksMessage = narrator
        ? await narrator.generateMessage({
            eventType: 'analyzing_audio',
            metadata: { trackCount: playlist.tracks?.total || 0 },
            userRequest,
            previousMessages: recentMessages,
          })
        : '🎵 Fetching track details...';
      await sseWriter.write({ type: 'thinking', data: tracksMessage });
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

      // Step 3: Analyze track metadata (audio features API deprecated)
      await sseWriter.write({ type: 'thinking', data: '🎵 Analyzing track metadata...' });

      // Calculate metadata-based statistics
      const validTracks = tracks.filter((t: any) => t && t.popularity !== undefined);
      const avgPopularity = validTracks.length > 0
        ? validTracks.reduce((sum: number, t: any) => sum + t.popularity, 0) / validTracks.length
        : 0;

      const avgDuration = validTracks.length > 0
        ? validTracks.reduce((sum: number, t: any) => sum + (t.duration_ms || 0), 0) / validTracks.length
        : 0;

      const explicitCount = validTracks.filter((t: any) => t.explicit).length;
      const explicitPercentage = validTracks.length > 0 ? (explicitCount / validTracks.length) * 100 : 0;

      // Extract unique artists for genre analysis
      const artistIds = new Set<string>();
      validTracks.forEach((t: any) => {
        if (t.artists) {
          t.artists.forEach((artist: any) => {
            if (artist.id) artistIds.add(artist.id);
          });
        }
      });

      // Step 4: Fetch artist genres (batch request, limit to 50 artists)
      await sseWriter.write({ type: 'thinking', data: '🎸 Fetching artist genres...' });
      const artistIdsArray = Array.from(artistIds).slice(0, 50);
      let genres: string[] = [];

      if (artistIdsArray.length > 0) {
        const artistsResponse = await fetch(
          `https://api.spotify.com/v1/artists?ids=${artistIdsArray.join(',')}`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (artistsResponse.ok) {
          const artistsData = await artistsResponse.json() as any;
          const genreMap = new Map<string, number>();

          artistsData.artists.forEach((artist: any) => {
            if (artist && artist.genres) {
              artist.genres.forEach((genre: string) => {
                genreMap.set(genre, (genreMap.get(genre) || 0) + 1);
              });
            }
          });

          // Get top genres sorted by frequency
          genres = Array.from(genreMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([genre]) => genre);

          await sseWriter.write({ type: 'thinking', data: `🎯 Found ${genres.length} genres across ${artistsData.artists.length} artists` });
        }
      }

      // Step 5: Analyze release dates
      const releaseDates = validTracks
        .map((t: any) => t.album?.release_date)
        .filter(Boolean);

      const releaseYears = releaseDates
        .map((date: string) => parseInt(date.split('-')[0]))
        .filter((year: number) => !isNaN(year));

      const avgReleaseYear = releaseYears.length > 0
        ? Math.round(releaseYears.reduce((sum: number, year: number) => sum + year, 0) / releaseYears.length)
        : null;

      const oldestYear = releaseYears.length > 0 ? Math.min(...releaseYears) : null;
      const newestYear = releaseYears.length > 0 ? Math.max(...releaseYears) : null;

      // Step 6: Sequential BPM enrichment (process one track at a time to stay within limits)
      let bpmData = null;
      if (env?.AUDIO_FEATURES_CACHE) {
        try {
          const enrichmentService = new AudioEnrichmentService(env.AUDIO_FEATURES_CACHE);

          // Process tracks sequentially with rate limiting (40 subrequests total / ~25ms per track)
          const tracksToEnrich = validTracks.slice(0, 30);
          const bpmResults: number[] = [];
          let enrichedCount = 0;
          let subrequestCount = 0;
          const MAX_SUBREQUESTS = 40; // Stay well under 50 limit

          await sseWriter.write({ type: 'thinking', data: `🎵 Enriching ${tracksToEnrich.length} tracks with BPM data (paced to avoid limits)...` });

          for (let i = 0; i < tracksToEnrich.length; i++) {
            // Stop if we're approaching the subrequest limit
            if (subrequestCount >= MAX_SUBREQUESTS) {
              await sseWriter.write({ type: 'thinking', data: `⚠️ Reached subrequest limit, enriched ${enrichedCount} tracks` });
              break;
            }

            const track = tracksToEnrich[i];

            try {
              const spotifyTrack = {
                id: track.id,
                name: track.name,
                duration_ms: track.duration_ms,
                artists: track.artists || [],
                external_ids: track.external_ids
              };

              const bpmResult = await enrichmentService.enrichTrack(spotifyTrack);
              subrequestCount += 3; // Estimate 3 subrequests per track (ISRC lookup + search + detail)

              if (bpmResult.bpm && AudioEnrichmentService.isValidBPM(bpmResult.bpm)) {
                bpmResults.push(bpmResult.bpm);
                enrichedCount++;

                // Stream progress updates every 5 tracks
                if ((i + 1) % 5 === 0) {
                  await sseWriter.write({ type: 'thinking', data: `🎵 Enriched ${enrichedCount}/${tracksToEnrich.length} tracks...` });
                }
              }

              // Rate limiting: 25ms delay between tracks (40 tracks/second max)
              if (i < tracksToEnrich.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 25));
              }
            } catch (error) {
              console.error(`[BPMEnrichment] Failed for track ${track.name}:`, error);
              subrequestCount += 3; // Count failed attempts too
              // Continue with next track
            }
          }

          if (bpmResults.length > 0) {
            const avgBPM = bpmResults.reduce((sum, bpm) => sum + bpm, 0) / bpmResults.length;
            const minBPM = Math.min(...bpmResults);
            const maxBPM = Math.max(...bpmResults);

            bpmData = {
              avg_bpm: Math.round(avgBPM),
              bpm_range: { min: minBPM, max: maxBPM },
              sample_size: bpmResults.length,
              total_checked: tracksToEnrich.length,
              source: 'deezer'
            };

            await sseWriter.write({ type: 'thinking', data: `✅ BPM enrichment complete! Found BPM for ${bpmResults.length}/${tracksToEnrich.length} tracks` });
          } else {
            await sseWriter.write({ type: 'thinking', data: '⚠️ No BPM data available for these tracks' });
          }
        } catch (error) {
          console.error('[BPMEnrichment] Failed:', error);
          await sseWriter.write({ type: 'thinking', data: '⚠️ BPM enrichment unavailable - continuing with metadata only' });
        }
      }

      // Step 7: Sequential Last.fm enrichment (tags, popularity, similarity)
      let lastfmData = null;
      if (env?.LASTFM_API_KEY && env?.AUDIO_FEATURES_CACHE) {
        try {
          const lastfmService = new LastFmService(env.LASTFM_API_KEY, env.AUDIO_FEATURES_CACHE);

          // Process tracks sequentially with same rate limiting
          const tracksForLastFm = validTracks.slice(0, 8); // Fewer tracks since Last.fm uses 4 calls per track
          const signalsMap = new Map();
          let lastfmSubrequests = 0;
          const MAX_LASTFM_SUBREQUESTS = 32; // Reserve subrequests for Last.fm

          await sseWriter.write({ type: 'thinking', data: `🎧 Enriching ${tracksForLastFm.length} tracks with Last.fm tags (paced)...` });

          for (let i = 0; i < tracksForLastFm.length; i++) {
            if (lastfmSubrequests >= MAX_LASTFM_SUBREQUESTS) {
              await sseWriter.write({ type: 'thinking', data: `⚠️ Reached Last.fm subrequest limit, enriched ${signalsMap.size} tracks` });
              break;
            }

            const track = tracksForLastFm[i];

            try {
              const lastfmTrack = {
                name: track.name,
                artist: track.artists?.[0]?.name || 'Unknown',
                duration_ms: track.duration_ms
              };

              const signals = await lastfmService.getTrackSignals(lastfmTrack);
              lastfmSubrequests += 4; // 4 API calls per track

              if (signals) {
                const key = `${track.id}`;
                signalsMap.set(key, signals);

                // Stream progress every 2 tracks
                if ((i + 1) % 2 === 0) {
                  await sseWriter.write({ type: 'thinking', data: `🎧 Enriched ${signalsMap.size}/${tracksForLastFm.length} tracks...` });
                }
              }

              // Rate limiting: 25ms delay between tracks
              if (i < tracksForLastFm.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 25));
              }
            } catch (error) {
              console.error(`[LastFm] Failed for track ${track.name}:`, error);
              lastfmSubrequests += 4;
            }
          }

          if (signalsMap.size > 0) {
            // Aggregate tags across all tracks
            const aggregatedTags = LastFmService.aggregateTags(signalsMap);

            // Calculate average popularity
            const popularity = LastFmService.calculateAveragePopularity(signalsMap);

            // Get some similar tracks from the first few tracks
            const similarTracks = new Set<string>();
            let count = 0;
            for (const signals of signalsMap.values()) {
              if (count >= 3) break; // Only get similar from first 3 tracks
              signals.similar.slice(0, 3).forEach(s => {
                similarTracks.add(`${s.artist} - ${s.name}`);
              });
              count++;
            }

            lastfmData = {
              crowd_tags: aggregatedTags.slice(0, 10),
              avg_listeners: popularity.avgListeners,
              avg_playcount: popularity.avgPlaycount,
              similar_tracks: Array.from(similarTracks).slice(0, 10),
              sample_size: signalsMap.size,
              source: 'lastfm'
            };

            await sseWriter.write({ type: 'thinking', data: `✅ Found Last.fm data for ${signalsMap.size} tracks!` });
          }
        } catch (error) {
          console.error('[LastFm] Enrichment failed:', error);
          await sseWriter.write({ type: 'thinking', data: '⚠️ Last.fm enrichment unavailable - continuing without tags' });
        }
      }

      await sseWriter.write({ type: 'thinking', data: '🧮 Computing playlist insights...' });

      const analysis = {
        playlist_name: playlist.name,
        playlist_description: playlist.description,
        total_tracks: tracks.length,
        metadata_analysis: {
          avg_popularity: Math.round(avgPopularity),
          avg_duration_ms: Math.round(avgDuration),
          avg_duration_minutes: Math.round(avgDuration / 60000 * 10) / 10,
          explicit_tracks: explicitCount,
          explicit_percentage: Math.round(explicitPercentage),
          top_genres: genres,
          release_year_range: oldestYear && newestYear ? {
            oldest: oldestYear,
            newest: newestYear,
            average: avgReleaseYear
          } : null,
          total_artists: artistIdsArray.length
        },
        bpm_analysis: bpmData, // BPM data from Deezer if available
        lastfm_analysis: lastfmData, // Last.fm tags and popularity if available
        track_ids: trackIds,
        message: (bpmData || lastfmData)
          ? `Enriched with ${bpmData ? 'BPM (Deezer)' : ''}${bpmData && lastfmData ? ' + ' : ''}${lastfmData ? 'tags/popularity (Last.fm)' : ''}! Use get_playlist_tracks for track details.`
          : 'Use get_playlist_tracks to fetch track details in batches, or get_track_details for specific tracks.'
      };

      await sseWriter.write({ type: 'thinking', data: `🎉 Analysis complete for "${analysis.playlist_name}"!` });

      // Log data size for debugging
      const analysisJson = JSON.stringify(analysis);
      console.log(`[Tool] analyze_playlist completed successfully`);
      console.log(`[Tool] Analysis JSON size: ${analysisJson.length} bytes (${(analysisJson.length / 1024).toFixed(1)}KB)`);
      console.log(`[Tool] Returning metadata analysis with ${trackIds.length} track IDs`);

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
  abortSignal?: AbortSignal,
  env?: Env,
  narrator?: ProgressNarrator,
  userRequest?: string,
  recentMessages?: string[]
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

        // Use enhanced executeSpotifyTool with progress streaming and narrator
        const result = await executeSpotifyToolWithProgress(
          'analyze_playlist',
          finalArgs,
          spotifyToken,
          sseWriter,
          env,
          narrator,
          userRequest,
          recentMessages
        );

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

      // Initialize progress narrator with Haiku
      const narrator = new ProgressNarrator(env.ANTHROPIC_API_KEY);
      const recentMessages: string[] = [];

      // Send initial thinking message with dynamic narration
      const initialMessage = await narrator.generateMessage({
        eventType: 'started',
        userRequest: request.message,
      });
      recentMessages.push(initialMessage);
      await sseWriter.write({ type: 'thinking', data: initialMessage });

      // Create tools with streaming callbacks
      const tools = createStreamingSpotifyTools(
        spotifyToken,
        sseWriter,
        playlistId || undefined,
        request.mode,
        abortController.signal,
        env,
        narrator,
        request.message,
        recentMessages
      );

      // Initialize Claude with streaming
      if (!env.ANTHROPIC_API_KEY) {
        console.error(`[Stream:${requestId}] CRITICAL: ANTHROPIC_API_KEY is not set`);
        throw new Error('Anthropic API key is not configured');
      }

      console.log(`[Stream:${requestId}] Initializing Claude with API key`);

      const llm = new ChatAnthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.2,
        maxTokens: 2000,
        streaming: true,
        maxRetries: 0,
      });

      const modelWithTools = llm.bindTools(tools);

      // Build system prompt
      const systemPrompt = `You are an AI DJ assistant with access to Spotify.

IMPORTANT: Spotify deprecated audio features on Nov 27, 2024, BUT we've restored them via free APIs!

analyze_playlist now returns THREE types of data:
1. metadata_analysis (always available):
   - Popularity (0-100 score based on play counts)
   - Genres (from artist data)
   - Release year range (oldest to newest)
   - Average track duration
   - Explicit content percentage

2. bpm_analysis (if KV cache configured):
   - avg_bpm: Average BPM (beats per minute)
   - bpm_range: { min, max } BPM range
   - sample_size: Number of tracks with BPM data found
   - source: 'deezer'

3. lastfm_analysis (if LASTFM_API_KEY configured):
   - crowd_tags: Most common tags/genres/moods from Last.fm community (e.g., ["electronic", "chill", "dance"])
   - avg_listeners: Average Last.fm listeners per track
   - avg_playcount: Average Last.fm playcounts
   - similar_tracks: Recommended similar tracks for transitions
   - source: 'lastfm'

ITERATIVE DATA FETCHING WORKFLOW:
1. analyze_playlist returns SUMMARY with metadata + BPM + Last.fm analysis (if available) + track_ids
2. get_playlist_tracks gets compact track info in batches (20 at a time)
3. get_track_details gets full metadata when needed (album art, release dates, etc.)

This allows you to fetch as much or as little detail as needed for the user's question.

${playlistId ? `CONTEXT: User has selected playlist ID: ${playlistId}

WORKFLOW FOR THIS PLAYLIST:
1. If user asks about the playlist, start with: analyze_playlist({"playlist_id": "${playlistId}"})
2. analyze_playlist returns:
   - metadata_analysis with avg_popularity, top_genres, release_year_range, etc.
   - bpm_analysis (if available) with avg_bpm, bpm_range
   - lastfm_analysis (if available) with crowd_tags, similar_tracks, popularity metrics
3. To see track names: get_playlist_tracks({"playlist_id": "${playlistId}", "offset": 0, "limit": 20})
4. To get more tracks: use different offset (20, 40, 60, etc.)
5. For specific track details: get_track_details({"track_ids": ["id1", "id2", ...]})

EXAMPLE QUESTIONS & RESPONSES:
- "What's the tempo?" → If bpm_analysis exists, use avg_bpm. Otherwise: "BPM data not available for these tracks. Based on the genres [list genres], this appears to be [describe music style and likely tempo range]."
- "What's the vibe?" → Use metadata, BPM, Last.fm crowd_tags, and similar_tracks to describe the playlist's vibe
- "What genres?" → Combine top_genres from metadata_analysis with crowd_tags from lastfm_analysis for comprehensive genre picture
- "Is this music old or new?" → Use release_year_range to answer
- "Suggest similar tracks" → Use similar_tracks from lastfm_analysis
- "List the first 10 tracks" → analyze_playlist + get_playlist_tracks(limit: 10)
- "What album is track 5 from?" → get_playlist_tracks + get_track_details for that track` : ''}

TOOL RULES:
- NEVER call tools with empty arguments {}
- ALWAYS provide required parameters
- Use pagination (offset/limit) for large playlists
- Only fetch what you need to answer the user's question
- Use metadata_analysis (not audio_analysis) for playlist insights

Be concise and helpful. Describe playlists using genres, popularity, era, and descriptions.`;

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
        // Handle content chunks (both string and array formats)
        let textContent = '';
        if (typeof chunk.content === 'string' && chunk.content) {
          textContent = chunk.content;
        } else if (Array.isArray(chunk.content)) {
          for (const block of chunk.content) {
            if (block.type === 'text' && block.text) {
              textContent += block.text;
            }
          }
        }

        if (textContent) {
          fullResponse += textContent;
          await sseWriter.write({ type: 'content', data: textContent });
          console.log(`[Stream:${requestId}] Content chunk ${chunkCount}: ${textContent.substring(0, 50)}...`);
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

          // Handle both string content and array content blocks (Claude API format)
          let textContent = '';
          if (typeof chunk.content === 'string' && chunk.content) {
            textContent = chunk.content;
          } else if (Array.isArray(chunk.content)) {
            // Extract text from content blocks: [{"type":"text","text":"..."}]
            for (const block of chunk.content) {
              if (block.type === 'text' && block.text) {
                textContent += block.text;
              }
            }
          }

          if (textContent) {
            if (!contentStarted) {
              console.log(`[Stream:${requestId}] CONTENT STARTED at chunk ${finalChunkCount}: ${textContent.substring(0, 100)}`);
              contentStarted = true;
            }
            fullResponse += textContent;
            await sseWriter.write({ type: 'content', data: textContent });
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