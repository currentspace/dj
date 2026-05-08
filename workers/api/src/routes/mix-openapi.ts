/**
 * Mix API routes using OpenAPI contracts
 * Live DJ Mode mix session management
 */

import type {Env} from '../index'
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
import {SpotifyPlaylistFullSchema} from '@dj/shared-types'

import {HTTP_STATUS, PAGINATION, VIBE_DEFAULTS} from '../constants'
import {isSuccessResponse} from '../lib/guards'
import * as vibeSteeringModule from '../lib/vibe-steering'
import {AudioEnrichmentService} from '../services/AudioEnrichmentService'
import {LastFmService} from '../services/LastFmService'
import {MixSessionService} from '../services/MixSessionService'
import {SuggestionEngine} from '../services/SuggestionEngine'
import {getLogger} from '../utils/LoggerContext'
import {
  autoFillQueue,
  createPlayedTrack,
  createQueuedTrack,
  extractQuickVibe,
  fetchSeedPlaylistTracks,
  fetchTrackDetails,
  fetchUserSeedTracks,
  getUserIdFromToken,
  queuedTrackToPlayedTrack,
  TARGET_QUEUE_SIZE,
} from './mix-helpers'

/** Register mix routes on the provided OpenAPI app. */
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

      const {steerVibe: steerVibeFunc} = vibeSteeringModule

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
