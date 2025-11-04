import type {StreamDebugData, StreamLogData, StreamToolData, StreamToolResult} from '@dj/shared-types'

import Anthropic from '@anthropic-ai/sdk'
import {
  SpotifyPlaylistFullSchema,
  SpotifyPlaylistTracksResponseSchema,
  SpotifySearchResponseSchema,
  type SpotifyTrackFull,
  SpotifyTrackFullSchema,
} from '@dj/shared-types'
import {Hono} from 'hono'
import {z} from 'zod'
import {zodToJsonSchema} from 'zod-to-json-schema'

// Native tool definition (replaces DynamicStructuredTool)
interface NativeTool {
  description: string
  func: (args: Record<string, unknown>) => Promise<unknown>
  name: string
  schema: z.ZodObject<z.ZodRawShape>
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

// Type guards for runtime type checking of unknown values
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

import type {Env} from '../index'

import {ProgressNarrator} from '../lib/progress-narrator'
import {executeSpotifyTool} from '../lib/spotify-tools'
import {AudioEnrichmentService} from '../services/AudioEnrichmentService'
import {LastFmService} from '../services/LastFmService'
import {getChildLogger, getLogger, runWithLogger} from '../utils/LoggerContext'
import {rateLimitedSpotifyCall} from '../utils/RateLimitedAPIClients'
import {ServiceLogger} from '../utils/ServiceLogger'
import {
  getSubrequestTracker,
  runWithSubrequestTracker,
  SubrequestTracker,
} from '../utils/SubrequestTracker'

// Enrichment limits to stay within Cloudflare Workers subrequest cap (1000 on paid tier)
// Last.fm makes 4 API calls per track (correction, info, tags, similar)
// Deezer makes 1 call per uncached track (most are cached after first run)
// PAID TIER: 1000 subrequest limit (vs 50 on free tier)
const MAX_DEEZER_ENRICHMENT = 500 // Can handle large playlists with cache
const MAX_LASTFM_ENRICHMENT = 200 // 200 tracks × 4 calls/track = 800 API calls

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
 * Convert Langchain DynamicStructuredTool to Anthropic tool format
 */
function convertToAnthropicTools(tools: NativeTool[]): Anthropic.Tool[] {
  return tools.map(tool => {
    const jsonSchema = zodToJsonSchema(tool.schema) as Record<string, unknown>

    // Extract properties with type guard
    const properties = isObject(jsonSchema.properties) ? jsonSchema.properties : {}

    // Extract required with type guard
    const required = isStringArray(jsonSchema.required) ? jsonSchema.required : []

    return {
      description: tool.description,
      input_schema: {
        properties,
        required,
        type: 'object' as const,
      },
      name: tool.name,
    }
  })
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
): NativeTool[] {
  const tools: NativeTool[] = [
    {
      description:
        'Search Spotify catalog for tracks by query string. Returns compact track info (name, artists, album, popularity, URI). Use for finding specific songs, artists, or exploring genre searches. Query can include track names, artist names, album names, or genre filters.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'search_spotify_tracks'},
          type: 'tool_start',
        })

        const result = await executeSpotifyTool('search_spotify_tracks', args, spotifyToken, env?.AUDIO_FEATURES_CACHE)

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
    },

    {
      description:
        'Get comprehensive playlist analysis with metadata (genres, popularity, era), BPM/rank from Deezer enrichment, and crowd tags/similar tracks from Last.fm. Returns aggregated insights and track IDs only (not full track objects). This is the FIRST tool to call for playlist questions - provides complete overview in compact format (~2-5KB regardless of playlist size). Use before fetching individual tracks.',
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
    },

    {
      description:
        'Get tracks from a playlist with pagination. Returns compact track info (name, artists, duration, popularity). Use this after analyze_playlist to get actual track details.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        // Auto-inject playlist ID and apply defaults
        const finalArgs = {
          limit: isNumber(args.limit) ? args.limit : 20,
          offset: isNumber(args.offset) ? args.offset : 0,
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

        const PLAYLIST_TRACKS_CACHE_TTL = 5 * 60 // 5 minutes in seconds
        const cacheKey = `spotify:playlist_tracks:${finalArgs.playlist_id}:${finalArgs.offset}:${finalArgs.limit}`

        // Check cache first
        let data: z.infer<typeof SpotifyPlaylistTracksResponseSchema>
        if (env?.AUDIO_FEATURES_CACHE) {
          const cached = await env.AUDIO_FEATURES_CACHE.get(cacheKey, 'json')
          if (cached) {
            getLogger()?.info(`[get_playlist_tracks] Cache hit for ${finalArgs.playlist_id}`)
            await sseWriter.write({
              data: `💾 Using cached tracks ${finalArgs.offset}-${finalArgs.offset + finalArgs.limit}`,
              type: 'thinking',
            })
            data = cached as z.infer<typeof SpotifyPlaylistTracksResponseSchema>
          } else {
            getLogger()?.info(`[get_playlist_tracks] Cache miss, fetching from Spotify`)
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
            data = SpotifyPlaylistTracksResponseSchema.parse(rawData)

            // Cache the result
            await env.AUDIO_FEATURES_CACHE.put(cacheKey, JSON.stringify(data), {
              expirationTtl: PLAYLIST_TRACKS_CACHE_TTL,
            })
            getLogger()?.info(`[get_playlist_tracks] Cached playlist tracks for ${finalArgs.playlist_id}`)
          }
        } else {
          await sseWriter.write({
            data: `📥 Fetching tracks ${finalArgs.offset}-${finalArgs.offset + finalArgs.limit}...`,
            type: 'thinking',
          })

          // Fetch tracks from Spotify (no cache available)
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
          data = SpotifyPlaylistTracksResponseSchema.parse(rawData)
        }
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
    },

    {
      description:
        'Get detailed information about specific tracks. Use when you need full metadata like album details, release dates, external URLs, etc.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'get_track_details'},
          type: 'tool_start',
        })

        if (!isStringArray(args.track_ids)) {
          throw new Error('track_ids must be an array of strings')
        }
        const trackIds = args.track_ids

        await sseWriter.write({
          data: `🔍 Fetching details for ${trackIds.length} tracks...`,
          type: 'thinking',
        })

        // Fetch tracks from Spotify (supports up to 50 tracks)
        const response = await rateLimitedSpotifyCall(
          () =>
            fetch(`https://api.spotify.com/v1/tracks?ids=${trackIds.join(',')}`, {
              headers: {Authorization: `Bearer ${spotifyToken}`},
            }),
          getLogger(),
          `get ${trackIds.length} track details`,
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
    },

    // Note: get_audio_features tool removed - Spotify deprecated this API for apps created after Nov 27, 2024
    // We now use Deezer + Last.fm enrichment instead via analyze_playlist

    {
      description:
        'Get Spotify algorithmic track recommendations based on seed tracks/artists/genres. Accepts audio feature parameters (energy, valence, danceability, etc.) to tune recommendations. Returns compact track info. Use as ONE component of discovery strategy, not the only source (algorithm alone produces generic results).',
      func: async args => {
        const finalArgs = {...args}

        // Smart context inference: if no seeds but we have playlist context
        if (
          (!isStringArray(args.seed_tracks) || args.seed_tracks.length === 0) &&
          (!isStringArray(args.seed_artists) || args.seed_artists.length === 0) &&
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
                const seedCount = isStringArray(finalArgs.seed_tracks) ? finalArgs.seed_tracks.length : 0
                getLogger()?.info(`[get_recommendations] Auto-injected ${seedCount} seed tracks from playlist`)
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

        const result = await executeSpotifyTool(
          'get_recommendations',
          finalArgs,
          spotifyToken,
          env?.AUDIO_FEATURES_CACHE,
        )

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
    },

    {
      description:
        'Create a new Spotify playlist with name, optional description, and track URIs. Returns playlist ID and Spotify URL. Use after gathering and curating recommendations - this is the final step in the discovery workflow.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        const trackCount = isStringArray(args.track_uris) ? args.track_uris.length : 0
        await sseWriter.write({
          data: {
            args: {name: args.name, tracks: trackCount},
            tool: 'create_playlist',
          },
          type: 'tool_start',
        })

        const result = await executeSpotifyTool('create_playlist', args, spotifyToken, env?.AUDIO_FEATURES_CACHE)
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
    },

    {
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

        const anthropic = new Anthropic({
          apiKey: env!.ANTHROPIC_API_KEY,
        })

        const vibePrompt = `<task>
You are a music critic with expertise in identifying subtle sonic and emotional characteristics. Your task is to analyze the provided playlist data and extract a deep vibe profile that captures signals beyond simple genre labels.

WHY THIS MATTERS: Generic algorithmic recommendations fail because they rely on superficial tags. Your analysis will guide intelligent discovery that matches the playlist's true essence.
</task>

<input_data>
METADATA ANALYSIS:
${isObject(args.analysis_data) ? JSON.stringify(args.analysis_data.metadata_analysis ?? {}, null, 2) : '{}'}

DEEZER ANALYSIS (BPM, rank, gain):
${isObject(args.analysis_data) ? JSON.stringify(args.analysis_data.deezer_analysis ?? {}, null, 2) : '{}'}

LAST.FM ANALYSIS (crowd tags, similar tracks):
${isObject(args.analysis_data) ? JSON.stringify(args.analysis_data.lastfm_analysis ?? {}, null, 2) : '{}'}

${
  Array.isArray(args.sample_tracks) && args.sample_tracks.length
    ? `SAMPLE TRACKS (representative examples):\n${args.sample_tracks
        .map((t: {artists: string; name: string}) => `- "${t.name}" by ${t.artists}`)
        .join('\n')}`
    : ''
}
</input_data>

<analysis_instructions>
STEP 1: Synthesize the data above to identify patterns across these dimensions:

<emotional_arc>
How does the emotional energy flow? Does it build progressively, cycle between states, or maintain consistency? Consider valence (positive/negative) and arousal (calm/energetic).
</emotional_arc>

<production_aesthetic>
What's the sonic signature? Lo-fi warmth vs polished clarity? Analog character vs digital precision? Spacious reverb vs dry intimacy? Dense layering vs minimal arrangements?
</production_aesthetic>

<vocal_characteristics>
What's the vocal approach? Breathy and intimate vs powerful and projected? Vocals as centerpiece vs instrumental focus? Lyrical language and delivery style?
</vocal_characteristics>

<instrumentation>
What instruments define the sound? What's prominent, what's absent? Acoustic vs electronic? Live vs programmed? Signature sounds or production techniques?
</instrumentation>

<temporal_context>
What era does this evoke? Vintage production nostalgia? Modern/contemporary? Retro-futuristic? How do production values signal time period?
</temporal_context>

<mixing_philosophy>
Bright and crisp vs warm and rounded? Heavily compressed "loudness war" vs dynamic range? Upfront vocals vs balanced mix? Intentional distortion/saturation?
</mixing_philosophy>

<mood_trajectory>
Introspective and contemplative vs energetic and outward? Dark/moody vs bright/uplifting? Consistent mood or emotional journey?
</mood_trajectory>

<structural_patterns>
Traditional verse-chorus-bridge vs experimental forms? Track length patterns? Build-ups and drops vs steady-state? Intro/outro approaches?
</structural_patterns>

<cultural_resonance>
What musical scene, movement, or cultural moment does this connect to? Underground vs mainstream aesthetic? Geographic associations? Subcultural identity?
</cultural_resonance>

STEP 2: Based on your analysis, formulate discovery hints that will guide strategic search:
- Which genre combinations capture the vibe (not just primary genres)
- What to AVOID (genres/styles that would break the vibe despite seeming related)
- Time periods to explore based on production and aesthetic
- Artist archetypes that embody the characteristics you identified
- Spotify audio feature targets (energy, valence, danceability, acousticness)

STEP 3: Synthesize everything into a cohesive vibe profile that captures the playlist's essence in natural language.
</analysis_instructions>

<output_format>
Return ONLY valid JSON with this exact structure:
{
  "vibe_profile": "2-3 sentence natural language description capturing the playlist's essence and sonic identity",
  "emotional_characteristics": ["5-7 specific adjectives describing emotional qualities"],
  "production_style": "1-2 sentences on production aesthetic and sonic signature",
  "vocal_style": "1-2 sentences on vocal approach and delivery (or 'Instrumental focus' if applicable)",
  "instrumentation_notes": "1-2 sentences on key instrumentation and sonic palette",
  "era_feel": "1-2 sentences on temporal context and production era",
  "discovery_hints": {
    "genre_combinations": ["3-5 genre blend descriptions that capture vibe nuance"],
    "avoid_these": ["3-5 things to avoid that would break the vibe"],
    "era_ranges": ["2-3 time periods to explore"],
    "artist_archetypes": ["3-5 artist type descriptions to seek"],
    "spotify_params": {
      "target_energy": 0.0-1.0,
      "target_valence": 0.0-1.0,
      "target_danceability": 0.0-1.0,
      "target_acousticness": 0.0-1.0
    }
  }
}

CRITICAL: Ensure all JSON is valid. Do not include markdown code blocks, only the raw JSON object.
</output_format>

<constraints>
- Base analysis ONLY on provided data - never hallucinate track details you haven't seen
- If sample tracks are absent, rely more heavily on metadata and enrichment data
- Be specific and descriptive, avoid generic music criticism clichés
- Discovery hints should be actionable for search query construction
</constraints>`

        try {
          const response = await anthropic.messages.create({
            max_tokens: 2000,
            messages: [{content: vibePrompt, role: 'user'}],
            model: 'claude-sonnet-4-5-20250929',
            system: 'You are a music critic. Return only valid JSON with deep vibe analysis.',
            temperature: 0.7,
          })

          // Extract text from content blocks
          const content = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map(block => block.text)
            .join('')
          const jsonMatch = /\{[\s\S]*\}/.exec(content)
          if (!jsonMatch) {
            throw new Error('No JSON found in vibe analysis response')
          }

          let vibeAnalysis
          try {
            vibeAnalysis = JSON.parse(jsonMatch[0])
          } catch (parseError) {
            getLogger()?.error('[extract_playlist_vibe] Failed to parse vibe analysis JSON', {
              error: parseError instanceof Error ? parseError.message : String(parseError),
              jsonPreview: jsonMatch[0].substring(0, 200),
            })
            throw new Error('Failed to parse vibe analysis response as JSON')
          }

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
            isObject(args.analysis_data) &&
            isObject(args.analysis_data.lastfm_analysis) &&
            Array.isArray(args.analysis_data.lastfm_analysis.crowd_tags)
              ? args.analysis_data.lastfm_analysis.crowd_tags
                  .slice(0, 5)
                  .map((t: {count: number; tag: string}) => t.tag)
              : []
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
    },

    {
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

        const anthropic = new Anthropic({
          apiKey: env!.ANTHROPIC_API_KEY,
        })

        const strategyPrompt = `<task>
You are a music discovery strategist creating an intelligent, multi-pronged search plan. Your goal is to find tracks that match the user's request while honoring the playlist's vibe profile.

WHY THIS MATTERS: Single-strategy searches (like "just use algorithm recommendations") produce generic results. A strategic combination of Last.fm similar tracks, creative Spotify queries, tag-based discovery, and tuned recommendations captures the vibe's nuance.
</task>

<user_intent>
USER REQUEST: "${args.user_request}"

What is the user actually asking for? Are they seeking:
- More tracks like the playlist (expansion)
- Tracks for a specific mood/activity (contextual)
- Discovery of new artists with similar vibe (exploration)
- Specific characteristics (tempo, energy, era)
</user_intent>

<vibe_context>
VIBE PROFILE (extracted from playlist analysis):
${JSON.stringify(args.vibe_profile, null, 2)}

This vibe profile contains:
- Overall essence and sonic identity
- Emotional characteristics and mood
- Production aesthetic and era feel
- Discovery hints (genre blends, artist archetypes, what to avoid)
- Spotify audio feature targets

Use this to inform your strategy - the discovery hints are especially valuable.
</vibe_context>

${
  isStringArray(args.similar_tracks_available) && args.similar_tracks_available.length > 0
    ? `<lastfm_similar_tracks>
AVAILABLE LAST.FM SIMILAR TRACKS:
${args.similar_tracks_available.slice(0, 10).join('\n')}
${args.similar_tracks_available.length > 10 ? `\n... and ${args.similar_tracks_available.length - 10} more available` : ''}

These are community-identified similar tracks. Evaluate which ones best match the vibe profile and user intent. Don't just pick the first N - select strategically.
</lastfm_similar_tracks>`
    : '<lastfm_similar_tracks>\nNo Last.fm similar tracks available for this playlist.\n</lastfm_similar_tracks>'
}

<strategy_instructions>
Create a comprehensive discovery plan with these components:

COMPONENT 1 - Last.fm Similar Track Selection:
- Review available similar tracks against vibe profile
- Select 5-8 that best capture the essence (not just the most popular)
- Consider: Do they match production style? Era feel? Emotional characteristics?
- Skip tracks that seem algorithmically related but vibe-mismatched

COMPONENT 2 - Tag-Based Search Combinations:
- Combine 2-3 tags creatively to capture vibe nuance
- Use vibe_profile.discovery_hints.genre_combinations as starting point
- Think beyond single genres - combinations reveal micro-niches
- Include 2-3 tag combos with rationale for each

COMPONENT 3 - Creative Spotify Searches:
- Construct 2-3 search queries that capture vibe WITHOUT just using genre labels
- Examples: "dreamy bedroom pop 2010s", "80s synthwave workout", "minimal techno berlin"
- Use era, production style, mood descriptors, and cultural context
- Each query should target a different angle on the vibe

COMPONENT 4 - Recommendation Algorithm Parameters:
- Use vibe_profile.discovery_hints.spotify_params as baseline
- Adjust based on user request specifics
- Set target_energy, target_valence, target_danceability, target_acousticness
- Describe the seed selection approach (how to pick tracks to seed from)

COMPONENT 5 - Avoidance List:
- What genres/styles/eras would BREAK the vibe?
- Use vibe_profile.discovery_hints.avoid_these as starting point
- Think about adjacent genres that seem related but would clash
- Be specific - "avoid mainstream pop" is too vague

FINAL STEP: Synthesize into strategy summary explaining the overall approach.
</strategy_instructions>

<output_format>
Return ONLY valid JSON with this exact structure:
{
  "strategy_summary": "2-3 sentence description of the overall discovery approach and why it will succeed",
  "lastfm_similar_priority": ["Artist - Track", "Artist - Track", ...],
  "tag_searches": [
    {
      "tags": ["tag1", "tag2", "tag3"],
      "rationale": "Specific reason why this combination captures a facet of the vibe"
    }
  ],
  "spotify_searches": [
    {
      "query": "creative search query string",
      "rationale": "What angle on the vibe this query targets"
    }
  ],
  "recommendation_seeds": {
    "approach": "How to select seed tracks from the playlist (e.g., 'pick highest energy tracks', 'use most popular tracks')",
    "parameters": {
      "target_energy": 0.0-1.0,
      "target_valence": 0.0-1.0,
      "target_danceability": 0.0-1.0,
      "target_acousticness": 0.0-1.0
    }
  },
  "avoid": ["specific thing to avoid 1", "specific thing to avoid 2", "specific thing to avoid 3"]
}

CRITICAL: Return valid JSON only. No markdown code blocks, no explanatory text outside the JSON.
</output_format>

<constraints>
- Base strategy on vibe profile and user request - don't introduce unrelated preferences
- Be specific in rationales - explain the "why" not just "what"
- Ensure diversity across search strategies (don't just repeat the same approach 4 times)
- If Last.fm tracks unavailable, compensate with more creative Spotify/tag searches
- Think strategically about how each component contributes to comprehensive discovery
</constraints>`

        try {
          const response = await anthropic.messages.create({
            max_tokens: 3000,
            messages: [{content: strategyPrompt, role: 'user'}],
            model: 'claude-sonnet-4-5-20250929',
            system: 'You are a music discovery strategist. Return only valid JSON.',
            temperature: 0.7,
          })

          // Extract text from content blocks
          const content = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map(block => block.text)
            .join('')
          const jsonMatch = /\{[\s\S]*\}/.exec(content)
          if (!jsonMatch) {
            throw new Error('No JSON found in strategy response')
          }

          let strategy
          try {
            strategy = JSON.parse(jsonMatch[0])
          } catch (parseError) {
            getLogger()?.error('[plan_discovery_strategy] Failed to parse strategy JSON', {
              error: parseError instanceof Error ? parseError.message : String(parseError),
              jsonPreview: jsonMatch[0].substring(0, 200),
            })
            throw new Error('Failed to parse discovery strategy response as JSON')
          }

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
            lastfm_similar_priority: isStringArray(args.similar_tracks_available)
              ? args.similar_tracks_available.slice(0, 5)
              : [],
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
    },

    {
      description:
        'Get Spotify track IDs from Last.fm similar tracks. Provide artist-track strings (e.g., "Daft Punk - One More Time") and get back Spotify IDs ready to use.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {args, tool: 'recommend_from_similar'},
          type: 'tool_start',
        })

        if (!isStringArray(args.similar_tracks)) {
          throw new Error('similar_tracks must be an array of strings')
        }

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
    },

    {
      description:
        'Discover tracks by combining 2-3 Last.fm crowd tags/genres in Spotify search. Automatically adds genre: prefix for recognized genres for better results. Returns compact track info. Use tag combinations (not single tags) to capture vibe nuance. Part of multi-pronged discovery strategy.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        if (!isStringArray(args.tags)) {
          throw new Error('tags must be an array of strings')
        }

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
    },

    {
      description:
        'Use AI to intelligently rank and filter track recommendations based on user criteria and playlist characteristics. Provide tracks and context, get back curated top picks with reasoning.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        if (!Array.isArray(args.candidate_tracks)) {
          throw new Error('candidate_tracks must be an array')
        }

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
        const anthropic = new Anthropic({
          apiKey: env!.ANTHROPIC_API_KEY,
        })

        const curationPrompt = `<task>
You are an expert music curator selecting the best track recommendations from a pool of candidates. Your goal is to pick tracks that best match the user's request while honoring the playlist's established vibe and characteristics.

WHY THIS MATTERS: The discovery strategy has gathered candidates from multiple sources. Your curation ensures quality over quantity - selecting tracks with the right vibe alignment, diversity, and user intent match.
</task>

<user_intent>
USER REQUEST: "${args.user_request}"

Interpret what the user truly wants:
- Are they seeking expansion (more of the same vibe)?
- Contextual recommendations (workout, study, party)?
- Discovery (new artists with similar aesthetic)?
- Specific characteristics (more upbeat, mellower, specific era)?

This interpretation should guide your selection priorities.
</user_intent>

<playlist_context>
PLAYLIST CHARACTERISTICS (baseline for vibe matching):
${
  isObject(args.playlist_context) && isObject(args.playlist_context.bpm_range)
    ? `BPM Range: ${args.playlist_context.bpm_range.min}-${args.playlist_context.bpm_range.max} (tempo profile)`
    : ''
}
${isObject(args.playlist_context) && Array.isArray(args.playlist_context.dominant_tags) && args.playlist_context.dominant_tags.length ? `Dominant Tags: ${args.playlist_context.dominant_tags.join(', ')} (genre/mood signals)` : ''}
${isObject(args.playlist_context) && isNumber(args.playlist_context.avg_popularity) ? `Average Popularity: ${args.playlist_context.avg_popularity}/100 (mainstream vs underground)` : ''}
${isObject(args.playlist_context) && isString(args.playlist_context.era) ? `Era: ${args.playlist_context.era} (temporal context)` : ''}

Use these characteristics as baseline expectations. Candidates should generally align with these patterns unless user intent explicitly requests deviation.
</playlist_context>

<candidate_pool>
CANDIDATE TRACKS (${args.candidate_tracks.length} total from multiple discovery strategies):
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
${args.candidate_tracks.length > 50 ? `\n... and ${args.candidate_tracks.length - 50} more candidates available` : ''}

Each track comes from a specific discovery source (Last.fm similar, Spotify search, tag-based, algorithm). Consider source diversity in your selection - don't pick all tracks from one source.
</candidate_pool>

<curation_instructions>
STEP 1: Evaluate each candidate against these criteria:

<vibe_alignment>
Does the track match the playlist's BPM range, dominant tags, and era? Look for tracks that feel like they "belong" in the playlist based on sonic characteristics.
</vibe_alignment>

<user_intent_match>
Does this track specifically address what the user requested? If they wanted "upbeat workout tracks", does it deliver on energy and context?
</user_intent_match>

<popularity_balance>
Does the track match the playlist's popularity profile? If playlist averages 45/100, avoid both mega-hits (90+) and ultra-obscure tracks (10-) unless user requested discovery.
</popularity_balance>

<diversity>
Are you selecting from multiple discovery sources? Are you avoiding artist repetition? Is there variety in specific sound within the vibe constraints?
</diversity>

<quality_signals>
Popularity isn't everything, but extremely low popularity might indicate poor quality. Balance "hidden gem" with "unheard for a reason."
</quality_signals>

STEP 2: Select top ${args.top_n} tracks that best meet the combined criteria.

STEP 3: Formulate reasoning that explains:
- What selection criteria you prioritized (and why based on user request)
- How you balanced vibe alignment with diversity
- Any specific considerations that guided your choices

Your reasoning should be specific and insightful, not generic.
</curation_instructions>

<output_format>
Return ONLY valid JSON with this exact structure:
{
  "selected_track_ids": ["id1", "id2", "id3", ...],
  "reasoning": "2-3 sentence explanation of your selection criteria and approach, referencing specific considerations from user request and playlist context"
}

CRITICAL:
- Return exactly ${args.top_n} track IDs (no more, no less)
- Ensure all IDs exist in the candidate list
- Return valid JSON only - no markdown code blocks, no extra text
</output_format>

<constraints>
- Select ONLY from provided candidate tracks - do not invent track IDs
- Return exactly ${args.top_n} tracks as requested
- Base selection on stated criteria - don't introduce personal music preferences
- Be specific in reasoning - explain the "why" behind your approach
- If candidate pool is smaller than ${args.top_n}, return all candidates and note limitation in reasoning
</constraints>`

        try {
          const response = await anthropic.messages.create({
            max_tokens: 2000,
            messages: [{content: curationPrompt, role: 'user'}],
            model: 'claude-sonnet-4-5-20250929',
            system: 'You are a music curator. Return only valid JSON.',
            temperature: 0.7,
          })

          // Extract text from content blocks
          const content = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map(block => block.text)
            .join('')

          getLogger()?.info(`[curate_recommendations] Claude response:`, {preview: content.substring(0, 200)})
          const jsonMatch = /\{[\s\S]*\}/.exec(content)
          if (!jsonMatch) {
            throw new Error('No JSON found in response')
          }

          let curation: {
            reasoning?: string
            selected_track_ids?: string[]
          }
          try {
            curation = JSON.parse(jsonMatch[0]) as {
              reasoning?: string
              selected_track_ids?: string[]
            }
          } catch (parseError) {
            getLogger()?.error('[curate_recommendations] Failed to parse curation JSON', {
              error: parseError instanceof Error ? parseError.message : String(parseError),
              jsonPreview: jsonMatch[0].substring(0, 200),
            })
            throw new Error('Failed to parse curation response as JSON')
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
          const topN = isNumber(args.top_n) ? args.top_n : 10
          const fallbackTracks = args.candidate_tracks
            .sort((a: {popularity?: number}, b: {popularity?: number}) => (b.popularity ?? 0) - (a.popularity ?? 0))
            .slice(0, topN)

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
    },
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
  getLogger()?.info(`[Tool] Executing ${toolName} with args:`, {args: JSON.stringify(args).substring(0, 200)})

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
          getLogger()?.info(`[SpotifyAPI]   - Available fields:`, {fields: Object.keys(track).join(', ')})
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

          // Step 1: Check cache status for tracks (cache lookups don't count as subrequests)
          const candidateTracks = validTracks.slice(0, MAX_DEEZER_ENRICHMENT)
          const cachedTracks: typeof candidateTracks = []
          const uncachedTracks: typeof candidateTracks = []

          getLogger()?.info(`[DeezerEnrichment] Checking cache status for ${candidateTracks.length} tracks...`)
          for (const track of candidateTracks) {
            const cacheKey = `bpm:${track.id}`
            const cached = await env.AUDIO_FEATURES_CACHE.get(cacheKey, 'json')
            if (cached) {
              cachedTracks.push(track)
            } else {
              uncachedTracks.push(track)
            }
          }

          const cacheHitRate = (cachedTracks.length / candidateTracks.length) * 100
          getLogger()?.info(
            `[DeezerEnrichment] Cache status: ${cachedTracks.length} cached, ${uncachedTracks.length} uncached (${cacheHitRate.toFixed(1)}% hit rate)`,
          )

          // Step 2: Calculate how many uncached tracks we can enrich based on remaining budget
          let tracksToEnrich: typeof uncachedTracks
          const subrequestTracker = getSubrequestTracker()
          if (subrequestTracker) {
            const remaining = subrequestTracker.remaining()
            // Reserve some budget for other operations (Spotify, Last.fm, etc.)
            const availableBudget = Math.max(0, remaining - 10)
            // Deezer makes 1 call per track (plus potential MusicBrainz fallback, so estimate 2 per track to be safe)
            const deezerBudget = Math.floor(availableBudget * 0.5) // Use 50% of remaining budget for Deezer
            tracksToEnrich = uncachedTracks.slice(0, Math.min(uncachedTracks.length, deezerBudget))

            getLogger()?.info(
              `[DeezerEnrichment] Budget: ${remaining} remaining, ${availableBudget} available, ${deezerBudget} for Deezer → enriching ${tracksToEnrich.length}/${uncachedTracks.length} uncached tracks`,
            )
          } else {
            // Fallback to fixed limits if no tracker available
            tracksToEnrich = uncachedTracks.slice(0, MAX_DEEZER_ENRICHMENT)
            getLogger()?.info(
              `[DeezerEnrichment] No subrequest tracker, using fixed limit → enriching ${tracksToEnrich.length}/${uncachedTracks.length} uncached tracks`,
            )
          }

          const bpmResults: number[] = []
          const rankResults: number[] = []
          const gainResults: number[] = []
          let enrichedCount = 0

          getLogger()?.info(`[DeezerEnrichment] Will attempt to enrich ${tracksToEnrich.length} uncached tracks`)
          sseWriter.writeAsync({
            data: `🎵 Deezer enrichment: ${cachedTracks.length} cached (${cacheHitRate.toFixed(0)}% hit rate), enriching ${tracksToEnrich.length} new tracks...`,
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
              getLogger()?.info(`[BPMEnrichment]   - external_ids value:`, {value: JSON.stringify(track.external_ids)})
              getLogger()?.info(`[BPMEnrichment]   - ISRC: ${track.external_ids?.isrc ?? 'NOT PRESENT'}`)
              getLogger()?.info(`[BPMEnrichment]   - Track object keys:`, {keys: Object.keys(track).join(', ')})
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

          // Convert tracks to SpotifyTrack format for batch enrichment
          const spotifyTracks = tracksToEnrich.map(track => ({
            artists: track.artists ?? [],
            duration_ms: track.duration_ms,
            external_ids: track.external_ids,
            id: track.id,
            name: track.name,
          }))

          getLogger()?.info(`[BPMEnrichment] Starting PARALLEL enrichment for ${spotifyTracks.length} tracks`)
          sseWriter.writeAsync({
            data: `🎵 Enriching ${spotifyTracks.length} tracks in parallel...`,
            type: 'thinking',
          })

          // Use batchEnrichTracks for parallel processing (up to 10 concurrent via Deezer lane)
          const enrichmentResults = await enrichmentService.batchEnrichTracks(spotifyTracks)

          // Process results
          for (const [trackId, deezerResult] of enrichmentResults.entries()) {
            const track = tracksToEnrich.find(t => t.id === trackId)

            // Track subrequests (enrichTrack makes 1-2 API calls: Deezer + maybe MusicBrainz)
            const tracker = getSubrequestTracker()
            if (tracker) {
              tracker.record(deezerResult.source === 'deezer-via-musicbrainz' ? 2 : 1)
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
            }
          }

          getLogger()?.info(
            `[BPMEnrichment] Parallel enrichment complete: ${enrichedCount}/${tracksToEnrich.length} tracks enriched`,
          )
          sseWriter.writeAsync({
            data: `✅ Enriched ${enrichedCount}/${tracksToEnrich.length} tracks`,
            type: 'thinking',
          })

          getLogger()?.info(`[DeezerEnrichment] ========== ENRICHMENT COMPLETE ==========`)
          getLogger()?.info(`[DeezerEnrichment] Cache efficiency:`)
          getLogger()?.info(`[DeezerEnrichment]   - Total candidates: ${candidateTracks.length}`)
          getLogger()?.info(`[DeezerEnrichment]   - Cached: ${cachedTracks.length} (${cacheHitRate.toFixed(1)}%)`)
          getLogger()?.info(`[DeezerEnrichment]   - Uncached: ${uncachedTracks.length}`)
          getLogger()?.info(`[DeezerEnrichment]   - Enriched (new): ${tracksToEnrich.length}`)
          getLogger()?.info(`[DeezerEnrichment] Enrichment results:`)
          getLogger()?.info(`[DeezerEnrichment]   - Tracks with Deezer match: ${enrichedCount}/${tracksToEnrich.length}`)
          getLogger()?.info(`[DeezerEnrichment]   - BPM results: ${bpmResults.length}`)
          getLogger()?.info(`[DeezerEnrichment]   - Rank results: ${rankResults.length}`)
          getLogger()?.info(`[DeezerEnrichment]   - Gain results: ${gainResults.length}`)
          const finalTracker = getSubrequestTracker()
          if (finalTracker) {
            getLogger()?.info(
              `[DeezerEnrichment] Subrequest tracking: ${finalTracker.getSummary().count}/${finalTracker.getSummary().max} used (${finalTracker.getSummary().percentage.toFixed(1)}%)`,
            )
          }

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

          // Step 7a: Check cache status and calculate budget
          const candidateLastFmTracks = validTracks.slice(0, MAX_LASTFM_ENRICHMENT)
          const cachedLastFmTracks: typeof candidateLastFmTracks = []
          const uncachedLastFmTracks: typeof candidateLastFmTracks = []

          getLogger()?.info(`[LastFmEnrichment] Checking cache status for ${candidateLastFmTracks.length} tracks...`)
          for (const track of candidateLastFmTracks) {
            const artist = track.artists?.[0]?.name ?? 'Unknown'
            const cacheKey = lastfmService.generateCacheKey(artist, track.name)
            const cached = await env.AUDIO_FEATURES_CACHE.get(`lastfm:${cacheKey}`, 'json')
            if (cached) {
              cachedLastFmTracks.push(track)
            } else {
              uncachedLastFmTracks.push(track)
            }
          }

          const lastfmCacheHitRate = (cachedLastFmTracks.length / candidateLastFmTracks.length) * 100
          getLogger()?.info(
            `[LastFmEnrichment] Cache status: ${cachedLastFmTracks.length} cached, ${uncachedLastFmTracks.length} uncached (${lastfmCacheHitRate.toFixed(1)}% hit rate)`,
          )

          // Calculate how many tracks to enrich based on remaining budget
          // Last.fm makes 4 API calls per track (correction, info, tags, similar)
          let tracksForLastFm: typeof uncachedLastFmTracks
          const lastfmTracker = getSubrequestTracker()
          if (lastfmTracker) {
            const remainingAfterDeezer = lastfmTracker.remaining()
            const availableForLastFm = Math.max(0, remainingAfterDeezer - 5) // Reserve 5 for other calls
            const lastfmBudget = Math.floor(availableForLastFm / 4) // 4 calls per track
            tracksForLastFm = uncachedLastFmTracks.slice(0, Math.min(uncachedLastFmTracks.length, lastfmBudget))

            getLogger()?.info(
              `[LastFmEnrichment] Budget: ${remainingAfterDeezer} remaining, ${availableForLastFm} available, ${lastfmBudget} tracks → enriching ${tracksForLastFm.length}/${uncachedLastFmTracks.length} uncached tracks`,
            )
          } else {
            // Fallback to fixed limits if no tracker available
            tracksForLastFm = uncachedLastFmTracks.slice(0, MAX_LASTFM_ENRICHMENT)
            getLogger()?.info(
              `[LastFmEnrichment] No subrequest tracker, using fixed limit → enriching ${tracksForLastFm.length}/${uncachedLastFmTracks.length} uncached tracks`,
            )
          }

          const signalsMap = new Map()

          // Step 7b: Get track signals (4 API calls per track for uncached) - PARALLEL processing
          getLogger()?.info(`[LastFmEnrichment] Starting PARALLEL enrichment for ${tracksForLastFm.length} tracks`)
          sseWriter.writeAsync({
            data: `🎧 Last.fm enrichment: ${cachedLastFmTracks.length} cached (${lastfmCacheHitRate.toFixed(0)}% hit rate), enriching ${tracksForLastFm.length} new tracks in parallel...`,
            type: 'thinking',
          })

          // Convert to LastFmTrack format
          const lastfmTracks = tracksForLastFm.map(track => ({
            artist: track.artists?.[0]?.name ?? 'Unknown',
            duration_ms: track.duration_ms,
            name: track.name,
          }))

          // Use batchGetSignals for parallel processing (up to 10 concurrent via Last.fm lane)
          const batchSignals = await lastfmService.batchGetSignals(lastfmTracks, true)

          // Track subrequests (getTrackSignals makes 4 API calls per track for uncached)
          const signalTracker = getSubrequestTracker()
          if (signalTracker) {
            // Estimate: 4 calls per track (correction, info, tags, similar)
            signalTracker.record(tracksForLastFm.length * 4)
          }

          // Map results by track ID for consistency with previous implementation
          for (let i = 0; i < tracksForLastFm.length; i++) {
            // eslint-disable-next-line security/detect-object-injection
            const track = tracksForLastFm[i]
            // eslint-disable-next-line security/detect-object-injection
            const lastfmTrack = lastfmTracks[i]

            const cacheKey = lastfmService.generateCacheKey(lastfmTrack.artist, lastfmTrack.name)
            const signals = batchSignals.get(cacheKey)

            if (signals) {
              const key = `${track.id}`
              signalsMap.set(key, signals)
            }
          }

          getLogger()?.info(`[LastFmEnrichment] Parallel enrichment complete: ${signalsMap.size} tracks processed`)
          sseWriter.writeAsync({
            data: `✅ Enriched ${signalsMap.size} tracks in parallel!`,
            type: 'thinking',
          })

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

          // Track artist info subrequests (1 API call per artist, but some are cached)
          // Estimate based on the number of artists actually enriched
          const artistTracker = getSubrequestTracker()
          if (artistTracker) {
            artistTracker.record(artistInfoMap.size)
          }

          getLogger()?.info(`[LastFmEnrichment] ========== ENRICHMENT COMPLETE ==========`)
          getLogger()?.info(`[LastFmEnrichment] Cache efficiency:`)
          getLogger()?.info(`[LastFmEnrichment]   - Total candidates: ${candidateLastFmTracks.length}`)
          getLogger()?.info(`[LastFmEnrichment]   - Cached: ${cachedLastFmTracks.length} (${lastfmCacheHitRate.toFixed(1)}%)`)
          getLogger()?.info(`[LastFmEnrichment]   - Uncached: ${uncachedLastFmTracks.length}`)
          getLogger()?.info(`[LastFmEnrichment]   - Enriched (new): ${tracksForLastFm.length}`)
          getLogger()?.info(`[LastFmEnrichment] Enrichment results:`)
          getLogger()?.info(`[LastFmEnrichment]   - Track signals: ${signalsMap.size}`)
          getLogger()?.info(`[LastFmEnrichment]   - Unique artists: ${uniqueArtists.length}`)
          getLogger()?.info(`[LastFmEnrichment]   - Artists enriched: ${artistInfoMap.size}`)
          const finalLastfmTracker = getSubrequestTracker()
          if (finalLastfmTracker) {
            getLogger()?.info(
              `[LastFmEnrichment] Subrequest tracking: ${finalLastfmTracker.getSummary().count}/${finalLastfmTracker.getSummary().max} used (${finalLastfmTracker.getSummary().percentage.toFixed(1)}%)`,
            )
          }

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
  return await executeSpotifyTool(toolName, args, token, env?.AUDIO_FEATURES_CACHE)
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
    getLogger()?.info(`[Stream:${requestId}] Request body parsed:`, {body: JSON.stringify(requestBody).slice(0, 200)})
  } catch (error) {
    getLogger()?.error(`[Stream:${requestId}] Failed to parse request body:`, error)
    return c.text('Invalid JSON', 400)
  }

  // Get auth token from header (we'll migrate to query param later)
  const authorization = c.req.header('Authorization')
  const env = c.env

  getLogger()?.info(`[Stream:${requestId}] Auth header present: ${!!authorization}`)
  getLogger()?.info(`[Stream:${requestId}] Env keys:`, {keys: Object.keys(env)})

  // Initialize logger for this request
  const streamLogger = new ServiceLogger(`Stream:${requestId}`, sseWriter)

  // Process the request and stream responses (wrapped in AsyncLocalStorage context)
  const processStream = async () => {
    await runWithLogger(streamLogger, async () => {
      const logger = getLogger()!
      logger.info('Starting async stream processing')
      logger.info('SSEWriter created, starting heartbeat')

      // Initialize subrequest tracker to stay within Cloudflare Workers limits (PAID TIER)
      const subrequestTracker = new SubrequestTracker({
        enableLogging: true,
        maxSubrequests: 950, // Safety margin below paid tier limit of 1000
        warningThreshold: 0.8,
      })
      logger.info('[SubrequestTracker] Initialized with paid tier limit: 950')

      // Wrap execution in subrequest tracker context (nested AsyncLocalStorage)
      await runWithSubrequestTracker(subrequestTracker, async () => {

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

        // Initialize Anthropic client
        // Extended thinking enabled with temperature 1.0 and budget 5000 tokens
        const anthropic = new Anthropic({
          apiKey: env.ANTHROPIC_API_KEY,
        })

        // Convert Langchain tools to Anthropic format
        const anthropicTools = convertToAnthropicTools(tools)

        // Build system prompt using Anthropic's 2025 best practices
        // Structure: XML tags, explicit actions, chain-of-thought, parallel execution emphasis
        const systemPrompt = `<role>
You are an AI DJ assistant with direct access to Spotify and music enrichment APIs. Your purpose is to help users discover, analyze, and curate music through intelligent tool use and transparent reasoning.
</role>

<capabilities>
You have access to these data sources and capabilities:
- Spotify metadata: Track info, audio features, search, recommendations, playlist management
- Deezer enrichment: BPM, audio rank, gain normalization data
- Last.fm crowd data: Community tags, similar tracks, popularity metrics
- AI-powered analysis: Vibe extraction, discovery planning, intelligent curation
- Iterative data fetching: Summary first, details on demand (prevents context bloat)
</capabilities>

<data_strategy>
CRITICAL: Never fetch more data than needed. Follow this hierarchy:

1. START with analyze_playlist → Returns aggregated insights + track IDs only
   - Why: Provides complete overview in ~2-5KB regardless of playlist size
   - When: User asks about tempo, genres, vibe, era, or wants recommendations

2. FETCH track names with get_playlist_tracks only when user needs to see them
   - Why: Adds ~100 bytes per track, use pagination (20-50 per batch)
   - When: User asks "what tracks are in this" or "show me the tracks"

3. GET full details with get_track_details only for specific tracks
   - Why: Full objects are ~2.5KB each, only fetch when explicitly needed
   - When: User asks about specific tracks' details, album art, or release info

This just-in-time approach keeps context efficient while maintaining complete information access.
</data_strategy>${
          playlistId
            ? `

<current_context>
User has selected playlist: ${playlistId}

ACTION: Auto-inject this ID when calling tools that accept playlist_id parameter (marked optional in tool schemas). This saves the user from having to repeat it.
</current_context>`
            : ''
        }

<decision_framework>
When user asks about a playlist:
- Simple analysis questions → Use analyze_playlist data directly, infer intelligently from available signals
- Missing BPM data? → Infer tempo from genre tags and crowd data rather than saying "not available"
- Track listing requests → Use get_playlist_tracks with appropriate pagination
- Specific track details → Use get_track_details for targeted tracks only
- NEVER speculate about data you haven't fetched - if uncertain, call the appropriate tool

When user wants recommendations or discovery:
EXECUTE this 4-phase vibe-driven workflow (prevents generic algorithm results):

  PHASE 1 - ANALYZE (gather intelligence):
    - Call analyze_playlist to get enrichment data
    - Call get_playlist_tracks (limit 10-20) to get sample track names
    - Call extract_playlist_vibe with analysis + samples
    - Why: Understanding vibe BEFORE searching prevents generic results

  PHASE 2 - PLAN (strategic thinking):
    - Call plan_discovery_strategy with vibe profile + user request
    - Why: AI creates multi-pronged creative search strategy

  PHASE 3 - EXECUTE (parallel tool calls):
    - Follow strategy: Last.fm similar + Spotify searches + tag combos + algorithm
    - IMPORTANT: Execute independent searches in parallel for speed
    - Why: Multiple discovery paths find more interesting candidates

  PHASE 4 - CURATE (intelligent filtering):
    - Call curate_recommendations with all candidates + context
    - Why: AI ranks by vibe alignment, not just popularity

This workflow captures subtle vibe signals that simple algorithmic search misses.
</decision_framework>

<reasoning_requirements>
After each tool use, reflect on the results and determine optimal next steps. Show your thinking:

1. Explain which data sources you're consulting (metadata / Deezer / Last.fm / AI)
2. When planning discovery, articulate the specific vibe characteristics you detected
3. When selecting tracks, explain WHY they fit (don't just list them)
4. If data is sparse or missing, acknowledge limitations and infer from available signals
5. NEVER hallucinate data - if you don't have it, either fetch it with tools or explicitly state uncertainty

Why this matters: Transparent reasoning helps users understand your recommendations and builds trust.
</reasoning_requirements>

<tool_execution>
CRITICAL RULES:
1. Provide all required parameters - never call tools with incomplete arguments
2. Use pagination intelligently - don't fetch 100 tracks when user wants "a few"
3. Parallel tool calls - when operations don't depend on each other, execute them simultaneously for speed
4. Minimal fetching - only get data needed to answer the current question
5. Tool schemas are authoritative - they define exact parameters and return types

EXAMPLE of parallel execution:
When starting discovery, call these in parallel:
  - analyze_playlist
  - get_playlist_tracks (small sample)
Then wait for results before calling extract_playlist_vibe.
</tool_execution>

Be concise, musically knowledgeable, and action-oriented. Describe playlists through their vibe, era, and sonic characteristics, not just genre labels.`

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

        // Build messages in Anthropic format
        // Note: System prompt is separate, not in messages array
        // Convert conversation history to Anthropic message format
        const messages: Anthropic.MessageParam[] = [
          ...request.conversationHistory.map(m => ({
            content: m.content,
            role: m.role,
          })),
          {
            content: actualMessage,
            role: 'user' as const,
          },
        ]

        await sseWriter.write({
          data: {
            level: 'info',
            message: `[${requestId}] Messages prepared: ${messages.length} total, sending to Claude...`,
          },
          type: 'log',
        })
        getLogger()?.info(`[Stream:${requestId}] User message: "${actualMessage}"`)

        // Stream the response using Anthropic SDK
        interface AnthropicToolCall {
          args: Record<string, unknown>
          id: string
          name: string
        }
        let fullResponse = ''
        const toolCalls: AnthropicToolCall[] = []

        getLogger()?.info(`[Stream:${requestId}] Starting Claude streaming with Anthropic SDK...`)
        sseWriter.writeAsync({
          data: 'Analyzing your request...',
          type: 'thinking',
        })

        // Check for abort before API call
        if (abortController.signal.aborted) {
          throw new Error('Request aborted')
        }

        try {
          getLogger()?.info(
            `[Stream:${requestId}] Calling anthropic.messages.stream() with ${messages.length} messages`,
          )

          // Create stream with Anthropic SDK
          // Extended thinking enabled: temperature 1.0, budget 5000 tokens
          const stream = anthropic.messages.stream({
            max_tokens: 10000, // 5000 for thinking + 5000 for response
            messages: messages,
            model: 'claude-sonnet-4-5-20250929',
            system: [
              {
                cache_control: {type: 'ephemeral' as const},
                text: systemPrompt,
                type: 'text' as const,
              },
            ],
            temperature: 1.0, // Required for extended thinking
            thinking: {
              budget_tokens: 5000,
              type: 'enabled' as const,
            },
            tools: anthropicTools,
          })

          getLogger()?.info(`[Stream:${requestId}] Claude stream initialized`)

          // Process streaming events
          let eventCount = 0
          const contentBlocks: Anthropic.ContentBlock[] = []
          let currentBlockIndex = -1

          for await (const event of stream) {
            if (abortController.signal.aborted) {
              throw new Error('Request aborted')
            }

            eventCount++

            if (event.type === 'content_block_start') {
              currentBlockIndex = event.index
              // eslint-disable-next-line security/detect-object-injection
              contentBlocks[currentBlockIndex] = event.content_block

              if (event.content_block.type === 'tool_use') {
                // Initialize tool input as empty string for JSON accumulation
                // This prevents "[object Object]" coercion when concatenating deltas
                event.content_block.input = ''
                getLogger()?.info(`[Stream:${requestId}] Tool use started: ${event.content_block.name}`)
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                // Text content delta
                const text = event.delta.text
                fullResponse += text
                await sseWriter.write({data: text, type: 'content'})
              } else if (event.delta.type === 'thinking_delta') {
                // Skip Claude's internal reasoning tokens (noisy, not useful for end users)
                // Meaningful progress messages are sent separately via tool execution handlers
              } else if (event.delta.type === 'input_json_delta') {
                // Tool input delta - accumulate
                // eslint-disable-next-line security/detect-object-injection
                const currentBlock = contentBlocks[currentBlockIndex]
                if (currentBlock?.type === 'tool_use') {
                  currentBlock.input ??= ''
                  currentBlock.input += event.delta.partial_json
                }
              }
            } else if (event.type === 'content_block_stop') {
              // Content block completed
              const block = contentBlocks[event.index]
              if (block?.type === 'tool_use' && block.id && block.name) {
                // Parse accumulated JSON and add to tool calls
                const inputStr = isString(block.input) ? block.input : '{}'
                try {
                  const input = JSON.parse(inputStr)
                  toolCalls.push({
                    args: input,
                    id: block.id,
                    name: block.name,
                  })
                  getLogger()?.info(`[Stream:${requestId}] Tool use complete: ${block.name}`)
                } catch (parseError) {
                  getLogger()?.error(
                    `[Stream:${requestId}] Failed to parse tool input for ${block.name}`,
                    {
                      error: parseError instanceof Error ? parseError.message : String(parseError),
                      inputType: typeof block.input,
                      inputPreview: inputStr.substring(0, 100),
                    },
                  )
                  // Use empty object as fallback to allow execution to continue
                  toolCalls.push({
                    args: {},
                    id: block.id,
                    name: block.name,
                  })
                }
              }
            }
          }

          getLogger()?.info(
            `[Stream:${requestId}] Initial streaming complete. Events: ${eventCount}, Tool calls: ${toolCalls.length}, Content length: ${fullResponse.length}`,
          )
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
          const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown API error'
          throw new Error(`Claude API failed: ${errorMessage}`)
        }

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
              getLogger()?.warn(
                `[Stream:${requestId}] ⚠️ Loop detected: identical tool calls 3 times in a row. Breaking.`,
              )
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

          // Execute tools and build tool result blocks
          const toolResultBlocks: Anthropic.ToolResultBlockParam[] = []
          for (const toolCall of currentToolCalls) {
            if (abortController.signal.aborted) {
              throw new Error('Request aborted')
            }

            getLogger()?.info(`[Stream:${requestId}] Looking for tool: ${toolCall.name}`)
            const tool = tools.find(t => t.name === toolCall.name)
            if (tool) {
              getLogger()?.info(`[Stream:${requestId}] Executing tool: ${toolCall.name} with args:`, {
                args: JSON.stringify(toolCall.args).substring(0, 200),
              })
              try {
                const result = await tool.func(toolCall.args)
                getLogger()?.info(`[Stream:${requestId}] Tool ${toolCall.name} completed successfully`)

                const toolContent = JSON.stringify(result)
                getLogger()?.info(`[Stream:${requestId}] Tool result JSON length: ${toolContent.length}`)
                getLogger()?.info(`[Stream:${requestId}] Tool result preview: ${toolContent.substring(0, 500)}...`)

                // Create tool result block
                toolResultBlocks.push({
                  content: toolContent,
                  tool_use_id: toolCall.id,
                  type: 'tool_result',
                })

                getLogger()?.info(`[Stream:${requestId}] Created tool result for: ${toolCall.id}`)
              } catch (error) {
                if (abortController.signal.aborted) {
                  throw new Error('Request aborted')
                }
                getLogger()?.error(`[Stream:${requestId}] Tool ${toolCall.name} failed:`, error)
                toolResultBlocks.push({
                  content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  is_error: true,
                  tool_use_id: toolCall.id,
                  type: 'tool_result',
                })
              }
            } else {
              getLogger()?.warn(`[Stream:${requestId}] Tool not found: ${toolCall.name}`)
              toolResultBlocks.push({
                content: `Error: Tool ${toolCall.name} not found`,
                is_error: true,
                tool_use_id: toolCall.id,
                type: 'tool_result',
              })
            }
          }
          getLogger()?.info(`[Stream:${requestId}] All tools executed. Results: ${toolResultBlocks.length}`)

          // Get next response with tool results
          getLogger()?.info(`[Stream:${requestId}] Getting next response from Claude (turn ${turnCount})...`)
          sseWriter.writeAsync({
            data: 'Preparing response...',
            type: 'thinking',
          })

          getLogger()?.info(`[Stream:${requestId}] Sending tool results back to Claude...`)
          getLogger()?.info(`[Stream:${requestId}] Full response so far: "${fullResponse.substring(0, 100)}"`)

          // Build Anthropic format messages for next turn
          // Add assistant's message with tool use blocks
          const assistantToolUseBlocks: Anthropic.ToolUseBlockParam[] = currentToolCalls.map(tc => ({
            id: tc.id,
            input: tc.args,
            name: tc.name,
            type: 'tool_use',
          }))

          // If there was text content before tool calls, include it
          const assistantContent: (Anthropic.ContentBlock | Anthropic.ToolUseBlockParam)[] = []
          if (fullResponse) {
            assistantContent.push({text: fullResponse, type: 'text'} as Anthropic.ContentBlock)
          }
          assistantContent.push(...assistantToolUseBlocks)

          conversationMessages.push({
            content: assistantContent,
            role: 'assistant',
          })

          // Add tool results as a user message
          conversationMessages.push({
            content: toolResultBlocks,
            role: 'user',
          })

          getLogger()?.info(`[Stream:${requestId}] Conversation now has ${conversationMessages.length} messages`)

          let nextStream
          try {
            // Create second stream with tool results
            nextStream = anthropic.messages.stream({
              max_tokens: 10000,
              messages: conversationMessages,
              model: 'claude-sonnet-4-5-20250929',
              system: [
                {
                  cache_control: {type: 'ephemeral' as const},
                  text: systemPrompt,
                  type: 'text' as const,
                },
              ],
              temperature: 1.0,
              // NOTE: Extended thinking disabled for agentic loops to prevent 400 errors
              // Extended thinking can cause message format issues when tool results are sent back
              // See: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
              tools: anthropicTools,
            })
          } catch (streamError) {
            const logger = getLogger()

            // Extract full error details, especially for Anthropic API errors
            const errorDetails: Record<string, unknown> = {
              conversationLength: conversationMessages.length,
              errorMessage: streamError instanceof Error ? streamError.message : String(streamError),
              errorType: streamError?.constructor?.name,
              hasAnyContent,
              turn: turnCount,
            }

            // For Anthropic API errors, extract detailed error information
            if (streamError && typeof streamError === 'object') {
              if ('status' in streamError) errorDetails.httpStatus = streamError.status
              if ('statusCode' in streamError) errorDetails.statusCode = streamError.statusCode
              if ('error' in streamError) {
                errorDetails.apiError = streamError.error
                errorDetails.fullErrorJSON = JSON.stringify(streamError, null, 2)
              }
              if ('headers' in streamError) errorDetails.headers = streamError.headers
            }

            // Include stack trace
            if (streamError instanceof Error && streamError.stack) {
              errorDetails.stack = streamError.stack.split('\n').slice(0, 10).join('\n')
            }

            logger?.error('Claude streaming API call failed', streamError, errorDetails)

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
          const nextToolCalls: AnthropicToolCall[] = []
          getLogger()?.info(`[Stream:${requestId}] Streaming response from Claude (turn ${turnCount})...`)

          try {
            // Process streaming events from second call
            let nextEventCount = 0
            const nextContentBlocks: Anthropic.ContentBlock[] = []
            let nextCurrentBlockIndex = -1

            for await (const event of nextStream) {
              if (abortController.signal.aborted) {
                throw new Error('Request aborted')
              }

              nextEventCount++

              if (event.type === 'content_block_start') {
                nextCurrentBlockIndex = event.index
                // eslint-disable-next-line security/detect-object-injection
                nextContentBlocks[nextCurrentBlockIndex] = event.content_block

                if (event.content_block.type === 'tool_use') {
                  // Initialize tool input as empty string for JSON accumulation
                  // This prevents "[object Object]" coercion when concatenating deltas
                  event.content_block.input = ''
                  getLogger()?.info(
                    `[Stream:${requestId}] Turn ${turnCount} tool use started: ${event.content_block.name}`,
                  )
                }
              } else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                  const text = event.delta.text
                  fullResponse += text
                  hasAnyContent = true
                  await sseWriter.write({data: text, type: 'content'})
                } else if (event.delta.type === 'thinking_delta') {
                  // Skip Claude's internal reasoning tokens (noisy, not useful for end users)
                } else if (event.delta.type === 'input_json_delta') {
                  // eslint-disable-next-line security/detect-object-injection
                  const currentBlock = nextContentBlocks[nextCurrentBlockIndex]
                  if (currentBlock?.type === 'tool_use') {
                    currentBlock.input ??= ''
                    currentBlock.input += event.delta.partial_json
                  }
                }
              } else if (event.type === 'content_block_stop') {
                const block = nextContentBlocks[event.index]
                if (block?.type === 'tool_use' && block.id && block.name) {
                  const inputStr = isString(block.input) ? block.input : '{}'
                  try {
                    const input = JSON.parse(inputStr)
                    nextToolCalls.push({
                      args: input,
                      id: block.id,
                      name: block.name,
                    })
                    getLogger()?.info(`[Stream:${requestId}] Turn ${turnCount} tool use complete: ${block.name}`)
                  } catch (parseError) {
                    getLogger()?.error(
                      `[Stream:${requestId}] Turn ${turnCount} failed to parse tool input for ${block.name}`,
                      {
                        error: parseError instanceof Error ? parseError.message : String(parseError),
                        inputType: typeof block.input,
                        inputPreview: inputStr.substring(0, 100),
                      },
                    )
                    // Use empty object as fallback to allow execution to continue
                    nextToolCalls.push({
                      args: {},
                      id: block.id,
                      name: block.name,
                    })
                  }
                }
              }
            }

            getLogger()?.info(
              `[Stream:${requestId}] Turn ${turnCount} streaming complete. Events: ${nextEventCount}, Tool calls: ${nextToolCalls.length}`,
            )
          } catch (chunkError) {
            const logger = getLogger()

            // Extract full error details, especially for Anthropic API errors
            const errorDetails: Record<string, unknown> = {
              errorMessage: chunkError instanceof Error ? chunkError.message : String(chunkError),
              errorType: chunkError?.constructor?.name,
              partialResponseLength: fullResponse.length,
              turn: turnCount,
            }

            // For Anthropic API errors, extract detailed error information
            if (chunkError && typeof chunkError === 'object') {
              if ('status' in chunkError) errorDetails.httpStatus = chunkError.status
              if ('statusCode' in chunkError) errorDetails.statusCode = chunkError.statusCode
              if ('error' in chunkError) {
                // Anthropic API error structure: { type: "error", error: { type, message } }
                errorDetails.apiError = chunkError.error
                errorDetails.fullErrorJSON = JSON.stringify(chunkError, null, 2)
              }
              if ('headers' in chunkError) errorDetails.headers = chunkError.headers
            }

            // Include stack trace for debugging
            if (chunkError instanceof Error && chunkError.stack) {
              errorDetails.stack = chunkError.stack.split('\n').slice(0, 10).join('\n')
            }

            logger?.error('Error processing Claude stream events', chunkError, errorDetails)

            // If we got partial content, continue; otherwise break
            if (fullResponse.length === 0) {
              logger?.warn('No content received before stream error, breaking agentic loop')
              break
            }
          }

          getLogger()?.info(
            `[Stream:${requestId}] Turn ${turnCount} complete. Content: ${fullResponse.length} chars, Next tool calls: ${nextToolCalls.length}`,
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
          conversationMessages.push({
            content:
              "Please provide your response based on the information you've gathered from the tools you've used.",
            role: 'user',
          })

          sseWriter.writeAsync({
            data: 'Preparing final response...',
            type: 'thinking',
          })

          let finalStream
          try {
            // Create final stream
            finalStream = anthropic.messages.stream({
              max_tokens: 10000,
              messages: conversationMessages,
              model: 'claude-sonnet-4-5-20250929',
              system: [
                {
                  cache_control: {type: 'ephemeral' as const},
                  text: systemPrompt,
                  type: 'text' as const,
                },
              ],
              temperature: 1.0,
              thinking: {
                budget_tokens: 5000,
                type: 'enabled' as const,
              },
              tools: anthropicTools,
            })
          } catch (finalStreamError) {
            const logger = getLogger()
            logger?.error('Final Claude streaming API call failed', finalStreamError, {
              conversationLength: conversationMessages.length,
              errorMessage: finalStreamError instanceof Error ? finalStreamError.message : String(finalStreamError),
              errorType: finalStreamError?.constructor?.name,
              turn: turnCount,
            })

            // Provide useful feedback based on tool executions
            const executedTools = conversationMessages
              .filter(m => m.role === 'assistant')
              .flatMap(m => {
                const content = Array.isArray(m.content) ? m.content : []
                return content
                  .filter((block): block is Anthropic.ToolUseBlockParam => 'type' in block && block.type === 'tool_use')
                  .map(block => block.name)
              })

            if (executedTools.length > 0) {
              const toolSummary = [...new Set(executedTools)].join(', ')
              await sseWriter.write({
                data: `I encountered a streaming error while preparing my response. I was able to execute these tools: ${toolSummary}. Please ask me to clarify any specific information you need.`,
                type: 'content',
              })
              fullResponse = `Executed tools: ${toolSummary}`
            } else {
              await sseWriter.write({
                data: 'I encountered a streaming error. Please try rephrasing your request.',
                type: 'content',
              })
              fullResponse = 'Streaming error occurred'
            }
            getLogger()?.warn(`[Stream:${requestId}] Final response skipped due to streaming error`)
            // Skip the rest of this block
          }

          // Process final stream events
          fullResponse = ''
          if (finalStream) {
            try {
              for await (const event of finalStream) {
                if (abortController.signal.aborted) {
                  throw new Error('Request aborted')
                }

                if (event.type === 'content_block_delta') {
                  if (event.delta.type === 'text_delta') {
                    const text = event.delta.text
                    fullResponse += text
                    await sseWriter.write({data: text, type: 'content'})
                  } else if (event.delta.type === 'thinking_delta') {
                    // Skip Claude's internal reasoning tokens (noisy, not useful for end users)
                  }
                }
              }
            } catch (finalChunkError) {
              const logger = getLogger()
              logger?.error('Error processing final response events', finalChunkError, {
                errorMessage: finalChunkError instanceof Error ? finalChunkError.message : String(finalChunkError),
                errorType: finalChunkError?.constructor?.name,
                partialResponseLength: fullResponse.length,
              })

              // If we got no content, provide useful feedback based on tool executions
              if (fullResponse.length === 0) {
                const executedTools = conversationMessages
                  .filter(m => m.role === 'assistant')
                  .flatMap(m => {
                    const content = Array.isArray(m.content) ? m.content : []
                    return content
                      .filter(
                        (block): block is Anthropic.ToolUseBlockParam => 'type' in block && block.type === 'tool_use',
                      )
                      .map(block => block.name)
                  })

                if (executedTools.length > 0) {
                  const toolSummary = [...new Set(executedTools)].join(', ')
                  await sseWriter.write({
                    data: `I gathered information using: ${toolSummary}. Please ask me to explain any specific details.`,
                    type: 'content',
                  })
                  fullResponse = `Executed tools: ${toolSummary}`
                } else {
                  await sseWriter.write({
                    data: 'I encountered an error processing the response. Please try again.',
                    type: 'content',
                  })
                  fullResponse = 'Processing error occurred'
                }
              }
            }
          }

          getLogger()?.info(`[Stream:${requestId}] Final response after limit: ${fullResponse.length} chars`)
        }

        getLogger()?.info(`[Stream:${requestId}] Agentic loop complete after ${turnCount} turns`)

        // If still no response after everything, provide useful feedback
        if (fullResponse.length === 0) {
          getLogger()?.error(`[Stream:${requestId}] WARNING: No content received from Claude!`)

          // Provide feedback based on what we attempted
          const executedTools = conversationMessages
            .filter(m => m.role === 'assistant')
            .flatMap(m => {
              const content = Array.isArray(m.content) ? m.content : []
              return content
                .filter((block): block is Anthropic.ToolUseBlockParam => 'type' in block && block.type === 'tool_use')
                .map(block => block.name)
            })

          if (executedTools.length > 0) {
            const toolSummary = [...new Set(executedTools)].join(', ')
            await sseWriter.write({
              data: `I successfully called these tools: ${toolSummary}, but encountered an issue formatting my response. Please ask me to explain the results.`,
              type: 'content',
            })
          } else {
            await sseWriter.write({
              data: 'I encountered an issue processing your request. Please try rephrasing or simplifying your request.',
              type: 'content',
            })
          }
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
      }) // End runWithSubrequestTracker
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
