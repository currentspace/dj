/**
 * Playback Store - Zustand 5 + subscribeWithSelector
 * SSE-based real-time Spotify playback state with progress interpolation
 */

import {create} from 'zustand'
import {subscribeWithSelector} from 'zustand/middleware'

import {HTTP_STATUS} from '../constants'

// =============================================================================
// TYPES
// =============================================================================

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

export interface PlaybackCore {
  albumArt: string | null
  artistName: string
  deviceId: string | null
  deviceName: string
  duration: number
  isPlaying: boolean
  timestamp: number
  trackId: string | null
  trackName: string
  trackUri: string | null
}

export interface PlaybackState extends PlaybackCore {
  progress: number
}

type TrackChangeCallback = (previousTrackId: string, previousTrackUri: string, newTrackId: string) => void

interface PlaybackStoreState {
  // State (separated for selective subscriptions)
  error: string | null
  playbackCore: PlaybackCore | null
  progress: number
  status: ConnectionStatus

  // Actions
  connect: (token: string) => void
  disconnect: () => void
  subscribeToTrackChange: (callback: TrackChangeCallback) => () => void
}

// =============================================================================
// STORE
// =============================================================================

// Private state (not in Zustand, for SSE management)
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
let interpolationInterval: ReturnType<typeof setInterval> | null = null
let lastServerUpdate = 0
let lastServerProgress = 0
let previousTrackId: string | null = null
let previousTrackUri: string | null = null
const trackChangeCallbacks = new Set<TrackChangeCallback>()

export const usePlaybackStore = create<PlaybackStoreState>()(
  subscribeWithSelector((set, get) => {
    // ==========================================================================
    // PRIVATE HELPERS
    // ==========================================================================

    function startInterpolation(): void {
      if (interpolationInterval) return

      interpolationInterval = setInterval(() => {
        const {playbackCore, progress} = get()
        if (!playbackCore?.isPlaying) return

        const elapsed = Date.now() - lastServerUpdate
        const interpolated = Math.min(lastServerProgress + elapsed, playbackCore.duration)

        // Only update if changed by >200ms
        if (Math.abs(interpolated - progress) > 200) {
          set({progress: interpolated})
        }
      }, 250)
    }

    function stopInterpolation(): void {
      if (interpolationInterval) {
        clearInterval(interpolationInterval)
        interpolationInterval = null
      }
    }

    function scheduleReconnect(token: string): void {
      stopInterpolation()
      set({status: 'disconnected'})

      if (reconnectTimeout) clearTimeout(reconnectTimeout)

      reconnectTimeout = setTimeout(() => {
        get().connect(token)
      }, 2000)
    }

    function handleEvent(event: string, data: string, token: string): void {
      try {
        const parsed = JSON.parse(data)

        switch (event) {
          case 'connected':
            console.log('[playbackStore] Connected:', parsed.message)
            break

          case 'playback': {
            lastServerUpdate = Date.now()
            lastServerProgress = parsed.progress

            // Detect track change
            const newTrackId = parsed.trackId as string | null
            const newTrackUri = parsed.trackUri as string | null

            if (previousTrackId && newTrackId && previousTrackId !== newTrackId) {
              console.log('[playbackStore] Track changed:', previousTrackId, '->', newTrackId)
              trackChangeCallbacks.forEach((cb) => {
                try {
                  cb(previousTrackId!, previousTrackUri!, newTrackId)
                } catch (err) {
                  console.error('[playbackStore] Track change callback error:', err)
                }
              })
            }

            previousTrackId = newTrackId
            previousTrackUri = newTrackUri

            const playbackCore: PlaybackCore = {
              albumArt: parsed.albumArt,
              artistName: parsed.artistName,
              deviceId: parsed.deviceId,
              deviceName: parsed.deviceName,
              duration: parsed.duration,
              isPlaying: parsed.isPlaying,
              timestamp: parsed.timestamp,
              trackId: parsed.trackId,
              trackName: parsed.trackName,
              trackUri: parsed.trackUri,
            }

            set({playbackCore, progress: parsed.progress, error: null})

            if (parsed.isPlaying) {
              startInterpolation()
            } else {
              stopInterpolation()
            }
            break
          }

          case 'error':
            console.warn('[playbackStore] Server error:', parsed.message)
            if (parsed.retriesRemaining !== undefined) {
              set({error: `Error: ${parsed.message} (${parsed.retriesRemaining} retries left)`})
            }
            break

          case 'reconnect':
            console.log('[playbackStore] Server requested reconnect')
            scheduleReconnect(token)
            break
        }
      } catch (err) {
        console.error('[playbackStore] Parse error:', err, data)
      }
    }

    // ==========================================================================
    // PUBLIC ACTIONS
    // ==========================================================================

    return {
      // Initial state
      error: null,
      playbackCore: null,
      progress: 0,
      status: 'disconnected',

      connect: (token) => {
        const {status} = get()
        if (status === 'connected' || status === 'connecting') return

        set({status: 'connecting', error: null})

        fetch('/api/player/stream', {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
        })
          .then((response) => {
            if (!response.ok) {
              if (response.status === HTTP_STATUS.UNAUTHORIZED) {
                set({status: 'error', error: 'Session expired'})
                return
              }
              throw new Error(`HTTP ${response.status}`)
            }

            if (!response.body) throw new Error('No response body')

            set({status: 'connected'})
            startInterpolation()

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            const read = async (): Promise<void> => {
              try {
                const {done, value} = await reader.read()

                if (done) {
                  scheduleReconnect(token)
                  return
                }

                buffer += decoder.decode(value, {stream: true})
                const lines = buffer.split('\n')
                buffer = lines.pop() ?? ''

                let currentEvent = ''
                let currentData = ''

                for (const line of lines) {
                  if (line.startsWith('event: ')) {
                    currentEvent = line.slice(7)
                  } else if (line.startsWith('data: ')) {
                    currentData = line.slice(6)
                  } else if (line === '' && currentEvent && currentData) {
                    handleEvent(currentEvent, currentData, token)
                    currentEvent = ''
                    currentData = ''
                  }
                }

                read()
              } catch (err) {
                console.error('[playbackStore] Read error:', err)
                scheduleReconnect(token)
              }
            }

            read()
          })
          .catch((err) => {
            console.error('[playbackStore] Connection error:', err)
            set({
              status: 'error',
              error: err instanceof Error ? err.message : 'Connection failed',
            })
            scheduleReconnect(token)
          })
      },

      disconnect: () => {
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout)
          reconnectTimeout = null
        }
        stopInterpolation()
        previousTrackId = null
        previousTrackUri = null
        set({
          error: null,
          playbackCore: null,
          progress: 0,
          status: 'disconnected',
        })
      },

      subscribeToTrackChange: (callback) => {
        trackChangeCallbacks.add(callback)
        return () => {
          trackChangeCallbacks.delete(callback)
        }
      },
    }
  })
)

// =============================================================================
// DERIVED SELECTORS
// =============================================================================

/**
 * Get combined PlaybackState for backward compatibility
 */
export function getPlaybackState(): PlaybackState | null {
  const {playbackCore, progress} = usePlaybackStore.getState()
  if (!playbackCore) return null
  return {...playbackCore, progress}
}
