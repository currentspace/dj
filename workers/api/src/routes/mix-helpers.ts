/**
 * Mix route helpers — extracted from mix-openapi.ts for readability.
 *
 * Pure functions and Spotify-fetch utilities used by the mix route handlers.
 * Route registration itself lives in mix-openapi.ts.
 */

import type {Env} from '../index'
import type {MixSession, PlayedTrack, QueuedTrack, SpotifyTrackFull, Suggestion, VibeProfile} from '@dj/shared-types'

import {SpotifyTrackFullSchema, SpotifyUserSchema} from '@dj/shared-types'
import {z} from 'zod'

import {isSuccessResponse} from '../lib/guards'
import {AudioEnrichmentService} from '../services/AudioEnrichmentService'
import {LastFmService} from '../services/LastFmService'
import {MixSessionService} from '../services/MixSessionService'
import {SuggestionEngine} from '../services/SuggestionEngine'
import {getLogger} from '../utils/LoggerContext'

// Auto-queue configuration
export const TARGET_QUEUE_SIZE = 5

interface SeedTrack {
  album?: {images?: {url: string}[]; release_date?: string}
  artists: {name: string}[]
  duration_ms?: number
  id: string
  name: string
  popularity?: number
  uri: string
}

/**
 * Auto-fill the queue using AI-generated suggestions, falling back to the
 * session's seed pool if generation fails or times out.
 */
export async function autoFillQueue(
  env: Env,
  token: string,
  session: MixSession,
  sessionService: MixSessionService,
): Promise<number> {
  const autoFillEnabled = session.preferences.autoFill ?? true
  if (!autoFillEnabled) {
    getLogger()?.info('Auto-fill disabled in session preferences, skipping')
    return 0
  }

  const queueSize = session.queue.length
  const tracksNeeded = TARGET_QUEUE_SIZE - queueSize
  if (tracksNeeded <= 0) return 0

  getLogger()?.info(`Auto-filling queue: ${queueSize} → ${TARGET_QUEUE_SIZE} (need ${tracksNeeded} tracks)`)

  try {
    const lastFmService = new LastFmService(env.LASTFM_API_KEY ?? '', env.AUDIO_FEATURES_CACHE)
    const audioService = new AudioEnrichmentService(env.AUDIO_FEATURES_CACHE)
    const suggestionEngine = new SuggestionEngine(
      lastFmService,
      audioService,
      token,
      env.ANTHROPIC_API_KEY,
      true, // enable extended thinking for deeper track selection
    )

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const suggestions = await Promise.race([
      suggestionEngine.generateSuggestions(session, tracksNeeded + 3),
      new Promise<Suggestion[]>((resolve) => {
        timeoutId = setTimeout(() => {
          getLogger()?.warn('[autoFillQueue] Suggestion generation timed out after 8s, using fallbacks')
          resolve([])
        }, 8000)
      }),
    ])
    clearTimeout(timeoutId)

    if (suggestionEngine.lastThinking) {
      getLogger()?.info('[autoFillQueue] AI thinking patterns captured for analysis', {
        thinkingSample: suggestionEngine.lastThinking.slice(0, 1000),
      })
    }

    if (suggestions.length === 0) {
      getLogger()?.info('No suggestions generated for auto-fill')
      return 0
    }

    const existingUris = new Set([
      ...session.history.map((t) => t.trackUri),
      ...session.queue.map((t) => t.trackUri),
    ])

    const availableSuggestions = suggestions.filter((s) => !existingUris.has(s.trackUri))
    if (availableSuggestions.length === 0) {
      getLogger()?.info('All suggestions are duplicates, skipping auto-fill')
      return 0
    }

    const toAdd = availableSuggestions.slice(0, tracksNeeded)
    let addedCount = 0

    for (const suggestion of toAdd) {
      const position = session.queue.length
      const queuedTrack: QueuedTrack = {
        addedBy: 'ai',
        albumArt: suggestion.albumArt,
        artist: suggestion.artist,
        name: suggestion.name,
        position,
        reason: suggestion.reason,
        trackId: suggestion.trackId,
        trackUri: suggestion.trackUri,
        vibeScore: suggestion.vibeScore,
      }
      sessionService.addToQueue(session, queuedTrack)
      addedCount++

      try {
        const spotifyResponse = await fetch(
          `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(suggestion.trackUri)}`,
          {headers: {Authorization: `Bearer ${token}`}, method: 'POST'},
        )
        if (spotifyResponse.status === 204) {
          getLogger()?.info(`Queued to Spotify: ${suggestion.name}`)
        }
      } catch {
        getLogger()?.warn(`Could not queue to Spotify: ${suggestion.name}`)
      }
    }

    if (addedCount === 0 && session.fallbackPool.length > 0) {
      getLogger()?.info('[autoFillQueue] Using fallback pool', {poolSize: session.fallbackPool.length})
      const fallbacksNeeded = Math.min(tracksNeeded, session.fallbackPool.length)

      for (let i = 0; i < fallbacksNeeded; i++) {
        const fallbackUri = session.fallbackPool.shift()!
        if (existingUris.has(fallbackUri)) continue

        const trackDetails = await fetchTrackDetails(fallbackUri, token)
        if (trackDetails) {
          const position = session.queue.length
          const queuedTrack = createQueuedTrack(trackDetails, position, 50, 'Fallback from seed playlist', 'ai')
          sessionService.addToQueue(session, queuedTrack)
          addedCount++

          try {
            await fetch(
              `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(fallbackUri)}`,
              {headers: {Authorization: `Bearer ${token}`}, method: 'POST'},
            )
          } catch {
            // Non-fatal
          }
        }
      }
    }

    await sessionService.updateSession(session)
    getLogger()?.info(`Auto-fill complete: added ${addedCount} tracks, queue now has ${session.queue.length} tracks`)
    return addedCount
  } catch (error) {
    getLogger()?.error('Auto-fill error:', error)
    return 0
  }
}

/**
 * Validate BPM is within sane bounds (positive, max 500) or return null.
 * Permissive to allow ambient (<20 BPM) and speedcore (>220 BPM).
 */
export function clampBpm(bpm: null | number): null | number {
  if (bpm === null) return null
  if (bpm <= 0 || bpm > 500) return null
  return bpm
}

/** Build a PlayedTrack from a Spotify track + enrichment. */
export function createPlayedTrack(
  track: SpotifyTrackFull,
  bpm: null | number,
  energy: null | number,
): PlayedTrack {
  return {
    albumArt: track.album?.images?.[0]?.url,
    artist: track.artists?.[0]?.name || 'Unknown Artist',
    bpm: clampBpm(bpm),
    energy,
    name: track.name,
    playedAt: new Date().toISOString(),
    trackId: track.id,
    trackUri: track.uri,
  }
}

/** Build a QueuedTrack from a Spotify track + queue metadata. */
export function createQueuedTrack(
  track: SpotifyTrackFull,
  position: number,
  vibeScore: number,
  reason: string,
  addedBy: 'ai' | 'user' = 'user',
): QueuedTrack {
  return {
    addedBy,
    albumArt: track.album?.images?.[0]?.url,
    artist: track.artists?.[0]?.name || 'Unknown Artist',
    name: track.name,
    position,
    reason,
    trackId: track.id,
    trackUri: track.uri,
    vibeScore,
  }
}

/**
 * Extract a quick vibe profile from a set of Spotify tracks.
 * Uses only cached enrichment data (no new external API calls on session start).
 * Returns vibe + fallback pool of top tracks.
 */
export async function extractQuickVibe(
  token: string,
  tracks: SeedTrack[],
  env: Env,
): Promise<{fallbackPool: string[]; vibe: Partial<VibeProfile>}> {
  const logger = getLogger()
  const allGenres: string[] = []
  const uniqueArtistNames = [...new Set(tracks.flatMap((t) => t.artists.map((a) => a.name)))]

  for (const artistName of uniqueArtistNames.slice(0, 10)) {
    try {
      const searchResp = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`,
        {headers: {Authorization: `Bearer ${token}`}},
      )
      if (searchResp.ok) {
        const ArtistSearchSchema = z
          .object({
            artists: z
              .object({
                items: z.array(z.object({genres: z.array(z.string()).optional()})).optional(),
              })
              .optional(),
          })
          .passthrough()
        const parsed = ArtistSearchSchema.safeParse(await searchResp.json())
        if (parsed.success) {
          allGenres.push(...(parsed.data.artists?.items?.[0]?.genres ?? []))
        }
      }
    } catch {
      // Non-fatal
    }
  }

  const genreCount = new Map<string, number>()
  for (const g of allGenres) genreCount.set(g, (genreCount.get(g) ?? 0) + 1)
  const topGenres = [...genreCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g)

  const popularities = tracks.filter((t) => t.popularity != null).map((t) => t.popularity!)
  const avgPopularity =
    popularities.length > 0 ? popularities.reduce((sum, p) => sum + p, 0) / popularities.length : 50
  const energyLevel = Math.max(1, Math.min(10, Math.round(avgPopularity / 10)))

  const years = tracks
    .map((t) => t.album?.release_date)
    .filter(Boolean)
    .map((d) => parseInt(d!.slice(0, 4)))
    .filter((y) => y >= 1900 && y <= 2100)

  const era =
    years.length > 0 ? {end: Math.max(...years), start: Math.min(...years)} : {end: 2025, start: 2000}

  let bpmRange = {max: 140, min: 80}
  if (env.AUDIO_FEATURES_CACHE) {
    const audioService = new AudioEnrichmentService(env.AUDIO_FEATURES_CACHE)
    const bpms: number[] = []
    for (const track of tracks.slice(0, 20)) {
      try {
        const enrichment = await audioService.enrichTrack({
          artists: track.artists,
          duration_ms: track.duration_ms ?? 0,
          id: track.id,
          name: track.name,
        })
        if (enrichment.bpm) bpms.push(enrichment.bpm)
      } catch {
        // Non-fatal
      }
    }
    if (bpms.length >= 3) {
      bpmRange = {
        max: Math.min(220, Math.max(...bpms) + 10),
        min: Math.max(20, Math.min(...bpms) - 10),
      }
    }
  }

  const fallbackPool = tracks
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, 10)
    .map((t) => t.uri)

  logger?.info('[extractQuickVibe] Extracted vibe from seed tracks', {
    bpmRange,
    energyLevel,
    era,
    fallbackPool: fallbackPool.length,
    genres: topGenres.length,
  })

  return {
    fallbackPool,
    vibe: {bpmRange, energyLevel, era, genres: topGenres, mood: []},
  }
}

/** Fetch tracks from a Spotify playlist for seed vibe extraction. */
export async function fetchSeedPlaylistTracks(token: string, playlistId: string): Promise<SeedTrack[]> {
  const logger = getLogger()
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=items(track(id,uri,name,artists(name),album(images,release_date),popularity,duration_ms))`,
      {headers: {Authorization: `Bearer ${token}`}},
    )
    if (!response.ok) {
      logger?.error(`Failed to fetch seed playlist tracks: ${response.status}`)
      return []
    }
    const PlaylistTracksSchema = z
      .object({
        items: z
          .array(
            z.object({
              track: z
                .object({
                  album: z
                    .object({
                      images: z.array(z.object({url: z.string()})).optional(),
                      release_date: z.string().optional(),
                    })
                    .optional(),
                  artists: z.array(z.object({name: z.string()})),
                  duration_ms: z.number().optional(),
                  id: z.string(),
                  name: z.string(),
                  popularity: z.number().optional(),
                  uri: z.string(),
                })
                .nullable()
                .optional(),
            }),
          )
          .optional(),
      })
      .passthrough()
    const parsed = PlaylistTracksSchema.safeParse(await response.json())
    if (!parsed.success) return []
    return (parsed.data.items ?? [])
      .map((item) => item.track)
      .filter((t): t is NonNullable<typeof t> => t != null)
      .map((t) => ({
        album: t.album,
        artists: t.artists,
        duration_ms: t.duration_ms,
        id: t.id,
        name: t.name,
        popularity: t.popularity,
        uri: t.uri,
      }))
  } catch (error) {
    logger?.error('fetchSeedPlaylistTracks error:', error)
    return []
  }
}

/** Fetch a single Spotify track's full details by URI. */
export async function fetchTrackDetails(
  trackUri: string,
  token: string,
): Promise<null | SpotifyTrackFull> {
  try {
    const trackId = trackUri.split(':')[2]
    if (!trackId) {
      getLogger()?.error('Invalid track URI format:', trackUri)
      return null
    }
    const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: {Authorization: `Bearer ${token}`},
    })
    if (!isSuccessResponse(response)) {
      getLogger()?.error(`Failed to fetch track details: ${response.status}`)
      return null
    }
    const parseResult = SpotifyTrackFullSchema.safeParse(await response.json())
    if (!parseResult.success) {
      getLogger()?.error('Invalid Spotify track response:', parseResult.error)
      return null
    }
    return parseResult.data
  } catch (error) {
    getLogger()?.error('Failed to fetch track details:', error)
    return null
  }
}

/** Fetch user's top + recently-played tracks for "surprise me" mode. */
export async function fetchUserSeedTracks(token: string): Promise<SeedTrack[]> {
  const logger = getLogger()
  const tracks: SeedTrack[] = []
  const seenIds = new Set<string>()

  const SeedTrackSchema = z
    .object({
      album: z
        .object({
          images: z.array(z.object({url: z.string()})).optional(),
          release_date: z.string().optional(),
        })
        .optional(),
      artists: z.array(z.object({name: z.string()})),
      duration_ms: z.number().optional(),
      id: z.string(),
      name: z.string(),
      popularity: z.number().optional(),
      uri: z.string(),
    })
    .passthrough()

  try {
    const topResp = await fetch(
      'https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=50',
      {headers: {Authorization: `Bearer ${token}`}},
    )
    if (topResp.ok) {
      const TopTracksSchema = z.object({items: z.array(SeedTrackSchema).optional()}).passthrough()
      const parsed = TopTracksSchema.safeParse(await topResp.json())
      if (parsed.success) {
        for (const t of parsed.data.items ?? []) {
          if (!seenIds.has(t.id)) {
            seenIds.add(t.id)
            tracks.push(t)
          }
        }
      }
    }
  } catch {
    logger?.warn('Failed to fetch top tracks for surprise me')
  }

  try {
    const recentResp = await fetch(
      'https://api.spotify.com/v1/me/player/recently-played?limit=50',
      {headers: {Authorization: `Bearer ${token}`}},
    )
    if (recentResp.ok) {
      const RecentlyPlayedSchema = z
        .object({items: z.array(z.object({track: SeedTrackSchema})).optional()})
        .passthrough()
      const parsed = RecentlyPlayedSchema.safeParse(await recentResp.json())
      if (parsed.success) {
        for (const item of parsed.data.items ?? []) {
          if (!seenIds.has(item.track.id)) {
            seenIds.add(item.track.id)
            tracks.push(item.track)
          }
        }
      }
    }
  } catch {
    logger?.warn('Failed to fetch recently played for surprise me')
  }

  logger?.info(`[fetchUserSeedTracks] Fetched ${tracks.length} seed tracks from user profile`)
  return tracks
}

/** Resolve userId from a Spotify access token via /v1/me. */
export async function getUserIdFromToken(token: string): Promise<null | string> {
  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: {Authorization: `Bearer ${token}`},
    })
    if (!isSuccessResponse(response)) return null
    const parseResult = SpotifyUserSchema.safeParse(await response.json())
    if (!parseResult.success) {
      getLogger()?.error('Invalid Spotify user response:', parseResult.error)
      return null
    }
    return parseResult.data.id
  } catch (error) {
    getLogger()?.error('Failed to get user ID from token:', error)
    return null
  }
}

/** Convert a queued track back into a played-track entry (for queue→history transitions). */
export function queuedTrackToPlayedTrack(
  queued: QueuedTrack,
  bpm: null | number = null,
  energy: null | number = null,
): PlayedTrack {
  return {
    albumArt: queued.albumArt,
    artist: queued.artist,
    bpm: clampBpm(bpm),
    energy,
    name: queued.name,
    playedAt: new Date().toISOString(),
    trackId: queued.trackId,
    trackUri: queued.trackUri,
  }
}
