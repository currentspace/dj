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
  PlaybackStateInit,
  PlaybackTickEvent,
  PlaybackTrack,
  PlayingType,
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

/** Legacy interface for backward compatibility */
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
        const parsed = JSON.parse(data)

        switch (event) {
          case 'connected':
            console.log('[playbackStore] Connected:', parsed.message)
            break

          case 'init': {
            // Full state initialization
            const init = parsed as PlaybackStateInit
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
            // Minimal progress update
            const tick = parsed as PlaybackTickEvent
            lastServerUpdate = tick.ts
            lastServerProgress = tick.p
            set({ progress: tick.p })
            break
          }

          case 'track': {
            // Track changed
            const track = parsed as PlaybackTrack & { seq: number }
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
            // Play/pause changed
            const state = parsed as { isPlaying: boolean; seq: number }
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
            // Device changed
            const device = parsed as PlaybackDevice & { seq: number }
            const { playbackCore } = get()
            if (playbackCore) {
              set({
                playbackCore: { ...playbackCore, device, seq: device.seq },
              })
            }
            break
          }

          case 'modes': {
            // Shuffle/repeat changed
            const modes = parsed as PlaybackModes & { seq: number }
            const { playbackCore } = get()
            if (playbackCore) {
              set({
                playbackCore: { ...playbackCore, modes, seq: modes.seq },
              })
            }
            break
          }

          case 'volume': {
            // Volume changed
            const volume = parsed as { percent: number; seq: number }
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
            // Context (playlist/album) changed
            const ctx = parsed as { context: PlaybackContext | null; seq: number }
            const { playbackCore } = get()
            if (playbackCore) {
              set({
                playbackCore: { ...playbackCore, context: ctx.context, seq: ctx.seq },
              })
            }
            break
          }

          case 'idle': {
            // No active playback
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
                  seq: (parsed as { seq: number }).seq,
                },
                progress: 0,
              })
            }
            break
          }

          case 'error':
            console.warn('[playbackStore] Server error:', parsed.message)
            if (parsed.retriesRemaining !== undefined) {
              set({ error: `Error: ${parsed.message} (${parsed.retriesRemaining} retries left)` })
            }
            break

          case 'reconnect':
            console.log('[playbackStore] Server requested reconnect')
            scheduleReconnect(token)
            break

          // Legacy event support (for backward compatibility during rollout)
          case 'playback': {
            console.log('[playbackStore] Received legacy playback event, converting...')
            lastServerUpdate = Date.now()
            lastServerProgress = parsed.progress

            const newTrackId = parsed.trackId as string | null
            const newTrackUri = parsed.trackUri as string | null

            if (newTrackId && newTrackUri) {
              notifyTrackChange(newTrackId, newTrackUri)
            }

            // Convert legacy format to new format
            const legacyCore: PlaybackCore = {
              track: parsed.trackId ? {
                id: parsed.trackId,
                uri: parsed.trackUri ?? '',
                name: parsed.trackName ?? 'Unknown',
                artist: parsed.artistName ?? '',
                albumArt: parsed.albumArt ?? null,
                albumName: '',
                duration: parsed.duration ?? 0,
                explicit: false,
                popularity: 0,
                isLocal: false,
                previewUrl: null,
              } : null,
              device: {
                id: parsed.deviceId ?? null,
                name: parsed.deviceName ?? 'Unknown',
                type: 'unknown',
                volumePercent: null,
                supportsVolume: false,
                isPrivateSession: false,
                isRestricted: false,
              },
              context: null,
              modes: { shuffle: false, repeat: 'off' },
              playingType: 'track',
              isPlaying: parsed.isPlaying ?? false,
              timestamp: parsed.timestamp ?? Date.now(),
              seq: 0,
            }

            set({ playbackCore: legacyCore, progress: parsed.progress, error: null })

            if (parsed.isPlaying) {
              startInterpolation()
            } else {
              stopInterpolation()
            }
            break
          }
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
// DERIVED SELECTORS & BACKWARD COMPATIBILITY
// =============================================================================

/**
 * Get legacy PlaybackState for backward compatibility
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
