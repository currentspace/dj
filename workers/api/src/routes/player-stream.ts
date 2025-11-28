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

import type { OpenAPIHono } from '@hono/zod-openapi'
import type {
  ContextType,
  DeviceType,
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
  RepeatState,
} from '@dj/shared-types'

import type { Env } from '../index'
import { isSuccessResponse } from '../lib/guards'
import { getLogger } from '../utils/LoggerContext'

// =============================================================================
// SPOTIFY API TYPES
// =============================================================================

interface SpotifyPlaybackResponse {
  device?: {
    id: string | null
    is_active: boolean
    is_private_session: boolean
    is_restricted: boolean
    name: string
    supports_volume: boolean
    type: string
    volume_percent: number | null
  }
  repeat_state?: RepeatState
  shuffle_state?: boolean
  context?: {
    type: string
    href: string
    external_urls?: { spotify: string }
    uri: string
  } | null
  timestamp?: number
  progress_ms?: number | null
  is_playing?: boolean
  item?: {
    album?: {
      images?: Array<{ url: string }>
      name?: string
    }
    artists?: Array<{ name: string }>
    duration_ms?: number
    explicit?: boolean
    id?: string
    is_local?: boolean
    name?: string
    popularity?: number
    preview_url?: string | null
    uri?: string
  } | null
  currently_playing_type?: PlayingType
  actions?: {
    disallows?: Record<string, boolean>
  }
}

// =============================================================================
// INTERNAL STATE TRACKING
// =============================================================================

interface InternalState {
  track: PlaybackTrack | null
  device: PlaybackDevice
  context: PlaybackContext | null
  modes: PlaybackModes
  playingType: PlayingType
  isPlaying: boolean
  progress: number
  timestamp: number
}

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

function normalizeContextType(type: string): ContextType {
  const normalized = type.toLowerCase()
  const validTypes: ContextType[] = ['album', 'artist', 'playlist', 'show', 'collection']
  return validTypes.includes(normalized as ContextType)
    ? (normalized as ContextType)
    : 'playlist' // Default fallback
}

function parseSpotifyResponse(data: SpotifyPlaybackResponse): InternalState {
  const track: PlaybackTrack | null = data.item ? {
    id: data.item.id ?? '',
    uri: data.item.uri ?? '',
    name: data.item.name ?? 'Unknown',
    artist: data.item.artists?.map(a => a.name).join(', ') ?? '',
    albumArt: data.item.album?.images?.[0]?.url ?? null,
    albumName: data.item.album?.name ?? '',
    duration: data.item.duration_ms ?? 0,
    explicit: data.item.explicit ?? false,
    popularity: data.item.popularity ?? 0,
    isLocal: data.item.is_local ?? false,
    previewUrl: data.item.preview_url ?? null,
  } : null

  const device: PlaybackDevice = {
    id: data.device?.id ?? null,
    name: data.device?.name ?? 'Unknown',
    type: normalizeDeviceType(data.device?.type ?? 'unknown'),
    volumePercent: data.device?.volume_percent ?? null,
    supportsVolume: data.device?.supports_volume ?? false,
    isPrivateSession: data.device?.is_private_session ?? false,
    isRestricted: data.device?.is_restricted ?? false,
  }

  const context: PlaybackContext | null = data.context ? {
    type: normalizeContextType(data.context.type),
    uri: data.context.uri,
    name: null, // Spotify doesn't give context name in player endpoint
    href: data.context.href,
  } : null

  const modes: PlaybackModes = {
    shuffle: data.shuffle_state ?? false,
    repeat: data.repeat_state ?? 'off',
  }

  return {
    track,
    device,
    context,
    modes,
    playingType: data.currently_playing_type ?? 'unknown',
    isPlaying: data.is_playing ?? false,
    progress: data.progress_ms ?? 0,
    timestamp: Date.now(),
  }
}

function createIdleState(): InternalState {
  return {
    track: null,
    device: {
      id: null,
      name: 'No active device',
      type: 'unknown',
      volumePercent: null,
      supportsVolume: false,
      isPrivateSession: false,
      isRestricted: false,
    },
    context: null,
    modes: { shuffle: false, repeat: 'off' },
    playingType: 'unknown',
    isPlaying: false,
    progress: 0,
    timestamp: Date.now(),
  }
}

// =============================================================================
// CHANGE DETECTION
// =============================================================================

function trackChanged(prev: PlaybackTrack | null, curr: PlaybackTrack | null): boolean {
  if (!prev && !curr) return false
  if (!prev || !curr) return true
  return prev.id !== curr.id
}

function deviceChanged(prev: PlaybackDevice, curr: PlaybackDevice): boolean {
  return prev.id !== curr.id || prev.name !== curr.name || prev.type !== curr.type
}

function modesChanged(prev: PlaybackModes, curr: PlaybackModes): boolean {
  return prev.shuffle !== curr.shuffle || prev.repeat !== curr.repeat
}

function volumeChanged(prev: PlaybackDevice, curr: PlaybackDevice): boolean {
  return prev.volumePercent !== curr.volumePercent
}

function contextChanged(prev: PlaybackContext | null, curr: PlaybackContext | null): boolean {
  if (!prev && !curr) return false
  if (!prev || !curr) return true
  return prev.uri !== curr.uri
}

// =============================================================================
// SSE WRITER
// =============================================================================

function writeSSE(writer: WritableStreamDefaultWriter<Uint8Array>, event: string, data: unknown): void {
  const encoder = new TextEncoder()
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  writer.write(encoder.encode(payload)).catch(() => {
    // Stream closed, ignore
  })
}

// =============================================================================
// MAIN ROUTE
// =============================================================================

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

    // Fetch from Spotify
    async function fetchPlayback(): Promise<InternalState> {
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 204) {
        return createIdleState()
      }

      if (!isSuccessResponse(response)) {
        throw new Error(`Spotify API error: ${response.status}`)
      }

      const data = await response.json() as SpotifyPlaybackResponse
      return parseSpotifyResponse(data)
    }

    // Send init event with full state
    function sendInit(state: InternalState): void {
      const initData: PlaybackStateInit = {
        track: state.track,
        device: state.device,
        context: state.context,
        modes: state.modes,
        playingType: state.playingType,
        isPlaying: state.isPlaying,
        progress: state.progress,
        timestamp: state.timestamp,
        seq: seq++,
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
      } catch (err) {
        consecutiveErrors++
        logger?.error('[PlayerStream] Fetch error:', err)

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          writeSSE(writer, 'error', { message: 'Too many errors, closing stream' })
          isStreamClosed = true
          writer.close().catch(() => {})
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
    const pollInterval = setInterval(poll, POLLING_INTERVAL_MS)
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
          writer.close().catch(() => {})
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
