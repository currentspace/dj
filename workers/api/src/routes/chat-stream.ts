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

      console.log(`[SpotifyAPI] Fetching playlist details: ${playlist_id}`);
      const playlistResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlist_id}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      console.log(`[SpotifyAPI] Playlist response status: ${playlistResponse.status}`);
      if (!playlistResponse.ok) {
        throw new Error(`Failed to get playlist: ${playlistResponse.status}`);
      }

      const playlist = await playlistResponse.json() as any;
      console.log(`[SpotifyAPI] Playlist loaded: "${playlist.name}" with ${playlist.tracks?.total} tracks`);

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

      console.log(`[SpotifyAPI] Fetching tracks from playlist: ${playlist_id}`);
      const tracksResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlist_id}/tracks?limit=100`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      console.log(`[SpotifyAPI] Tracks response status: ${tracksResponse.status}`);
      if (!tracksResponse.ok) {
        const errorBody = await tracksResponse.text();
        console.error(`[SpotifyAPI] Tracks fetch failed: ${tracksResponse.status} - ${errorBody}`);
        throw new Error(`Failed to get tracks: ${tracksResponse.status}`);
      }

      const tracksData = await tracksResponse.json() as any;
      const tracks = tracksData.items.map((item: any) => item.track).filter(Boolean);
      const trackIds = tracks.map((t: any) => t.id).filter(Boolean);

      console.log(`[SpotifyAPI] Loaded ${tracks.length} tracks from playlist`);

      // Debug: Log first 3 tracks' structure to see what fields Spotify returns
      if (tracks.length > 0) {
        console.log(`[SpotifyAPI] ========== TRACK STRUCTURE DEBUG ==========`);
        tracks.slice(0, 3).forEach((track: any, idx: number) => {
          console.log(`[SpotifyAPI] Track ${idx + 1}: "${track.name}" by ${track.artists?.[0]?.name}`);
          console.log(`[SpotifyAPI]   - ID: ${track.id}`);
          console.log(`[SpotifyAPI]   - has external_ids: ${!!track.external_ids}`);
          console.log(`[SpotifyAPI]   - external_ids value:`, track.external_ids);
          console.log(`[SpotifyAPI]   - ISRC: ${track.external_ids?.isrc || 'NOT PRESENT'}`);
          console.log(`[SpotifyAPI]   - Available fields:`, Object.keys(track).join(', '));
        });
        console.log(`[SpotifyAPI] ========== END TRACK STRUCTURE DEBUG ==========`);
      }

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

      // Step 6: Deezer enrichment (BPM often null, but rank/gain/release_date are valuable)
      let deezerData = null;
      if (env?.AUDIO_FEATURES_CACHE) {
        try {
          console.log(`[DeezerEnrichment] ========== STARTING DEEZER ENRICHMENT ==========`);
          console.log(`[DeezerEnrichment] KV Cache available: YES`);
          const enrichmentService = new AudioEnrichmentService(env.AUDIO_FEATURES_CACHE);

          // Process tracks sequentially with rate limiting at 40 TPS
          const tracksToEnrich = validTracks.slice(0, 100); // Process up to 100 tracks
          const bpmResults: number[] = [];
          const rankResults: number[] = [];
          const gainResults: number[] = [];
          let enrichedCount = 0;

          console.log(`[DeezerEnrichment] Will attempt to enrich ${tracksToEnrich.length} tracks`);
          await sseWriter.write({ type: 'thinking', data: `🎵 Enriching ${tracksToEnrich.length} tracks with Deezer data (BPM, rank, gain)...` });

          // Debug: Check if tracks have external_ids
          const tracksWithISRC = tracksToEnrich.filter(t => t.external_ids?.isrc).length;
          console.log(`[BPMEnrichment] Pre-enrichment ISRC check: ${tracksWithISRC}/${tracksToEnrich.length} tracks have ISRC`);

          // Debug: Log first 3 tracks to see their structure in detail
          if (tracksToEnrich.length > 0) {
            console.log(`[BPMEnrichment] ========== ENRICHMENT TRACK STRUCTURE DEBUG ==========`);
            tracksToEnrich.slice(0, 3).forEach((track, idx) => {
              console.log(`[BPMEnrichment] Track ${idx + 1}: "${track.name}" by ${track.artists?.[0]?.name}`);
              console.log(`[BPMEnrichment]   - ID: ${track.id}`);
              console.log(`[BPMEnrichment]   - Duration: ${track.duration_ms}ms`);
              console.log(`[BPMEnrichment]   - has external_ids: ${!!track.external_ids}`);
              console.log(`[BPMEnrichment]   - external_ids type: ${typeof track.external_ids}`);
              console.log(`[BPMEnrichment]   - external_ids value:`, JSON.stringify(track.external_ids));
              console.log(`[BPMEnrichment]   - ISRC: ${track.external_ids?.isrc || 'NOT PRESENT'}`);
              console.log(`[BPMEnrichment]   - Track object keys:`, Object.keys(track).join(', '));
            });
            console.log(`[BPMEnrichment] ========== END ENRICHMENT TRACK STRUCTURE DEBUG ==========`);
          }

          if (tracksWithISRC === 0) {
            console.warn(`[BPMEnrichment] ⚠️ CRITICAL: No tracks have ISRC in external_ids`);
            console.warn(`[BPMEnrichment] Will need to fetch full track details from Spotify /tracks API`);
            await sseWriter.write({ type: 'thinking', data: '⚠️ Tracks missing ISRC data - fetching from Spotify API...' });
          } else {
            console.log(`[BPMEnrichment] ✅ Found ${tracksWithISRC} tracks with ISRC, proceeding with enrichment`);
          }

          for (let i = 0; i < tracksToEnrich.length; i++) {
            const track = tracksToEnrich[i];

            // Log every track attempt for first 5 tracks, then every 10th
            if (i < 5 || i % 10 === 0) {
              console.log(`[BPMEnrichment] Processing track ${i + 1}/${tracksToEnrich.length}: "${track.name}"`);
            }

            try {
              const spotifyTrack = {
                id: track.id,
                name: track.name,
                duration_ms: track.duration_ms,
                artists: track.artists || [],
                external_ids: track.external_ids
              };

              // Log the track being sent to enrichment service
              if (i < 3) {
                console.log(`[BPMEnrichment] Calling enrichTrack with:`, {
                  id: spotifyTrack.id,
                  name: spotifyTrack.name,
                  has_external_ids: !!spotifyTrack.external_ids,
                  isrc: spotifyTrack.external_ids?.isrc || 'NONE'
                });
              }

              const deezerResult = await enrichmentService.enrichTrack(spotifyTrack);

              // Log the result for first few tracks
              if (i < 3) {
                console.log(`[DeezerEnrichment] Result for "${track.name}":`, {
                  bpm: deezerResult.bpm,
                  gain: deezerResult.gain,
                  rank: deezerResult.rank,
                  release_date: deezerResult.release_date,
                  source: deezerResult.source
                });
              }

              // Collect all available Deezer data
              if (deezerResult.bpm && AudioEnrichmentService.isValidBPM(deezerResult.bpm)) {
                bpmResults.push(deezerResult.bpm);
              }
              if (deezerResult.rank !== null && deezerResult.rank > 0) {
                rankResults.push(deezerResult.rank);
              }
              if (deezerResult.gain !== null) {
                gainResults.push(deezerResult.gain);
              }

              if (deezerResult.source) {
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
              console.error(`[BPMEnrichment] Failed for track "${track.name}":`, error);
              // Continue with next track
            }
          }

          console.log(`[DeezerEnrichment] ========== ENRICHMENT COMPLETE ==========`);
          console.log(`[DeezerEnrichment] Total tracks processed: ${tracksToEnrich.length}`);
          console.log(`[DeezerEnrichment] Tracks with Deezer match: ${enrichedCount}`);
          console.log(`[DeezerEnrichment] BPM results: ${bpmResults.length}`);
          console.log(`[DeezerEnrichment] Rank results: ${rankResults.length}`);
          console.log(`[DeezerEnrichment] Gain results: ${gainResults.length}`);

          if (enrichedCount > 0) {
            deezerData = {
              total_checked: tracksToEnrich.length,
              tracks_found: enrichedCount,
              source: 'deezer'
            } as any;

            // Add BPM stats if available
            if (bpmResults.length > 0) {
              const avgBPM = bpmResults.reduce((sum, bpm) => sum + bpm, 0) / bpmResults.length;
              deezerData.bpm = {
                avg: Math.round(avgBPM),
                range: { min: Math.min(...bpmResults), max: Math.max(...bpmResults) },
                sample_size: bpmResults.length
              };
            }

            // Add rank stats if available
            if (rankResults.length > 0) {
              const avgRank = rankResults.reduce((sum, rank) => sum + rank, 0) / rankResults.length;
              deezerData.rank = {
                avg: Math.round(avgRank),
                range: { min: Math.min(...rankResults), max: Math.max(...rankResults) },
                sample_size: rankResults.length
              };
            }

            // Add gain stats if available
            if (gainResults.length > 0) {
              const avgGain = gainResults.reduce((sum, gain) => sum + gain, 0) / gainResults.length;
              deezerData.gain = {
                avg: parseFloat(avgGain.toFixed(1)),
                range: { min: Math.min(...gainResults), max: Math.max(...gainResults) },
                sample_size: gainResults.length
              };
            }

            const dataTypes = [
              bpmResults.length > 0 ? 'BPM' : null,
              rankResults.length > 0 ? 'rank' : null,
              gainResults.length > 0 ? 'gain' : null
            ].filter(Boolean).join(', ');

            await sseWriter.write({ type: 'thinking', data: `✅ Deezer enrichment complete! Found ${dataTypes} for ${enrichedCount}/${tracksToEnrich.length} tracks` });
          } else {
            await sseWriter.write({ type: 'thinking', data: '⚠️ No Deezer data available for these tracks' });
          }
        } catch (error) {
          console.error('[DeezerEnrichment] Failed:', error);
          await sseWriter.write({ type: 'thinking', data: '⚠️ Deezer enrichment unavailable - continuing with metadata only' });
        }
      }

      // Step 7: Optimized Last.fm enrichment (tracks + unique artists separately)
      let lastfmData = null;
      if (env?.LASTFM_API_KEY && env?.AUDIO_FEATURES_CACHE) {
        try {
          const lastfmService = new LastFmService(env.LASTFM_API_KEY, env.AUDIO_FEATURES_CACHE);

          const tracksForLastFm = validTracks.slice(0, 50); // Process up to 50 tracks
          const signalsMap = new Map();

          // Step 7a: Get track signals (4 API calls per track = 200 total)
          await sseWriter.write({ type: 'thinking', data: `🎧 Enriching ${tracksForLastFm.length} tracks with Last.fm data (40 TPS)...` });

          for (let i = 0; i < tracksForLastFm.length; i++) {
            const track = tracksForLastFm[i];

            try {
              const lastfmTrack = {
                name: track.name,
                artist: track.artists?.[0]?.name || 'Unknown',
                duration_ms: track.duration_ms
              };

              // Get track signals WITHOUT artist info (skipArtistInfo=true)
              const signals = await lastfmService.getTrackSignals(lastfmTrack, true);

              if (signals) {
                const key = `${track.id}`;
                signalsMap.set(key, signals);

                // Stream progress every 10 tracks with narrator
                if ((i + 1) % 10 === 0 || i === tracksForLastFm.length - 1) {
                  if (narrator) {
                    const recentTags = signals.top_tags?.slice(0, 3).map(t => t.name).join(', ') || '';
                    const message = await narrator.generateMessage({
                      eventType: 'enriching_tracks',
                      userRequest,
                      metadata: {
                        enrichedCount: i + 1,
                        totalTracks: tracksForLastFm.length,
                        recentTags,
                        recentTrackName: track.name
                      }
                    });
                    await sseWriter.write({ type: 'thinking', data: `🎧 ${message}` });
                  } else {
                    await sseWriter.write({ type: 'thinking', data: `🎧 Track enrichment: ${signalsMap.size}/${tracksForLastFm.length}...` });
                  }
                }
              }

              // Rate limiting: 25ms delay = 40 TPS
              if (i < tracksForLastFm.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 25));
              }
            } catch (error) {
              console.error(`[LastFm] Failed for track ${track.name}:`, error);
            }
          }

          // Step 7b: Get unique artists and fetch artist info separately (cached + rate-limited queue)
          const uniqueArtists = [...new Set(tracksForLastFm.map(t => t.artists?.[0]?.name).filter(Boolean))];
          await sseWriter.write({ type: 'thinking', data: `🎤 Fetching artist info for ${uniqueArtists.length} unique artists...` });

          const artistInfoMap = await lastfmService.batchGetArtistInfo(uniqueArtists, async (current, total) => {
            // Report progress every 10 artists with narrator
            if (current % 10 === 0 || current === total) {
              if (narrator) {
                const recentArtist = uniqueArtists[current - 1];
                const message = await narrator.generateMessage({
                  eventType: 'enriching_artists',
                  userRequest,
                  metadata: {
                    enrichedCount: current,
                    totalArtists: total,
                    recentArtistName: recentArtist
                  }
                });
                await sseWriter.write({ type: 'thinking', data: `🎤 ${message}` });
              } else {
                await sseWriter.write({ type: 'thinking', data: `🎤 Artist enrichment: ${current}/${total}...` });
              }
            }
          });

          // Step 7c: Attach artist info to track signals and update cache
          for (const [trackId, signals] of signalsMap.entries()) {
            const artistKey = signals.canonicalArtist.toLowerCase();
            if (artistInfoMap.has(artistKey)) {
              signals.artistInfo = artistInfoMap.get(artistKey);

              // Update cache with complete signals including artist info
              const cacheKey = lastfmService.generateCacheKey(signals.canonicalArtist, signals.canonicalTrack);
              await lastfmService.updateCachedSignals(cacheKey, signals);
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
              artists_enriched: artistInfoMap.size,
              source: 'lastfm'
            };

            await sseWriter.write({ type: 'thinking', data: `✅ Enriched ${signalsMap.size} tracks + ${artistInfoMap.size} artists!` });
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
        deezer_analysis: deezerData, // Deezer BPM, rank, gain if available
        lastfm_analysis: lastfmData, // Last.fm tags and popularity if available
        track_ids: trackIds,
        message: (() => {
          const sources = [
            deezerData ? `Deezer (${[
              deezerData.bpm ? 'BPM' : null,
              deezerData.rank ? 'rank' : null,
              deezerData.gain ? 'gain' : null
            ].filter(Boolean).join(', ')})` : null,
            lastfmData ? 'Last.fm (tags, popularity)' : null
          ].filter(Boolean);
          return sources.length > 0
            ? `Enriched with ${sources.join(' + ')}! Use get_playlist_tracks for track details.`
            : 'Use get_playlist_tracks to fetch track details in batches, or get_track_details for specific tracks.';
        })()
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

        // Auto-inject playlist ID and apply defaults
        let finalArgs = {
          offset: args.offset ?? 0,
          limit: args.limit ?? 20,
          playlist_id: args.playlist_id
        };

        if (!finalArgs.playlist_id && contextPlaylistId) {
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

    // Note: get_audio_features tool removed - Spotify deprecated this API for apps created after Nov 27, 2024
    // We now use Deezer + Last.fm enrichment instead via analyze_playlist

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
    }),

    new DynamicStructuredTool({
      name: 'extract_playlist_vibe',
      description: 'Use AI to deeply analyze playlist enrichment data and extract subtle vibe signals that go beyond genre tags. Returns natural language vibe profile with discovery hints.',
      schema: z.object({
        analysis_data: z.object({
          metadata_analysis: z.any().optional(),
          deezer_analysis: z.any().optional(),
          lastfm_analysis: z.any().optional()
        }).describe('Full analysis from analyze_playlist'),
        sample_tracks: z.array(z.object({
          name: z.string(),
          artists: z.string(),
          duration_ms: z.number().optional(),
          popularity: z.number().optional()
        })).max(20).optional().describe('Sample track names for additional context')
      }),
      func: async (args) => {
        if (abortSignal?.aborted) throw new Error('Request aborted');

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'extract_playlist_vibe', args: { has_metadata: !!args.analysis_data } }
        });

        await sseWriter.write({
          type: 'thinking',
          data: `🎨 Analyzing playlist vibe using AI...`
        });

        const anthropic = new AnthropicBedrock({
          model: 'claude-sonnet-4-5-20250929',
          anthropicApiKey: env.ANTHROPIC_API_KEY
        });

        const vibePrompt = `You are a music critic analyzing a playlist's vibe. Extract SUBTLE signals that algorithms miss.

METADATA ANALYSIS:
${JSON.stringify(args.analysis_data.metadata_analysis || {}, null, 2)}

DEEZER ANALYSIS (BPM, rank, gain):
${JSON.stringify(args.analysis_data.deezer_analysis || {}, null, 2)}

LAST.FM ANALYSIS (crowd tags, similar tracks):
${JSON.stringify(args.analysis_data.lastfm_analysis || {}, null, 2)}

${args.sample_tracks?.length ? `SAMPLE TRACKS:\n${args.sample_tracks.map(t => `- "${t.name}" by ${t.artists}`).join('\n')}` : ''}

Analyze the VIBE beyond genre tags. Consider:
- Emotional arc: Does energy build or stay constant?
- Production aesthetic: Lo-fi/polished? Analog/digital? Spacious/dense?
- Vocal characteristics: Breathy/powerful? Sparse/prominent? Language?
- Instrumentation: What's dominant? What's missing?
- Era feel: Vintage/modern? Nostalgic/futuristic?
- Mixing philosophy: Bright/warm? Compressed/dynamic?
- Mood progression: Introspective/energetic? Dark/light?
- Song structure: Experimental/traditional? Long/short?
- Cultural context: What scene/movement does this evoke?

Return ONLY valid JSON:
{
  "vibe_profile": "Natural language description of the vibe (2-3 sentences capturing essence)",
  "emotional_characteristics": ["adjective1", "adjective2", ...],
  "production_style": "Description of production aesthetic",
  "vocal_style": "Description of vocal characteristics",
  "instrumentation_notes": "Key instrumentation patterns",
  "era_feel": "Description of temporal feel",
  "discovery_hints": {
    "genre_combinations": ["genre blend 1", "genre blend 2"],
    "avoid_these": ["what NOT to search for"],
    "era_ranges": ["time period to explore"],
    "artist_archetypes": ["types of artists to seek"],
    "spotify_params": {
      "target_energy": 0.7,
      "target_valence": 0.5,
      "target_danceability": 0.6
    }
  }
}`;

        try {
          const response = await anthropic.invoke([
            new SystemMessage('You are a music critic. Return only valid JSON with deep vibe analysis.'),
            new HumanMessage(vibePrompt)
          ]);

          const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in vibe analysis response');
          }

          const vibeAnalysis = JSON.parse(jsonMatch[0]);

          await sseWriter.write({
            type: 'thinking',
            data: `✅ Vibe extracted: ${vibeAnalysis.vibe_profile?.substring(0, 80)}...`
          });

          await sseWriter.write({
            type: 'tool_end',
            data: {
              tool: 'extract_playlist_vibe',
              result: `Analyzed vibe: ${vibeAnalysis.emotional_characteristics?.slice(0, 3).join(', ')}`
            }
          });

          return vibeAnalysis;
        } catch (error) {
          console.error('[extract_playlist_vibe] AI analysis failed:', error);

          // Fallback: Basic analysis from tags
          const tags = args.analysis_data.lastfm_analysis?.crowd_tags?.slice(0, 5).map((t: any) => t.tag) || [];
          const fallbackVibe = {
            vibe_profile: `Playlist characterized by tags: ${tags.join(', ')}`,
            emotional_characteristics: tags,
            production_style: 'Unknown',
            vocal_style: 'Unknown',
            instrumentation_notes: 'Unknown',
            era_feel: 'Unknown',
            discovery_hints: {
              genre_combinations: tags.slice(0, 2),
              avoid_these: [],
              era_ranges: [],
              artist_archetypes: [],
              spotify_params: { target_energy: 0.5, target_valence: 0.5, target_danceability: 0.5 }
            }
          };

          await sseWriter.write({
            type: 'thinking',
            data: `⚠️ Using basic tag analysis (AI unavailable)`
          });

          await sseWriter.write({
            type: 'tool_end',
            data: {
              tool: 'extract_playlist_vibe',
              result: `Basic analysis: ${tags.join(', ')}`
            }
          });

          return fallbackVibe;
        }
      }
    }),

    new DynamicStructuredTool({
      name: 'plan_discovery_strategy',
      description: 'Use AI to create a smart multi-pronged discovery strategy based on vibe analysis. Returns specific search queries and parameters to find interesting recommendations.',
      schema: z.object({
        vibe_profile: z.any().describe('Output from extract_playlist_vibe'),
        user_request: z.string().describe('User\'s original request to understand intent'),
        similar_tracks_available: z.array(z.string()).max(20).optional().describe('Last.fm similar tracks if available')
      }),
      func: async (args) => {
        if (abortSignal?.aborted) throw new Error('Request aborted');

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'plan_discovery_strategy', args: { has_vibe: !!args.vibe_profile } }
        });

        await sseWriter.write({
          type: 'thinking',
          data: `🎯 Planning discovery strategy using AI...`
        });

        const anthropic = new AnthropicBedrock({
          model: 'claude-sonnet-4-5-20250929',
          anthropicApiKey: env.ANTHROPIC_API_KEY
        });

        const strategyPrompt = `You are a music discovery strategist. Create a smart plan to find interesting tracks.

USER REQUEST: "${args.user_request}"

VIBE PROFILE:
${JSON.stringify(args.vibe_profile, null, 2)}

${args.similar_tracks_available?.length ? `LAST.FM SIMILAR TRACKS AVAILABLE:\n${args.similar_tracks_available.slice(0, 10).join('\n')}` : ''}

Create a multi-pronged discovery strategy. Be CREATIVE and STRATEGIC:

1. Which Last.fm similar tracks to prioritize (pick 5-8 most interesting)?
2. What Spotify search queries will find the vibe (NOT just genre tags)?
3. What specific artists/songs to use as seeds for Spotify recommendations?
4. What to AVOID to prevent generic results?

Return ONLY valid JSON:
{
  "strategy_summary": "Brief description of the discovery approach",
  "lastfm_similar_priority": ["Artist - Track", ...],
  "tag_searches": [
    {
      "tags": ["tag1", "tag2"],
      "rationale": "why this combination captures the vibe"
    }
  ],
  "spotify_searches": [
    {
      "query": "search query",
      "rationale": "why this will find interesting tracks"
    }
  ],
  "recommendation_seeds": {
    "approach": "Description of seed selection strategy",
    "parameters": {
      "target_energy": 0.7,
      "target_valence": 0.5,
      "target_danceability": 0.6,
      "target_acousticness": 0.3
    }
  },
  "avoid": ["what to avoid", "generic patterns to skip"]
}`;

        try {
          const response = await anthropic.invoke([
            new SystemMessage('You are a music discovery strategist. Return only valid JSON.'),
            new HumanMessage(strategyPrompt)
          ]);

          const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in strategy response');
          }

          const strategy = JSON.parse(jsonMatch[0]);

          await sseWriter.write({
            type: 'thinking',
            data: `✅ Strategy: ${strategy.strategy_summary?.substring(0, 80)}...`
          });

          await sseWriter.write({
            type: 'tool_end',
            data: {
              tool: 'plan_discovery_strategy',
              result: `Created ${strategy.tag_searches?.length || 0} tag searches, ${strategy.spotify_searches?.length || 0} custom queries`
            }
          });

          return strategy;
        } catch (error) {
          console.error('[plan_discovery_strategy] AI planning failed:', error);

          // Fallback: Basic strategy
          const fallbackStrategy = {
            strategy_summary: 'Using basic tag-based discovery',
            lastfm_similar_priority: args.similar_tracks_available?.slice(0, 5) || [],
            tag_searches: [],
            spotify_searches: [],
            recommendation_seeds: {
              approach: 'Use top tracks as seeds',
              parameters: { target_energy: 0.5, target_valence: 0.5, target_danceability: 0.5 }
            },
            avoid: []
          };

          await sseWriter.write({
            type: 'thinking',
            data: `⚠️ Using basic strategy (AI unavailable)`
          });

          await sseWriter.write({
            type: 'tool_end',
            data: {
              tool: 'plan_discovery_strategy',
              result: 'Basic fallback strategy'
            }
          });

          return fallbackStrategy;
        }
      }
    }),

    new DynamicStructuredTool({
      name: 'recommend_from_similar',
      description: 'Get Spotify track IDs from Last.fm similar tracks. Provide artist-track strings (e.g., "Daft Punk - One More Time") and get back Spotify IDs ready to use.',
      schema: z.object({
        similar_tracks: z.array(z.string()).min(1).max(20).describe('Array of "Artist - Track" strings from Last.fm similar_tracks'),
        limit_per_track: z.number().min(1).max(5).default(1).describe('How many search results to return per track (default 1 = best match)')
      }),
      func: async (args) => {
        if (abortSignal?.aborted) throw new Error('Request aborted');

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'recommend_from_similar', args }
        });

        await sseWriter.write({
          type: 'thinking',
          data: `🔍 Searching Spotify for ${args.similar_tracks.length} Last.fm recommendations...`
        });

        const recommendations: any[] = [];
        let successCount = 0;

        for (const trackString of args.similar_tracks) {
          if (abortSignal?.aborted) break;

          try {
            // Parse "Artist - Track" format
            const parts = trackString.split(' - ');
            if (parts.length < 2) {
              console.warn(`[recommend_from_similar] Invalid format: "${trackString}"`);
              continue;
            }

            const artist = parts[0].trim();
            const track = parts.slice(1).join(' - ').trim();
            const query = `artist:"${artist}" track:"${track}"`;

            // Search Spotify
            const response = await fetch(
              `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${args.limit_per_track}`,
              { headers: { 'Authorization': `Bearer ${spotifyToken}` } }
            );

            if (response.ok) {
              const data = await response.json() as any;
              const tracks = data.tracks?.items || [];

              for (const spotifyTrack of tracks) {
                recommendations.push({
                  id: spotifyTrack.id,
                  name: spotifyTrack.name,
                  artists: spotifyTrack.artists?.map((a: any) => a.name).join(', '),
                  uri: spotifyTrack.uri,
                  popularity: spotifyTrack.popularity,
                  source: 'lastfm_similar',
                  original_query: trackString
                });
              }

              if (tracks.length > 0) successCount++;
            }

            // Rate limiting: 25ms between requests
            await new Promise(resolve => setTimeout(resolve, 25));
          } catch (error) {
            console.error(`[recommend_from_similar] Error searching "${trackString}":`, error);
          }
        }

        await sseWriter.write({
          type: 'thinking',
          data: `✅ Found ${recommendations.length} tracks (${successCount}/${args.similar_tracks.length} successful)`
        });

        await sseWriter.write({
          type: 'tool_end',
          data: {
            tool: 'recommend_from_similar',
            result: `Found ${recommendations.length} Spotify tracks from ${successCount} Last.fm recommendations`
          }
        });

        return {
          tracks: recommendations,
          total_found: recommendations.length,
          queries_successful: successCount,
          queries_total: args.similar_tracks.length
        };
      }
    }),

    new DynamicStructuredTool({
      name: 'recommend_from_tags',
      description: 'Discover tracks based on Last.fm crowd tags/genres. Searches Spotify using tag combinations.',
      schema: z.object({
        tags: z.array(z.string()).min(1).max(5).describe('Genre/mood tags from Last.fm crowd_tags (e.g., ["italo-disco", "80s", "synth-pop"])'),
        limit: z.number().min(1).max(50).default(20).describe('Total number of tracks to return')
      }),
      func: async (args) => {
        if (abortSignal?.aborted) throw new Error('Request aborted');

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'recommend_from_tags', args }
        });

        await sseWriter.write({
          type: 'thinking',
          data: `🏷️ Searching Spotify for tracks matching tags: ${args.tags.join(', ')}`
        });

        // Build Spotify search query from tags
        // Try genre: prefix for recognized genres, otherwise just use as keywords
        const genreKeywords = ['rock', 'pop', 'jazz', 'classical', 'electronic', 'hip-hop', 'indie', 'disco', 'funk', 'soul'];
        const genreTags = args.tags.filter(tag =>
          genreKeywords.some(genre => tag.toLowerCase().includes(genre.toLowerCase()))
        );
        const otherTags = args.tags.filter(tag => !genreTags.includes(tag));

        let query = '';
        if (genreTags.length > 0) {
          query += genreTags.map(tag => `genre:"${tag}"`).join(' OR ');
        }
        if (otherTags.length > 0) {
          if (query) query += ' ';
          query += otherTags.join(' ');
        }

        console.log(`[recommend_from_tags] Search query: ${query}`);

        const response = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${args.limit}`,
          { headers: { 'Authorization': `Bearer ${spotifyToken}` } }
        );

        if (!response.ok) {
          throw new Error(`Spotify search failed: ${response.status}`);
        }

        const data = await response.json() as any;
        const tracks = data.tracks?.items || [];

        const recommendations = tracks.map((track: any) => ({
          id: track.id,
          name: track.name,
          artists: track.artists?.map((a: any) => a.name).join(', '),
          uri: track.uri,
          popularity: track.popularity,
          album: track.album?.name,
          source: 'tag_based',
          matched_tags: args.tags
        }));

        await sseWriter.write({
          type: 'thinking',
          data: `✅ Found ${recommendations.length} tracks matching ${args.tags.length} tags`
        });

        await sseWriter.write({
          type: 'tool_end',
          data: {
            tool: 'recommend_from_tags',
            result: `Found ${recommendations.length} tracks for tags: ${args.tags.join(', ')}`
          }
        });

        return {
          tracks: recommendations,
          total_found: recommendations.length,
          tags_used: args.tags,
          search_query: query
        };
      }
    }),

    new DynamicStructuredTool({
      name: 'curate_recommendations',
      description: 'Use AI to intelligently rank and filter track recommendations based on user criteria and playlist characteristics. Provide tracks and context, get back curated top picks with reasoning.',
      schema: z.object({
        candidate_tracks: z.array(z.object({
          id: z.string(),
          name: z.string(),
          artists: z.string(),
          popularity: z.number().optional(),
          source: z.string().optional()
        })).min(1).max(100).describe('Tracks to curate (from various sources like tag search, similar tracks, Spotify recommendations)'),
        playlist_context: z.object({
          bpm_range: z.object({ min: z.number(), max: z.number() }).optional(),
          dominant_tags: z.array(z.string()).optional(),
          avg_popularity: z.number().optional(),
          era: z.string().optional()
        }).describe('Context from analyze_playlist to guide curation'),
        user_request: z.string().describe('User\'s original request to understand intent'),
        top_n: z.number().min(1).max(50).default(10).describe('How many curated recommendations to return')
      }),
      func: async (args) => {
        if (abortSignal?.aborted) throw new Error('Request aborted');

        await sseWriter.write({
          type: 'tool_start',
          data: { tool: 'curate_recommendations', args: { track_count: args.candidate_tracks.length, top_n: args.top_n } }
        });

        await sseWriter.write({
          type: 'thinking',
          data: `🤖 Using AI to curate ${args.top_n} best picks from ${args.candidate_tracks.length} candidates...`
        });

        // Use Claude Sonnet 4.5 for high-quality intelligent curation
        const anthropic = new AnthropicBedrock({
          model: 'claude-sonnet-4-5-20250929',
          anthropicApiKey: env.ANTHROPIC_API_KEY
        });

        const curationPrompt = `You are a music curator helping select the best track recommendations.

USER REQUEST: "${args.user_request}"

PLAYLIST CONTEXT:
${args.playlist_context.bpm_range ? `BPM Range: ${args.playlist_context.bpm_range.min}-${args.playlist_context.bpm_range.max}` : ''}
${args.playlist_context.dominant_tags?.length ? `Dominant Tags: ${args.playlist_context.dominant_tags.join(', ')}` : ''}
${args.playlist_context.avg_popularity ? `Average Popularity: ${args.playlist_context.avg_popularity}/100` : ''}
${args.playlist_context.era ? `Era: ${args.playlist_context.era}` : ''}

CANDIDATE TRACKS (${args.candidate_tracks.length} total):
${args.candidate_tracks.slice(0, 50).map((t, i) =>
  `${i + 1}. "${t.name}" by ${t.artists} (popularity: ${t.popularity || 'unknown'}, source: ${t.source || 'unknown'})`
).join('\n')}
${args.candidate_tracks.length > 50 ? `\n... and ${args.candidate_tracks.length - 50} more` : ''}

Select the top ${args.top_n} tracks that best match the user's request and playlist context.
Consider: genre fit, era match, popularity balance, diversity, and relevance to user intent.

Return ONLY a JSON object with this structure:
{
  "selected_track_ids": ["id1", "id2", ...],
  "reasoning": "Brief explanation of selection criteria in 1-2 sentences"
}`;

        try {
          const response = await anthropic.invoke([
            new SystemMessage('You are a music curator. Return only valid JSON.'),
            new HumanMessage(curationPrompt)
          ]);

          console.log(`[curate_recommendations] Claude response:`, response.content);

          // Parse JSON from response
          const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in response');
          }

          const curation = JSON.parse(jsonMatch[0]);
          const selectedIds = curation.selected_track_ids || [];
          const reasoning = curation.reasoning || 'AI curation complete';

          // Filter candidate tracks to only selected ones
          const curatedTracks = args.candidate_tracks.filter(t => selectedIds.includes(t.id));

          // Preserve order from AI selection
          const orderedTracks = selectedIds
            .map(id => curatedTracks.find(t => t.id === id))
            .filter(Boolean);

          await sseWriter.write({
            type: 'thinking',
            data: `✅ Curated ${orderedTracks.length} top picks: ${reasoning}`
          });

          await sseWriter.write({
            type: 'tool_end',
            data: {
              tool: 'curate_recommendations',
              result: `Curated ${orderedTracks.length} tracks using AI`
            }
          });

          return {
            curated_tracks: orderedTracks,
            total_curated: orderedTracks.length,
            original_count: args.candidate_tracks.length,
            reasoning: reasoning
          };
        } catch (error) {
          console.error('[curate_recommendations] AI curation failed:', error);

          // Fallback: Sort by popularity and return top N
          const fallbackTracks = args.candidate_tracks
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .slice(0, args.top_n);

          await sseWriter.write({
            type: 'thinking',
            data: `⚠️ AI curation unavailable, using popularity-based ranking`
          });

          await sseWriter.write({
            type: 'tool_end',
            data: {
              tool: 'curate_recommendations',
              result: `Fallback: Sorted ${fallbackTracks.length} tracks by popularity`
            }
          });

          return {
            curated_tracks: fallbackTracks,
            total_curated: fallbackTracks.length,
            original_count: args.candidate_tracks.length,
            reasoning: 'Ranked by popularity (AI curation unavailable)'
          };
        }
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
        // Note: Cannot use both temperature and topP with Sonnet 4.5
      });

      const modelWithTools = llm.bindTools(tools);

      // Build system prompt
      const systemPrompt = `You are an AI DJ assistant with access to Spotify.

IMPORTANT: Spotify deprecated their audio features API on Nov 27, 2024. We now use Deezer + Last.fm APIs for enrichment!

analyze_playlist now returns FOUR types of data:
1. metadata_analysis (always available):
   - Popularity (0-100 score based on play counts)
   - Genres (from artist data)
   - Release year range (oldest to newest)
   - Average track duration
   - Explicit content percentage

2. deezer_analysis (if KV cache configured):
   - bpm: { avg, range, sample_size } - Beats per minute when available (often null)
   - rank: { avg, range, sample_size } - Deezer popularity rank (higher = more popular)
   - gain: { avg, range, sample_size } - Audio normalization level in dB
   - tracks_found: Number of tracks matched in Deezer
   - source: 'deezer'

3. lastfm_analysis (if LASTFM_API_KEY configured):
   - crowd_tags: Most common tags/genres/moods from Last.fm community (e.g., ["electronic", "chill", "dance"])
   - avg_listeners: Average Last.fm listeners per track
   - avg_playcount: Average Last.fm playcounts
   - similar_tracks: Recommended similar tracks for transitions
   - source: 'lastfm'

ITERATIVE DATA FETCHING WORKFLOW:
1. analyze_playlist returns SUMMARY with metadata + Deezer + Last.fm analysis (if available) + track_ids
2. get_playlist_tracks gets compact track info in batches (20 at a time)
3. get_track_details gets full metadata when needed (album art, release dates, etc.)

This allows you to fetch as much or as little detail as needed for the user's question.

${playlistId ? `CONTEXT: User has selected playlist ID: ${playlistId}

WORKFLOW FOR THIS PLAYLIST:
1. If user asks about the playlist, start with: analyze_playlist({"playlist_id": "${playlistId}"})
2. analyze_playlist returns:
   - metadata_analysis with avg_popularity, top_genres, release_year_range, etc.
   - deezer_analysis (if available) with BPM, rank (popularity), gain (loudness)
   - lastfm_analysis (if available) with crowd_tags, similar_tracks, popularity metrics
3. To see track names: get_playlist_tracks({"playlist_id": "${playlistId}", "offset": 0, "limit": 20})
4. To get more tracks: use different offset (20, 40, 60, etc.)
5. For specific track details: get_track_details({"track_ids": ["id1", "id2", ...]})

EXAMPLE QUESTIONS & RESPONSES:
- "What's the tempo?" → If deezer_analysis.bpm exists, use that. Otherwise: "BPM data not available for most tracks. Based on genres [list genres], this appears to be [describe style and likely tempo]."
- "What's the vibe?" → Use metadata, Deezer rank/BPM, and Last.fm crowd_tags to describe the vibe
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

RECOMMENDATION WORKFLOW (VIBE-DRIVEN DISCOVERY):
When user asks for track recommendations, use this INTELLIGENT multi-step workflow:

PHASE 1: DEEP ANALYSIS
1. analyze_playlist → Get enrichment data (metadata, Deezer BPM/rank, Last.fm tags/similar tracks)
2. get_playlist_tracks → Get sample track names (first 10-20 for context)
3. extract_playlist_vibe → AI analyzes subtle vibe signals beyond genre
   - Takes: Full analysis data + sample tracks
   - Returns: Vibe profile with emotional characteristics, production style, era feel
   - Provides discovery hints (genre combinations, Spotify parameters, what to avoid)

PHASE 2: STRATEGIC PLANNING
4. plan_discovery_strategy → AI creates smart discovery plan
   - Takes: Vibe profile + user request + available Last.fm similar tracks
   - Returns: Multi-pronged strategy with:
     * Prioritized Last.fm similar tracks (5-8 most interesting)
     * Creative Spotify search queries (NOT just genre tags)
     * Tag combinations with rationale
     * Recommendation seed parameters tuned to vibe
     * What to AVOID to prevent generic results

PHASE 3: EXECUTION
Execute strategy from plan_discovery_strategy:
5a. recommend_from_similar(strategy.lastfm_similar_priority) → Spotify IDs from curated Last.fm picks
5b. For each spotify_searches: search_spotify_tracks(query) → Creative query results
5c. For each tag_searches: recommend_from_tags(tags) → Genre blend discoveries
5d. get_recommendations(seeds, strategy.recommendation_seeds.parameters) → Algorithm with tuned params

PHASE 4: INTELLIGENT CURATION
6. curate_recommendations → AI ranks ALL candidates
   - Takes: Combined tracks + vibe profile + strategy + user request
   - Uses Sonnet 4.5 to select based on:
     * Vibe alignment (production style, emotional feel, era)
     * Strategic fit (follows discovery plan rationale)
     * Diversity vs cohesion balance
     * User intent understanding
   - Returns: Top N with detailed reasoning

7. PRESENT curated picks with vibe-aware explanation

EXAMPLE: "Find tracks like this playlist"
1. analyze_playlist → enrichment data
2. get_playlist_tracks(limit=15) → sample track names
3. extract_playlist_vibe → "Nostalgic 80s synth-pop with lo-fi production, breathy vocals, warm analog sound"
4. plan_discovery_strategy → Strategy: "Focus on modern lo-fi producers with 80s influence, avoid overly polished tracks"
5. Execute:
   - Last.fm priority tracks (8) + Tag search "lo-fi synth-pop retro" (20) + Creative query "year:2018-2024 analog synth bedroom pop" (10) + Recommendations with target_acousticness=0.7
6. curate_recommendations(58 candidates) → Top 10 that match lo-fi nostalgic vibe
7. Present with reasoning about vibe fit

KEY INSIGHT: Sonnet 4.5 UNDERSTANDS the vibe BEFORE searching, then PLANS strategic discovery, preventing generic algorithm trap.

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

      // Agentic loop: Keep executing tools until Claude stops requesting them
      let conversationMessages = [...messages];
      let currentToolCalls = toolCalls;
      let turnCount = 0;
      const MAX_TURNS = 5; // Prevent infinite loops - reduced from 15
      const recentToolCalls: string[] = []; // Track recent tool calls to detect loops

      while (currentToolCalls.length > 0 && turnCount < MAX_TURNS) {
        turnCount++;

        // Detect loops: if same tool with same args called 3+ times in a row, break
        // Include args in signature to allow multiple calls with different parameters
        const toolSignature = currentToolCalls.map(tc => {
          const argsStr = JSON.stringify(tc.args || {});
          return `${tc.name}(${argsStr})`;
        }).join(',');
        recentToolCalls.push(toolSignature);
        if (recentToolCalls.length >= 3) {
          const lastThree = recentToolCalls.slice(-3);
          if (lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
            console.warn(`[Stream:${requestId}] ⚠️ Loop detected: identical tool calls 3 times in a row. Breaking.`);
            console.warn(`[Stream:${requestId}] Tool signature: ${lastThree[0]}`);
            await sseWriter.write({ type: 'thinking', data: 'Detected repetitive tool calls, wrapping up...' });
            break;
          }
        }

        console.log(`[Stream:${requestId}] 🔄 Agentic loop turn ${turnCount}: Executing ${currentToolCalls.length} tool calls...`);
        await sseWriter.write({ type: 'thinking', data: 'Using Spotify tools...' });

        // Execute tools and build ToolMessages properly
        const toolMessages = [];
        for (const toolCall of currentToolCalls) {
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

        // Get next response with tool results
        console.log(`[Stream:${requestId}] Getting next response from Claude (turn ${turnCount})...`);
        await sseWriter.write({ type: 'thinking', data: 'Preparing response...' });

        console.log(`[Stream:${requestId}] Sending tool results back to Claude...`);
        console.log(`[Stream:${requestId}] Full response so far: "${fullResponse.substring(0, 100)}"`);

        // Build the conversation including tool results
        const aiMessageContent = fullResponse || '';
        console.log(`[Stream:${requestId}] Creating AIMessage with content length: ${aiMessageContent.length}, tool calls: ${currentToolCalls.length}`);

        // Add the AI's message with tool calls
        conversationMessages.push(new AIMessage({ content: aiMessageContent, tool_calls: currentToolCalls }));
        // Add the tool results
        conversationMessages.push(...toolMessages);

        console.log(`[Stream:${requestId}] Conversation now has ${conversationMessages.length} messages`);

        console.log(`[Stream:${requestId}] Attempting to get next response from Claude...`);
        console.log(`[Stream:${requestId}] Message structure (last 5):`);
        conversationMessages.slice(-5).forEach((msg, i) => {
          const msgType = msg.constructor.name;
          const contentPreview = msg.content?.toString().slice(0, 200) || 'no content';
          console.log(`[Stream:${requestId}]   ${conversationMessages.length - 5 + i}: ${msgType} - ${contentPreview}`);
          if (msgType === 'ToolMessage') {
            console.log(`[Stream:${requestId}]     Tool call ID: ${(msg as any).tool_call_id}`);
            console.log(`[Stream:${requestId}]     Content length: ${msg.content?.toString().length || 0}`);
          } else if (msgType === 'AIMessage' && (msg as any).tool_calls) {
            console.log(`[Stream:${requestId}]     Tool calls: ${(msg as any).tool_calls.map((tc: any) => `${tc.name}(id:${tc.id})`).join(', ')}`);
          }
        });

        const nextResponse = await modelWithTools.stream(conversationMessages, { signal: abortController.signal });

        fullResponse = '';
        let nextChunkCount = 0;
        let nextToolCalls: any[] = [];
        console.log(`[Stream:${requestId}] Streaming response from Claude (turn ${turnCount})...`);
        let contentStarted = false;

        for await (const chunk of nextResponse) {
          if (abortController.signal.aborted) {
            throw new Error('Request aborted');
          }

          nextChunkCount++;
          // Log ALL chunks to see what Claude is actually sending
          const contentPreview = typeof chunk.content === 'string'
            ? chunk.content.substring(0, 100)
            : Array.isArray(chunk.content)
            ? JSON.stringify(chunk.content).substring(0, 100)
            : chunk.content
            ? String(chunk.content).substring(0, 100)
            : 'no content';

          console.log(`[Stream:${requestId}] Turn ${turnCount} chunk ${nextChunkCount}:`, {
            hasContent: !!chunk.content,
            contentLength: typeof chunk.content === 'string' ? chunk.content.length : 0,
            chunkKeys: Object.keys(chunk),
            chunkContent: contentPreview,
            hasToolCalls: !!chunk.tool_calls
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
              console.log(`[Stream:${requestId}] CONTENT STARTED at turn ${turnCount} chunk ${nextChunkCount}: ${textContent.substring(0, 100)}`);
              contentStarted = true;
            }
            fullResponse += textContent;
            await sseWriter.write({ type: 'content', data: textContent });
          }

          // Check for MORE tool calls in the response
          if (chunk.tool_calls && chunk.tool_calls.length > 0) {
            nextToolCalls = chunk.tool_calls;
            console.log(`[Stream:${requestId}] ⚠️ Additional tool calls detected (turn ${turnCount}): ${chunk.tool_calls.map((tc: any) => tc.name).join(', ')}`);
          }
        }
        console.log(`[Stream:${requestId}] Turn ${turnCount} complete. Chunks: ${nextChunkCount}, Content: ${fullResponse.length} chars, Next tool calls: ${nextToolCalls.length}`);

        // Update for next iteration
        currentToolCalls = nextToolCalls;
      }

      // Check if we hit the max turns limit or loop detection
      if (turnCount >= MAX_TURNS || fullResponse.length === 0) {
        console.warn(`[Stream:${requestId}] ⚠️ Hit limit (${turnCount} turns). Requesting final response from Claude...`);

        // Ask Claude to provide a response based on what it has learned
        const finalPrompt = new HumanMessage(
          "Please provide your response based on the information you've gathered from the tools you've used."
        );
        conversationMessages.push(finalPrompt);

        await sseWriter.write({ type: 'thinking', data: 'Preparing final response...' });

        const finalResponse = await modelWithTools.stream(conversationMessages, { signal: abortController.signal });

        fullResponse = '';
        for await (const chunk of finalResponse) {
          if (abortController.signal.aborted) {
            throw new Error('Request aborted');
          }

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
          }
        }

        console.log(`[Stream:${requestId}] Final response after limit: ${fullResponse.length} chars`);
      }

      console.log(`[Stream:${requestId}] Agentic loop complete after ${turnCount} turns`);

      // If still no response after everything, provide fallback
      if (fullResponse.length === 0) {
        console.error(`[Stream:${requestId}] WARNING: No content received from Claude!`);
        await sseWriter.write({ type: 'content', data: 'I apologize, but I encountered an issue generating a response. Please try again.' });
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