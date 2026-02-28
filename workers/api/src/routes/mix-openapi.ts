/**
 * Mix API routes using OpenAPI contracts
 * Live DJ Mode mix session management
 */

import type {PlayedTrack, QueuedTrack, SpotifyTrackFull} from '@dj/shared-types'
import type {OpenAPIHono} from '@hono/zod-openapi'

import {
  addToQueue,
  endMix,
  getCurrentMix,
  getQueue,
  getSuggestions,
  getVibe,
  queueToSpotify,
  removeFromQueue,
  reorderQueue,
  saveMix,
  startMix,
  steerVibe,
  trackPlayed,
  updatePreferences,
  updateVibe,
} from '@dj/api-contracts'
import {SpotifyPlaylistFullSchema, SpotifyTrackFullSchema, SpotifyUserSchema} from '@dj/shared-types'
import {z} from 'zod'

import type {Env} from '../index'

import {HTTP_STATUS, PAGINATION, VIBE_DEFAULTS} from '../constants'
import {isSuccessResponse} from '../lib/guards'
import {AudioEnrichmentService} from '../services/AudioEnrichmentService'
import {LastFmService} from '../services/LastFmService'
import {MixSessionService} from '../services/MixSessionService'
import {SuggestionEngine} from '../services/SuggestionEngine'
import {getLogger} from '../utils/LoggerContext'

/**
 * Validate BPM is within sane bounds (positive, max 500) or return null
 * Very permissive to allow ambient (<20 BPM) and speedcore (>220 BPM)
 */
function clampBpm(bpm: null | number): null | number {
  if (bpm === null) return null
  if (bpm <= 0 || bpm > 500) return null // Obvious data error, treat as unknown
  return bpm
}

/**
 * Helper to create PlayedTrack from SpotifyTrackFull
 */
function createPlayedTrack(
  track: SpotifyTrackFull,
  bpm: null | number,
  energy: null | number
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

/**
 * Helper to create QueuedTrack from SpotifyTrackFull and enrichment data
 */
function createQueuedTrack(
  track: SpotifyTrackFull,
  position: number,
  vibeScore: number,
  reason: string,
  addedBy: 'ai' | 'user' = 'user'
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
async function extractQuickVibe(
  token: string,
  tracks: {album?: {images?: {url: string}[], release_date?: string}, artists: {name: string}[], duration_ms?: number; id: string, name: string, popularity?: number, uri: string,}[],
  env: Env,
): Promise<{fallbackPool: string[]; vibe: Partial<VibeProfile>,}> {
  const logger = getLogger()

  // Extract genres from artist data
  const allGenres: string[] = []

  // Fetch artist IDs for genre data (batch up to 50)
  const uniqueArtistNames = [...new Set(tracks.flatMap(t => t.artists.map(a => a.name)))]

  // Search for first 10 artists to get genre data
  for (const artistName of uniqueArtistNames.slice(0, 10)) {
    try {
      const searchResp = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (searchResp.ok) {
        const ArtistSearchSchema = z.object({
          artists: z.object({
            items: z.array(z.object({
              genres: z.array(z.string()).optional(),
            })).optional(),
          }).optional(),
        }).passthrough()
        const parsed = ArtistSearchSchema.safeParse(await searchResp.json())
        if (parsed.success) {
          const genres = parsed.data.artists?.items?.[0]?.genres ?? []
          allGenres.push(...genres)
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // Count genre frequency and pick top 5
  const genreCount = new Map<string, number>()
  for (const g of allGenres) {
    genreCount.set(g, (genreCount.get(g) ?? 0) + 1)
  }
  const topGenres = [...genreCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g)

  // Calculate popularity average
  const popularities = tracks.filter(t => t.popularity != null).map(t => t.popularity!)
  const avgPopularity = popularities.length > 0
    ? popularities.reduce((sum, p) => sum + p, 0) / popularities.length
    : 50

  // Map popularity (0-100) to energy level (1-10)
  const energyLevel = Math.max(1, Math.min(10, Math.round(avgPopularity / 10)))

  // Extract release years for era
  const years = tracks
    .map(t => t.album?.release_date)
    .filter(Boolean)
    .map(d => parseInt(d!.slice(0, 4)))
    .filter(y => y >= 1900 && y <= 2100)

  const era = years.length > 0
    ? { end: Math.max(...years), start: Math.min(...years) }
    : { end: 2025, start: 2000 }

  // Try to get BPM range from cached enrichment data
  let bpmRange = { max: 140, min: 80 } // default
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
        // Non-fatal — skip this track
      }
    }
    if (bpms.length >= 3) {
      bpmRange = {
        max: Math.min(220, Math.max(...bpms) + 10),
        min: Math.max(20, Math.min(...bpms) - 10),
      }
    }
  }

  // Build fallback pool: top 10 tracks by popularity
  const fallbackPool = tracks
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, 10)
    .map(t => t.uri)

  logger?.info('[extractQuickVibe] Extracted vibe from seed tracks', {
    bpmRange,
    energyLevel,
    era,
    fallbackPool: fallbackPool.length,
    genres: topGenres.length,
  })

  return {
    fallbackPool,
    vibe: {
      bpmRange,
      energyLevel,
      era,
      genres: topGenres,
      mood: [], // Will be filled by AI on first suggestion batch
    },
  }
}

/**
 * Fetch tracks from a Spotify playlist for seed vibe extraction.
 */
async function fetchSeedPlaylistTracks(
  token: string,
  playlistId: string,
): Promise<{album?: {images?: {url: string}[], release_date?: string}, artists: {name: string}[], duration_ms?: number; id: string, name: string, popularity?: number, uri: string,}[]> {
  const logger = getLogger()
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=items(track(id,uri,name,artists(name),album(images,release_date),popularity,duration_ms))`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!response.ok) {
      logger?.error(`Failed to fetch seed playlist tracks: ${response.status}`)
      return []
    }
    const PlaylistTracksSchema = z.object({
      items: z.array(z.object({
        track: z.object({
          album: z.object({
            images: z.array(z.object({url: z.string()})).optional(),
            release_date: z.string().optional(),
          }).optional(),
          artists: z.array(z.object({name: z.string()})),
          duration_ms: z.number().optional(),
          id: z.string(),
          name: z.string(),
          popularity: z.number().optional(),
          uri: z.string(),
        }).nullable().optional(),
      })).optional(),
    }).passthrough()
    const parsed = PlaylistTracksSchema.safeParse(await response.json())
    if (!parsed.success) return []
    return (parsed.data.items ?? [])
      .map(item => item.track)
      .filter((t): t is NonNullable<typeof t> => t != null)
      .map(t => ({
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

/**
 * Helper to fetch track details from Spotify
 */
async function fetchTrackDetails(trackUri: string, token: string): Promise<null | SpotifyTrackFull> {
  try {
    // Extract track ID from URI (spotify:track:ID)
    const trackId = trackUri.split(':')[2]
    if (!trackId) {
      getLogger()?.error('Invalid track URI format:', trackUri)
      return null
    }

    const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!isSuccessResponse(response)) {
      getLogger()?.error(`Failed to fetch track details: ${response.status}`)
      return null
    }

    const rawData = await response.json()
    const parseResult = SpotifyTrackFullSchema.safeParse(rawData)

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

// =============================================================================
// SEED PLAYLIST & VIBE EXTRACTION (Phase 2)
// =============================================================================

import type {VibeProfile} from '@dj/shared-types'

/**
 * Fetch user's top tracks + recently played for "surprise me" mode.
 */
async function fetchUserSeedTracks(
  token: string,
): Promise<{album?: {images?: {url: string}[], release_date?: string}, artists: {name: string}[], duration_ms?: number; id: string, name: string, popularity?: number, uri: string,}[]> {
  const logger = getLogger()
  const tracks: {album?: {images?: {url: string}[], release_date?: string}, artists: {name: string}[], duration_ms?: number; id: string, name: string, popularity?: number, uri: string,}[] = []
  const seenIds = new Set<string>()

  // Fetch top tracks (short-term = last 4 weeks)
  try {
    const topResp = await fetch(
      'https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=50',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (topResp.ok) {
      const SeedTrackSchema = z.object({
        album: z.object({
          images: z.array(z.object({url: z.string()})).optional(),
          release_date: z.string().optional(),
        }).optional(),
        artists: z.array(z.object({name: z.string()})),
        duration_ms: z.number().optional(),
        id: z.string(),
        name: z.string(),
        popularity: z.number().optional(),
        uri: z.string(),
      }).passthrough()
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

  // Fetch recently played
  try {
    const recentResp = await fetch(
      'https://api.spotify.com/v1/me/player/recently-played?limit=50',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (recentResp.ok) {
      const RecentTrackSchema = z.object({
        album: z.object({
          images: z.array(z.object({url: z.string()})).optional(),
          release_date: z.string().optional(),
        }).optional(),
        artists: z.array(z.object({name: z.string()})),
        duration_ms: z.number().optional(),
        id: z.string(),
        name: z.string(),
        popularity: z.number().optional(),
        uri: z.string(),
      }).passthrough()
      const RecentlyPlayedSchema = z.object({
        items: z.array(z.object({track: RecentTrackSchema})).optional(),
      }).passthrough()
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

/**
 * Helper to get userId from Spotify token
 */
async function getUserIdFromToken(token: string): Promise<null | string> {
  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!isSuccessResponse(response)) {
      return null
    }

    const rawData = await response.json()
    const parseResult = SpotifyUserSchema.safeParse(rawData)

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

/**
 * Helper to create PlayedTrack from QueuedTrack (when moving from queue to history)
 */
function queuedTrackToPlayedTrack(
  queued: QueuedTrack,
  bpm: null | number = null,
  energy: null | number = null
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

// Auto-queue configuration
const TARGET_QUEUE_SIZE = 5

/**
 * Register mix routes on the provided OpenAPI app
 */
export function registerMixRoutes(app: OpenAPIHono<{Bindings: Env}>) {
  // POST /api/mix/start - Create new mix session
  app.openapi(startMix, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      // Get user ID from Spotify token
      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      // Get request body
      const body = await c.req.json()
      const {preferences, seedPlaylistId} = body

      // Check if MIX_SESSIONS KV is available
      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      // Create session service
      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)

      // Check for existing session
      const existingSession = await sessionService.getSession(userId)
      if (existingSession) {
        // Return existing session
        return c.json({session: existingSession}, 200)
      }

      // Create new session
      const session = await sessionService.createSession(userId, preferences)

      getLogger()?.info(`Started mix session for user ${userId}`, {sessionId: session.id})

      // Phase 2: Extract vibe from seed playlist or user profile
      try {
        let seedTracks: {album?: {images?: {url: string}[], release_date?: string}, artists: {name: string}[], duration_ms?: number; id: string, name: string, popularity?: number, uri: string,}[] = []

        if (seedPlaylistId) {
          // Seed from specific playlist
          seedTracks = await fetchSeedPlaylistTracks(token, seedPlaylistId)
          getLogger()?.info(`Extracted ${seedTracks.length} tracks from seed playlist ${seedPlaylistId}`)
        } else {
          // "Surprise me" — seed from user's top tracks + recently played
          seedTracks = await fetchUserSeedTracks(token)
          getLogger()?.info(`Extracted ${seedTracks.length} tracks from user profile (surprise me)`)
        }

        if (seedTracks.length > 0) {
          const { fallbackPool, vibe: extractedVibe } = await extractQuickVibe(token, seedTracks, c.env)

          // Apply extracted vibe to session
          if (extractedVibe.genres?.length) session.vibe.genres = extractedVibe.genres
          if (extractedVibe.energyLevel) session.vibe.energyLevel = extractedVibe.energyLevel
          if (extractedVibe.era) session.vibe.era = extractedVibe.era
          if (extractedVibe.bpmRange) session.vibe.bpmRange = extractedVibe.bpmRange
          session.fallbackPool = fallbackPool

          await sessionService.updateSession(session)
          getLogger()?.info('Applied seed vibe to session', { energy: session.vibe.energyLevel, genres: session.vibe.genres })
        }
      } catch (err) {
        getLogger()?.error('Seed vibe extraction failed (continuing with defaults):', err)
        // Non-fatal — session still works with default vibe
      }

      // Auto-fill initial queue (BLOCKING — user should see filled queue immediately)
      try {
        const addedCount = await autoFillQueue(c.env, token, session, sessionService)
        getLogger()?.info(`Initial auto-fill added ${addedCount} tracks`)
      } catch (err) {
        getLogger()?.error('Initial auto-fill failed:', err)
        // Continue anyway — session is still valid, just empty queue
      }

      return c.json({session}, 200)
    } catch (error) {
      getLogger()?.error('Start mix error:', error)
      const message = error instanceof Error ? error.message : 'Failed to start mix session'
      return c.json({error: message}, 500)
    }
  })

  // GET /api/mix/current - Get current session state
  app.openapi(getCurrentMix, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      // Auto-fill queue if depleted (e.g., after page refresh)
      if (session && session.queue.length < TARGET_QUEUE_SIZE) {
        getLogger()?.info(`Session has ${session.queue.length} tracks, auto-filling to ${TARGET_QUEUE_SIZE}`)
        try {
          const addedCount = await autoFillQueue(c.env, token, session, sessionService)
          getLogger()?.info(`getCurrentMix auto-fill added ${addedCount} tracks`)
        } catch (err) {
          getLogger()?.error('getCurrentMix auto-fill failed:', err)
          // Continue - return session even if auto-fill failed
        }
      }

      return c.json({session}, 200)
    } catch (error) {
      getLogger()?.error('Get current mix error:', error)
      const message = error instanceof Error ? error.message : 'Failed to get current mix'
      return c.json({error: message}, 500)
    }
  })

  // DELETE /api/mix/end - End current session
  app.openapi(endMix, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const stats = await sessionService.endSession(userId)

      if (stats.tracksPlayed === 0 && stats.sessionDuration === 0) {
        return c.json({error: 'No active session'}, 404)
      }

      return c.json({success: true, ...stats}, 200)
    } catch (error) {
      getLogger()?.error('End mix error:', error)
      const message = error instanceof Error ? error.message : 'Failed to end mix session'
      return c.json({error: message}, 500)
    }
  })

  // GET /api/mix/queue - Get current queue
  app.openapi(getQueue, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      if (!session) {
        return c.json({error: 'No active session'}, 404)
      }

      return c.json({queue: session.queue}, 200)
    } catch (error) {
      getLogger()?.error('Get queue error:', error)
      const message = error instanceof Error ? error.message : 'Failed to get queue'
      return c.json({error: message}, 500)
    }
  })

  // POST /api/mix/queue/add - Add track to queue
  app.openapi(addToQueue, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      const body = await c.req.json()
      const {position, trackUri} = body

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      if (!session) {
        return c.json({error: 'No active session'}, 404)
      }

      if (session.queue.length >= PAGINATION.MAX_QUEUE_SIZE) {
        return c.json({error: `Queue is full (max ${PAGINATION.MAX_QUEUE_SIZE} tracks)`}, HTTP_STATUS.BAD_REQUEST)
      }

      // Fetch track details from Spotify
      const trackDetails = await fetchTrackDetails(trackUri, token)
      if (!trackDetails) {
        return c.json({error: 'Failed to fetch track details'}, 400)
      }

      // Create queued track
      const queuedTrack = createQueuedTrack(
        trackDetails,
        position ?? session.queue.length,
        VIBE_DEFAULTS.USER_TRACK_VIBE_SCORE,
        'Manually added',
        'user'
      )

      // Add to queue
      sessionService.addToQueue(session, queuedTrack)

      // Save updated session
      await sessionService.updateSession(session)

      return c.json({queue: session.queue, success: true}, 200)
    } catch (error) {
      getLogger()?.error('Add to queue error:', error)
      const message = error instanceof Error ? error.message : 'Failed to add track to queue'
      return c.json({error: message}, 500)
    }
  })

  // DELETE /api/mix/queue/:position - Remove track from queue
  app.openapi(removeFromQueue, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      const position = c.req.param('position')
      const positionNum = parseInt(position, 10)

      if (isNaN(positionNum) || positionNum < 0) {
        return c.json({error: 'Invalid position'}, 400)
      }

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      if (!session) {
        return c.json({error: 'No active session'}, 404)
      }

      if (positionNum >= session.queue.length) {
        return c.json({error: 'Invalid position'}, 400)
      }

      // Remove from queue
      sessionService.removeFromQueue(session, positionNum)

      // Save updated session
      await sessionService.updateSession(session)

      return c.json({queue: session.queue, success: true}, 200)
    } catch (error) {
      getLogger()?.error('Remove from queue error:', error)
      const message = error instanceof Error ? error.message : 'Failed to remove track from queue'
      return c.json({error: message}, 500)
    }
  })

  // PUT /api/mix/queue/reorder - Reorder queue items
  app.openapi(reorderQueue, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      const body = await c.req.json()
      const {from, to} = body

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      if (!session) {
        return c.json({error: 'No active session'}, 404)
      }

      if (from < 0 || from >= session.queue.length || to < 0 || to >= session.queue.length) {
        return c.json({error: 'Invalid positions'}, 400)
      }

      // Reorder queue
      sessionService.reorderQueue(session, from, to)

      // Save updated session
      await sessionService.updateSession(session)

      return c.json({queue: session.queue, success: true}, 200)
    } catch (error) {
      getLogger()?.error('Reorder queue error:', error)
      const message = error instanceof Error ? error.message : 'Failed to reorder queue'
      return c.json({error: message}, 500)
    }
  })

  // GET /api/mix/vibe - Get current vibe profile
  app.openapi(getVibe, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      if (!session) {
        return c.json({error: 'No active session'}, 404)
      }

      return c.json({vibe: session.vibe}, 200)
    } catch (error) {
      getLogger()?.error('Get vibe error:', error)
      const message = error instanceof Error ? error.message : 'Failed to get vibe profile'
      return c.json({error: message}, 500)
    }
  })

  // PUT /api/mix/vibe - Update vibe preferences
  app.openapi(updateVibe, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      const body = await c.req.json()
      const {bpmRange, energyDirection, energyLevel} = body

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      if (!session) {
        return c.json({error: 'No active session'}, 404)
      }

      // Update vibe using blend
      const updates: Partial<typeof session.vibe> = {}
      if (energyLevel !== undefined) updates.energyLevel = energyLevel
      if (energyDirection !== undefined) updates.energyDirection = energyDirection
      if (bpmRange !== undefined) updates.bpmRange = bpmRange

      const updatedVibe = sessionService.blendVibes(session.vibe, updates, VIBE_DEFAULTS.USER_UPDATE_WEIGHT)

      session.vibe = updatedVibe

      // Clear existing queue and rebuild with new vibe
      sessionService.clearQueue(session)

      // Rebuild queue with new vibe (BLOCKING - user should see new queue immediately)
      try {
        const addedCount = await autoFillQueue(c.env, token, session, sessionService)
        getLogger()?.info(`Vibe update: rebuilt queue with ${addedCount} tracks`)
      } catch (err) {
        getLogger()?.error('Queue rebuild after vibe update failed:', err)
        // Save session even if auto-fill failed
        await sessionService.updateSession(session)
      }

      return c.json({queue: session.queue, vibe: updatedVibe}, 200)
    } catch (error) {
      getLogger()?.error('Update vibe error:', error)
      const message = error instanceof Error ? error.message : 'Failed to update vibe'
      return c.json({error: message}, 500)
    }
  })

  // POST /api/mix/vibe/steer - Natural language vibe steering
  app.openapi(steerVibe, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      const body = await c.req.json()
      const {direction} = body

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      if (!c.env.ANTHROPIC_API_KEY) {
        return c.json({error: 'AI vibe steering not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      if (!session) {
        return c.json({error: 'No active session'}, 404)
      }

      // Import vibe steering function
      const {steerVibe: steerVibeFunc} = await import('../lib/vibe-steering')

      // Steer the vibe using AI
      const updatedVibe = await steerVibeFunc(session.vibe, direction, c.env.ANTHROPIC_API_KEY)

      // Calculate what changed for response
      const changes: string[] = []
      if (updatedVibe.energyLevel !== session.vibe.energyLevel) {
        changes.push(
          `Energy: ${session.vibe.energyLevel}/10 → ${updatedVibe.energyLevel}/10`
        )
      }
      if (updatedVibe.energyDirection !== session.vibe.energyDirection) {
        changes.push(`Direction: ${session.vibe.energyDirection} → ${updatedVibe.energyDirection}`)
      }
      if (JSON.stringify(updatedVibe.era) !== JSON.stringify(session.vibe.era)) {
        changes.push(
          `Era: ${session.vibe.era.start}-${session.vibe.era.end} → ${updatedVibe.era.start}-${updatedVibe.era.end}`
        )
      }
      if (JSON.stringify(updatedVibe.bpmRange) !== JSON.stringify(session.vibe.bpmRange)) {
        changes.push(
          `BPM: ${session.vibe.bpmRange.min}-${session.vibe.bpmRange.max} → ${updatedVibe.bpmRange.min}-${updatedVibe.bpmRange.max}`
        )
      }
      if (updatedVibe.genres.length !== session.vibe.genres.length) {
        const newGenres = updatedVibe.genres.filter(g => !session.vibe.genres.includes(g))
        if (newGenres.length > 0) {
          changes.push(`Added genres: ${newGenres.join(', ')}`)
        }
      }
      if (updatedVibe.mood.length !== session.vibe.mood.length) {
        const newMoods = updatedVibe.mood.filter(m => !session.vibe.mood.includes(m))
        if (newMoods.length > 0) {
          changes.push(`Added moods: ${newMoods.join(', ')}`)
        }
      }

      // Update session with new vibe
      session.vibe = updatedVibe

      // Clear existing queue and rebuild with new vibe
      sessionService.clearQueue(session)

      // Rebuild queue with new vibe (BLOCKING - user should see new queue immediately)
      try {
        const addedCount = await autoFillQueue(c.env, token, session, sessionService)
        getLogger()?.info(`Vibe steer: rebuilt queue with ${addedCount} tracks`)
      } catch (err) {
        getLogger()?.error('Queue rebuild after vibe steer failed:', err)
        // Save session even if auto-fill failed
        await sessionService.updateSession(session)
      }

      getLogger()?.info('Steered vibe for session', {
        changes,
        direction,
        sessionId: session.id,
        userId,
      })

      return c.json({changes, queue: session.queue, vibe: updatedVibe}, 200)
    } catch (error) {
      getLogger()?.error('Steer vibe error:', error)
      const message = error instanceof Error ? error.message : 'Failed to steer vibe'
      return c.json({error: message}, 500)
    }
  })

  // GET /api/mix/suggestions - Get AI suggestions
  app.openapi(getSuggestions, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      const count = parseInt(c.req.query('count') ?? '5', 10)

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      if (!session) {
        return c.json({error: 'No active session'}, 404)
      }

      // Initialize services with extended thinking for quality reasoning
      const lastFmService = new LastFmService(c.env.LASTFM_API_KEY ?? '', c.env.AUDIO_FEATURES_CACHE)
      const audioService = new AudioEnrichmentService(c.env.AUDIO_FEATURES_CACHE)
      const enableThinking = true // Enable extended thinking for deeper track selection reasoning
      const suggestionEngine = new SuggestionEngine(lastFmService, audioService, token, c.env.ANTHROPIC_API_KEY, enableThinking)

      // Generate suggestions
      const suggestions = await suggestionEngine.generateSuggestions(session, count)

      // Log thinking patterns if available
      if (suggestionEngine.lastThinking) {
        getLogger()?.info('[getSuggestions] AI thinking patterns', {
          thinkingSample: suggestionEngine.lastThinking.slice(0, 1000),
        })
      }

      // Build basedOn context
      const currentTrack = session.history[0]?.name
      const vibeProfile = `Energy: ${session.vibe.energyLevel}/10 (${session.vibe.energyDirection}), BPM: ${session.vibe.bpmRange.min}-${session.vibe.bpmRange.max}, Genres: ${session.vibe.genres.join(', ') || 'any'}`

      return c.json(
        {
          basedOn: {
            currentTrack,
            vibeProfile,
          },
          suggestions,
        },
        200
      )
    } catch (error) {
      getLogger()?.error('Get suggestions error:', error)
      const message = error instanceof Error ? error.message : 'Failed to get suggestions'
      return c.json({error: message}, 500)
    }
  })

  // POST /api/mix/save - Save mix as Spotify playlist
  app.openapi(saveMix, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      const body = await c.req.json()
      const {description, includeQueue, name} = body

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      if (!session) {
        return c.json({error: 'No active session'}, 404)
      }

      // Collect track URIs
      const trackUris: string[] = []

      // Add history (newest first, reverse to oldest first for playlist)
      trackUris.push(...session.history.map(t => t.trackUri).reverse())

      // Add queue if requested
      if (includeQueue !== false) {
        trackUris.push(...session.queue.map(t => t.trackUri))
      }

      if (trackUris.length === 0) {
        return c.json({error: 'No tracks to save'}, 400)
      }

      // Get Spotify user ID
      const spotifyUserId = await getUserIdFromToken(token)
      if (!spotifyUserId) {
        return c.json({error: 'Failed to get Spotify user ID'}, 401)
      }

      // Create playlist on Spotify
      const createResponse = await fetch(`https://api.spotify.com/v1/users/${spotifyUserId}/playlists`, {
        body: JSON.stringify({
          description: description ?? `DJ Mix created on ${new Date().toLocaleDateString()}`,
          name,
          public: false,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })

      if (!isSuccessResponse(createResponse)) {
        getLogger()?.error(`Create playlist failed: ${createResponse.status}`)
        return c.json({error: 'Failed to create playlist'}, 500)
      }

      const rawPlaylist = await createResponse.json()
      const playlistParseResult = SpotifyPlaylistFullSchema.safeParse(rawPlaylist)

      if (!playlistParseResult.success) {
        getLogger()?.error('Invalid Spotify playlist response:', playlistParseResult.error)
        return c.json({error: 'Invalid response from Spotify'}, 500)
      }

      const playlist = playlistParseResult.data

      // Add tracks to playlist (Spotify allows max 100 per request)
      const batches = []
      for (let i = 0; i < trackUris.length; i += 100) {
        batches.push(trackUris.slice(i, i + 100))
      }

      for (const batch of batches) {
        const addResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
          body: JSON.stringify({
            uris: batch,
          }),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })

        if (!isSuccessResponse(addResponse)) {
          getLogger()?.error(`Add tracks failed: ${addResponse.status}`)
          // Continue adding other batches even if one fails
        }
      }

      getLogger()?.info(`Saved mix as playlist for user ${userId}`, {
        playlistId: playlist.id,
        trackCount: trackUris.length,
      })

      return c.json(
        {
          playlistId: playlist.id,
          playlistUrl: playlist.external_urls.spotify,
          success: true,
          trackCount: trackUris.length,
        },
        200
      )
    } catch (error) {
      getLogger()?.error('Save mix error:', error)
      const message = error instanceof Error ? error.message : 'Failed to save mix'
      return c.json({error: message}, 500)
    }
  })

  // POST /api/mix/playback/track-played - Notify that a track was played
  app.openapi(trackPlayed, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Invalid authorization token'}, 401)
      }

      const body = await c.req.json()
      const {trackId, trackUri} = body

      // Validate required fields - return 500 as that's what the contract supports
      if (!trackId || typeof trackId !== 'string' || !trackUri || typeof trackUri !== 'string') {
        getLogger()?.error('track-played: Missing or invalid trackId/trackUri', { trackId, trackUri })
        return c.json({error: 'Missing or invalid track data'}, 500)
      }

      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      if (!session) {
        return c.json({error: 'No active session'}, 404)
      }

      let movedToHistory = false

      // Check if this track is in our queue (at position 0)
      const queuedTrack = session.queue.find(t => t.trackId === trackId || t.trackUri === trackUri)

      if (queuedTrack) {
        // Remove from queue
        sessionService.removeFromQueue(session, queuedTrack.position)

        // Try to get audio features for BPM/energy by fetching track details
        let bpm: null | number = null
        const energy: null | number = null

        if (c.env.AUDIO_FEATURES_CACHE) {
          const trackDetails = await fetchTrackDetails(trackUri, token)
          if (trackDetails) {
            const audioService = new AudioEnrichmentService(c.env.AUDIO_FEATURES_CACHE)
            const enrichment = await audioService.enrichTrack(trackDetails)
            if (enrichment) {
              bpm = enrichment.bpm ?? null
            }
          }
        }

        // Create played track and add to history
        const playedTrack = queuedTrackToPlayedTrack(queuedTrack, bpm, energy)
        sessionService.addToHistory(session, playedTrack)

        // Update vibe from the played track
        sessionService.updateVibeFromTrack(session, playedTrack)

        movedToHistory = true

        getLogger()?.info('Moved track from queue to history', {
          historyLength: session.history.length,
          queueLength: session.queue.length,
          trackId,
          userId,
        })
      } else {
        // Track wasn't in our queue - user might be playing something else
        // Still add to history if we can get track details
        const trackDetails = await fetchTrackDetails(trackUri, token)
        if (trackDetails) {
          let bpm: null | number = null
          if (c.env.AUDIO_FEATURES_CACHE) {
            const audioService = new AudioEnrichmentService(c.env.AUDIO_FEATURES_CACHE)
            const enrichment = await audioService.enrichTrack(trackDetails)
            if (enrichment) {
              bpm = enrichment.bpm ?? null
            }
          }

          const playedTrack = createPlayedTrack(trackDetails, bpm, null)
          sessionService.addToHistory(session, playedTrack)
          sessionService.updateVibeFromTrack(session, playedTrack)
          movedToHistory = true
        }
      }

      // Save updated session
      await sessionService.updateSession(session)

      // Auto-fill queue in background — don't block the response (Phase 1b)
      if (movedToHistory && session.queue.length < TARGET_QUEUE_SIZE) {
        c.executionCtx.waitUntil((async () => {
          try {
            // Re-fetch session since we're in background and the response already returned
            const freshSession = await sessionService.getSession(userId)
            if (!freshSession || freshSession.queue.length >= TARGET_QUEUE_SIZE) return
            const addedCount = await autoFillQueue(c.env, token, freshSession, sessionService)
            if (addedCount > 0) {
              getLogger()?.info(`[track-played] Background auto-fill added ${addedCount} tracks`)
            }
          } catch (err) {
            getLogger()?.error('Background auto-fill failed:', err)
          }
        })())
      }

      return c.json({movedToHistory, session, success: true}, 200)
    } catch (error) {
      getLogger()?.error('Track played error:', error)
      const message = error instanceof Error ? error.message : 'Failed to process track played'
      return c.json({error: message}, 500)
    }
  })

  // POST /api/mix/queue/spotify - Add track to Spotify's playback queue
  app.openapi(queueToSpotify, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      const body = await c.req.json()
      const {trackUri} = body

      // Call Spotify's Queue API
      // POST https://api.spotify.com/v1/me/player/queue?uri={uri}
      const response = await fetch(
        `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(trackUri)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          method: 'POST',
        }
      )

      if (response.status === 204) {
        // Success - no content
        getLogger()?.info('Track queued to Spotify', {trackUri})
        return c.json({queued: true, success: true}, 200)
      }

      if (response.status === 404) {
        // No active device
        return c.json(
          {error: 'No active Spotify device. Start playing on a device first.'},
          403
        )
      }

      if (response.status === 403) {
        // Premium required or other restriction
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = (errorData as {error?: {message?: string}}).error?.message ?? 'Spotify Premium required'
        return c.json({error: errorMessage}, 403)
      }

      if (!isSuccessResponse(response)) {
        getLogger()?.error(`Spotify queue failed: ${response.status}`)
        return c.json({error: `Spotify API error: ${response.status}`}, 500)
      }

      return c.json({queued: true, success: true}, 200)
    } catch (error) {
      getLogger()?.error('Queue to Spotify error:', error)
      const message = error instanceof Error ? error.message : 'Failed to queue to Spotify'
      return c.json({error: message}, 500)
    }
  })

  // PATCH /api/mix/preferences - Update session preferences (autoFill toggle)
  app.openapi(updatePreferences, async c => {
    try {
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      if (!token) {
        return c.json({error: 'No authorization token'}, 401)
      }

      // Check if KV is available
      if (!c.env.MIX_SESSIONS) {
        return c.json({error: 'Mix sessions not available'}, 500)
      }

      // Get userId from token
      const userId = await getUserIdFromToken(token)
      if (!userId) {
        return c.json({error: 'Failed to get user identity'}, 401)
      }

      const sessionService = new MixSessionService(c.env.MIX_SESSIONS)
      const session = await sessionService.getSession(userId)

      if (!session) {
        return c.json({error: 'No active mix session'}, 404)
      }

      const body = await c.req.json()
      const {autoFill} = body

      // Update preferences
      if (autoFill !== undefined) {
        session.preferences.autoFill = autoFill
      }

      // Save updated session
      await sessionService.updateSession(session)

      getLogger()?.info(`Updated preferences for session ${session.id}`, {autoFill})

      // If autoFill was just enabled and queue is low, trigger auto-fill
      if (autoFill && session.queue.length < TARGET_QUEUE_SIZE) {
        try {
          const addedCount = await autoFillQueue(c.env, token, session, sessionService)
          getLogger()?.info(`Preferences update: auto-fill added ${addedCount} tracks`)
        } catch (err) {
          getLogger()?.error('Auto-fill after preferences update failed:', err)
          // Continue - non-fatal
        }
      }

      return c.json({preferences: session.preferences, session, success: true}, 200)
    } catch (error) {
      getLogger()?.error('Update preferences error:', error)
      const message = error instanceof Error ? error.message : 'Failed to update preferences'
      return c.json({error: message}, 500)
    }
  })
}

/**
 * Auto-fill queue to target size with AI suggestions
 * This is the server-side implementation of automatic queue management.
 * Returns the number of tracks added.
 */
async function autoFillQueue(
  env: Env,
  token: string,
  session: import('@dj/shared-types').MixSession,
  sessionService: MixSessionService
): Promise<number> {
  // Check if autoFill is enabled in session preferences (default to true if not set)
  const autoFillEnabled = session.preferences.autoFill ?? true
  if (!autoFillEnabled) {
    getLogger()?.info('Auto-fill disabled in session preferences, skipping')
    return 0
  }

  const queueSize = session.queue.length
  const tracksNeeded = TARGET_QUEUE_SIZE - queueSize

  if (tracksNeeded <= 0) {
    return 0
  }

  getLogger()?.info(`Auto-filling queue: ${queueSize} → ${TARGET_QUEUE_SIZE} (need ${tracksNeeded} tracks)`)

  try {
    // Initialize suggestion engine with extended thinking enabled for quality reasoning
    const lastFmService = new LastFmService(env.LASTFM_API_KEY ?? '', env.AUDIO_FEATURES_CACHE)
    const audioService = new AudioEnrichmentService(env.AUDIO_FEATURES_CACHE)
    const enableThinking = true // Enable extended thinking for deeper track selection reasoning
    const suggestionEngine = new SuggestionEngine(lastFmService, audioService, token, env.ANTHROPIC_API_KEY, enableThinking)

    // Generate suggestions with 8-second timeout (Phase 3c)
    // If Claude is slow, fall through to fallback pool below
    const suggestions = await Promise.race([
      suggestionEngine.generateSuggestions(session, tracksNeeded + 3),
      new Promise<import('@dj/shared-types').Suggestion[]>(resolve =>
        setTimeout(() => {
          getLogger()?.warn('[autoFillQueue] Suggestion generation timed out after 8s, using fallbacks')
          resolve([])
        }, 8000)
      ),
    ])

    // Log thinking patterns if available (for prompt optimization)
    if (suggestionEngine.lastThinking) {
      getLogger()?.info('[autoFillQueue] AI thinking patterns captured for analysis', {
        thinkingSample: suggestionEngine.lastThinking.slice(0, 1000),
      })
    }

    if (suggestions.length === 0) {
      getLogger()?.info('No suggestions generated for auto-fill')
      return 0
    }

    // Get URIs already in queue and history to avoid duplicates
    const existingUris = new Set([
      ...session.history.map((t) => t.trackUri),
      ...session.queue.map((t) => t.trackUri),
    ])

    // Filter out duplicates
    const availableSuggestions = suggestions.filter((s) => !existingUris.has(s.trackUri))

    if (availableSuggestions.length === 0) {
      getLogger()?.info('All suggestions are duplicates, skipping auto-fill')
      return 0
    }

    // Take only what we need
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

      // Also queue to Spotify's playback queue (best effort)
      try {
        const spotifyResponse = await fetch(
          `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(suggestion.trackUri)}`,
          {
            headers: {Authorization: `Bearer ${token}`},
            method: 'POST',
          }
        )
        if (spotifyResponse.status === 204) {
          getLogger()?.info(`Queued to Spotify: ${suggestion.name}`)
        }
      } catch {
        // Non-fatal - might fail if no active device or not Premium
        getLogger()?.warn(`Could not queue to Spotify: ${suggestion.name}`)
      }
    }

    // Phase 3c: If AI returned nothing (timeout or failure), use fallback pool
    if (addedCount === 0 && session.fallbackPool.length > 0) {
      getLogger()?.info('[autoFillQueue] Using fallback pool', { poolSize: session.fallbackPool.length })
      const fallbacksNeeded = Math.min(tracksNeeded, session.fallbackPool.length)

      for (let i = 0; i < fallbacksNeeded; i++) {
        const fallbackUri = session.fallbackPool.shift()!
        // Check it's not already in queue/history
        if (existingUris.has(fallbackUri)) continue

        const trackDetails = await fetchTrackDetails(fallbackUri, token)
        if (trackDetails) {
          const position = session.queue.length
          const queuedTrack = createQueuedTrack(trackDetails, position, 50, 'Fallback from seed playlist', 'ai')
          sessionService.addToQueue(session, queuedTrack)
          addedCount++

          // Queue to Spotify (best effort)
          try {
            await fetch(
              `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(fallbackUri)}`,
              { headers: { Authorization: `Bearer ${token}` }, method: 'POST' }
            )
          } catch {
            // Non-fatal
          }
        }
      }
    }

    // Save updated session
    await sessionService.updateSession(session)

    getLogger()?.info(`Auto-fill complete: added ${addedCount} tracks, queue now has ${session.queue.length} tracks`)
    return addedCount
  } catch (error) {
    getLogger()?.error('Auto-fill error:', error)
    return 0
  }
}
