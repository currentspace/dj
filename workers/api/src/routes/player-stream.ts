/**
 * Player Stream - Delta-based SSE for real-time Spotify playback state
 *
 * Protocol optimizations:
 * - `init`: Full state on connection (one-time)
 * - `tick`: Minimal progress updates (~20 bytes vs 500+)
 * - `track/state/device/modes/volume/context`: Granular change events
 * - Sequence numbers for ordering
 * - Rich Spotify data (shuffle, repeat, context, volume, device type)
 */

import type {
  ContextType,
  DeviceType,
  ListenerSignal,
  PlaybackContext,
  PlaybackContextEvent,
  PlaybackDevice,
  PlaybackDeviceEvent,
  PlaybackModes,
  PlaybackModesEvent,
  PlaybackStateEvent,
  PlaybackStateInit,
  PlaybackTickEvent,
  PlaybackTrack,
  PlaybackTrackEvent,
  PlaybackVolumeEvent,
  PlayingType,
} from '@dj/shared-types'
import type { OpenAPIHono } from '@hono/zod-openapi'

import { z } from 'zod'

import type { Env } from '../index'

import { isSuccessResponse, safeParse } from '../lib/guards'
import { AudioEnrichmentService } from '../services/AudioEnrichmentService'
import { MixSessionService } from '../services/MixSessionService'
import { getLogger } from '../utils/LoggerContext'

// =============================================================================
// ZOD SCHEMA FOR SPOTIFY PLAYBACK API
// =============================================================================

/** Schema for Spotify playback state response */
const SpotifyPlaybackResponseSchema = z.object({
  actions: z.object({
    disallows: z.record(z.string(), z.boolean()).optional(),
  }).optional(),
  context: z.object({
    external_urls: z.object({ spotify: z.string() }).optional(),
    href: z.string(),
    type: z.string(),
    uri: z.string(),
  }).nullable().optional(),
  currently_playing_type: z.enum(['track', 'episode', 'ad', 'unknown']).optional(),
  device: z.object({
    id: z.string().nullable(),
    is_active: z.boolean(),
    is_private_session: z.boolean(),
    is_restricted: z.boolean(),
    name: z.string(),
    supports_volume: z.boolean(),
    type: z.string(),
    volume_percent: z.number().nullable(),
  }).optional(),
  is_playing: z.boolean().optional(),
  item: z.object({
    album: z.object({
      images: z.array(z.object({ url: z.string() })).optional(),
      name: z.string().optional(),
    }).optional(),
    artists: z.array(z.object({ name: z.string() })).optional(),
    duration_ms: z.number().optional(),
    explicit: z.boolean().optional(),
    id: z.string().optional(),
    is_local: z.boolean().optional(),
    name: z.string().optional(),
    popularity: z.number().optional(),
    preview_url: z.string().nullable().optional(),
    uri: z.string().optional(),
  }).nullable().optional(),
  progress_ms: z.number().nullable().optional(),
  repeat_state: z.enum(['off', 'track', 'context']).optional(),
  shuffle_state: z.boolean().optional(),
  timestamp: z.number().optional(),
})

interface InternalState {
  context: null | PlaybackContext
  device: PlaybackDevice
  isPlaying: boolean
  modes: PlaybackModes
  playingType: PlayingType
  progress: number
  timestamp: number
  track: null | PlaybackTrack
}


// =============================================================================
// INTERNAL STATE TRACKING
// =============================================================================

/** Inferred type from the Zod schema */
type SpotifyPlaybackResponseZod = z.infer<typeof SpotifyPlaybackResponseSchema>

// =============================================================================
// CONFIGURATION
// =============================================================================

const POLLING_INTERVAL_MS = 1000
const HEARTBEAT_INTERVAL_MS = 15000
const MAX_CONSECUTIVE_ERRORS = 5
const MAX_STREAM_LIFETIME_MS = 5 * 60 * 1000 // 5 minutes

// =============================================================================
// HELPERS
// =============================================================================

function contextChanged(prev: null | PlaybackContext, curr: null | PlaybackContext): boolean {
  if (!prev && !curr) return false
  if (!prev || !curr) return true
  return prev.uri !== curr.uri
}

function createIdleState(): InternalState {
  return {
    context: null,
    device: {
      id: null,
      isPrivateSession: false,
      isRestricted: false,
      name: 'No active device',
      supportsVolume: false,
      type: 'unknown',
      volumePercent: null,
    },
    isPlaying: false,
    modes: { repeat: 'off', shuffle: false },
    playingType: 'unknown',
    progress: 0,
    timestamp: Date.now(),
    track: null,
  }
}

function deviceChanged(prev: PlaybackDevice, curr: PlaybackDevice): boolean {
  return prev.id !== curr.id || prev.name !== curr.name || prev.type !== curr.type
}

function modesChanged(prev: PlaybackModes, curr: PlaybackModes): boolean {
  return prev.shuffle !== curr.shuffle || prev.repeat !== curr.repeat
}

// =============================================================================
// CHANGE DETECTION
// =============================================================================

function normalizeContextType(type: string): ContextType {
  const normalized = type.toLowerCase()
  const validTypes: ContextType[] = ['album', 'artist', 'playlist', 'show', 'collection']
  return validTypes.includes(normalized as ContextType)
    ? (normalized as ContextType)
    : 'playlist' // Default fallback
}

function normalizeDeviceType(type: string): DeviceType {
  const normalized = type.toLowerCase()
  const validTypes: DeviceType[] = [
    'computer', 'smartphone', 'speaker', 'tv', 'avr', 'stb',
    'audio_dongle', 'game_console', 'cast_video', 'cast_audio', 'automobile'
  ]
  return validTypes.includes(normalized as DeviceType)
    ? (normalized as DeviceType)
    : 'unknown'
}

function parseSpotifyResponse(data: SpotifyPlaybackResponseZod): InternalState {
  const track: null | PlaybackTrack = data.item ? {
    albumArt: data.item.album?.images?.[0]?.url ?? null,
    albumName: data.item.album?.name ?? '',
    artist: data.item.artists?.map(a => a.name).join(', ') ?? '',
    duration: data.item.duration_ms ?? 0,
    explicit: data.item.explicit ?? false,
    id: data.item.id ?? '',
    isLocal: data.item.is_local ?? false,
    name: data.item.name ?? 'Unknown',
    popularity: data.item.popularity ?? 0,
    previewUrl: data.item.preview_url ?? null,
    uri: data.item.uri ?? '',
  } : null

  const device: PlaybackDevice = {
    id: data.device?.id ?? null,
    isPrivateSession: data.device?.is_private_session ?? false,
    isRestricted: data.device?.is_restricted ?? false,
    name: data.device?.name ?? 'Unknown',
    supportsVolume: data.device?.supports_volume ?? false,
    type: normalizeDeviceType(data.device?.type ?? 'unknown'),
    volumePercent: data.device?.volume_percent ?? null,
  }

  const context: null | PlaybackContext = data.context ? {
    href: data.context.href,
    name: null, // Spotify doesn't give context name in player endpoint
    type: normalizeContextType(data.context.type),
    uri: data.context.uri,
  } : null

  const modes: PlaybackModes = {
    repeat: data.repeat_state ?? 'off',
    shuffle: data.shuffle_state ?? false,
  }

  return {
    context,
    device,
    isPlaying: data.is_playing ?? false,
    modes,
    playingType: data.currently_playing_type ?? 'unknown',
    progress: data.progress_ms ?? 0,
    timestamp: Date.now(),
    track,
  }
}

function trackChanged(prev: null | PlaybackTrack, curr: null | PlaybackTrack): boolean {
  if (!prev && !curr) return false
  if (!prev || !curr) return true
  return prev.id !== curr.id
}

function volumeChanged(prev: PlaybackDevice, curr: PlaybackDevice): boolean {
  return prev.volumePercent !== curr.volumePercent
}

// =============================================================================
// SERVER-SIDE TRACK TRANSITION HANDLING
// =============================================================================

const QUEUE_LOW_THRESHOLD = 3
const QUEUE_CHECK_INTERVAL = 10 // Check queue every N polls
const MAX_SIGNALS = 50

export function registerPlayerStreamRoute(app: OpenAPIHono<{ Bindings: Env }>) {
  app.get('/api/player/stream', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({ error: 'No authorization token' }, 401)
    }

    const logger = getLogger()

    // Create TransformStream for SSE
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>(undefined, {
      highWaterMark: 10,
    })
    const writer = writable.getWriter()

    // State tracking
    let prevState: InternalState | null = null
    let seq = 0
    let consecutiveErrors = 0
    let isStreamClosed = false
    let isIdle = false
    let trackStartTimestamp = Date.now()
    let pollCount = 0

    // Custom error for auth expiration
    class AuthExpiredError extends Error {
      constructor() {
        super('auth_expired')
        this.name = 'AuthExpiredError'
      }
    }

    // Fetch from Spotify
    async function fetchPlayback(): Promise<InternalState> {
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 204) {
        return createIdleState()
      }

      // Handle 401 specifically - token expired
      if (response.status === 401) {
        throw new AuthExpiredError()
      }

      if (!isSuccessResponse(response)) {
        throw new Error(`Spotify API error: ${response.status}`)
      }

      const json: unknown = await response.json()
      const parseResult = safeParse(SpotifyPlaybackResponseSchema, json)

      if (!parseResult.success) {
        logger?.error('[PlayerStream] Invalid playback response:', parseResult.error.message)
        throw new Error('Invalid playback response from Spotify')
      }

      return parseSpotifyResponse(parseResult.data)
    }

    // Send init event with full state
    function sendInit(state: InternalState): void {
      const initData: PlaybackStateInit = {
        context: state.context,
        device: state.device,
        isPlaying: state.isPlaying,
        modes: state.modes,
        playingType: state.playingType,
        progress: state.progress,
        seq: seq++,
        timestamp: state.timestamp,
        track: state.track,
      }
      writeSSE(writer, 'init', initData)
    }

    // Send delta events based on what changed
    function sendDeltas(prev: InternalState, curr: InternalState): void {
      // Track change
      if (trackChanged(prev.track, curr.track)) {
        if (curr.track) {
          const event: PlaybackTrackEvent = { ...curr.track, seq: seq++ }
          writeSSE(writer, 'track', event)
        } else {
          // Entered idle state
          writeSSE(writer, 'idle', { seq: seq++ })
        }

        // Server-side track transition processing (Phase 1a)
        // Run in background — never block the SSE poll loop
        if (prev.track) {
          c.executionCtx.waitUntil(
            handleTrackTransition(c.env, token!, prev.track, trackStartTimestamp)
          )
        }
        // Reset track start time for the new track
        trackStartTimestamp = Date.now()
      }

      // Play/pause change
      if (prev.isPlaying !== curr.isPlaying) {
        const event: PlaybackStateEvent = { isPlaying: curr.isPlaying, seq: seq++ }
        writeSSE(writer, 'state', event)
      }

      // Device change
      if (deviceChanged(prev.device, curr.device)) {
        const event: PlaybackDeviceEvent = { ...curr.device, seq: seq++ }
        writeSSE(writer, 'device', event)
      }

      // Modes change (shuffle/repeat)
      if (modesChanged(prev.modes, curr.modes)) {
        const event: PlaybackModesEvent = { ...curr.modes, seq: seq++ }
        writeSSE(writer, 'modes', event)
      }

      // Volume change (separate from device)
      if (volumeChanged(prev.device, curr.device) && !deviceChanged(prev.device, curr.device)) {
        const event: PlaybackVolumeEvent = { percent: curr.device.volumePercent ?? 0, seq: seq++ }
        writeSSE(writer, 'volume', event)
      }

      // Context change
      if (contextChanged(prev.context, curr.context)) {
        const event: PlaybackContextEvent = { context: curr.context, seq: seq++ }
        writeSSE(writer, 'context', event)
      }
    }

    // Main polling function
    async function poll(): Promise<void> {
      if (isStreamClosed) return

      try {
        const curr = await fetchPlayback()
        consecutiveErrors = 0

        // First fetch - send full init
        if (!prevState) {
          sendInit(curr)
          isIdle = !curr.track
          prevState = curr
          return
        }

        // Check if we went idle
        const nowIdle = !curr.track
        if (nowIdle !== isIdle) {
          if (nowIdle) {
            writeSSE(writer, 'idle', { seq: seq++ })
          } else {
            // Came back from idle - send full init
            sendInit(curr)
          }
          isIdle = nowIdle
          prevState = curr
          return
        }

        // If idle, no updates needed
        if (isIdle) {
          prevState = curr
          return
        }

        // Check for changes and send appropriate deltas
        sendDeltas(prevState, curr)

        // Always send tick when playing (minimal ~20 bytes)
        if (curr.isPlaying) {
          const tick: PlaybackTickEvent = { p: curr.progress, ts: curr.timestamp }
          writeSSE(writer, 'tick', tick)
        }

        prevState = curr
        pollCount++

        // Periodic queue health check (Phase 1c) — every QUEUE_CHECK_INTERVAL polls (~10 seconds)
        if (pollCount % QUEUE_CHECK_INTERVAL === 0 && c.env.MIX_SESSIONS) {
          c.executionCtx.waitUntil((async () => {
            try {
              const sessionService = new MixSessionService(c.env.MIX_SESSIONS!)
              // Derive userId from token (lightweight — cached by Spotify)
              const userResp = await fetch('https://api.spotify.com/v1/me', {
                headers: { Authorization: `Bearer ${token}` },
              })
              if (!userResp.ok) return
              const userJson2: unknown = await userResp.json()
              const userParsed2 = z.object({ id: z.string() }).safeParse(userJson2)
              if (!userParsed2.success) return

              const session = await sessionService.getSession(userParsed2.data.id)
              if (!session) return

              if (session.queue.length < QUEUE_LOW_THRESHOLD && session.preferences.autoFill) {
                writeSSE(writer, 'queue_low', { depth: session.queue.length, seq: seq++ })
                logger?.info('[PlayerStream] Queue low detected', { depth: session.queue.length })
              }
            } catch {
              // Non-fatal — queue check is best-effort
            }
          })())
        }
      } catch (err) {
        // Handle auth expiration specifically - send auth_expired and close stream
        if (err instanceof AuthExpiredError) {
          logger?.info('[PlayerStream] Token expired, sending auth_expired event')
          writeSSE(writer, 'auth_expired', { message: 'Spotify token expired, please refresh' })
          isStreamClosed = true
          clearInterval(pollInterval)
          clearInterval(heartbeatInterval)
          writer.close().catch(() => { /* noop */ })
          return
        }

        consecutiveErrors++
        logger?.error('[PlayerStream] Fetch error:', err)

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          writeSSE(writer, 'error', { message: 'Too many errors, closing stream' })
          isStreamClosed = true
          writer.close().catch(() => { /* noop */ })
          return
        }

        writeSSE(writer, 'error', {
          message: err instanceof Error ? err.message : 'Failed to fetch playback',
          retriesRemaining: MAX_CONSECUTIVE_ERRORS - consecutiveErrors,
        })
      }
    }

    // Heartbeat
    function sendHeartbeat(): void {
      if (isStreamClosed) return
      writer.write(new TextEncoder().encode(': heartbeat\n\n')).catch(() => {
        isStreamClosed = true
      })
    }

    // Start intervals
    const pollInterval = setInterval(() => { void poll() }, POLLING_INTERVAL_MS)
    const heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

    // Initial fetch
    poll()

    // Connected event
    writeSSE(writer, 'connected', {
      message: 'Connected to playback stream (delta protocol v2)',
      pollingInterval: POLLING_INTERVAL_MS,
    })

    // Cleanup
    c.executionCtx.waitUntil(
      new Promise<void>(resolve => {
        const maxLifetime = setTimeout(() => {
          isStreamClosed = true
          clearInterval(pollInterval)
          clearInterval(heartbeatInterval)
          writeSSE(writer, 'reconnect', { message: 'Stream lifetime exceeded' })
          writer.close().catch(() => { /* noop */ })
          resolve()
        }, MAX_STREAM_LIFETIME_MS)

        writer.closed
          .then(() => {
            isStreamClosed = true
            clearInterval(pollInterval)
            clearInterval(heartbeatInterval)
            clearTimeout(maxLifetime)
            resolve()
          })
          .catch(() => {
            isStreamClosed = true
            clearInterval(pollInterval)
            clearInterval(heartbeatInterval)
            clearTimeout(maxLifetime)
            resolve()
          })
      })
    )

    return new Response(readable, {
      headers: {
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'text/event-stream',
        'X-Accel-Buffering': 'no',
      },
    })
  })
}

/**
 * Classify a listener signal based on how much of the track was heard.
 */
function classifySignal(listenDurationMs: number, trackDurationMs: number): 'completed' | 'partial' | 'skipped' {
  if (trackDurationMs <= 0) return 'partial'
  const ratio = listenDurationMs / trackDurationMs
  if (ratio >= 0.8) return 'completed'
  if (listenDurationMs < 30000) return 'skipped'
  return 'partial'
}

// =============================================================================
// SSE WRITER
// =============================================================================

/**
 * Handle a track transition server-side. This is the "DJ brain" —
 * it processes track completions, updates the session, and triggers
 * background queue refill without depending on the frontend.
 *
 * Runs inside waitUntil() so it never blocks the SSE poll loop.
 */
async function handleTrackTransition(
  env: Env,
  token: string,
  prevTrack: PlaybackTrack,
  trackStartTimestamp: number,
): Promise<void> {
  const logger = getLogger()

  if (!env.MIX_SESSIONS) return

  try {
    // Get user ID from Spotify
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!userResponse.ok) return
    const userJson: unknown = await userResponse.json()
    const userParsed = z.object({ id: z.string() }).safeParse(userJson)
    if (!userParsed.success) return
    const userId = userParsed.data.id

    const sessionService = new MixSessionService(env.MIX_SESSIONS)
    const session = await sessionService.getSession(userId)
    if (!session) return // No mix session, skip

    // Check if track is still in queue (hasn't been processed already by frontend)
    const queuedTrack = session.queue.find(
      t => t.trackId === prevTrack.id || t.trackUri === prevTrack.uri
    )

    // Calculate listen duration and classify signal
    const listenDurationMs = Date.now() - trackStartTimestamp
    const signalType = classifySignal(listenDurationMs, prevTrack.duration)

    // Store listener signal
    const signal: ListenerSignal = {
      listenDuration: listenDurationMs,
      timestamp: Date.now(),
      trackDuration: prevTrack.duration,
      trackId: prevTrack.id,
      type: signalType,
    }
    session.signals.push(signal)
    if (session.signals.length > MAX_SIGNALS) {
      session.signals = session.signals.slice(-MAX_SIGNALS)
    }

    if (queuedTrack) {
      // Move from queue to history
      sessionService.removeFromQueue(session, queuedTrack.position)

      // Enrich with BPM if possible
      let bpm: null | number = null
      if (env.AUDIO_FEATURES_CACHE) {
        try {
          const audioService = new AudioEnrichmentService(env.AUDIO_FEATURES_CACHE)
          const enrichment = await audioService.enrichTrack({
            artists: [{ name: prevTrack.artist }],
            duration_ms: prevTrack.duration,
            id: prevTrack.id,
            name: prevTrack.name,
          })
          if (enrichment) bpm = enrichment.bpm ?? null
        } catch {
          // Non-fatal
        }
      }

      const playedTrack = {
        albumArt: prevTrack.albumArt ?? undefined,
        artist: prevTrack.artist,
        bpm,
        energy: null as null | number,
        name: prevTrack.name,
        playedAt: new Date().toISOString(),
        trackId: prevTrack.id,
        trackUri: prevTrack.uri,
      }

      sessionService.addToHistory(session, playedTrack)
      sessionService.updateVibeFromTrack(session, playedTrack)

      logger?.info('[PlayerStream] Server-side track transition processed', {
        queueRemaining: session.queue.length,
        signal: signalType,
        trackId: prevTrack.id,
      })
    }

    // Update taste model from signal (Phase 4)
    if (session.tasteModel || signalType !== 'partial') {
      sessionService.updateTasteFromSignal(session, signal, prevTrack.artist)
    }

    // Save session
    await sessionService.updateSession(session)

    // Phase 4c: Check for consecutive skips → clear queue and force refill
    const recentSignals = session.signals.slice(-5)
    let consecutiveSkips = 0
    for (let i = recentSignals.length - 1; i >= 0; i--) {
      // eslint-disable-next-line security/detect-object-injection -- safe: i is a controlled loop index bounded by array length
      if (recentSignals[i].type === 'skipped') consecutiveSkips++
      else break
    }

    if (consecutiveSkips >= 3 && session.queue.length > 0) {
      logger?.info('[PlayerStream] 3+ consecutive skips detected, clearing queue for replan', {
        consecutiveSkips,
        queueLength: session.queue.length,
      })
      session.queue = []
      await sessionService.updateSession(session)
      // Queue refill will happen via the periodic queue check or frontend request
    }
  } catch (error) {
    logger?.error('[PlayerStream] handleTrackTransition error:', error)
    // Never throw — this runs in waitUntil
  }
}

// =============================================================================
// MAIN ROUTE
// =============================================================================

function writeSSE(writer: WritableStreamDefaultWriter<Uint8Array>, event: string, data: unknown): void {
  const encoder = new TextEncoder()
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  writer.write(encoder.encode(payload)).catch(() => {
    // Stream closed, ignore
  })
}
