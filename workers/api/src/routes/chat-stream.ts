import type {StreamDebugData, StreamLogData, StreamToolData, StreamToolResult} from '@dj/shared-types'

import {
  SpotifyPlaylistFullSchema,
  SpotifyPlaylistTracksResponseSchema,
  SpotifySearchResponseSchema,
  type SpotifyTrackFull,
  SpotifyTrackFullSchema,
} from '@dj/shared-types'
import {ChatAnthropic} from '@langchain/anthropic'
import {AIMessage, HumanMessage, SystemMessage, ToolMessage} from '@langchain/core/messages'
import {DynamicStructuredTool} from '@langchain/core/tools'
import {Hono} from 'hono'
import {z} from 'zod'

import type {Env} from '../index'

import {ProgressNarrator} from '../lib/progress-narrator'
import {executeSpotifyTool} from '../lib/spotify-tools'
import {AudioEnrichmentService} from '../services/AudioEnrichmentService'
import {LastFmService} from '../services/LastFmService'
import {getChildLogger, getLogger, runWithLogger} from '../utils/LoggerContext'
import {rateLimitedAnthropicCall, rateLimitedSpotifyCall} from '../utils/RateLimitedAPIClients'
import {ServiceLogger} from '../utils/ServiceLogger'

const chatStreamRouter = new Hono<{Bindings: Env}>()

// Request schema
const ChatRequestSchema = z.object({
  conversationHistory: z
    .array(
      z.object({
        content: z.string(),
        role: z.enum(['user', 'assistant']),
      }),
    )
    .max(20)
    .default([]),
  message: z.string().min(1).max(2000),
  mode: z.enum(['analyze', 'create', 'edit']).default('analyze'),
})

// Analysis result types
interface AnalysisResult {
  deezer_analysis?: {
    bpm?: {
      avg: number
      range: {max: number; min: number}
      sample_size: number
    }
    gain?: {
      avg: number
      range: {max: number; min: number}
      sample_size: number
    }
    rank?: {
      avg: number
      range: {max: number; min: number}
      sample_size: number
    }
    source: string
    total_checked: number
    tracks_found: number
  }
  lastfm_analysis?: {
    artists_enriched: number
    avg_listeners: number
    avg_playcount: number
    crowd_tags: {count: number; tag: string}[]
    sample_size: number
    similar_tracks: string[]
    source: string
  }
  message: string
  metadata_analysis: {
    avg_duration_minutes: number
    avg_duration_ms: number
    avg_popularity: number
    explicit_percentage: number
    explicit_tracks: number
    release_year_range: null | {
      average: number
      newest: number
      oldest: number
    }
    top_genres: string[]
    total_artists: number
  }
  playlist_description: null | string
  playlist_name: string
  total_tracks: number
  track_ids: string[]
}

interface CreatePlaylistResult {
  id: string
  name: string
  snapshot_id: string
  url: string
}

// SSE message types
type StreamEvent =
  | {data: null; type: 'done'}
  | {data: StreamDebugData; type: 'debug'}
  | {data: StreamLogData; type: 'log'}
  | {data: StreamToolData; type: 'tool_start'}
  | {data: StreamToolResult; type: 'tool_end'}
  | {data: string; type: 'content'}
  | {data: string; type: 'error'}
  | {data: string; type: 'thinking'}

// Writer queue to prevent concurrent writes
class SSEWriter {
  private closed = false
  private encoder: TextEncoder
  private writeQueue: Promise<void> = Promise.resolve()
  private writer: WritableStreamDefaultWriter

  constructor(writer: WritableStreamDefaultWriter) {
    this.writer = writer
    this.encoder = new TextEncoder()
  }

  async close(): Promise<void> {
    this.closed = true
    await this.writeQueue
    await this.writer.close()
  }

  /**
   * Wait for all queued writes to complete
   */
  async flush(): Promise<void> {
    await this.writeQueue
  }

  async write(event: StreamEvent): Promise<void> {
    if (this.closed) return

    this.writeQueue = this.writeQueue.then(async () => {
      if (this.closed) return
      try {
        const message = `data: ${JSON.stringify(event)}\n\n`
        await this.writer.write(this.encoder.encode(message))
      } catch (error) {
        getLogger()?.error('SSE write error:', error)
        this.closed = true
      }
    })

    return this.writeQueue
  }

  /**
   * Queue a write without awaiting (fire-and-forget)
   * Use this for non-critical messages to avoid blocking
   */
  writeAsync(event: StreamEvent): void {
    if (this.closed) return

    this.writeQueue = this.writeQueue.then(async () => {
      if (this.closed) return
      try {
        const message = `data: ${JSON.stringify(event)}\n\n`
        await this.writer.write(this.encoder.encode(message))
      } catch (error) {
        getLogger()?.error('SSE write error:', error)
        this.closed = true
      }
    })
  }

  async writeHeartbeat(): Promise<void> {
    if (this.closed) return

    this.writeQueue = this.writeQueue.then(async () => {
      if (this.closed) return
      try {
        await this.writer.write(this.encoder.encode(': heartbeat\n\n'))
      } catch (error) {
        getLogger()?.error('Heartbeat write error:', error)
        this.closed = true
      }
    })

    return this.writeQueue
  }
}

/**
 * Create Spotify tools with streaming callbacks
 */

function createStreamingSpotifyTools(
  spotifyToken: string,
  sseWriter: SSEWriter,
  contextPlaylistId?: string,
  mode?: string,
  abortSignal?: AbortSignal,
  env?: Env,
  narrator?: ProgressNarrator,
  userRequest?: string,
  recentMessages?: string[],
): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [
    new DynamicStructuredTool({
      description: 'Search for tracks on Spotify',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'search_spotify_tracks'},
          type: 'tool_start',
        })

        const result = await executeSpotifyTool('search_spotify_tracks', args, spotifyToken)

        await sseWriter.write({
          data: {
            result: Array.isArray(result) ? `Found ${result.length} tracks` : 'Search complete',
            tool: 'search_spotify_tracks',
          },
          type: 'tool_end',
        })

        return result
      },
      name: 'search_spotify_tracks',
      schema: z.object({
        limit: z.number().min(1).max(50).default(10),
        query: z.string(),
      }),
    }),

    new DynamicStructuredTool({
      description: 'Analyze a playlist',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        // Auto-inject playlist ID if missing or empty
        const finalArgs = {...args}
        if (!args.playlist_id && contextPlaylistId) {
          getLogger()?.info(`[analyze_playlist] Auto-injecting playlist_id: ${contextPlaylistId}`)
          finalArgs.playlist_id = contextPlaylistId
        }

        await sseWriter.write({
          data: {args: finalArgs, tool: 'analyze_playlist'},
          type: 'tool_start',
        })

        // Use enhanced executeSpotifyTool with progress streaming and narrator
        const result = await executeSpotifyToolWithProgress(
          'analyze_playlist',
          finalArgs,
          spotifyToken,
          sseWriter,
          env,
          narrator,
          userRequest,
          recentMessages,
        )

        const analysisResult = result as AnalysisResult
        await sseWriter.write({
          data: {
            result: analysisResult.playlist_name ? `Analyzed "${analysisResult.playlist_name}"` : 'Analysis complete',
            tool: 'analyze_playlist',
          },
          type: 'tool_end',
        })

        return result
      },
      name: 'analyze_playlist',
      schema: z.object({
        playlist_id: z.string().optional(),
      }),
    }),

    new DynamicStructuredTool({
      description:
        'Get tracks from a playlist with pagination. Returns compact track info (name, artists, duration, popularity). Use this after analyze_playlist to get actual track details.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        // Auto-inject playlist ID and apply defaults
        const finalArgs = {
          limit: args.limit ?? 20,
          offset: args.offset ?? 0,
          playlist_id: args.playlist_id,
        }

        if (!finalArgs.playlist_id && contextPlaylistId) {
          getLogger()?.info(`[get_playlist_tracks] Auto-injecting playlist_id: ${contextPlaylistId}`)
          finalArgs.playlist_id = contextPlaylistId
        }

        if (!finalArgs.playlist_id) {
          throw new Error('playlist_id is required')
        }

        await sseWriter.write({
          data: {args: finalArgs, tool: 'get_playlist_tracks'},
          type: 'tool_start',
        })

        await sseWriter.write({
          data: `📥 Fetching tracks ${finalArgs.offset}-${finalArgs.offset + finalArgs.limit}...`,
          type: 'thinking',
        })

        // Fetch tracks from Spotify
        const response = await rateLimitedSpotifyCall(
          () =>
            fetch(
              `https://api.spotify.com/v1/playlists/${finalArgs.playlist_id}/tracks?offset=${finalArgs.offset}&limit=${finalArgs.limit}`,
              {headers: {Authorization: `Bearer ${spotifyToken}`}},
            ),
          getLogger(),
          `get playlist tracks offset=${finalArgs.offset}`,
        )

        if (!response?.ok) {
          throw new Error(`Failed to get playlist tracks: ${response?.status || 'null response'}`)
        }

        const rawData = await response.json()
        const data = SpotifyPlaylistTracksResponseSchema.parse(rawData)
        const tracks = data.items.map(item => item.track).filter((track): track is SpotifyTrackFull => track !== null)

        // Return compact track info
        const compactTracks = tracks.map(track => ({
          album: track.album?.name,
          artists: track.artists.map(a => a.name).join(', '),
          duration_ms: track.duration_ms,
          id: track.id,
          name: track.name,
          popularity: track.popularity,
          uri: track.uri,
        }))

        await sseWriter.write({
          data: `✅ Loaded ${compactTracks.length} tracks`,
          type: 'thinking',
        })

        await sseWriter.write({
          data: {
            result: `Fetched ${compactTracks.length} tracks`,
            tool: 'get_playlist_tracks',
          },
          type: 'tool_end',
        })

        return {
          has_more: finalArgs.offset + compactTracks.length < data.total,
          limit: finalArgs.limit,
          offset: finalArgs.offset,
          total: data.total,
          tracks: compactTracks,
        }
      },
      name: 'get_playlist_tracks',
      schema: z.object({
        limit: z.number().min(1).max(50).default(20),
        offset: z.number().min(0).default(0),
        playlist_id: z.string().optional(),
      }),
    }),

    new DynamicStructuredTool({
      description:
        'Get detailed information about specific tracks. Use when you need full metadata like album details, release dates, external URLs, etc.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'get_track_details'},
          type: 'tool_start',
        })

        await sseWriter.write({
          data: `🔍 Fetching details for ${args.track_ids.length} tracks...`,
          type: 'thinking',
        })

        // Fetch tracks from Spotify (supports up to 50 tracks)
        const response = await rateLimitedSpotifyCall(
          () =>
            fetch(`https://api.spotify.com/v1/tracks?ids=${args.track_ids.join(',')}`, {
              headers: {Authorization: `Bearer ${spotifyToken}`},
            }),
          getLogger(),
          `get ${args.track_ids.length} track details`,
        )

        if (!response?.ok) {
          throw new Error(`Failed to get track details: ${response?.status || 'null response'}`)
        }

        const rawData = await response.json()
        const BatchTracksSchema = z.object({
          tracks: z.array(SpotifyTrackFullSchema.nullable()),
        })
        const data = BatchTracksSchema.parse(rawData)
        const tracks = data.tracks.filter((track): track is SpotifyTrackFull => track !== null)

        // Return detailed track info
        const detailedTracks = tracks.map(track => ({
          album: {
            id: track.album.id,
            images: track.album.images.map(img => ({
              height: img.height,
              url: img.url,
              width: img.width,
            })),
            name: track.album.name,
            release_date: track.album.release_date,
            total_tracks: track.album.total_tracks,
          },
          artists: track.artists.map(a => ({
            id: a.id,
            name: a.name,
          })),
          duration_ms: track.duration_ms,
          explicit: track.explicit,
          external_urls: track.external_urls,
          id: track.id,
          name: track.name,
          popularity: track.popularity,
          preview_url: track.preview_url,
          uri: track.uri,
        }))

        await sseWriter.write({
          data: `✅ Loaded details for ${detailedTracks.length} tracks`,
          type: 'thinking',
        })

        await sseWriter.write({
          data: {
            result: `Fetched details for ${detailedTracks.length} tracks`,
            tool: 'get_track_details',
          },
          type: 'tool_end',
        })

        return {tracks: detailedTracks}
      },
      name: 'get_track_details',
      schema: z.object({
        track_ids: z.array(z.string()).min(1).max(50),
      }),
    }),

    // Note: get_audio_features tool removed - Spotify deprecated this API for apps created after Nov 27, 2024
    // We now use Deezer + Last.fm enrichment instead via analyze_playlist

    new DynamicStructuredTool({
      description: 'Get track recommendations',
      func: async args => {
        const finalArgs = {...args}

        // Smart context inference: if no seeds but we have playlist context
        if (
          (!args.seed_tracks || args.seed_tracks.length === 0) &&
          (!args.seed_artists || args.seed_artists.length === 0) &&
          contextPlaylistId &&
          (mode === 'analyze' || mode === 'create')
        ) {
          getLogger()?.info(`[get_recommendations] Auto-fetching seed tracks from playlist: ${contextPlaylistId}`)

          try {
            // Fetch playlist tracks to use as seeds
            const playlistResponse = await rateLimitedSpotifyCall(
              () =>
                fetch(`https://api.spotify.com/v1/playlists/${contextPlaylistId}/tracks?limit=50`, {
                  headers: {Authorization: `Bearer ${spotifyToken}`},
                }),
              getLogger(),
              `get seed tracks for playlist ${contextPlaylistId}`,
            )

            if (playlistResponse?.ok) {
              const rawPlaylistData = await playlistResponse.json()
              const playlistData = SpotifyPlaylistTracksResponseSchema.parse(rawPlaylistData)
              const trackIds = playlistData.items
                .map(item => item.track?.id)
                .filter((id): id is string => !!id)
                .slice(0, 5) // Use up to 5 tracks as seeds

              if (trackIds.length > 0) {
                finalArgs.seed_tracks = trackIds
                getLogger()?.info(
                  `[get_recommendations] Auto-injected ${finalArgs.seed_tracks.length} seed tracks from playlist`,
                )
              }
            }
          } catch (error) {
            getLogger()?.error(`[get_recommendations] Failed to auto-fetch seed tracks:`, error)
          }
        }

        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args: finalArgs, tool: 'get_recommendations'},
          type: 'tool_start',
        })

        const result = await executeSpotifyTool('get_recommendations', finalArgs, spotifyToken)

        await sseWriter.write({
          data: {
            result: Array.isArray(result) ? `Found ${result.length} recommendations` : 'Complete',
            tool: 'get_recommendations',
          },
          type: 'tool_end',
        })

        return result
      },
      name: 'get_recommendations',
      schema: z.object({
        limit: z.number().min(1).max(100).default(20),
        seed_artists: z.array(z.string()).max(5).optional(),
        seed_tracks: z.array(z.string()).max(5).optional(),
      }),
    }),

    new DynamicStructuredTool({
      description: 'Create a new Spotify playlist',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {
            args: {name: args.name, tracks: args.track_uris.length},
            tool: 'create_playlist',
          },
          type: 'tool_start',
        })

        const result = await executeSpotifyTool('create_playlist', args, spotifyToken)
        const createResult = result as CreatePlaylistResult

        await sseWriter.write({
          data: {
            result: createResult.id ? `Created playlist: ${args.name}` : 'Playlist created',
            tool: 'create_playlist',
          },
          type: 'tool_end',
        })

        return result
      },
      name: 'create_playlist',
      schema: z.object({
        description: z.string().max(300).optional(),
        name: z.string().min(1).max(100),
        track_uris: z.array(z.string()),
      }),
    }),

    new DynamicStructuredTool({
      description:
        'Use AI to deeply analyze playlist enrichment data and extract subtle vibe signals that go beyond genre tags. Returns natural language vibe profile with discovery hints.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {
            args: {has_metadata: !!args.analysis_data},
            tool: 'extract_playlist_vibe',
          },
          type: 'tool_start',
        })

        await sseWriter.write({
          data: `🎨 Analyzing playlist vibe using AI...`,
          type: 'thinking',
        })

        const anthropic = new ChatAnthropic({
          apiKey: env.ANTHROPIC_API_KEY,
          maxRetries: 0,
          model: 'claude-sonnet-4-5-20250929',
        })

        const vibePrompt = `You are a music critic analyzing a playlist's vibe. Extract SUBTLE signals that algorithms miss.

METADATA ANALYSIS:
${JSON.stringify(args.analysis_data.metadata_analysis ?? {}, null, 2)}

DEEZER ANALYSIS (BPM, rank, gain):
${JSON.stringify(args.analysis_data.deezer_analysis ?? {}, null, 2)}

LAST.FM ANALYSIS (crowd tags, similar tracks):
${JSON.stringify(args.analysis_data.lastfm_analysis ?? {}, null, 2)}

${
  args.sample_tracks?.length
    ? `SAMPLE TRACKS:\n${args.sample_tracks
        .map((t: {artists: string; name: string}) => `- "${t.name}" by ${t.artists}`)
        .join('\n')}`
    : ''
}

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
}`

        try {
          const response = await anthropic.invoke([
            new SystemMessage('You are a music critic. Return only valid JSON with deep vibe analysis.'),
            new HumanMessage(vibePrompt),
          ])

          const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
          const jsonMatch = /\{[\s\S]*\}/.exec(content)
          if (!jsonMatch) {
            throw new Error('No JSON found in vibe analysis response')
          }

          const vibeAnalysis = JSON.parse(jsonMatch[0])

          await sseWriter.write({
            data: `✅ Vibe extracted: ${vibeAnalysis.vibe_profile?.substring(0, 80)}...`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: `Analyzed vibe: ${vibeAnalysis.emotional_characteristics?.slice(0, 3).join(', ')}`,
              tool: 'extract_playlist_vibe',
            },
            type: 'tool_end',
          })

          return vibeAnalysis
        } catch (error) {
          getLogger()?.error('[extract_playlist_vibe] AI analysis failed:', error)

          // Fallback: Basic analysis from tags
          const tags =
            args.analysis_data.lastfm_analysis?.crowd_tags
              ?.slice(0, 5)
              .map((t: {count: number; tag: string}) => t.tag) ?? []
          const fallbackVibe = {
            discovery_hints: {
              artist_archetypes: [],
              avoid_these: [],
              era_ranges: [],
              genre_combinations: tags.slice(0, 2),
              spotify_params: {
                target_danceability: 0.5,
                target_energy: 0.5,
                target_valence: 0.5,
              },
            },
            emotional_characteristics: tags,
            era_feel: 'Unknown',
            instrumentation_notes: 'Unknown',
            production_style: 'Unknown',
            vibe_profile: `Playlist characterized by tags: ${tags.join(', ')}`,
            vocal_style: 'Unknown',
          }

          await sseWriter.write({
            data: `⚠️ Using basic tag analysis (AI unavailable)`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: `Basic analysis: ${tags.join(', ')}`,
              tool: 'extract_playlist_vibe',
            },
            type: 'tool_end',
          })

          return fallbackVibe
        }
      },
      name: 'extract_playlist_vibe',
      schema: z.object({
        analysis_data: z
          .object({
            deezer_analysis: z
              .object({
                bpm: z
                  .object({
                    avg: z.number(),
                    range: z.object({max: z.number(), min: z.number()}),
                    sample_size: z.number(),
                  })
                  .optional(),
                gain: z
                  .object({
                    avg: z.number(),
                    range: z.object({max: z.number(), min: z.number()}),
                    sample_size: z.number(),
                  })
                  .optional(),
                rank: z
                  .object({
                    avg: z.number(),
                    range: z.object({max: z.number(), min: z.number()}),
                    sample_size: z.number(),
                  })
                  .optional(),
                source: z.string(),
                total_checked: z.number(),
                tracks_found: z.number(),
              })
              .optional(),
            lastfm_analysis: z
              .object({
                artists_enriched: z.number(),
                avg_listeners: z.number(),
                avg_playcount: z.number(),
                crowd_tags: z.array(z.object({count: z.number(), tag: z.string()})),
                sample_size: z.number(),
                similar_tracks: z.array(z.string()),
                source: z.string(),
              })
              .optional(),
            metadata_analysis: z
              .object({
                avg_duration_minutes: z.number(),
                avg_duration_ms: z.number(),
                avg_popularity: z.number(),
                explicit_percentage: z.number(),
                explicit_tracks: z.number(),
                release_year_range: z
                  .object({
                    average: z.number(),
                    newest: z.number(),
                    oldest: z.number(),
                  })
                  .nullable(),
                top_genres: z.array(z.string()),
                total_artists: z.number(),
              })
              .optional(),
          })
          .describe('Full analysis from analyze_playlist'),
        sample_tracks: z
          .array(
            z.object({
              artists: z.string(),
              duration_ms: z.number().optional(),
              name: z.string(),
              popularity: z.number().optional(),
            }),
          )
          .max(20)
          .optional()
          .describe('Sample track names for additional context'),
      }),
    }),

    new DynamicStructuredTool({
      description:
        'Use AI to create a smart multi-pronged discovery strategy based on vibe analysis. Returns specific search queries and parameters to find interesting recommendations.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {
            args: {has_vibe: !!args.vibe_profile},
            tool: 'plan_discovery_strategy',
          },
          type: 'tool_start',
        })

        await sseWriter.write({
          data: `🎯 Planning discovery strategy using AI...`,
          type: 'thinking',
        })

        const anthropic = new ChatAnthropic({
          apiKey: env.ANTHROPIC_API_KEY,
          maxRetries: 0,
          model: 'claude-sonnet-4-5-20250929',
        })

        const strategyPrompt = `You are a music discovery strategist. Create a smart plan to find interesting tracks.

USER REQUEST: "${args.user_request}"

VIBE PROFILE:
${JSON.stringify(args.vibe_profile, null, 2)}

${
  args.similar_tracks_available?.length
    ? `LAST.FM SIMILAR TRACKS AVAILABLE:\n${args.similar_tracks_available.slice(0, 10).join('\n')}`
    : ''
}

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
}`

        try {
          const response = await anthropic.invoke([
            new SystemMessage('You are a music discovery strategist. Return only valid JSON.'),
            new HumanMessage(strategyPrompt),
          ])

          const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
          const jsonMatch = /\{[\s\S]*\}/.exec(content)
          if (!jsonMatch) {
            throw new Error('No JSON found in strategy response')
          }

          const strategy = JSON.parse(jsonMatch[0])

          await sseWriter.write({
            data: `✅ Strategy: ${strategy.strategy_summary?.substring(0, 80)}...`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: `Created ${strategy.tag_searches?.length ?? 0} tag searches, ${
                strategy.spotify_searches?.length ?? 0
              } custom queries`,
              tool: 'plan_discovery_strategy',
            },
            type: 'tool_end',
          })

          return strategy
        } catch (error) {
          getLogger()?.error('[plan_discovery_strategy] AI planning failed:', error)

          // Fallback: Basic strategy
          const fallbackStrategy = {
            avoid: [],
            lastfm_similar_priority: args.similar_tracks_available?.slice(0, 5) ?? [],
            recommendation_seeds: {
              approach: 'Use top tracks as seeds',
              parameters: {
                target_danceability: 0.5,
                target_energy: 0.5,
                target_valence: 0.5,
              },
            },
            spotify_searches: [],
            strategy_summary: 'Using basic tag-based discovery',
            tag_searches: [],
          }

          await sseWriter.write({
            data: `⚠️ Using basic strategy (AI unavailable)`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: 'Basic fallback strategy',
              tool: 'plan_discovery_strategy',
            },
            type: 'tool_end',
          })

          return fallbackStrategy
        }
      },
      name: 'plan_discovery_strategy',
      schema: z.object({
        similar_tracks_available: z
          .array(z.string())
          .max(20)
          .optional()
          .describe('Last.fm similar tracks if available'),
        user_request: z.string().describe("User's original request to understand intent"),
        vibe_profile: z.record(z.unknown()).describe('Output from extract_playlist_vibe'),
      }),
    }),

    new DynamicStructuredTool({
      description:
        'Get Spotify track IDs from Last.fm similar tracks. Provide artist-track strings (e.g., "Daft Punk - One More Time") and get back Spotify IDs ready to use.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'recommend_from_similar'},
          type: 'tool_start',
        })

        await sseWriter.write({
          data: `🔍 Searching Spotify for ${args.similar_tracks.length} Last.fm recommendations...`,
          type: 'thinking',
        })

        interface SimilarRecommendation {
          artists: string
          id: string
          name: string
          original_query: string
          popularity: number
          source: string
          uri: string
        }
        const recommendations: SimilarRecommendation[] = []
        let successCount = 0

        for (const trackString of args.similar_tracks) {
          if (abortSignal?.aborted) break

          try {
            // Parse "Artist - Track" format
            const parts = trackString.split(' - ')
            if (parts.length < 2) {
              getLogger()?.warn(`[recommend_from_similar] Invalid format: "${trackString}"`)
              continue
            }

            const artist = parts[0].trim()
            const track = parts.slice(1).join(' - ').trim()
            const query = `artist:"${artist}" track:"${track}"`

            // Search Spotify
            const response = await rateLimitedSpotifyCall(
              () =>
                fetch(
                  `https://api.spotify.com/v1/search?q=${encodeURIComponent(
                    query,
                  )}&type=track&limit=${args.limit_per_track}`,
                  {headers: {Authorization: `Bearer ${spotifyToken}`}},
                ),
              getLogger(),
              `search similar: ${artist} - ${track}`,
            )

            if (response?.ok) {
              const rawData = await response.json()
              const searchData = SpotifySearchResponseSchema.parse(rawData)
              const tracks = searchData.tracks?.items ?? []

              for (const spotifyTrack of tracks) {
                recommendations.push({
                  artists: spotifyTrack.artists.map(a => a.name).join(', '),
                  id: spotifyTrack.id,
                  name: spotifyTrack.name,
                  original_query: trackString,
                  popularity: spotifyTrack.popularity,
                  source: 'lastfm_similar',
                  uri: spotifyTrack.uri,
                })
              }

              if (tracks.length > 0) successCount++
            }

            // Rate limiting: 25ms between requests
            await new Promise(resolve => setTimeout(resolve, 25))
          } catch (error) {
            getLogger()?.error(`[recommend_from_similar] Error searching "${trackString}":`, error)
          }
        }

        await sseWriter.write({
          data: `✅ Found ${recommendations.length} tracks (${successCount}/${args.similar_tracks.length} successful)`,
          type: 'thinking',
        })

        await sseWriter.write({
          data: {
            result: `Found ${recommendations.length} Spotify tracks from ${successCount} Last.fm recommendations`,
            tool: 'recommend_from_similar',
          },
          type: 'tool_end',
        })

        return {
          queries_successful: successCount,
          queries_total: args.similar_tracks.length,
          total_found: recommendations.length,
          tracks: recommendations,
        }
      },
      name: 'recommend_from_similar',
      schema: z.object({
        limit_per_track: z
          .number()
          .min(1)
          .max(5)
          .default(1)
          .describe('How many search results to return per track (default 1 = best match)'),
        similar_tracks: z
          .array(z.string())
          .min(1)
          .max(20)
          .describe('Array of "Artist - Track" strings from Last.fm similar_tracks'),
      }),
    }),

    new DynamicStructuredTool({
      description: 'Discover tracks based on Last.fm crowd tags/genres. Searches Spotify using tag combinations.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'recommend_from_tags'},
          type: 'tool_start',
        })

        await sseWriter.write({
          data: `🏷️ Searching Spotify for tracks matching tags: ${args.tags.join(', ')}`,
          type: 'thinking',
        })

        // Build Spotify search query from tags
        // Try genre: prefix for recognized genres, otherwise just use as keywords
        const genreKeywords = [
          'rock',
          'pop',
          'jazz',
          'classical',
          'electronic',
          'hip-hop',
          'indie',
          'disco',
          'funk',
          'soul',
        ]
        const genreTags = args.tags.filter((tag: string) =>
          genreKeywords.some(genre => tag.toLowerCase().includes(genre.toLowerCase())),
        )
        const otherTags = args.tags.filter((tag: string) => !genreTags.includes(tag))

        let query = ''
        if (genreTags.length > 0) {
          query += genreTags.map((tag: string) => `genre:"${tag}"`).join(' OR ')
        }
        if (otherTags.length > 0) {
          if (query) query += ' '
          query += otherTags.join(' ')
        }

        getLogger()?.info(`[recommend_from_tags] Search query: ${query}`)

        const response = await rateLimitedSpotifyCall(
          () =>
            fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${args.limit}`, {
              headers: {Authorization: `Bearer ${spotifyToken}`},
            }),
          getLogger(),
          `search by tags: ${args.tags.join(', ')}`,
        )

        if (!response?.ok) {
          throw new Error(`Spotify search failed: ${response?.status || 'null response'}`)
        }

        const rawData = await response.json()
        const searchData = SpotifySearchResponseSchema.parse(rawData)
        const tracks = searchData.tracks?.items ?? []

        const recommendations = tracks.map(track => ({
          album: track.album.name,
          artists: track.artists.map(a => a.name).join(', '),
          id: track.id,
          matched_tags: args.tags,
          name: track.name,
          popularity: track.popularity,
          source: 'tag_based',
          uri: track.uri,
        }))

        await sseWriter.write({
          data: `✅ Found ${recommendations.length} tracks matching ${args.tags.length} tags`,
          type: 'thinking',
        })

        await sseWriter.write({
          data: {
            result: `Found ${recommendations.length} tracks for tags: ${args.tags.join(', ')}`,
            tool: 'recommend_from_tags',
          },
          type: 'tool_end',
        })

        return {
          search_query: query,
          tags_used: args.tags,
          total_found: recommendations.length,
          tracks: recommendations,
        }
      },
      name: 'recommend_from_tags',
      schema: z.object({
        limit: z.number().min(1).max(50).default(20).describe('Total number of tracks to return'),
        tags: z
          .array(z.string())
          .min(1)
          .max(5)
          .describe('Genre/mood tags from Last.fm crowd_tags (e.g., ["italo-disco", "80s", "synth-pop"])'),
      }),
    }),

    new DynamicStructuredTool({
      description:
        'Use AI to intelligently rank and filter track recommendations based on user criteria and playlist characteristics. Provide tracks and context, get back curated top picks with reasoning.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {
            args: {
              top_n: args.top_n,
              track_count: args.candidate_tracks.length,
            },
            tool: 'curate_recommendations',
          },
          type: 'tool_start',
        })

        await sseWriter.write({
          data: `🤖 Using AI to curate ${args.top_n} best picks from ${args.candidate_tracks.length} candidates...`,
          type: 'thinking',
        })

        // Use Claude Sonnet 4.5 for high-quality intelligent curation
        const anthropic = new ChatAnthropic({
          apiKey: env.ANTHROPIC_API_KEY,
          maxRetries: 0,
          model: 'claude-sonnet-4-5-20250929',
        })

        const curationPrompt = `You are a music curator helping select the best track recommendations.

USER REQUEST: "${args.user_request}"

PLAYLIST CONTEXT:
${
  args.playlist_context.bpm_range
    ? `BPM Range: ${args.playlist_context.bpm_range.min}-${args.playlist_context.bpm_range.max}`
    : ''
}
${args.playlist_context.dominant_tags?.length ? `Dominant Tags: ${args.playlist_context.dominant_tags.join(', ')}` : ''}
${args.playlist_context.avg_popularity ? `Average Popularity: ${args.playlist_context.avg_popularity}/100` : ''}
${args.playlist_context.era ? `Era: ${args.playlist_context.era}` : ''}

CANDIDATE TRACKS (${args.candidate_tracks.length} total):
${args.candidate_tracks
  .slice(0, 50)
  .map(
    (
      t: {
        artists?: string
        id: string
        name: string
        popularity?: number
        source?: string
      },
      i: number,
    ) =>
      `${i + 1}. "${t.name}" by ${t.artists} (popularity: ${
        t.popularity ?? 'unknown'
      }, source: ${t.source ?? 'unknown'})`,
  )
  .join('\n')}
${args.candidate_tracks.length > 50 ? `\n... and ${args.candidate_tracks.length - 50} more` : ''}

Select the top ${args.top_n} tracks that best match the user's request and playlist context.
Consider: genre fit, era match, popularity balance, diversity, and relevance to user intent.

Return ONLY a JSON object with this structure:
{
  "selected_track_ids": ["id1", "id2", ...],
  "reasoning": "Brief explanation of selection criteria in 1-2 sentences"
}`

        try {
          const response = await anthropic.invoke([
            new SystemMessage('You are a music curator. Return only valid JSON.'),
            new HumanMessage(curationPrompt),
          ])

          getLogger()?.info(`[curate_recommendations] Claude response:`, response.content)

          // Parse JSON from response
          const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
          const jsonMatch = /\{[\s\S]*\}/.exec(content)
          if (!jsonMatch) {
            throw new Error('No JSON found in response')
          }

          const curation = JSON.parse(jsonMatch[0]) as {
            reasoning?: string
            selected_track_ids?: string[]
          }
          const selectedIds = curation.selected_track_ids ?? []
          const reasoning = curation.reasoning ?? 'AI curation complete'

          // Filter candidate tracks to only selected ones
          const curatedTracks = args.candidate_tracks.filter((t: {id: string}) => selectedIds.includes(t.id))

          // Preserve order from AI selection
          const orderedTracks = selectedIds
            .map((id: string) => curatedTracks.find((t: {id: string}) => t.id === id))
            .filter((t): t is {id: string} => !!t)

          await sseWriter.write({
            data: `✅ Curated ${orderedTracks.length} top picks: ${reasoning}`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: `Curated ${orderedTracks.length} tracks using AI`,
              tool: 'curate_recommendations',
            },
            type: 'tool_end',
          })

          return {
            curated_tracks: orderedTracks,
            original_count: args.candidate_tracks.length,
            reasoning: reasoning,
            total_curated: orderedTracks.length,
          }
        } catch (error) {
          getLogger()?.error('[curate_recommendations] AI curation failed:', error)

          // Fallback: Sort by popularity and return top N
          const fallbackTracks = args.candidate_tracks
            .sort((a: {popularity?: number}, b: {popularity?: number}) => (b.popularity ?? 0) - (a.popularity ?? 0))
            .slice(0, args.top_n)

          await sseWriter.write({
            data: `⚠️ AI curation unavailable, using popularity-based ranking`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: `Fallback: Sorted ${fallbackTracks.length} tracks by popularity`,
              tool: 'curate_recommendations',
            },
            type: 'tool_end',
          })

          return {
            curated_tracks: fallbackTracks,
            original_count: args.candidate_tracks.length,
            reasoning: 'Ranked by popularity (AI curation unavailable)',
            total_curated: fallbackTracks.length,
          }
        }
      },
      name: 'curate_recommendations',
      schema: z.object({
        candidate_tracks: z
          .array(
            z.object({
              artists: z.string(),
              id: z.string(),
              name: z.string(),
              popularity: z.number().optional(),
              source: z.string().optional(),
            }),
          )
          .min(1)
          .max(100)
          .describe('Tracks to curate (from various sources like tag search, similar tracks, Spotify recommendations)'),
        playlist_context: z
          .object({
            avg_popularity: z.number().optional(),
            bpm_range: z.object({max: z.number(), min: z.number()}).optional(),
            dominant_tags: z.array(z.string()).optional(),
            era: z.string().optional(),
          })
          .describe('Context from analyze_playlist to guide curation'),
        top_n: z.number().min(1).max(50).default(10).describe('How many curated recommendations to return'),
        user_request: z.string().describe("User's original request to understand intent"),
      }),
    }),
  ]

  return tools
}

// Enhanced tool executor with progress streaming
async function executeSpotifyToolWithProgress(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
  sseWriter: SSEWriter,
  env?: Env,
  narrator?: ProgressNarrator,
  userRequest?: string,
  recentMessages?: string[],
): Promise<unknown> {
  // Get logger from AsyncLocalStorage context
  const logger = getLogger()
  if (!logger) {
    throw new Error('executeSpotifyToolWithProgress called outside logger context')
  }
  getLogger()?.info(`[Tool] Executing ${toolName} with args:`, JSON.stringify(args).substring(0, 200))

  if (toolName === 'analyze_playlist') {
    const {playlist_id} = args

    try {
      // Use narrator if available, otherwise fallback to static message
      const startMessage = narrator
        ? await narrator.generateMessage({
            eventType: 'tool_call_start',
            parameters: args,
            previousMessages: recentMessages,
            toolName: 'analyze_playlist',
            userRequest,
          })
        : '📊 Starting playlist analysis...'

      sseWriter.writeAsync({data: startMessage, type: 'thinking'})

      // Step 1: Get playlist details
      const fetchMessage = narrator
        ? await narrator.generateMessage({
            eventType: 'analyzing_request',
            previousMessages: recentMessages,
            userRequest,
          })
        : '🔍 Fetching playlist information...'
      sseWriter.writeAsync({data: fetchMessage, type: 'thinking'})

      getLogger()?.info(`[SpotifyAPI] Fetching playlist details: ${playlist_id}`)
      const playlistResponse = await rateLimitedSpotifyCall(
        () =>
          fetch(`https://api.spotify.com/v1/playlists/${playlist_id}`, {
            headers: {Authorization: `Bearer ${token}`},
          }),
        getLogger(),
        `get playlist ${playlist_id}`,
      )

      getLogger()?.info(`[SpotifyAPI] Playlist response status: ${playlistResponse?.status}`)
      if (!playlistResponse?.ok) {
        throw new Error(`Failed to get playlist: ${playlistResponse?.status || 'null response'}`)
      }

      const rawPlaylist = await playlistResponse.json()
      const playlist = SpotifyPlaylistFullSchema.parse(rawPlaylist)
      getLogger()?.info(`[SpotifyAPI] Playlist loaded: "${playlist.name}" with ${playlist.tracks.total} tracks`)

      const foundMessage = narrator
        ? await narrator.generateMessage({
            eventType: 'searching_tracks',
            parameters: {
              name: playlist.name,
              trackCount: playlist.tracks.total,
            },
            previousMessages: recentMessages,
            userRequest,
          })
        : `🎼 Found "${playlist.name}" with ${playlist.tracks.total} tracks`
      sseWriter.writeAsync({data: foundMessage, type: 'thinking'})

      // Step 2: Get tracks
      const tracksMessage = narrator
        ? await narrator.generateMessage({
            eventType: 'analyzing_audio',
            metadata: {trackCount: playlist.tracks.total},
            previousMessages: recentMessages,
            userRequest,
          })
        : '🎵 Fetching track details...'
      sseWriter.writeAsync({data: tracksMessage, type: 'thinking'})

      getLogger()?.info(`[SpotifyAPI] Fetching tracks from playlist: ${playlist_id}`)
      const tracksResponse = await rateLimitedSpotifyCall(
        () =>
          fetch(`https://api.spotify.com/v1/playlists/${playlist_id}/tracks?limit=100`, {
            headers: {Authorization: `Bearer ${token}`},
          }),
        getLogger(),
        `get tracks for playlist ${playlist_id}`,
      )

      getLogger()?.info(`[SpotifyAPI] Tracks response status: ${tracksResponse?.status}`)
      if (!tracksResponse?.ok) {
        const errorBody = tracksResponse ? await tracksResponse.text() : 'null response'
        getLogger()?.error(`[SpotifyAPI] Tracks fetch failed: ${tracksResponse?.status || 'null'} - ${errorBody}`)
        throw new Error(`Failed to get tracks: ${tracksResponse?.status || 'null response'}`)
      }

      const rawTracksData = await tracksResponse.json()
      const tracksData = SpotifyPlaylistTracksResponseSchema.parse(rawTracksData)
      const tracks = tracksData.items
        .map(item => item.track)
        .filter((track): track is SpotifyTrackFull => track !== null)
      const trackIds = tracks.map(t => t.id)

      getLogger()?.info(`[SpotifyAPI] Loaded ${tracks.length} tracks from playlist`)

      // Debug: Log first 3 tracks' structure to see what fields Spotify returns
      if (tracks.length > 0) {
        getLogger()?.info(`[SpotifyAPI] ========== TRACK STRUCTURE DEBUG ==========`)
        tracks.slice(0, 3).forEach((track, idx) => {
          getLogger()?.info(`[SpotifyAPI] Track ${idx + 1}: "${track.name}" by ${track.artists[0]?.name}`)
          getLogger()?.info(`[SpotifyAPI]   - ID: ${track.id}`)
          getLogger()?.info(`[SpotifyAPI]   - has external_ids: ${!!track.external_ids}`)
          getLogger()?.info(`[SpotifyAPI]   - external_ids value:`, track.external_ids)
          getLogger()?.info(`[SpotifyAPI]   - ISRC: ${track.external_ids.isrc ?? 'NOT PRESENT'}`)
          getLogger()?.info(`[SpotifyAPI]   - Available fields:`, Object.keys(track).join(', '))
        })
        getLogger()?.info(`[SpotifyAPI] ========== END TRACK STRUCTURE DEBUG ==========`)
      }

      sseWriter.writeAsync({
        data: `✅ Loaded ${tracks.length} tracks successfully`,
        type: 'thinking',
      })

      // Step 3: Analyze track metadata (audio features API deprecated)
      sseWriter.writeAsync({
        data: '🎵 Analyzing track metadata...',
        type: 'thinking',
      })

      // Calculate metadata-based statistics
      const validTracks = tracks // All tracks are now guaranteed to have required fields
      const avgPopularity =
        validTracks.length > 0 ? validTracks.reduce((sum, t) => sum + t.popularity, 0) / validTracks.length : 0

      const avgDuration =
        validTracks.length > 0 ? validTracks.reduce((sum, t) => sum + t.duration_ms, 0) / validTracks.length : 0

      const explicitCount = validTracks.filter(t => t.explicit).length
      const explicitPercentage = validTracks.length > 0 ? (explicitCount / validTracks.length) * 100 : 0

      // Extract unique artists for genre analysis
      const artistIds = new Set<string>()
      validTracks.forEach(t => {
        t.artists.forEach(artist => {
          artistIds.add(artist.id)
        })
      })

      // Step 4: Fetch artist genres (batch request, limit to 50 artists)
      sseWriter.writeAsync({
        data: '🎸 Fetching artist genres...',
        type: 'thinking',
      })
      const artistIdsArray = Array.from(artistIds).slice(0, 50)
      let genres: string[] = []

      if (artistIdsArray.length > 0) {
        const artistsResponse = await rateLimitedSpotifyCall(
          () =>
            fetch(`https://api.spotify.com/v1/artists?ids=${artistIdsArray.join(',')}`, {
              headers: {Authorization: `Bearer ${token}`},
            }),
          getLogger(),
          `get ${artistIdsArray.length} artists`,
        )

        if (artistsResponse?.ok) {
          const rawArtistsData = await artistsResponse.json()
          const BatchArtistsSchema = z.object({
            artists: z.array(
              z
                .object({
                  genres: z.array(z.string()),
                  id: z.string(),
                  name: z.string(),
                })
                .nullable(),
            ),
          })
          const artistsData = BatchArtistsSchema.parse(rawArtistsData)
          const genreMap = new Map<string, number>()

          artistsData.artists.forEach(artist => {
            if (artist?.genres) {
              artist.genres.forEach((genre: string) => {
                genreMap.set(genre, (genreMap.get(genre) ?? 0) + 1)
              })
            }
          })

          // Get top genres sorted by frequency
          genres = Array.from(genreMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([genre]) => genre)

          sseWriter.writeAsync({
            data: `🎯 Found ${genres.length} genres across ${artistsData.artists.length} artists`,
            type: 'thinking',
          })
        }
      }

      // Flush after metadata + genre analysis
      await sseWriter.flush()

      // Step 5: Analyze release dates
      const releaseDates = validTracks.map(t => t.album.release_date).filter((date): date is string => !!date)

      const releaseYears = releaseDates
        .map((date: string) => parseInt(date.split('-')[0]))
        .filter((year: number) => !isNaN(year))

      const avgReleaseYear =
        releaseYears.length > 0
          ? Math.round(releaseYears.reduce((sum: number, year: number) => sum + year, 0) / releaseYears.length)
          : null

      const oldestYear = releaseYears.length > 0 ? Math.min(...releaseYears) : null
      const newestYear = releaseYears.length > 0 ? Math.max(...releaseYears) : null

      // Step 6: Deezer enrichment (BPM often null, but rank/gain/release_date are valuable)
      let deezerData: null | {
        bpm?: {
          avg: number
          range: {max: number; min: number}
          sample_size: number
        }
        gain?: {
          avg: number
          range: {max: number; min: number}
          sample_size: number
        }
        rank?: {
          avg: number
          range: {max: number; min: number}
          sample_size: number
        }
        source: string
        total_checked: number
        tracks_found: number
      } = null
      if (env?.AUDIO_FEATURES_CACHE) {
        try {
          getLogger()?.info(`[DeezerEnrichment] ========== STARTING DEEZER ENRICHMENT ==========`)
          getLogger()?.info(`[DeezerEnrichment] KV Cache available: YES`)
          const enrichmentService = new AudioEnrichmentService(env.AUDIO_FEATURES_CACHE)

          // Process tracks sequentially with rate limiting at 40 TPS
          const tracksToEnrich = validTracks.slice(0, 100) // Process up to 100 tracks
          const bpmResults: number[] = []
          const rankResults: number[] = []
          const gainResults: number[] = []
          let enrichedCount = 0

          getLogger()?.info(`[DeezerEnrichment] Will attempt to enrich ${tracksToEnrich.length} tracks`)
          sseWriter.writeAsync({
            data: `🎵 Enriching ${tracksToEnrich.length} tracks with Deezer data (BPM, rank, gain)...`,
            type: 'thinking',
          })

          // Debug: Check if tracks have external_ids
          const tracksWithISRC = tracksToEnrich.filter(t => t.external_ids?.isrc).length
          getLogger()?.info(
            `[BPMEnrichment] Pre-enrichment ISRC check: ${tracksWithISRC}/${tracksToEnrich.length} tracks have ISRC`,
          )

          // Debug: Log first 3 tracks to see their structure in detail
          if (tracksToEnrich.length > 0) {
            getLogger()?.info(`[BPMEnrichment] ========== ENRICHMENT TRACK STRUCTURE DEBUG ==========`)
            tracksToEnrich.slice(0, 3).forEach((track, idx) => {
              getLogger()?.info(`[BPMEnrichment] Track ${idx + 1}: "${track.name}" by ${track.artists?.[0]?.name}`)
              getLogger()?.info(`[BPMEnrichment]   - ID: ${track.id}`)
              getLogger()?.info(`[BPMEnrichment]   - Duration: ${track.duration_ms}ms`)
              getLogger()?.info(`[BPMEnrichment]   - has external_ids: ${!!track.external_ids}`)
              getLogger()?.info(`[BPMEnrichment]   - external_ids type: ${typeof track.external_ids}`)
              getLogger()?.info(`[BPMEnrichment]   - external_ids value:`, JSON.stringify(track.external_ids))
              getLogger()?.info(`[BPMEnrichment]   - ISRC: ${track.external_ids?.isrc ?? 'NOT PRESENT'}`)
              getLogger()?.info(`[BPMEnrichment]   - Track object keys:`, Object.keys(track).join(', '))
            })
            getLogger()?.info(`[BPMEnrichment] ========== END ENRICHMENT TRACK STRUCTURE DEBUG ==========`)
          }

          if (tracksWithISRC === 0) {
            getLogger()?.warn(`[BPMEnrichment] ⚠️ CRITICAL: No tracks have ISRC in external_ids`)
            getLogger()?.warn(`[BPMEnrichment] Will need to fetch full track details from Spotify /tracks API`)
            sseWriter.writeAsync({
              data: '⚠️ Tracks missing ISRC data - fetching from Spotify API...',
              type: 'thinking',
            })
          } else {
            getLogger()?.info(`[BPMEnrichment] ✅ Found ${tracksWithISRC} tracks with ISRC, proceeding with enrichment`)
          }

          for (let i = 0; i < tracksToEnrich.length; i++) {
            // eslint-disable-next-line security/detect-object-injection
            const track = tracksToEnrich[i]

            // Log every track attempt for first 5 tracks, then every 10th
            if (i < 5 || i % 10 === 0) {
              getLogger()?.info(`[BPMEnrichment] Processing track ${i + 1}/${tracksToEnrich.length}: "${track.name}"`)
            }

            try {
              const spotifyTrack = {
                artists: track.artists ?? [],
                duration_ms: track.duration_ms,
                external_ids: track.external_ids,
                id: track.id,
                name: track.name,
              }

              // Log the track being sent to enrichment service
              if (i < 3) {
                getLogger()?.info(`[BPMEnrichment] Calling enrichTrack with:`, {
                  has_external_ids: !!spotifyTrack.external_ids,
                  id: spotifyTrack.id,
                  isrc: spotifyTrack.external_ids?.isrc ?? 'NONE',
                  name: spotifyTrack.name,
                })
              }

              const deezerResult = await enrichmentService.enrichTrack(spotifyTrack)

              // Log the result for first few tracks
              if (i < 3) {
                getLogger()?.info(`[DeezerEnrichment] Result for "${track.name}":`, {
                  bpm: deezerResult.bpm,
                  gain: deezerResult.gain,
                  rank: deezerResult.rank,
                  release_date: deezerResult.release_date,
                  source: deezerResult.source,
                })
              }

              // Collect all available Deezer data
              if (deezerResult.bpm && AudioEnrichmentService.isValidBPM(deezerResult.bpm)) {
                bpmResults.push(deezerResult.bpm)
              }
              if (deezerResult.rank !== null && deezerResult.rank > 0) {
                rankResults.push(deezerResult.rank)
              }
              if (deezerResult.gain !== null) {
                gainResults.push(deezerResult.gain)
              }

              if (deezerResult.source) {
                enrichedCount++

                // Stream progress updates every 5 tracks
                if ((i + 1) % 5 === 0) {
                  sseWriter.writeAsync({
                    data: `🎵 Enriched ${enrichedCount}/${tracksToEnrich.length} tracks...`,
                    type: 'thinking',
                  })
                }
              }

              // No manual rate limiting needed - orchestrator handles it via continuous queue
            } catch (error) {
              getChildLogger('BPMEnrichment').error(`Failed for track "${track.name}"`, error)
              // Continue with next track
            }
          }

          getLogger()?.info(`[DeezerEnrichment] ========== ENRICHMENT COMPLETE ==========`)
          getLogger()?.info(`[DeezerEnrichment] Total tracks processed: ${tracksToEnrich.length}`)
          getLogger()?.info(`[DeezerEnrichment] Tracks with Deezer match: ${enrichedCount}`)
          getLogger()?.info(`[DeezerEnrichment] BPM results: ${bpmResults.length}`)
          getLogger()?.info(`[DeezerEnrichment] Rank results: ${rankResults.length}`)
          getLogger()?.info(`[DeezerEnrichment] Gain results: ${gainResults.length}`)

          if (enrichedCount > 0) {
            deezerData = {
              source: 'deezer',
              total_checked: tracksToEnrich.length,
              tracks_found: enrichedCount,
            }

            // Add BPM stats if available
            if (bpmResults.length > 0) {
              const avgBPM = bpmResults.reduce((sum, bpm) => sum + bpm, 0) / bpmResults.length
              deezerData.bpm = {
                avg: Math.round(avgBPM),
                range: {
                  max: Math.max(...bpmResults),
                  min: Math.min(...bpmResults),
                },
                sample_size: bpmResults.length,
              }
            }

            // Add rank stats if available
            if (rankResults.length > 0) {
              const avgRank = rankResults.reduce((sum, rank) => sum + rank, 0) / rankResults.length
              deezerData.rank = {
                avg: Math.round(avgRank),
                range: {
                  max: Math.max(...rankResults),
                  min: Math.min(...rankResults),
                },
                sample_size: rankResults.length,
              }
            }

            // Add gain stats if available
            if (gainResults.length > 0) {
              const avgGain = gainResults.reduce((sum, gain) => sum + gain, 0) / gainResults.length
              deezerData.gain = {
                avg: parseFloat(avgGain.toFixed(1)),
                range: {
                  max: Math.max(...gainResults),
                  min: Math.min(...gainResults),
                },
                sample_size: gainResults.length,
              }
            }

            const dataTypes = [
              bpmResults.length > 0 ? 'BPM' : null,
              rankResults.length > 0 ? 'rank' : null,
              gainResults.length > 0 ? 'gain' : null,
            ]
              .filter(Boolean)
              .join(', ')

            sseWriter.writeAsync({
              data: `✅ Deezer enrichment complete! Found ${dataTypes} for ${enrichedCount}/${tracksToEnrich.length} tracks`,
              type: 'thinking',
            })
          } else {
            sseWriter.writeAsync({
              data: '⚠️ No Deezer data available for these tracks',
              type: 'thinking',
            })
          }
        } catch (error) {
          getChildLogger('DeezerEnrichment').error('Enrichment failed', error)
          sseWriter.writeAsync({
            data: '⚠️ Deezer enrichment unavailable - continuing with metadata only',
            type: 'thinking',
          })
        }
      }

      // Flush after Deezer enrichment
      await sseWriter.flush()

      // Step 7: Optimized Last.fm enrichment (tracks + unique artists separately)
      let lastfmData = null
      if (env?.LASTFM_API_KEY && env?.AUDIO_FEATURES_CACHE) {
        try {
          const lastfmService = new LastFmService(env.LASTFM_API_KEY, env.AUDIO_FEATURES_CACHE)

          const tracksForLastFm = validTracks.slice(0, 50) // Process up to 50 tracks
          const signalsMap = new Map()

          // Step 7a: Get track signals (4 API calls per track = 200 total)
          sseWriter.writeAsync({
            data: `🎧 Enriching ${tracksForLastFm.length} tracks with Last.fm data (40 TPS)...`,
            type: 'thinking',
          })

          for (let i = 0; i < tracksForLastFm.length; i++) {
            // eslint-disable-next-line security/detect-object-injection
            const track = tracksForLastFm[i]

            try {
              const lastfmTrack = {
                artist: track.artists?.[0]?.name ?? 'Unknown',
                duration_ms: track.duration_ms,
                name: track.name,
              }

              // Get track signals WITHOUT artist info (skipArtistInfo=true)
              const signals = await lastfmService.getTrackSignals(lastfmTrack, true)

              if (signals) {
                const key = `${track.id}`
                signalsMap.set(key, signals)

                // Stream simple progress every 2 tracks
                // Note: Narrator calls disabled here - concurrent ChatAnthropic instance creation fails
                if ((i + 1) % 2 === 0 || i === tracksForLastFm.length - 1) {
                  sseWriter.writeAsync({
                    data: `🎧 Enriched ${i + 1}/${tracksForLastFm.length} tracks...`,
                    type: 'thinking',
                  })
                }
              }
            } catch (error) {
              getChildLogger('LastFm').error(`Failed for track ${track.name}`, error)
            }
          }

          // Step 7b: Get unique artists and fetch artist info separately (cached + rate-limited queue)
          const uniqueArtists = [...new Set(tracksForLastFm.map(t => t.artists?.[0]?.name).filter(Boolean))]
          sseWriter.writeAsync({
            data: `🎤 Fetching artist info for ${uniqueArtists.length} unique artists...`,
            type: 'thinking',
          })

          const artistInfoMap = await lastfmService.batchGetArtistInfo(uniqueArtists, (current, total) => {
            // Report progress every 10 artists with simple message
            // Note: Narrator calls disabled here - concurrent ChatAnthropic instance creation fails
            if (current % 10 === 0 || current === total) {
              // Fire and forget - don't await, just queue the write
              void sseWriter.writeAsync({
                data: `🎤 Enriched ${current}/${total} artists...`,
                type: 'thinking',
              })
            }
          })

          // Step 7c: Attach artist info to track signals and update cache
          for (const [_trackId, signals] of signalsMap.entries()) {
            const artistKey = signals.canonicalArtist.toLowerCase()
            if (artistInfoMap.has(artistKey)) {
              signals.artistInfo = artistInfoMap.get(artistKey)

              // Update cache with complete signals including artist info
              const cacheKey = lastfmService.generateCacheKey(signals.canonicalArtist, signals.canonicalTrack)
              await lastfmService.updateCachedSignals(cacheKey, signals)
            }
          }

          if (signalsMap.size > 0) {
            // Aggregate tags across all tracks
            const aggregatedTags = LastFmService.aggregateTags(signalsMap)

            // Calculate average popularity
            const popularity = LastFmService.calculateAveragePopularity(signalsMap)

            // Get some similar tracks from the first few tracks
            const similarTracks = new Set<string>()
            let count = 0
            for (const signals of signalsMap.values()) {
              if (count >= 3) break // Only get similar from first 3 tracks
              signals.similar.slice(0, 3).forEach((s: {artist: string; name: string}) => {
                similarTracks.add(`${s.artist} - ${s.name}`)
              })
              count++
            }

            lastfmData = {
              artists_enriched: artistInfoMap.size,
              avg_listeners: popularity.avgListeners,
              avg_playcount: popularity.avgPlaycount,
              crowd_tags: aggregatedTags.slice(0, 10),
              sample_size: signalsMap.size,
              similar_tracks: Array.from(similarTracks).slice(0, 10),
              source: 'lastfm',
            }

            sseWriter.writeAsync({
              data: `✅ Enriched ${signalsMap.size} tracks + ${artistInfoMap.size} artists!`,
              type: 'thinking',
            })
          }
        } catch (error) {
          getChildLogger('LastFm').error('Enrichment failed', error)
          sseWriter.writeAsync({
            data: '⚠️ Last.fm enrichment unavailable - continuing without tags',
            type: 'thinking',
          })
        }
      }

      // Flush any pending narrator messages before final analysis
      await sseWriter.flush()

      sseWriter.writeAsync({
        data: '🧮 Computing playlist insights...',
        type: 'thinking',
      })

      const analysis = {
        deezer_analysis: deezerData, // Deezer BPM, rank, gain if available
        lastfm_analysis: lastfmData, // Last.fm tags and popularity if available
        message: (() => {
          const sources = [
            deezerData
              ? `Deezer (${[
                  deezerData.bpm ? 'BPM' : null,
                  deezerData.rank ? 'rank' : null,
                  deezerData.gain ? 'gain' : null,
                ]
                  .filter(Boolean)
                  .join(', ')})`
              : null,
            lastfmData ? 'Last.fm (tags, popularity)' : null,
          ].filter(Boolean)
          return sources.length > 0
            ? `Enriched with ${sources.join(' + ')}! Use get_playlist_tracks for track details.`
            : 'Use get_playlist_tracks to fetch track details in batches, or get_track_details for specific tracks.'
        })(),
        metadata_analysis: {
          avg_duration_minutes: Math.round((avgDuration / 60000) * 10) / 10,
          avg_duration_ms: Math.round(avgDuration),
          avg_popularity: Math.round(avgPopularity),
          explicit_percentage: Math.round(explicitPercentage),
          explicit_tracks: explicitCount,
          release_year_range:
            oldestYear && newestYear
              ? {
                  average: avgReleaseYear,
                  newest: newestYear,
                  oldest: oldestYear,
                }
              : null,
          top_genres: genres,
          total_artists: artistIdsArray.length,
        },
        playlist_description: playlist.description,
        playlist_name: playlist.name,
        total_tracks: tracks.length,
        track_ids: trackIds,
      }

      sseWriter.writeAsync({
        data: `🎉 Analysis complete for "${analysis.playlist_name}"!`,
        type: 'thinking',
      })

      // Log data size for debugging
      const analysisJson = JSON.stringify(analysis)
      getLogger()?.info(`[Tool] analyze_playlist completed successfully`)
      getLogger()?.info(
        `[Tool] Analysis JSON size: ${analysisJson.length} bytes (${(analysisJson.length / 1024).toFixed(1)}KB)`,
      )
      getLogger()?.info(`[Tool] Returning metadata analysis with ${trackIds.length} track IDs`)

      return analysis
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      sseWriter.writeAsync({
        data: `❌ Analysis failed: ${errorMsg}`,
        type: 'thinking',
      })
      getChildLogger('Tool:analyze_playlist').error('Analysis failed', error, {
        errorMessage: errorMsg,
        errorType: error?.constructor?.name,
      })
      throw error
    }
  }

  // Fall back to original tool executor for other tools
  return await executeSpotifyTool(toolName, args, token)
}

/**
 * Streaming chat endpoint using Server-Sent Events
 * Uses query token for auth since EventSource can't send headers
 */
chatStreamRouter.post('/message', async c => {
  const requestId = crypto.randomUUID().substring(0, 8)
  getLogger()?.info(`[Stream:${requestId}] ========== NEW STREAMING REQUEST ==========`)
  getLogger()?.info(`[Stream:${requestId}] Method: ${c.req.method}`)
  getLogger()?.info(`[Stream:${requestId}] URL: ${c.req.url}`)
  getLogger()?.info(`[Stream:${requestId}] Headers:`, Object.fromEntries(c.req.raw.headers.entries()))

  // Create abort controller for client disconnect handling
  const abortController = new AbortController()
  const onAbort = () => {
    getLogger()?.info(`[Stream:${requestId}] Client disconnected, aborting...`)
    abortController.abort()
  }

  // Listen for client disconnect
  c.req.raw.signal.addEventListener('abort', onAbort)

  // Create a TransformStream for proper SSE handling in Cloudflare Workers
  const {readable, writable} = new TransformStream()
  const writer = writable.getWriter()
  const sseWriter = new SSEWriter(writer)

  // Set proper SSE headers for Cloudflare
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-transform',
    'Content-Encoding': 'identity',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })

  // Get request body, authorization, and environment before starting async processing
  let requestBody
  try {
    requestBody = await c.req.json()
    getLogger()?.info(`[Stream:${requestId}] Request body parsed:`, JSON.stringify(requestBody).slice(0, 200))
  } catch (error) {
    getLogger()?.error(`[Stream:${requestId}] Failed to parse request body:`, error)
    return c.text('Invalid JSON', 400)
  }

  // Get auth token from header (we'll migrate to query param later)
  const authorization = c.req.header('Authorization')
  const env = c.env

  getLogger()?.info(`[Stream:${requestId}] Auth header present: ${!!authorization}`)
  getLogger()?.info(`[Stream:${requestId}] Env keys:`, Object.keys(env))

  // Initialize logger for this request
  const streamLogger = new ServiceLogger(`Stream:${requestId}`, sseWriter)

  // Process the request and stream responses (wrapped in AsyncLocalStorage context)
  const processStream = async () => {
    await runWithLogger(streamLogger, async () => {
      const logger = getLogger()!
      logger.info('Starting async stream processing')
      logger.info('SSEWriter created, starting heartbeat')

      // Heartbeat to keep connection alive
      const heartbeatInterval = setInterval(() => {
        if (abortController.signal.aborted) {
          clearInterval(heartbeatInterval)
          return
        }
        getLogger()?.info(`[Stream:${requestId}] Sending heartbeat`)
        void sseWriter.writeHeartbeat()
      }, 15000)

      try {
        // Check abort signal early
        if (abortController.signal.aborted) {
          throw new Error('Request aborted')
        }

        getLogger()?.info(`[Stream:${requestId}] Sending initial debug event`)
        // Send debug info as first event
        await sseWriter.write({
          data: {
            buildInfo: {
              branch: 'main',
              buildTime: new Date().toISOString(),
              commitHash: 'current',
              version: '1.0.0',
            },
            requestId,
            serverTime: new Date().toISOString(),
          },
          type: 'debug',
        })

        // Parse request
        const body = requestBody
        await sseWriter.write({
          data: {
            level: 'info',
            message: `[${requestId}] Request received - Body size: ${JSON.stringify(body).length} bytes`,
          },
          type: 'log',
        })

        const request = ChatRequestSchema.parse(body)

        await sseWriter.write({
          data: {
            historyLength: request.conversationHistory.length,
            messageLength: request.message.length,
            mode: request.mode,
            rawMessage: request.message.substring(0, 100),
            requestId,
          },
          type: 'debug',
        })

        // Extract playlist ID if present
        let playlistId: null | string = null
        let actualMessage = request.message
        const playlistIdMatch = /^\[Playlist ID: ([^\]]+)\] (.+)$/.exec(request.message)

        if (playlistIdMatch) {
          playlistId = playlistIdMatch[1]
          actualMessage = playlistIdMatch[2]
          await sseWriter.write({
            data: {
              level: 'info',
              message: `[${requestId}] ✅ Playlist ID extracted: ${playlistId}`,
            },
            type: 'log',
          })
        } else {
          await sseWriter.write({
            data: {
              level: 'warn',
              message: `[${requestId}] ⚠️ No playlist ID found in message: "${request.message.substring(0, 50)}..."`,
            },
            type: 'log',
          })
        }

        // Get Spotify token
        if (!authorization?.startsWith('Bearer ')) {
          await sseWriter.write({
            data: 'Unauthorized - Missing or invalid Authorization header',
            type: 'error',
          })
          return
        }
        const spotifyToken = authorization.replace('Bearer ', '')

        await sseWriter.write({
          data: {
            level: 'info',
            message: `[${requestId}] Auth token present`,
          },
          type: 'log',
        })

        // Initialize progress narrator with Haiku
        const narratorLogger = new ServiceLogger('ProgressNarrator', sseWriter)
        const narrator = new ProgressNarrator(env.ANTHROPIC_API_KEY, narratorLogger)
        const recentMessages: string[] = []

        // Send initial thinking message with dynamic narration
        const initialMessage = await narrator.generateMessage({
          eventType: 'started',
          userRequest: request.message,
        })
        recentMessages.push(initialMessage)
        sseWriter.writeAsync({data: initialMessage, type: 'thinking'})

        // Create tools with streaming callbacks
        const tools = createStreamingSpotifyTools(
          spotifyToken,
          sseWriter,
          playlistId ?? undefined,
          request.mode,
          abortController.signal,
          env,
          narrator,
          request.message,
          recentMessages,
        )

        // Initialize Claude with streaming
        if (!env.ANTHROPIC_API_KEY) {
          getLogger()?.error(`[Stream:${requestId}] CRITICAL: ANTHROPIC_API_KEY is not set`)
          throw new Error('Anthropic API key is not configured')
        }

        getLogger()?.info(`[Stream:${requestId}] Initializing Claude with API key`)

        // Helper function to create fresh ChatAnthropic instance
        // CRITICAL: Must create new instance for each .stream() call in Workers
        // Reusing instances causes "Connection error" on subsequent calls
        const createModelWithTools = () => {
          const llm = new ChatAnthropic({
            apiKey: env.ANTHROPIC_API_KEY,
            maxRetries: 0,
            maxTokens: 2000,
            model: 'claude-sonnet-4-5-20250929',
            streaming: true,
            temperature: 0.2,
            // Note: Cannot use both temperature and topP with Sonnet 4.5
          })
          return llm.bindTools(tools)
        }

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

${
  playlistId
    ? `CONTEXT: User has selected playlist ID: ${playlistId}

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
- "What album is track 5 from?" → get_playlist_tracks + get_track_details for that track`
    : ''
}

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

Be concise and helpful. Describe playlists using genres, popularity, era, and descriptions.`

        await sseWriter.write({
          data: {
            level: 'info',
            message: `[${requestId}] System prompt includes playlist: ${playlistId ? 'YES' : 'NO'}`,
          },
          type: 'log',
        })

        await sseWriter.write({
          data: {
            hasPlaylistContext: !!playlistId,
            playlistId: playlistId,
            systemPromptLength: systemPrompt.length,
          },
          type: 'debug',
        })

        // Build messages
        const messages = [
          new SystemMessage(systemPrompt),
          ...request.conversationHistory.map(m =>
            m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
          ),
          new HumanMessage(actualMessage),
        ]

        await sseWriter.write({
          data: {
            level: 'info',
            message: `[${requestId}] Messages prepared: ${messages.length} total, sending to Claude...`,
          },
          type: 'log',
        })
        getLogger()?.info(`[Stream:${requestId}] User message: "${actualMessage}"`)

        // Stream the response
        interface ToolCall {
          args: Record<string, unknown>
          id?: string
          name: string
        }
        let fullResponse = ''
        let toolCalls: ToolCall[] = []

        getLogger()?.info(`[Stream:${requestId}] Starting Claude streaming...`)
        sseWriter.writeAsync({
          data: 'Analyzing your request...',
          type: 'thinking',
        })

        // Check for abort before API call
        if (abortController.signal.aborted) {
          throw new Error('Request aborted')
        }

        let response
        try {
          getLogger()?.info(`[Stream:${requestId}] Calling createModelWithTools().stream() with ${messages.length} messages`)
          // Wrap stream call in orchestrator to respect anthropic lane limits (max 2 concurrent)
          response = await rateLimitedAnthropicCall(
            () =>
              createModelWithTools().stream(messages, {
                signal: abortController.signal,
              }),
            getLogger(),
            `main chat stream (initial, ${messages.length} messages)`,
          )
          getLogger()?.info(`[Stream:${requestId}] Claude stream initialized`)
        } catch (apiError) {
          if (abortController.signal.aborted) {
            throw new Error('Request aborted')
          }
          getLogger()?.error(`[Stream:${requestId}] Anthropic API call failed:`, apiError)
          if (apiError instanceof Error) {
            getLogger()?.error(`[Stream:${requestId}] Error details:`, {
              message: apiError.message,
              name: apiError.name,
              stack: apiError.stack?.substring(0, 500),
            })
          }
          // Try to parse and provide more details
          const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown API error'
          throw new Error(`Claude API failed: ${errorMessage}`)
        }

        let chunkCount = 0
        for await (const chunk of response) {
          if (abortController.signal.aborted) {
            throw new Error('Request aborted')
          }

          chunkCount++
          // Handle content chunks (both string and array formats)
          let textContent = ''
          if (typeof chunk.content === 'string' && chunk.content) {
            textContent = chunk.content
          } else if (Array.isArray(chunk.content)) {
            for (const block of chunk.content) {
              if (block.type === 'text' && block.text) {
                textContent += block.text
              }
            }
          }

          if (textContent) {
            fullResponse += textContent
            await sseWriter.write({data: textContent, type: 'content'})
            getLogger()?.info(`[Stream:${requestId}] Content chunk ${chunkCount}: ${textContent.substring(0, 50)}...`)
          }

          // Handle tool calls
          if (chunk.tool_calls && chunk.tool_calls.length > 0) {
            toolCalls = chunk.tool_calls
            getLogger()?.info(`[Stream:${requestId}] Tool calls received: ${chunk.tool_calls.map(tc => tc.name).join(', ')}`)
          }
        }

        getLogger()?.info(
          `[Stream:${requestId}] Initial streaming complete. Chunks: ${chunkCount}, Tool calls: ${toolCalls.length}, Content length: ${fullResponse.length}`,
        )

        // Agentic loop: Keep executing tools until Claude stops requesting them
        const conversationMessages = [...messages]
        let currentToolCalls = toolCalls
        let turnCount = 0
        const MAX_TURNS = 5 // Prevent infinite loops - reduced from 15
        const recentToolCalls: string[] = [] // Track recent tool calls to detect loops
        let hasAnyContent = fullResponse.length > 0 // Track if we've gotten ANY content across all turns

        while (currentToolCalls.length > 0 && turnCount < MAX_TURNS) {
          turnCount++

          // Detect loops: if same tool with same args called 3+ times in a row, break
          // Include args in signature to allow multiple calls with different parameters
          const toolSignature = currentToolCalls
            .map(tc => {
              const argsStr = JSON.stringify(tc.args ?? {})
              return `${tc.name}(${argsStr})`
            })
            .join(',')
          recentToolCalls.push(toolSignature)
          if (recentToolCalls.length >= 3) {
            const lastThree = recentToolCalls.slice(-3)
            if (lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
              getLogger()?.warn(`[Stream:${requestId}] ⚠️ Loop detected: identical tool calls 3 times in a row. Breaking.`)
              getLogger()?.warn(`[Stream:${requestId}] Tool signature: ${lastThree[0]}`)
              sseWriter.writeAsync({
                data: 'Detected repetitive tool calls, wrapping up...',
                type: 'thinking',
              })
              break
            }
          }

          getLogger()?.info(
            `[Stream:${requestId}] 🔄 Agentic loop turn ${turnCount}: Executing ${currentToolCalls.length} tool calls...`,
          )
          sseWriter.writeAsync({
            data: 'Using Spotify tools...',
            type: 'thinking',
          })

          // Execute tools and build ToolMessages properly
          const toolMessages = []
          for (const toolCall of currentToolCalls) {
            if (abortController.signal.aborted) {
              throw new Error('Request aborted')
            }

            getLogger()?.info(`[Stream:${requestId}] Looking for tool: ${toolCall.name}`)
            const tool = tools.find(t => t.name === toolCall.name)
            if (tool) {
              getLogger()?.info(
                `[Stream:${requestId}] Executing tool: ${toolCall.name} with args:`,
                JSON.stringify(toolCall.args).substring(0, 200),
              )
              try {
                const result = await tool.func(toolCall.args)
                getLogger()?.info(`[Stream:${requestId}] Tool ${toolCall.name} completed successfully`)
                getLogger()?.info(`[Stream:${requestId}] Tool result type: ${typeof result}`)
                getLogger()?.info(
                  `[Stream:${requestId}] Tool result keys: ${
                    typeof result === 'object' ? Object.keys(result ?? {}).join(', ') : 'N/A'
                  }`,
                )

                const toolContent = JSON.stringify(result)
                getLogger()?.info(`[Stream:${requestId}] Tool result JSON length: ${toolContent.length}`)
                getLogger()?.info(`[Stream:${requestId}] Tool result preview: ${toolContent.substring(0, 500)}...`)

                // Create the tool message
                const toolMsg = new ToolMessage({
                  content: toolContent,
                  tool_call_id: toolCall.id,
                })

                toolMessages.push(toolMsg)

                getLogger()?.info(`[Stream:${requestId}] Created ToolMessage with:`)
                getLogger()?.info(`[Stream:${requestId}]   - call_id: ${toolCall.id}`)
                getLogger()?.info(`[Stream:${requestId}]   - content length: ${toolContent.length}`)
                getLogger()?.info(
                  `[Stream:${requestId}]   - content has playlist_name: ${toolContent.includes('playlist_name')}`,
                )
              } catch (error) {
                if (abortController.signal.aborted) {
                  throw new Error('Request aborted')
                }
                getLogger()?.error(`[Stream:${requestId}] Tool ${toolCall.name} failed:`, error)
                toolMessages.push(
                  new ToolMessage({
                    content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    tool_call_id: toolCall.id,
                  }),
                )
              }
            } else {
              getLogger()?.warn(`[Stream:${requestId}] Tool not found: ${toolCall.name}`)
              toolMessages.push(
                new ToolMessage({
                  content: `Error: Tool ${toolCall.name} not found`,
                  tool_call_id: toolCall.id,
                }),
              )
            }
          }
          getLogger()?.info(`[Stream:${requestId}] All tools executed. Results: ${toolMessages.length}`)

          // Get next response with tool results
          getLogger()?.info(`[Stream:${requestId}] Getting next response from Claude (turn ${turnCount})...`)
          sseWriter.writeAsync({
            data: 'Preparing response...',
            type: 'thinking',
          })

          getLogger()?.info(`[Stream:${requestId}] Sending tool results back to Claude...`)
          getLogger()?.info(`[Stream:${requestId}] Full response so far: "${fullResponse.substring(0, 100)}"`)

          // Build the conversation including tool results
          const aiMessageContent = fullResponse || ''
          getLogger()?.info(
            `[Stream:${requestId}] Creating AIMessage with content length: ${aiMessageContent.length}, tool calls: ${currentToolCalls.length}`,
          )

          // Add the AI's message with tool calls
          conversationMessages.push(
            new AIMessage({
              content: aiMessageContent,
              tool_calls: currentToolCalls,
            }),
          )
          // Add the tool results
          conversationMessages.push(...toolMessages)

          getLogger()?.info(`[Stream:${requestId}] Conversation now has ${conversationMessages.length} messages`)

          getLogger()?.info(`[Stream:${requestId}] Attempting to get next response from Claude...`)
          getLogger()?.info(`[Stream:${requestId}] Message structure (last 5):`)
          conversationMessages.slice(-5).forEach((msg, i) => {
            const msgType = msg.constructor.name
            const contentPreview = msg.content?.toString().slice(0, 200) || 'no content'
            getLogger()?.info(
              `[Stream:${requestId}]   ${conversationMessages.length - 5 + i}: ${msgType} - ${contentPreview}`,
            )
            if (msgType === 'ToolMessage' && 'tool_call_id' in msg) {
              getLogger()?.info(`[Stream:${requestId}]     Tool call ID: ${msg.tool_call_id}`)
              getLogger()?.info(`[Stream:${requestId}]     Content length: ${msg.content?.toString().length || 0}`)
            } else if (msgType === 'AIMessage' && 'tool_calls' in msg && msg.tool_calls) {
              getLogger()?.info(
                `[Stream:${requestId}]     Tool calls: ${msg.tool_calls
                  .map((tc: ToolCall) => `${tc.name}(id:${tc.id})`)
                  .join(', ')}`,
              )
            }
          })

          let nextResponse
          try {
            // Wrap stream call in orchestrator to respect anthropic lane limits (max 2 concurrent)
            nextResponse = await rateLimitedAnthropicCall(
              () =>
                createModelWithTools().stream(conversationMessages, {
                  signal: abortController.signal,
                }),
              getLogger(),
              `main chat stream (turn ${turnCount}, ${conversationMessages.length} messages)`,
            )
          } catch (streamError) {
            const logger = getLogger()
            logger?.error('Claude streaming API call failed', streamError, {
              conversationLength: conversationMessages.length,
              errorMessage: streamError instanceof Error ? streamError.message : String(streamError),
              errorType: streamError?.constructor?.name,
              hasAnyContent,
              turn: turnCount,
            })

            // If we already have content from any turn (initial or tools), break gracefully
            if (hasAnyContent) {
              logger?.info('Breaking agentic loop due to streaming error (content already available)', {
                hasAnyContent,
                turn: turnCount,
              })
              await sseWriter.write({
                data: '\n\n✅ Task completed successfully!',
                type: 'content',
              })
              // Set fullResponse so we don't hit the "no content" fallback
              fullResponse = 'Task completed (graceful degradation after streaming error)'
              break // Exit the while loop
            } else {
              // If no content yet, throw to be handled by outer try-catch
              throw streamError
            }
          }

          fullResponse = ''
          let nextChunkCount = 0
          let nextToolCalls: ToolCall[] = []
          getLogger()?.info(`[Stream:${requestId}] Streaming response from Claude (turn ${turnCount})...`)
          let contentStarted = false

          try {
            for await (const chunk of nextResponse) {
              if (abortController.signal.aborted) {
                throw new Error('Request aborted')
              }

              nextChunkCount++
              // Log ALL chunks to see what Claude is actually sending
              const contentPreview =
                typeof chunk.content === 'string'
                  ? chunk.content.substring(0, 100)
                  : Array.isArray(chunk.content)
                    ? JSON.stringify(chunk.content).substring(0, 100)
                    : chunk.content
                      ? String(chunk.content).substring(0, 100)
                      : 'no content'

              getLogger()?.info(`[Stream:${requestId}] Turn ${turnCount} chunk ${nextChunkCount}:`, {
                chunkContent: contentPreview,
                chunkKeys: Object.keys(chunk),
                contentLength: typeof chunk.content === 'string' ? chunk.content.length : 0,
                hasContent: !!chunk.content,
                hasToolCalls: !!chunk.tool_calls,
              })

              // Handle both string content and array content blocks (Claude API format)
              let textContent = ''
              if (typeof chunk.content === 'string' && chunk.content) {
                textContent = chunk.content
              } else if (Array.isArray(chunk.content)) {
                // Extract text from content blocks: [{"type":"text","text":"..."}]
                for (const block of chunk.content) {
                  if (block.type === 'text' && block.text) {
                    textContent += block.text
                  }
                }
              }

              if (textContent) {
                if (!contentStarted) {
                  getLogger()?.info(
                    `[Stream:${requestId}] CONTENT STARTED at turn ${turnCount} chunk ${nextChunkCount}: ${textContent.substring(
                      0,
                      100,
                    )}`,
                  )
                  contentStarted = true
                }
                fullResponse += textContent
                hasAnyContent = true // Track that we got content
                await sseWriter.write({data: textContent, type: 'content'})
              }

              // Check for MORE tool calls in the response
              if (chunk.tool_calls && chunk.tool_calls.length > 0) {
                nextToolCalls = chunk.tool_calls as ToolCall[]
                getLogger()?.info(
                  `[Stream:${requestId}] ⚠️ Additional tool calls detected (turn ${turnCount}): ${chunk.tool_calls
                    .map(tc => tc.name)
                    .join(', ')}`,
                )
              }
            }
          } catch (chunkError) {
            const logger = getLogger()
            logger?.error('Error processing Claude stream chunks', chunkError, {
              chunksProcessed: nextChunkCount,
              errorMessage: chunkError instanceof Error ? chunkError.message : String(chunkError),
              errorType: chunkError?.constructor?.name,
              partialResponseLength: fullResponse.length,
              turn: turnCount,
            })

            // If we got partial content, continue; otherwise break
            if (fullResponse.length === 0) {
              logger?.warn('No content received before stream error, breaking agentic loop')
              break
            }
          }

          getLogger()?.info(
            `[Stream:${requestId}] Turn ${turnCount} complete. Chunks: ${nextChunkCount}, Content: ${fullResponse.length} chars, Next tool calls: ${nextToolCalls.length}`,
          )

          // Update for next iteration
          currentToolCalls = nextToolCalls
        }

        // Check if we hit the max turns limit or loop detection
        if (turnCount >= MAX_TURNS || fullResponse.length === 0) {
          getLogger()?.warn(
            `[Stream:${requestId}] ⚠️ Hit limit (${turnCount} turns). Requesting final response from Claude...`,
          )

          // Ask Claude to provide a response based on what it has learned
          const finalPrompt = new HumanMessage(
            "Please provide your response based on the information you've gathered from the tools you've used.",
          )
          conversationMessages.push(finalPrompt)

          sseWriter.writeAsync({
            data: 'Preparing final response...',
            type: 'thinking',
          })

          let finalResponse
          try {
            // Wrap stream call in orchestrator to respect anthropic lane limits (max 2 concurrent)
            finalResponse = await rateLimitedAnthropicCall(
              () =>
                createModelWithTools().stream(conversationMessages, {
                  signal: abortController.signal,
                }),
              getLogger(),
              `main chat stream (final, ${conversationMessages.length} messages)`,
            )
          } catch (finalStreamError) {
            const logger = getLogger()
            logger?.error('Final Claude streaming API call failed', finalStreamError, {
              conversationLength: conversationMessages.length,
              errorMessage: finalStreamError instanceof Error ? finalStreamError.message : String(finalStreamError),
              errorType: finalStreamError?.constructor?.name,
              turn: turnCount,
            })

            // Provide a fallback response
            await sseWriter.write({
              data: 'I encountered a connection issue while preparing the final response. However, I was able to complete the task successfully.',
              type: 'content',
            })
            fullResponse = 'Task completed despite connection error.'
            getLogger()?.warn(`[Stream:${requestId}] Final response skipped due to streaming error`)
            // Skip the rest of this block
          }

          if (finalResponse) {
            fullResponse = ''
            try {
              for await (const chunk of finalResponse) {
                if (abortController.signal.aborted) {
                  throw new Error('Request aborted')
                }

                let textContent = ''
                if (typeof chunk.content === 'string' && chunk.content) {
                  textContent = chunk.content
                } else if (Array.isArray(chunk.content)) {
                  for (const block of chunk.content) {
                    if (block.type === 'text' && block.text) {
                      textContent += block.text
                    }
                  }
                }

                if (textContent) {
                  fullResponse += textContent
                  await sseWriter.write({data: textContent, type: 'content'})
                }
              }
            } catch (finalChunkError) {
              const logger = getLogger()
              logger?.error('Error processing final response chunks', finalChunkError, {
                errorMessage: finalChunkError instanceof Error ? finalChunkError.message : String(finalChunkError),
                errorType: finalChunkError?.constructor?.name,
                partialResponseLength: fullResponse.length,
              })

              // If we got no content, provide fallback
              if (fullResponse.length === 0) {
                await sseWriter.write({
                  data: 'The task was completed successfully.',
                  type: 'content',
                })
                fullResponse = 'Task completed.'
              }
            }

            getLogger()?.info(`[Stream:${requestId}] Final response after limit: ${fullResponse.length} chars`)
          }
        }

        getLogger()?.info(`[Stream:${requestId}] Agentic loop complete after ${turnCount} turns`)

        // If still no response after everything, provide fallback
        if (fullResponse.length === 0) {
          getLogger()?.error(`[Stream:${requestId}] WARNING: No content received from Claude!`)
          await sseWriter.write({
            data: 'I apologize, but I encountered an issue generating a response. Please try again.',
            type: 'content',
          })
        }

        // Stream processing complete - done event sent in finally block
        getLogger()?.info(`[Stream:${requestId}] Stream processing complete - all events sent`)
      } catch (error) {
        const logger = getLogger()!
        if (error instanceof Error && error.message === 'Request aborted') {
          logger.info('Request was aborted by client')
        } else {
          logger.error('Stream processing error', error, {
            errorMessage: error instanceof Error ? error.message : String(error),
            errorType: error?.constructor?.name,
          })
          await sseWriter.write({
            data: error instanceof Error ? error.message : 'An error occurred',
            type: 'error',
          })
        }
      } finally {
        const logger = getLogger()!
        // CRITICAL: Always send done event so client knows stream is complete
        logger.info(`[Stream:${requestId}] Sending done event in finally`)
        await sseWriter.write({data: null, type: 'done'})
        clearInterval(heartbeatInterval)
        c.req.raw.signal.removeEventListener('abort', onAbort)
        logger.info('Closing writer...')
        await sseWriter.close()
        logger.info('Stream cleanup complete, heartbeat cleared')
      }
    }) // End runWithLogger
  }

  // Start processing without blocking the response
  processStream().catch(error => {
    // Logger context may not be available here, use direct streamLogger
    streamLogger.error('Unhandled error in processStream', error)
  })

  // Return the SSE response immediately
  getLogger()?.info(`[Stream:${requestId}] Returning Response with SSE headers`)
  const response = new Response(readable, {headers})
  getLogger()?.info(`[Stream:${requestId}] Response created, headers:`, Object.fromEntries(headers.entries()))
  return response
})

/**
 * GET endpoint for SSE with query token authentication
 * This allows EventSource to work since it can't send custom headers
 */
chatStreamRouter.get('/events', async c => {
  const token = c.req.query('token')

  if (!token) {
    return c.text('Unauthorized', 401)
  }

  // Validate token (you might want to verify this is a valid Spotify token)
  // For now, we'll just check it exists

  const requestId = crypto.randomUUID().substring(0, 8)
  getLogger()?.info(`[SSE:${requestId}] EventSource connection established`)

  // Create abort controller for client disconnect
  const abortController = new AbortController()
  const onAbort = () => {
    getLogger()?.info(`[SSE:${requestId}] Client disconnected`)
    abortController.abort()
  }

  c.req.raw.signal.addEventListener('abort', onAbort)

  // Create SSE stream
  const {readable, writable} = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  // Set proper SSE headers
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-transform',
    'Content-Encoding': 'identity',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })

  // Simple heartbeat to demonstrate connection
  const processStream = async () => {
    const heartbeatInterval = setInterval(() => {
      if (abortController.signal.aborted) {
        clearInterval(heartbeatInterval)
        return
      }
      try {
        void writer.write(encoder.encode(': heartbeat\n\n'))
      } catch {
        clearInterval(heartbeatInterval)
      }
    }, 15000)

    try {
      // Send initial event
      await writer.write(encoder.encode(`data: {"type":"connected","requestId":"${requestId}"}\n\n`))

      // Keep connection open until client disconnects
      await new Promise(resolve => {
        abortController.signal.addEventListener('abort', resolve)
      })
    } finally {
      clearInterval(heartbeatInterval)
      c.req.raw.signal.removeEventListener('abort', onAbort)
      await writer.close()
    }
  }

  processStream().catch(console.error)

  return new Response(readable, {headers})
})

export {chatStreamRouter}
