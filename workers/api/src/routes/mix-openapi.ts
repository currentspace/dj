/**
 * Mix API routes using OpenAPI contracts
 * Live DJ Mode mix session management
 */

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
  updateVibe,
} from '@dj/api-contracts'
import type {PlayedTrack, QueuedTrack, SpotifyTrackFull} from '@dj/shared-types'
import {SpotifyPlaylistFullSchema, SpotifyTrackFullSchema, SpotifyUserSchema} from '@dj/shared-types'

import {HTTP_STATUS, PAGINATION, VIBE_DEFAULTS} from '../constants'
import type {Env} from '../index'
import {isSuccessResponse} from '../lib/guards'
import {AudioEnrichmentService} from '../services/AudioEnrichmentService'
import {LastFmService} from '../services/LastFmService'
import {MixSessionService} from '../services/MixSessionService'
import {SuggestionEngine} from '../services/SuggestionEngine'
import {getLogger} from '../utils/LoggerContext'

/**
 * Helper to get userId from Spotify token
 */
async function getUserIdFromToken(token: string): Promise<string | null> {
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
 * Helper to fetch track details from Spotify
 */
async function fetchTrackDetails(trackUri: string, token: string): Promise<SpotifyTrackFull | null> {
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

/**
 * Helper to create QueuedTrack from SpotifyTrackFull and enrichment data
 */
function createQueuedTrack(
  track: SpotifyTrackFull,
  position: number,
  vibeScore: number,
  reason: string,
  addedBy: 'user' | 'ai' = 'user'
): QueuedTrack {
  return {
    trackId: track.id,
    trackUri: track.uri,
    name: track.name,
    artist: track.artists?.[0]?.name || 'Unknown Artist',
    albumArt: track.album?.images?.[0]?.url,
    addedBy,
    vibeScore,
    reason,
    position,
  }
}

/**
 * Helper to create PlayedTrack from SpotifyTrackFull
 */
function createPlayedTrack(
  track: SpotifyTrackFull,
  bpm: number | null,
  energy: number | null
): PlayedTrack {
  return {
    trackId: track.id,
    trackUri: track.uri,
    name: track.name,
    artist: track.artists?.[0]?.name || 'Unknown Artist',
    albumArt: track.album?.images?.[0]?.url,
    playedAt: new Date().toISOString(),
    bpm,
    energy,
  }
}

/**
 * Helper to create PlayedTrack from QueuedTrack (when moving from queue to history)
 */
function queuedTrackToPlayedTrack(
  queued: QueuedTrack,
  bpm: number | null = null,
  energy: number | null = null
): PlayedTrack {
  return {
    trackId: queued.trackId,
    trackUri: queued.trackUri,
    name: queued.name,
    artist: queued.artist,
    albumArt: queued.albumArt,
    playedAt: new Date().toISOString(),
    bpm,
    energy,
  }
}

// Auto-queue configuration
const TARGET_QUEUE_SIZE = 5

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
  const queueSize = session.queue.length
  const tracksNeeded = TARGET_QUEUE_SIZE - queueSize

  if (tracksNeeded <= 0) {
    return 0
  }

  getLogger()?.info(`Auto-filling queue: ${queueSize} → ${TARGET_QUEUE_SIZE} (need ${tracksNeeded} tracks)`)

  try {
    // Initialize suggestion engine
    const lastFmService = new LastFmService(env.LASTFM_API_KEY || '', env.AUDIO_FEATURES_CACHE)
    const audioService = new AudioEnrichmentService(env.AUDIO_FEATURES_CACHE)
    const suggestionEngine = new SuggestionEngine(lastFmService, audioService, token, env.ANTHROPIC_API_KEY)

    // Generate suggestions (fetch a few extra in case of duplicates)
    const suggestions = await suggestionEngine.generateSuggestions(session, tracksNeeded + 3)

    if (suggestions.length === 0) {
      getLogger()?.info('No suggestions generated for auto-fill')
      return 0
    }

    // Get URIs already in queue and history to avoid duplicates
    const existingUris = new Set([
      ...session.queue.map((t) => t.trackUri),
      ...session.history.map((t) => t.trackUri),
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
        trackId: suggestion.trackId,
        trackUri: suggestion.trackUri,
        name: suggestion.name,
        artist: suggestion.artist,
        albumArt: suggestion.albumArt,
        addedBy: 'ai',
        vibeScore: suggestion.vibeScore,
        reason: suggestion.reason,
        position,
      }

      sessionService.addToQueue(session, queuedTrack)
      addedCount++

      // Also queue to Spotify's playback queue (best effort)
      try {
        const spotifyResponse = await fetch(
          `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(suggestion.trackUri)}`,
          {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`},
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

    // Save updated session
    await sessionService.updateSession(session)

    getLogger()?.info(`Auto-fill complete: added ${addedCount} tracks, queue now has ${session.queue.length} tracks`)
    return addedCount
  } catch (error) {
    getLogger()?.error('Auto-fill error:', error)
    return 0
  }
}

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
      const {preferences} = body
      // Note: seedPlaylistId will be used in future versions for initializing from existing playlists

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

      // Auto-fill initial queue (non-blocking)
      autoFillQueue(c.env, token, session, sessionService).catch((err) => {
        getLogger()?.error('Initial auto-fill failed:', err)
      })

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
      const {trackUri, position} = body

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

      return c.json({success: true, queue: session.queue}, 200)
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

      return c.json({success: true, queue: session.queue}, 200)
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

      return c.json({success: true, queue: session.queue}, 200)
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
      const {energyLevel, energyDirection, bpmRange} = body

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

      // Save updated session
      await sessionService.updateSession(session)

      // Rebuild queue with new vibe (non-blocking)
      autoFillQueue(c.env, token, session, sessionService).catch((err) => {
        getLogger()?.error('Queue rebuild after vibe update failed:', err)
      })

      return c.json({vibe: updatedVibe}, 200)
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

      await sessionService.updateSession(session)

      // Rebuild queue with new vibe (non-blocking)
      autoFillQueue(c.env, token, session, sessionService).catch((err) => {
        getLogger()?.error('Queue rebuild after vibe steer failed:', err)
      })

      getLogger()?.info('Steered vibe for session', {
        userId,
        sessionId: session.id,
        direction,
        changes,
      })

      return c.json({vibe: updatedVibe, changes}, 200)
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

      // Initialize services
      const lastFmService = new LastFmService(c.env.LASTFM_API_KEY || '', c.env.AUDIO_FEATURES_CACHE)
      const audioService = new AudioEnrichmentService(c.env.AUDIO_FEATURES_CACHE)
      const suggestionEngine = new SuggestionEngine(lastFmService, audioService, token, c.env.ANTHROPIC_API_KEY)

      // Generate suggestions
      const suggestions = await suggestionEngine.generateSuggestions(session, count)

      // Build basedOn context
      const currentTrack = session.history[0]?.name
      const vibeProfile = `Energy: ${session.vibe.energyLevel}/10 (${session.vibe.energyDirection}), BPM: ${session.vibe.bpmRange.min}-${session.vibe.bpmRange.max}, Genres: ${session.vibe.genres.join(', ') || 'any'}`

      return c.json(
        {
          suggestions,
          basedOn: {
            currentTrack,
            vibeProfile,
          },
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
      const {name, description, includeQueue} = body

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
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          description: description || `DJ Mix created on ${new Date().toLocaleDateString()}`,
          public: false,
        }),
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
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            uris: batch,
          }),
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
          success: true,
          playlistId: playlist.id,
          playlistUrl: playlist.external_urls.spotify,
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
        let bpm: number | null = null
        let energy: number | null = null

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
          userId,
          trackId,
          queueLength: session.queue.length,
          historyLength: session.history.length,
        })
      } else {
        // Track wasn't in our queue - user might be playing something else
        // Still add to history if we can get track details
        const trackDetails = await fetchTrackDetails(trackUri, token)
        if (trackDetails) {
          let bpm: number | null = null
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

      // Auto-fill queue if needed (non-blocking, runs after response)
      if (movedToHistory) {
        // Run auto-fill in background (don't await)
        autoFillQueue(c.env, token, session, sessionService).catch((err) => {
          getLogger()?.error('Background auto-fill failed:', err)
        })
      }

      return c.json({success: true, movedToHistory, session}, 200)
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
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

      if (response.status === 204) {
        // Success - no content
        getLogger()?.info('Track queued to Spotify', {trackUri})
        return c.json({success: true, queued: true}, 200)
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
        const errorMessage = (errorData as {error?: {message?: string}}).error?.message || 'Spotify Premium required'
        return c.json({error: errorMessage}, 403)
      }

      if (!isSuccessResponse(response)) {
        getLogger()?.error(`Spotify queue failed: ${response.status}`)
        return c.json({error: `Spotify API error: ${response.status}`}, 500)
      }

      return c.json({success: true, queued: true}, 200)
    } catch (error) {
      getLogger()?.error('Queue to Spotify error:', error)
      const message = error instanceof Error ? error.message : 'Failed to queue to Spotify'
      return c.json({error: message}, 500)
    }
  })
}
