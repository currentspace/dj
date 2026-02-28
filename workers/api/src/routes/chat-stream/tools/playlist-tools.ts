import {
  SpotifyPlaylistTracksResponseSchema,
  SpotifySearchResponseSchema,
  type SpotifyTrackFull,
  SpotifyTrackFullSchema,
} from '@dj/shared-types'
import {z} from 'zod'

import type {Env} from '../../../index'
import type {ProgressNarrator} from '../../../lib/progress-narrator'
import type {SSEWriter} from '../streaming/sse-writer'
import type {CreatePlaylistResult, NativeTool} from '../types'

import {executeSpotifyTool} from '../../../lib/spotify-tools'
import {getLogger} from '../../../utils/LoggerContext'
import {rateLimitedSpotifyCall} from '../../../utils/RateLimitedAPIClients'
import {executeAnalyzePlaylist} from '../enrichment'
import {isNumber, isStringArray} from '../streaming/anthropic-utils'

/**
 * Create playlist-related Spotify tools
 */
export function createPlaylistTools(
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
  return [
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

        // Use enhanced executeAnalyzePlaylist with progress streaming and narrator
        const result = await executeAnalyzePlaylist(
          finalArgs,
          spotifyToken,
          sseWriter,
          env,
          narrator,
          userRequest,
          recentMessages,
        )

        const analysisResult = result
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
              data: `Using cached tracks ${finalArgs.offset}-${finalArgs.offset + finalArgs.limit}`,
              type: 'thinking',
            })
            data = cached as z.infer<typeof SpotifyPlaylistTracksResponseSchema>
          } else {
            getLogger()?.info(`[get_playlist_tracks] Cache miss, fetching from Spotify`)
            await sseWriter.write({
              data: `Fetching tracks ${finalArgs.offset}-${finalArgs.offset + finalArgs.limit}...`,
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
            data: `Fetching tracks ${finalArgs.offset}-${finalArgs.offset + finalArgs.limit}...`,
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
          data: `Loaded ${compactTracks.length} tracks`,
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
          data: `Fetching details for ${trackIds.length} tracks...`,
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
          data: `Loaded details for ${detailedTracks.length} tracks`,
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
          data: `Searching Spotify for ${args.similar_tracks.length} Last.fm recommendations...`,
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
          data: `Found ${recommendations.length} tracks (${successCount}/${args.similar_tracks.length} successful)`,
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
          data: `Searching Spotify for tracks matching tags: ${args.tags.join(', ')}`,
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
          data: `Found ${recommendations.length} tracks matching ${args.tags.length} tags`,
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
  ]
}
