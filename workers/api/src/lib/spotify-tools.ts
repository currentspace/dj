/**
 * Spotify Tools for Anthropic Function Calling
 *
 * NOTE: Several Spotify Web API endpoints were deprecated on November 27, 2024:
 * - /audio-features (get_audio_features)
 * - /recommendations (get_recommendations)
 * - /audio-analysis
 * - /recommendations/available-genre-seeds
 *
 * These endpoints are no longer available for apps created after Nov 27, 2024.
 * See: https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
 *
 * This project uses Deezer API for BPM/audio data and Last.fm for recommendations instead.
 */
import {
  SpotifyAlbumFullSchema,
  SpotifyCreatePlaylistResponseSchema,
  SpotifyPagingSchema,
  SpotifyPlaylistFullSchema,
  SpotifyPlaylistTracksResponseSchema,
  SpotifySearchResponseSchema,
  SpotifyTrackFullSchema,
  SpotifyUserSchema,
} from '@dj/shared-types'
import {z} from 'zod'

import {getLogger} from '../utils/LoggerContext'
import {rateLimitedSpotifyCall} from '../utils/RateLimitedAPIClients'
import {formatZodError, safeParse} from './guards'

// =============================================================================
// ZOD SCHEMAS FOR PLAYER API RESPONSES
// =============================================================================

/** Schema for now playing response */
const NowPlayingResponseSchema = z.object({
  is_playing: z.boolean(),
  item: z.object({
    album: z.object({name: z.string()}).optional(),
    artists: z.array(z.object({name: z.string()})).optional(),
    duration_ms: z.number(),
    name: z.string(),
    uri: z.string(),
  }).nullable().optional(),
  progress_ms: z.number().nullable().optional(),
})

/** Schema for queue response */
const QueueResponseSchema = z.object({
  currently_playing: z.object({
    artists: z.array(z.object({name: z.string()})).optional(),
    name: z.string(),
    uri: z.string(),
  }).nullable(),
  queue: z.array(z.object({
    artists: z.array(z.object({name: z.string()})).optional(),
    name: z.string(),
    uri: z.string(),
  })),
})

/** Schema for playback state response */
const PlaybackStateResponseSchema = z.object({
  context: z.object({
    href: z.string(),
    type: z.string(),
    uri: z.string(),
  }).nullable(),
  currently_playing_type: z.string(),
  device: z.object({
    id: z.string().nullable(),
    is_active: z.boolean(),
    is_private_session: z.boolean(),
    is_restricted: z.boolean(),
    name: z.string(),
    supports_volume: z.boolean(),
    type: z.string(),
    volume_percent: z.number().nullable(),
  }),
  is_playing: z.boolean(),
  item: z.object({
    album: z.object({
      images: z.array(z.object({url: z.string()})).optional(),
      name: z.string(),
    }).optional(),
    artists: z.array(z.object({name: z.string()})).optional(),
    duration_ms: z.number(),
    name: z.string(),
    uri: z.string(),
  }).nullable(),
  progress_ms: z.number().nullable(),
  repeat_state: z.enum(['off', 'track', 'context']),
  shuffle_state: z.boolean(),
  timestamp: z.number(),
})

/** Schema for related artists response */
const RelatedArtistsResponseSchema = z.object({
  artists: z.array(z.object({
    genres: z.array(z.string()).optional(),
    id: z.string(),
    images: z.array(z.object({url: z.string()})).optional(),
    name: z.string(),
    popularity: z.number().optional(),
  })),
})

/** Schema for artist search response */
const ArtistSearchResponseSchema = z.object({
  artists: SpotifyPagingSchema(z.object({
    genres: z.array(z.string()).optional(),
    id: z.string(),
    images: z.array(z.object({url: z.string()})).optional(),
    name: z.string(),
    popularity: z.number().optional(),
  })),
})

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

// Type guards for runtime type checking of unknown values
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

// Tool schemas
export const SearchTracksSchema = z.object({
  limit: z.number().min(1).max(50).default(10).describe('Number of results to return'),
  query: z.string().describe('Search query for tracks'),
})

export const CreatePlaylistSchema = z.object({
  description: z.string().max(300).optional(),
  name: z.string().min(1).max(100),
  public: z.boolean().default(false),
  track_uris: z.array(z.string()).describe('Spotify track URIs to add'),
})

export const ModifyPlaylistSchema = z.object({
  action: z.enum(['add', 'remove', 'reorder']),
  playlist_id: z.string(),
  position: z.number().optional().describe('Position to insert tracks (for add/reorder)'),
  track_uris: z.array(z.string()),
})

// Tool definitions for Anthropic
export const spotifyTools = [
  {
    description: 'Search for tracks on Spotify by query string',
    input_schema: {
      properties: {
        limit: {
          default: 10,
          description: 'Number of results (1-50)',
          type: 'number',
        },
        query: {
          description: 'Search query (artist name, song name, etc.)',
          type: 'string',
        },
      },
      required: ['query'],
      type: 'object',
    },
    name: 'search_spotify_tracks',
  },
  {
    description: 'Create a new Spotify playlist and add tracks',
    input_schema: {
      properties: {
        description: {
          description: 'Playlist description',
          maxLength: 300,
          type: 'string',
        },
        name: {
          description: 'Playlist name',
          maxLength: 100,
          minLength: 1,
          type: 'string',
        },
        public: {
          default: false,
          description: 'Make playlist public',
          type: 'boolean',
        },
        track_uris: {
          description: 'Spotify track URIs to add (spotify:track:...)',
          items: {type: 'string'},
          type: 'array',
        },
      },
      required: ['name', 'track_uris'],
      type: 'object',
    },
    name: 'create_playlist',
  },
  {
    description: 'Add, remove, or reorder tracks in an existing playlist',
    input_schema: {
      properties: {
        action: {
          description: 'Action to perform',
          enum: ['add', 'remove', 'reorder'],
          type: 'string',
        },
        playlist_id: {
          description: 'Spotify playlist ID',
          type: 'string',
        },
        position: {
          description: 'Position for insertion (add/reorder)',
          minimum: 0,
          type: 'number',
        },
        track_uris: {
          description: 'Track URIs to add/remove/reorder',
          items: {type: 'string'},
          type: 'array',
        },
      },
      required: ['playlist_id', 'action', 'track_uris'],
      type: 'object',
    },
    name: 'modify_playlist',
  },
  // Queue & Playback Tools (DJ Mode)
  {
    description:
      "Add a track to the user's playback queue. Use this when the user asks to queue a song or add something to play next.",
    input_schema: {
      properties: {
        uri: {
          description: 'Spotify track URI (format: spotify:track:xxx)',
          type: 'string',
        },
      },
      required: ['uri'],
      type: 'object',
    },
    name: 'add_to_queue',
  },
  {
    description:
      "Get what is currently playing on the user's Spotify. Returns track name, artist, progress, and whether it's playing.",
    input_schema: {
      properties: {},
      required: [],
      type: 'object',
    },
    name: 'get_now_playing',
  },
  {
    description: "Get the user's current playback queue - shows what's playing now and what's coming up next.",
    input_schema: {
      properties: {},
      required: [],
      type: 'object',
    },
    name: 'get_queue',
  },
  {
    description: 'Control playback: play, pause, skip to next track, or go to previous track.',
    input_schema: {
      properties: {
        action: {
          description: 'The playback action to perform',
          enum: ['play', 'pause', 'next', 'previous'],
          type: 'string',
        },
      },
      required: ['action'],
      type: 'object',
    },
    name: 'control_playback',
  },
  {
    description:
      "Get full playback state including device info, shuffle/repeat status, and what playlist/album is playing from. More detailed than get_now_playing.",
    input_schema: {
      properties: {},
      required: [],
      type: 'object',
    },
    name: 'get_playback_state',
  },
  {
    description: 'Toggle shuffle mode on or off for playback.',
    input_schema: {
      properties: {
        state: {
          description: 'Whether shuffle should be on (true) or off (false)',
          type: 'boolean',
        },
      },
      required: ['state'],
      type: 'object',
    },
    name: 'set_shuffle',
  },
  {
    description: 'Set repeat mode for playback.',
    input_schema: {
      properties: {
        state: {
          description: 'Repeat mode: "off" (no repeat), "track" (repeat current track), "context" (repeat playlist/album)',
          enum: ['off', 'track', 'context'],
          type: 'string',
        },
      },
      required: ['state'],
      type: 'object',
    },
    name: 'set_repeat',
  },
  {
    description: 'Set playback volume (0-100). Only works on devices that support volume control.',
    input_schema: {
      properties: {
        volume_percent: {
          description: 'Volume level from 0 to 100',
          maximum: 100,
          minimum: 0,
          type: 'number',
        },
      },
      required: ['volume_percent'],
      type: 'object',
    },
    name: 'set_volume',
  },
  {
    description:
      "Transfer playback to a different device (e.g., from phone to computer). Use get_playback_state first to see available devices.",
    input_schema: {
      properties: {
        device_id: {
          description: 'The device ID to transfer playback to',
          type: 'string',
        },
        play: {
          description: 'Whether to start playing on the new device (default: true)',
          type: 'boolean',
        },
      },
      required: ['device_id'],
      type: 'object',
    },
    name: 'transfer_playback',
  },
  {
    description: 'Analyze an existing playlist to understand its characteristics (track metadata, artist frequency, genres)',
    input_schema: {
      properties: {
        playlist_id: {
          description: 'Spotify playlist ID to analyze',
          type: 'string',
        },
      },
      required: ['playlist_id'],
      type: 'object',
    },
    name: 'analyze_playlist',
  },
]

// Tool executor with logging
export async function executeSpotifyTool(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
  _cache?: KVNamespace,  
): Promise<unknown> {
  getLogger()?.info(`[Tool] Executing ${toolName} with args:`, {args: JSON.stringify(args).substring(0, 200)})
  const startTime = Date.now()

  try {
    let result
    switch (toolName) {
      // Queue & Playback Tools (DJ Mode)
      case 'add_to_queue':
        result = await addToQueue(args, token)
        break
      case 'analyze_playlist':
        result = await analyzePlaylist(args, token)
        break
      case 'control_playback':
        result = await controlPlayback(args, token)
        break
      case 'create_playlist':
        result = await createPlaylist(args, token)
        break
      case 'get_album_info':
        result = await getAlbumInfo(args, token)
        break
      case 'get_artist_info':
        result = await getArtistInfo(args, token)
        break
      case 'get_artist_top_tracks':
        result = await getArtistTopTracks(args, token)
        break
      case 'get_now_playing':
        result = await getNowPlaying(token)
        break
      case 'get_playback_state':
        result = await getPlaybackState(token)
        break
      case 'get_queue':
        result = await getQueue(token)
        break
      case 'get_related_artists':
        result = await getRelatedArtists(args, token)
        break
      case 'get_track_details':
        result = await getTrackDetails(args, token)
        break
      case 'modify_playlist':
        result = await modifyPlaylist(args, token)
        break
      case 'search_artists':
        result = await searchArtists(args, token)
        break
      case 'search_spotify_tracks':
        result = await searchSpotifyTracks(args as z.infer<typeof SearchTracksSchema>, token)
        break
      case 'set_repeat':
        result = await setRepeat(args, token)
        break
      case 'set_shuffle':
        result = await setShuffle(args, token)
        break
      case 'set_volume':
        result = await setVolume(args, token)
        break
      case 'transfer_playback':
        result = await transferPlayback(args, token)
        break
      default:
        getLogger()?.error(`[Tool] Unknown tool: ${toolName}`)
        throw new Error(`Unknown tool: ${toolName}`)
    }

    const duration = Date.now() - startTime
    getLogger()?.info(`[Tool] ${toolName} completed successfully in ${duration}ms`)
    return result
  } catch (error) {
    const duration = Date.now() - startTime
    getLogger()?.error(`[Tool] ${toolName} failed after ${duration}ms:`, error)
    throw error
  }
}

async function addToQueue(args: Record<string, unknown>, token: string) {
  const uri = isString(args.uri) ? args.uri : null
  if (!uri) {
    throw new Error('Track URI is required')
  }

  getLogger()?.info(`[Tool:addToQueue] Adding ${uri} to queue`)

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`, {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      }),
    undefined,
    'player:queue'
  )

  if (response.status === 204) {
    return {message: 'Track added to queue', success: true, uri}
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to add to queue: ${response.status} - ${errorText}`)
  }

  return {message: 'Track added to queue', success: true, uri}
}

async function analyzePlaylist(args: Record<string, unknown>, token: string) {
  const {playlist_id} = args

  getLogger()?.info(`[analyzePlaylist] Starting analysis with args:`, {args: JSON.stringify(args)})
  getLogger()?.info(`[analyzePlaylist] Extracted playlist_id: "${playlist_id}"`)
  getLogger()?.info(`[analyzePlaylist] Token present: ${token ? 'YES' : 'NO'}`)

  if (!playlist_id) {
    getLogger()?.error(`[analyzePlaylist] CRITICAL: playlist_id is missing or empty!`)
    throw new Error('playlist_id parameter is required')
  }

  // Get playlist details
  getLogger()?.info(`[analyzePlaylist] Fetching playlist details for ID: ${playlist_id}`)
  const playlistResponse = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/playlists/${playlist_id}`, {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'playlist:details',
  )

  getLogger()?.info(`[analyzePlaylist] Playlist API response status: ${playlistResponse.status}`)

  if (!playlistResponse.ok) {
    const errorText = await playlistResponse.text()
    getLogger()?.error(`[analyzePlaylist] Failed to get playlist: ${playlistResponse.status} - ${errorText}`)
    throw new Error(`Failed to get playlist: ${playlistResponse.status}`)
  }

  const playlistJson = await playlistResponse.json()
  const playlistResult = safeParse(SpotifyPlaylistFullSchema, playlistJson)

  if (!playlistResult.success) {
    getLogger()?.error('[analyzePlaylist] Failed to parse playlist:', formatZodError(playlistResult.error))
    throw new Error(`Invalid playlist data: ${formatZodError(playlistResult.error)}`)
  }

  const playlist = playlistResult.data
  getLogger()?.info(`[analyzePlaylist] Successfully got playlist: "${playlist.name}" (${playlist.tracks?.total} tracks)`)

  // Get tracks
  getLogger()?.info(`[analyzePlaylist] Fetching playlist tracks...`)
  const tracksResponse = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/playlists/${playlist_id}/tracks?limit=100`, {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'playlist:tracks',
  )

  getLogger()?.info(`[analyzePlaylist] Tracks API response status: ${tracksResponse.status}`)

  if (!tracksResponse.ok) {
    const errorText = await tracksResponse.text()
    getLogger()?.error(`[analyzePlaylist] Failed to get playlist tracks: ${tracksResponse.status} - ${errorText}`)
    throw new Error(`Failed to get playlist tracks: ${tracksResponse.status}`)
  }

  const tracksJson = await tracksResponse.json()
  const tracksResult = safeParse(SpotifyPlaylistTracksResponseSchema, tracksJson)

  if (!tracksResult.success) {
    getLogger()?.error('[analyzePlaylist] Failed to parse tracks:', formatZodError(tracksResult.error))
    throw new Error(`Invalid tracks data: ${formatZodError(tracksResult.error)}`)
  }

  const tracksData = tracksResult.data
  const tracks = tracksData.items
    .map(item => item.track)
    .filter((track): track is NonNullable<typeof track> => track !== null)
  const trackIds = tracks.map(t => t.id).filter(Boolean)
  getLogger()?.info(`[analyzePlaylist] Found ${tracks.length} tracks, ${trackIds.length} with valid IDs`)

  // NOTE: Audio features endpoint was deprecated by Spotify on November 27, 2024
  // See: https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
  // BPM/tempo data is now provided by Deezer via AudioEnrichmentService instead

  // Create analysis object with track metadata
  const analysis = {
    // Add genre analysis from artists (tracks don't have genres, but artists do)
    // Note: Artist genres may not be available in all responses
    genres: Array.from(
      new Set(
        tracks.flatMap((t) =>
          t.artists?.flatMap((a) => {
            // Artists may have genres property depending on the endpoint
            const artistObj = a as Record<string, unknown>
            const genres = Array.isArray(artistObj.genres) ? artistObj.genres.filter((g): g is string => typeof g === 'string') : []
            return genres
          }) ?? []
        )
      )
    ).slice(0, 5),
    playlist_description: playlist.description ?? 'No description',
    playlist_name: playlist.name,
    // Only include a sample of tracks with minimal data (not full track objects)
    sample_tracks: tracks.slice(0, 5).map((track) => ({
      artists: track.artists?.map((a) => a.name).join(', ') ?? 'Unknown',
      duration_ms: track.duration_ms,
      name: track.name,
      popularity: track.popularity,
    })),
    // Include artist frequency analysis
    top_artists: Object.entries(
      tracks.reduce<Record<string, number>>((acc, track) => {
        track.artists?.forEach((artist) => {
          acc[artist.name] = (acc[artist.name] ?? 0) + 1
        })
        return acc
      }, {}),
    )
      .sort((a, b) => {
        const countA = a[1]
        const countB = b[1]
        return (typeof countB === 'number' ? countB : 0) - (typeof countA === 'number' ? countA : 0)
      })
      .slice(0, 5)
      .map(([artist, count]) => ({artist, track_count: count})),
    total_tracks: tracks.length,
  }

  getLogger()?.info(
    `[analyzePlaylist] Analysis complete! Playlist: "${analysis.playlist_name}", Tracks: ${analysis.total_tracks}`,
  )
  getLogger()?.info(`[analyzePlaylist] Analysis object size: ${JSON.stringify(analysis).length} bytes`)

  return analysis
}

async function controlPlayback(args: Record<string, unknown>, token: string) {
  const action = isString(args.action) ? args.action : null
  if (!action || !['next', 'pause', 'play', 'previous'].includes(action)) {
    throw new Error('Valid action is required: play, pause, next, or previous')
  }

  getLogger()?.info(`[Tool:controlPlayback] Executing ${action}`)

  const endpoints: Record<string, {method: string; url: string}> = {
    next: {method: 'POST', url: 'https://api.spotify.com/v1/me/player/next'},
    pause: {method: 'PUT', url: 'https://api.spotify.com/v1/me/player/pause'},
    play: {method: 'PUT', url: 'https://api.spotify.com/v1/me/player/play'},
    previous: {method: 'POST', url: 'https://api.spotify.com/v1/me/player/previous'},
  }

  // eslint-disable-next-line security/detect-object-injection
  const {method, url} = endpoints[action]

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(url, {
        headers: {Authorization: `Bearer ${token}`},
        method,
      }),
    undefined,
    `player:${action}`
  )

  if (response.status === 204 || response.ok) {
    return {action, message: `Playback ${action} successful`, success: true}
  }

  const errorText = await response.text()
  throw new Error(`Failed to ${action}: ${response.status} - ${errorText}`)
}

async function createPlaylist(args: Record<string, unknown>, token: string) {
  getLogger()?.info(`[Tool:createPlaylist] Creating playlist: ${args.name}`)

  // Get user ID first
  const userResponse = await rateLimitedSpotifyCall(
    () =>
      fetch('https://api.spotify.com/v1/me', {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'user:profile',
  )

  if (!userResponse.ok) {
    getLogger()?.error(`[Tool:createPlaylist] Failed to get user profile: ${userResponse.status}`)
    throw new Error('Failed to get user profile')
  }

  const userJson = await userResponse.json()
  const userResult = safeParse(SpotifyUserSchema, userJson)

  if (!userResult.success) {
    getLogger()?.error('[Tool:createPlaylist] Failed to parse user data:', formatZodError(userResult.error))
    throw new Error(`Invalid user data: ${formatZodError(userResult.error)}`)
  }

  const userId = userResult.data.id
  getLogger()?.info(`[Tool:createPlaylist] User ID: ${userId}`)

  // Create playlist
  const createResponse = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
        body: JSON.stringify({
          description: args.description ?? '',
          name: args.name,
          public: args.public ?? false,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    undefined,
    'playlist:create',
  )

  if (!createResponse.ok) {
    getLogger()?.error(`[Tool:createPlaylist] Failed to create playlist: ${createResponse.status}`)
    throw new Error('Failed to create playlist')
  }

  const playlistJson = await createResponse.json()
  const playlistResult = safeParse(SpotifyCreatePlaylistResponseSchema, playlistJson)

  if (!playlistResult.success) {
    getLogger()?.error('[Tool:createPlaylist] Failed to parse playlist response:', formatZodError(playlistResult.error))
    throw new Error(`Invalid playlist response: ${formatZodError(playlistResult.error)}`)
  }

  const playlist = playlistResult.data
  getLogger()?.info(`[Tool:createPlaylist] Playlist created with ID: ${playlist.id}`)

  // Add tracks if provided
  if (isStringArray(args.track_uris) && args.track_uris.length > 0) {
    const addResponse = await rateLimitedSpotifyCall(
      () =>
        fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
          body: JSON.stringify({
            uris: args.track_uris,
          }),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        }),
      undefined,
      'playlist:add-tracks',
    )

    if (!addResponse.ok) {
      throw new Error('Failed to add tracks to playlist')
    }
  }

  return playlist
}

async function getAlbumInfo(args: Record<string, unknown>, token: string) {
  const {album_id} = args

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/albums/${album_id}`, {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'album:info',
  )

  if (!response.ok) {
    throw new Error(`Failed to get album info: ${response.status}`)
  }

  const albumJson = await response.json()
  const albumResult = safeParse(SpotifyAlbumFullSchema, albumJson)

  if (!albumResult.success) {
    getLogger()?.error('[getAlbumInfo] Failed to parse album data:', formatZodError(albumResult.error))
    throw new Error(`Invalid album data: ${formatZodError(albumResult.error)}`)
  }

  const album = albumResult.data

  // NOTE: Audio features endpoint was deprecated by Spotify on November 27, 2024
  // See: https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api

  // Return compact album format to reduce payload size
  return {
    id: album.id,
    images: album.images?.slice(0, 1), // Only largest image
    name: album.name,
    release_date: album.release_date,
    total_tracks: album.total_tracks,
    tracks: album.tracks?.items?.slice(0, 10).map(t => ({
      artists: t.artists?.map((a: {name: string}) => a.name).join(', '),
      duration_ms: t.duration_ms,
      id: t.id,
      name: t.name,
      track_number: t.track_number,
    })),
  }
}

async function getArtistInfo(args: Record<string, unknown>, token: string) {
  const {artist_id} = args

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/artists/${artist_id}`, {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'artist:info',
  )

  if (!response.ok) {
    throw new Error(`Failed to get artist info: ${response.status}`)
  }

  return await response.json()
}

async function getArtistTopTracks(args: Record<string, unknown>, token: string) {
  const {artist_id, market = 'US'} = args

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/artists/${artist_id}/top-tracks?market=${market}`, {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'artist:top-tracks',
  )

  if (!response.ok) {
    throw new Error(`Failed to get artist top tracks: ${response.status}`)
  }

  const json = await response.json()
  const result = safeParse(SpotifyPagingSchema(SpotifyTrackFullSchema), json)

  if (!result.success) {
    getLogger()?.error('[getArtistTopTracks] Failed to parse response:', formatZodError(result.error))
    return []
  }

  // Return compact track format to reduce payload size
  return (result.data.items ?? []).map(track => ({
    album: track.album ? {
      name: track.album.name,
      release_date: track.album.release_date,
    } : undefined,
    artists: track.artists?.map(a => a.name).join(', '),
    id: track.id,
    name: track.name,
    popularity: track.popularity,
    uri: track.uri,
  }))
}

async function getNowPlaying(token: string) {
  getLogger()?.info('[Tool:getNowPlaying] Fetching current playback')

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'player:current'
  )

  if (response.status === 204) {
    return {is_playing: false, message: 'Nothing currently playing'}
  }

  if (!response.ok) {
    throw new Error(`Failed to get now playing: ${response.status}`)
  }

  const json: unknown = await response.json()
  const result = safeParse(NowPlayingResponseSchema, json)

  if (!result.success) {
    getLogger()?.error('[getNowPlaying] Failed to parse response:', formatZodError(result.error))
    throw new Error(`Invalid now playing response: ${formatZodError(result.error)}`)
  }

  const data = result.data

  return {
    album: data.item?.album?.name,
    artists: data.item?.artists?.map(a => a.name).join(', '),
    duration_ms: data.item?.duration_ms,
    is_playing: data.is_playing,
    progress_ms: data.progress_ms,
    track_name: data.item?.name,
    uri: data.item?.uri,
  }
}

async function getPlaybackState(token: string) {
  getLogger()?.info('[Tool:getPlaybackState] Fetching full playback state')

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch('https://api.spotify.com/v1/me/player', {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'player:state'
  )

  if (response.status === 204) {
    return {
      is_playing: false,
      message: 'No active playback session. Start playing on any device first.',
    }
  }

  if (!response.ok) {
    throw new Error(`Failed to get playback state: ${response.status}`)
  }

  const json: unknown = await response.json()
  const result = safeParse(PlaybackStateResponseSchema, json)

  if (!result.success) {
    getLogger()?.error('[getPlaybackState] Failed to parse response:', formatZodError(result.error))
    throw new Error(`Invalid playback state response: ${formatZodError(result.error)}`)
  }

  const data = result.data

  return {
    // Context (playlist/album being played)
    context: data.context ? {
      type: data.context.type,
      uri: data.context.uri,
    } : null,
    currently_playing_type: data.currently_playing_type,
    // Device info
    device: {
      id: data.device?.id,
      is_active: data.device?.is_active,
      name: data.device?.name,
      supports_volume: data.device?.supports_volume,
      type: data.device?.type,
      volume_percent: data.device?.volume_percent,
    },
    // Current track
    is_playing: data.is_playing,
    progress_ms: data.progress_ms,
    repeat_state: data.repeat_state,
    // Playback settings
    shuffle_state: data.shuffle_state,
    track: data.item ? {
      album: data.item.album?.name,
      artists: data.item.artists?.map(a => a.name).join(', '),
      duration_ms: data.item.duration_ms,
      name: data.item.name,
      uri: data.item.uri,
    } : null,
  }
}

async function getQueue(token: string) {
  getLogger()?.info('[Tool:getQueue] Fetching queue')

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'player:queue'
  )

  if (!response.ok) {
    throw new Error(`Failed to get queue: ${response.status}`)
  }

  const json: unknown = await response.json()
  const result = safeParse(QueueResponseSchema, json)

  if (!result.success) {
    getLogger()?.error('[getQueue] Failed to parse response:', formatZodError(result.error))
    throw new Error(`Invalid queue response: ${formatZodError(result.error)}`)
  }

  const data = result.data

  return {
    currently_playing: data.currently_playing
      ? {
          artists: data.currently_playing.artists?.map(a => a.name).join(', '),
          name: data.currently_playing.name,
          uri: data.currently_playing.uri,
        }
      : null,
    queue: data.queue.slice(0, 10).map(track => ({
      artists: track.artists?.map(a => a.name).join(', '),
      name: track.name,
      uri: track.uri,
    })),
    queue_length: data.queue.length,
  }
}

// ==================== Queue & Playback Tools (DJ Mode) ====================

async function getRelatedArtists(args: Record<string, unknown>, token: string) {
  const {artist_id} = args

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/artists/${artist_id}/related-artists`, {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'artist:related',
  )

  if (!response.ok) {
    throw new Error(`Failed to get related artists: ${response.status}`)
  }

  const json: unknown = await response.json()
  const result = safeParse(RelatedArtistsResponseSchema, json)

  if (!result.success) {
    getLogger()?.error('[getRelatedArtists] Failed to parse response:', formatZodError(result.error))
    return []
  }

  return result.data.artists ?? []
}

async function getTrackDetails(args: Record<string, unknown>, token: string) {
  const {track_id} = args

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/tracks/${track_id}`, {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'track:details',
  )

  if (!response.ok) {
    throw new Error(`Failed to get track details: ${response.status}`)
  }

  const trackJson = await response.json()
  const trackResult = safeParse(SpotifyTrackFullSchema, trackJson)

  if (!trackResult.success) {
    getLogger()?.error('[getTrackDetails] Failed to parse track:', formatZodError(trackResult.error))
    throw new Error(`Invalid track data: ${formatZodError(trackResult.error)}`)
  }

  const track = trackResult.data

  // NOTE: Audio features endpoint was deprecated by Spotify on November 27, 2024
  // See: https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api

  return {
    album: {
      id: track.album.id,
      images: track.album.images,
      name: track.album.name,
      release_date: track.album.release_date,
    },
    artists: track.artists,
    duration_ms: track.duration_ms,
    explicit: track.explicit,
    id: track.id,
    name: track.name,
    popularity: track.popularity,
    preview_url: track.preview_url,
    uri: track.uri,
  }
}

async function modifyPlaylist(args: Record<string, unknown>, token: string) {
  const {action, playlist_id, position, track_uris} = args

  if (!isStringArray(track_uris)) {
    throw new Error('track_uris must be an array of strings')
  }

  const url = `https://api.spotify.com/v1/playlists/${playlist_id}/tracks`
  let method = 'POST'
  let body: Record<string, unknown> = {}

  switch (action) {
    case 'add':
      body.uris = track_uris
      if (position !== undefined) body.position = position
      break
    case 'remove':
      method = 'DELETE'
      body.tracks = track_uris.map((uri: string) => ({uri}))
      break
    case 'reorder':
      method = 'PUT'
      body = {
        insert_before: args.insert_before,
        range_length: track_uris.length,
        range_start: position,
      }
      break
  }

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(url, {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method,
      }),
    undefined,
    `playlist:${isString(action) ? action : 'modify'}`,
  )

  if (!response.ok) {
    throw new Error(`Failed to ${isString(action) ? action : 'modify'} tracks: ${response.status}`)
  }

  return {action, success: true, track_count: track_uris.length}
}

async function searchArtists(args: Record<string, unknown>, token: string) {
  const {limit = 10, query} = args

  if (!isString(query)) {
    throw new Error('query must be a string')
  }

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=${limit}`, {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'search:artists',
  )

  if (!response.ok) {
    throw new Error(`Failed to search artists: ${response.status}`)
  }

  const json: unknown = await response.json()
  const result = safeParse(ArtistSearchResponseSchema, json)

  if (!result.success) {
    getLogger()?.error('[searchArtists] Failed to parse response:', formatZodError(result.error))
    return []
  }

  return result.data.artists?.items ?? []
}

// Implementation functions
async function searchSpotifyTracks(
  args: z.infer<typeof SearchTracksSchema>,
  token: string,
): Promise<z.infer<typeof SpotifyTrackFullSchema>[]> {
  const {limit = 10, query} = args

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`, {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'search:tracks',
  )

  if (!response.ok) {
    throw new Error(`Spotify search failed: ${response.status}`)
  }

  const json = await response.json()
  const result = safeParse(SpotifySearchResponseSchema, json)

  if (!result.success) {
    getLogger()?.error('[searchSpotifyTracks] Failed to parse response:', formatZodError(result.error))
    throw new Error(`Invalid search response: ${formatZodError(result.error)}`)
  }

  // NOTE: Audio features endpoint was deprecated by Spotify on November 27, 2024
  // Filter by energy/tempo is no longer available. Use Deezer API for BPM filtering instead.
  // See: https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api

  return result.data.tracks?.items ?? []
}

async function setRepeat(args: Record<string, unknown>, token: string) {
  const state = isString(args.state) && ['context', 'off', 'track'].includes(args.state) ? args.state : null
  if (!state) {
    throw new Error('state is required: "off", "track", or "context"')
  }

  getLogger()?.info(`[Tool:setRepeat] Setting repeat to ${state}`)

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/me/player/repeat?state=${state}`, {
        headers: {Authorization: `Bearer ${token}`},
        method: 'PUT',
      }),
    undefined,
    'player:repeat'
  )

  if (response.status === 204 || response.ok) {
    const messages: Record<string, string> = {
      context: 'Repeating playlist/album',
      off: 'Repeat disabled',
      track: 'Repeating current track',
    }
    // eslint-disable-next-line security/detect-object-injection
    return {message: messages[state], repeat: state, success: true}
  }

  const errorText = await response.text()
  throw new Error(`Failed to set repeat: ${response.status} - ${errorText}`)
}

async function setShuffle(args: Record<string, unknown>, token: string) {
  const state = typeof args.state === 'boolean' ? args.state : null
  if (state === null) {
    throw new Error('state (boolean) is required')
  }

  getLogger()?.info(`[Tool:setShuffle] Setting shuffle to ${state}`)

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/me/player/shuffle?state=${state}`, {
        headers: {Authorization: `Bearer ${token}`},
        method: 'PUT',
      }),
    undefined,
    'player:shuffle'
  )

  if (response.status === 204 || response.ok) {
    return {message: `Shuffle ${state ? 'enabled' : 'disabled'}`, shuffle: state, success: true}
  }

  const errorText = await response.text()
  throw new Error(`Failed to set shuffle: ${response.status} - ${errorText}`)
}

async function setVolume(args: Record<string, unknown>, token: string) {
  const volumePercent = typeof args.volume_percent === 'number' ? args.volume_percent : null
  if (volumePercent === null || volumePercent < 0 || volumePercent > 100) {
    throw new Error('volume_percent (0-100) is required')
  }

  getLogger()?.info(`[Tool:setVolume] Setting volume to ${volumePercent}%`)

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round(volumePercent)}`, {
        headers: {Authorization: `Bearer ${token}`},
        method: 'PUT',
      }),
    undefined,
    'player:volume'
  )

  if (response.status === 204 || response.ok) {
    return {message: `Volume set to ${volumePercent}%`, success: true, volume_percent: volumePercent}
  }

  const errorText = await response.text()
  throw new Error(`Failed to set volume: ${response.status} - ${errorText}`)
}

async function transferPlayback(args: Record<string, unknown>, token: string) {
  const deviceId = isString(args.device_id) ? args.device_id : null
  if (!deviceId) {
    throw new Error('device_id is required')
  }

  const play = typeof args.play === 'boolean' ? args.play : true

  getLogger()?.info(`[Tool:transferPlayback] Transferring to device ${deviceId}, play: ${play}`)

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch('https://api.spotify.com/v1/me/player', {
        body: JSON.stringify({
          device_ids: [deviceId],
          play,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      }),
    undefined,
    'player:transfer'
  )

  if (response.status === 204 || response.ok) {
    return {device_id: deviceId, message: `Playback transferred to device`, success: true}
  }

  const errorText = await response.text()
  throw new Error(`Failed to transfer playback: ${response.status} - ${errorText}`)
}
