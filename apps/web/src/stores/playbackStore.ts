/**
 * Playback Store - Zustand 5 + subscribeWithSelector
 * SSE-based real-time Spotify playback state with delta protocol
 *
 * Protocol v2 events:
 * - init: Full state on connection
 * - tick: Minimal progress updates {p, ts}
 * - track/state/device/modes/volume/context: Granular deltas
 * - idle: No active playback
 */

import type {
  PlaybackContext,
  PlaybackDevice,
  PlaybackModes,
  PlaybackTrack,
  PlayingType,
} from '@dj/shared-types'
import {
  PlaybackContextEventSchema,
  PlaybackDeviceEventSchema,
  PlaybackIdleEventSchema,
  PlaybackModesEventSchema,
  PlaybackStateEventSchema,
  PlaybackStateInitSchema,
  PlaybackTickEventSchema,
  PlaybackTrackEventSchema,
  PlaybackVolumeEventSchema,
} from '@dj/shared-types'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import { HTTP_STATUS } from '../constants'

// =============================================================================
// TYPES
// =============================================================================

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

/** Rich playback state with all Spotify data */
export interface PlaybackCore {
  // Track info
  track: PlaybackTrack | null
  // Device info
  device: PlaybackDevice
  // Context (what's being played from)
  context: PlaybackContext | null
  // Playback modes
  modes: PlaybackModes
  // Playback state
  playingType: PlayingType
  isPlaying: boolean
  // Timing
  timestamp: number
  // Sequence for ordering
  seq: number
}

/** Simplified playback state for UI components */
export interface PlaybackState {
  albumArt: string | null
  artistName: string
  deviceId: string | null
  deviceName: string
  duration: number
  isPlaying: boolean
  progress: number
  timestamp: number
  trackId: string | null
  trackName: string
  trackUri: string | null
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
        const { playbackCore, progress } = get()
        if (!playbackCore?.isPlaying || !playbackCore.track) return

        const elapsed = Date.now() - lastServerUpdate
        const interpolated = Math.min(lastServerProgress + elapsed, playbackCore.track.duration)

        // Only update if changed by >200ms
        if (Math.abs(interpolated - progress) > 200) {
          set({ progress: interpolated })
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
      set({ status: 'disconnected' })

      if (reconnectTimeout) clearTimeout(reconnectTimeout)

      reconnectTimeout = setTimeout(() => {
        get().connect(token)
      }, 2000)
    }

    function notifyTrackChange(newTrackId: string, newTrackUri: string): void {
      if (previousTrackId && previousTrackId !== newTrackId) {
        console.log('[playbackStore] Track changed:', previousTrackId, '->', newTrackId)
        trackChangeCallbacks.forEach((cb) => {
          try {
            cb(previousTrackId!, previousTrackUri ?? '', newTrackId)
          } catch (err) {
            console.error('[playbackStore] Track change callback error:', err)
          }
        })
      }
      previousTrackId = newTrackId
      previousTrackUri = newTrackUri
    }

    function handleEvent(event: string, data: string, token: string): void {
      try {
        const parsed: unknown = JSON.parse(data)

        switch (event) {
          case 'connected':
            console.log('[playbackStore] Connected:', parsed)
            break

          case 'init': {
            const initResult = PlaybackStateInitSchema.safeParse(parsed)
            if (!initResult.success) {
              console.error('[playbackStore] Invalid init event:', initResult.error)
              break
            }
            const init = initResult.data
            lastServerUpdate = Date.now()
            lastServerProgress = init.progress

            if (init.track) {
              notifyTrackChange(init.track.id, init.track.uri)
            }

            const playbackCore: PlaybackCore = {
              track: init.track,
              device: init.device,
              context: init.context,
              modes: init.modes,
              playingType: init.playingType,
              isPlaying: init.isPlaying,
              timestamp: init.timestamp,
              seq: init.seq,
            }

            set({ playbackCore, progress: init.progress, error: null })

            if (init.isPlaying) {
              startInterpolation()
            } else {
              stopInterpolation()
            }
            break
          }

          case 'tick': {
            const tickResult = PlaybackTickEventSchema.safeParse(parsed)
            if (!tickResult.success) break
            const tick = tickResult.data
            lastServerUpdate = tick.ts
            lastServerProgress = tick.p
            set({ progress: tick.p })
            break
          }

          case 'track': {
            const trackResult = PlaybackTrackEventSchema.safeParse(parsed)
            if (!trackResult.success) break
            const track = trackResult.data
            notifyTrackChange(track.id, track.uri)

            const { playbackCore } = get()
            if (playbackCore) {
              set({
                playbackCore: { ...playbackCore, track, seq: track.seq },
                error: null,
              })
            }
            break
          }

          case 'state': {
            const stateResult = PlaybackStateEventSchema.safeParse(parsed)
            if (!stateResult.success) break
            const state = stateResult.data
            const { playbackCore } = get()
            if (playbackCore) {
              set({
                playbackCore: { ...playbackCore, isPlaying: state.isPlaying, seq: state.seq },
              })

              if (state.isPlaying) {
                startInterpolation()
              } else {
                stopInterpolation()
              }
            }
            break
          }

          case 'device': {
            const deviceResult = PlaybackDeviceEventSchema.safeParse(parsed)
            if (!deviceResult.success) break
            const device = deviceResult.data
            const { playbackCore } = get()
            if (playbackCore) {
              set({
                playbackCore: { ...playbackCore, device, seq: device.seq },
              })
            }
            break
          }

          case 'modes': {
            const modesResult = PlaybackModesEventSchema.safeParse(parsed)
            if (!modesResult.success) break
            const modes = modesResult.data
            const { playbackCore } = get()
            if (playbackCore) {
              set({
                playbackCore: { ...playbackCore, modes, seq: modes.seq },
              })
            }
            break
          }

          case 'volume': {
            const volumeResult = PlaybackVolumeEventSchema.safeParse(parsed)
            if (!volumeResult.success) break
            const volume = volumeResult.data
            const { playbackCore } = get()
            if (playbackCore) {
              set({
                playbackCore: {
                  ...playbackCore,
                  device: { ...playbackCore.device, volumePercent: volume.percent },
                  seq: volume.seq,
                },
              })
            }
            break
          }

          case 'context': {
            const ctxResult = PlaybackContextEventSchema.safeParse(parsed)
            if (!ctxResult.success) break
            const ctx = ctxResult.data
            const { playbackCore } = get()
            if (playbackCore) {
              set({
                playbackCore: { ...playbackCore, context: ctx.context, seq: ctx.seq },
              })
            }
            break
          }

          case 'idle': {
            const idleResult = PlaybackIdleEventSchema.safeParse(parsed)
            if (!idleResult.success) break
            stopInterpolation()
            previousTrackId = null
            previousTrackUri = null
            const { playbackCore } = get()
            if (playbackCore) {
              set({
                playbackCore: {
                  ...playbackCore,
                  track: null,
                  isPlaying: false,
                  seq: idleResult.data.seq,
                },
                progress: 0,
              })
            }
            break
          }

          case 'error': {
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const errorData = parsed as Record<string, unknown>
              console.warn('[playbackStore] Server error:', errorData.message)
              if (typeof errorData.retriesRemaining === 'number') {
                set({ error: `Error: ${String(errorData.message)} (${errorData.retriesRemaining} retries left)` })
              }
            }
            break
          }

          case 'auth_expired':
            console.log('[playbackStore] Auth expired, triggering token refresh')
            set({ status: 'disconnected', error: 'Token expired, refreshing...' })
            stopInterpolation()
            // Trigger token refresh via authStore (catch to prevent unhandled rejection)
            import('../stores/authStore').then(({ useAuthStore }) => {
              useAuthStore.getState().refreshToken().then((success) => {
                if (success) {
                  console.log('[playbackStore] Token refreshed, reconnecting...')
                  const newToken = useAuthStore.getState().token
                  if (newToken) {
                    setTimeout(() => get().connect(newToken), 500)
                  }
                } else {
                  console.error('[playbackStore] Token refresh failed')
                  set({ error: 'Session expired. Please log in again.' })
                }
              }).catch((err: unknown) => {
                console.error('[playbackStore] Token refresh error:', err)
                set({ error: 'Session expired. Please log in again.' })
              })
            }).catch((err: unknown) => {
              console.error('[playbackStore] Failed to load authStore:', err)
            })
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
        const { status } = get()
        if (status === 'connected' || status === 'connecting') return

        set({ status: 'connecting', error: null })

        fetch('/api/player/stream', {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
        })
          .then((response) => {
            if (!response.ok) {
              if (response.status === HTTP_STATUS.UNAUTHORIZED) {
                set({ status: 'error', error: 'Session expired' })
                return
              }
              throw new Error(`HTTP ${response.status}`)
            }

            if (!response.body) throw new Error('No response body')

            set({ status: 'connected' })
            startInterpolation()

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            const read = async (): Promise<void> => {
              try {
                const { done, value } = await reader.read()

                if (done) {
                  scheduleReconnect(token)
                  return
                }

                buffer += decoder.decode(value, { stream: true })
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
 * Get simplified PlaybackState for UI components
 */
export function getPlaybackState(): PlaybackState | null {
  const { playbackCore, progress } = usePlaybackStore.getState()
  if (!playbackCore) return null

  return {
    albumArt: playbackCore.track?.albumArt ?? null,
    artistName: playbackCore.track?.artist ?? '',
    deviceId: playbackCore.device.id,
    deviceName: playbackCore.device.name,
    duration: playbackCore.track?.duration ?? 0,
    isPlaying: playbackCore.isPlaying,
    progress,
    timestamp: playbackCore.timestamp,
    trackId: playbackCore.track?.id ?? null,
    trackName: playbackCore.track?.name ?? 'Unknown',
    trackUri: playbackCore.track?.uri ?? null,
  }
}

/**
 * Selector for rich device info
 */
export function useDevice() {
  return usePlaybackStore((s) => s.playbackCore?.device)
}

/**
 * Selector for playback modes (shuffle/repeat)
 */
export function useModes() {
  return usePlaybackStore((s) => s.playbackCore?.modes)
}

/**
 * Selector for playback context (playlist/album)
 */
export function useContext() {
  return usePlaybackStore((s) => s.playbackCore?.context)
}

/**
 * Selector for volume
 */
export function useVolume() {
  return usePlaybackStore((s) => s.playbackCore?.device.volumePercent)
}
