/**
 * Player Stream - SSE endpoint for real-time Spotify playback state
 *
 * Since Spotify has no WebSocket API, we poll on the server and push
 * updates to connected clients via Server-Sent Events.
 */

import type {OpenAPIHono} from '@hono/zod-openapi'

import type {Env} from '../index'

import {isSuccessResponse} from '../lib/guards'
import {getLogger} from '../utils/LoggerContext'

/** Playback state sent to clients */
interface PlaybackState {
  albumArt: string | null
  artistName: string
  deviceId: string | null
  deviceName: string
  duration: number
  isPlaying: boolean
  progress: number
  trackId: string | null
  trackName: string
  trackUri: string | null
  /** Server timestamp when state was fetched (for client-side interpolation) */
  timestamp: number
}

/** Polling configuration */
const POLLING_INTERVAL_MS = 1000 // Poll every 1 second
const HEARTBEAT_INTERVAL_MS = 15000 // Send heartbeat every 15 seconds
const MAX_CONSECUTIVE_ERRORS = 5 // Stop after 5 consecutive errors

/**
 * Create a hash of the playback state to detect changes
 */
function hashState(state: PlaybackState): string {
  return `${state.trackId}:${state.isPlaying}:${state.deviceId}`
}

/**
 * Fetch current playback state from Spotify
 */
async function fetchPlaybackState(token: string): Promise<PlaybackState | null> {
  const response = await fetch('https://api.spotify.com/v1/me/player', {
    headers: {Authorization: `Bearer ${token}`},
  })

  // 204 = no active playback
  if (response.status === 204) {
    return {
      albumArt: null,
      artistName: '',
      deviceId: null,
      deviceName: 'No active device',
      duration: 0,
      isPlaying: false,
      progress: 0,
      timestamp: Date.now(),
      trackId: null,
      trackName: 'No active playback',
      trackUri: null,
    }
  }

  if (!isSuccessResponse(response)) {
    throw new Error(`Spotify API error: ${response.status}`)
  }

  const data = (await response.json()) as {
    device?: {id: string; name: string}
    is_playing?: boolean
    item?: {
      album?: {images?: Array<{url: string}>}
      artists?: Array<{name: string}>
      duration_ms?: number
      id?: string
      name?: string
      uri?: string
    }
    progress_ms?: number
  }

  return {
    albumArt: data.item?.album?.images?.[0]?.url ?? null,
    artistName: data.item?.artists?.map(a => a.name).join(', ') ?? '',
    deviceId: data.device?.id ?? null,
    deviceName: data.device?.name ?? 'Unknown',
    duration: data.item?.duration_ms ?? 0,
    isPlaying: data.is_playing ?? false,
    progress: data.progress_ms ?? 0,
    timestamp: Date.now(),
    trackId: data.item?.id ?? null,
    trackName: data.item?.name ?? 'Unknown',
    trackUri: data.item?.uri ?? null,
  }
}

/**
 * Write SSE event to stream
 */
function writeSSE(writer: WritableStreamDefaultWriter<Uint8Array>, event: string, data: unknown): void {
  const encoder = new TextEncoder()
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  writer.write(encoder.encode(payload)).catch(() => {
    // Stream closed, ignore
  })
}

/**
 * Register Player Stream route
 */
export function registerPlayerStreamRoute(app: OpenAPIHono<{Bindings: Env}>) {
  // GET /api/player/stream - SSE stream for real-time playback state
  app.get('/api/player/stream', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    const logger = getLogger()

    // Create TransformStream for SSE
    const {readable, writable} = new TransformStream<Uint8Array, Uint8Array>(undefined, {
      highWaterMark: 10,
    })
    const writer = writable.getWriter()

    // Track state for change detection
    let lastStateHash = ''
    let consecutiveErrors = 0
    let isStreamClosed = false

    // Polling function
    const pollPlayback = async () => {
      if (isStreamClosed) return

      try {
        const state = await fetchPlaybackState(token)
        consecutiveErrors = 0 // Reset on success

        if (state) {
          const currentHash = hashState(state)

          // Always send progress updates when playing, or when state changes
          if (state.isPlaying || currentHash !== lastStateHash) {
            writeSSE(writer, 'playback', state)
            lastStateHash = currentHash
          }
        }
      } catch (err) {
        consecutiveErrors++
        logger?.error('[PlayerStream] Fetch error:', err)

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          writeSSE(writer, 'error', {message: 'Too many errors, closing stream'})
          isStreamClosed = true
          writer.close().catch(() => {})
          return
        }

        // Send error event but keep trying
        writeSSE(writer, 'error', {
          message: err instanceof Error ? err.message : 'Failed to fetch playback state',
          retriesRemaining: MAX_CONSECUTIVE_ERRORS - consecutiveErrors,
        })
      }
    }

    // Heartbeat function to keep connection alive
    const sendHeartbeat = () => {
      if (isStreamClosed) return
      writer.write(new TextEncoder().encode(': heartbeat\n\n')).catch(() => {
        isStreamClosed = true
      })
    }

    // Start background polling
    const pollInterval = setInterval(pollPlayback, POLLING_INTERVAL_MS)
    const heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

    // Initial fetch
    pollPlayback()

    // Send initial connected event
    writeSSE(writer, 'connected', {
      message: 'Connected to playback stream',
      pollingInterval: POLLING_INTERVAL_MS,
    })

    // Cleanup when client disconnects
    // Note: In Cloudflare Workers, we can't detect client disconnect directly
    // The stream will error when trying to write to a closed connection
    c.executionCtx.waitUntil(
      new Promise<void>(resolve => {
        // Set a max lifetime for the stream (5 minutes)
        // Client should reconnect periodically
        const maxLifetime = setTimeout(() => {
          isStreamClosed = true
          clearInterval(pollInterval)
          clearInterval(heartbeatInterval)
          writeSSE(writer, 'reconnect', {message: 'Stream lifetime exceeded, please reconnect'})
          writer.close().catch(() => {})
          resolve()
        }, 5 * 60 * 1000)

        // Also cleanup when intervals are cleared
        readable.pipeTo(new WritableStream()).catch(() => {
          // Client disconnected
          isStreamClosed = true
          clearInterval(pollInterval)
          clearInterval(heartbeatInterval)
          clearTimeout(maxLifetime)
          resolve()
        })
      }),
    )

    return new Response(readable, {
      headers: {
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream',
        'X-Accel-Buffering': 'no',
      },
    })
  })
}
