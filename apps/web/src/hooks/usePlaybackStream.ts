/**
 * usePlaybackStream Hook
 * Connects to SSE stream for real-time Spotify playback state
 * with client-side progress interpolation for smooth UI updates
 *
 * Optimized to avoid unnecessary re-renders:
 * - Progress updates only notify progress-specific listeners
 * - Core playback data changes notify all listeners
 */

import {useCallback, useRef, useSyncExternalStore} from 'react'

import {HTTP_STATUS} from '../constants'

/** Core playback state (changes infrequently) */
export interface PlaybackCore {
  albumArt: string | null
  artistName: string
  deviceId: string | null
  deviceName: string
  duration: number
  isPlaying: boolean
  trackId: string | null
  trackName: string
  trackUri: string | null
  timestamp: number
}

/** Full playback state including progress */
export interface PlaybackState extends PlaybackCore {
  progress: number
}

/** Connection status */
type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

interface PlaybackStreamState {
  error: string | null
  /** Core playback data (track info, device) - changes infrequently */
  playbackCore: PlaybackCore | null
  /** Progress in ms - changes frequently during playback */
  progress: number
  status: ConnectionStatus
}

type StreamListener = () => void

// =============================================================================
// PLAYBACK STREAM EXTERNAL STORE
// =============================================================================

/** Track change callback type */
type TrackChangeCallback = (previousTrackId: string, previousTrackUri: string, newTrackId: string) => void

function createPlaybackStreamStore() {
  // Separate listeners for different data types
  const coreListeners = new Set<StreamListener>()  // For track/device changes
  const progressListeners = new Set<StreamListener>()  // For progress updates only
  const trackChangeCallbacks = new Set<TrackChangeCallback>()
  let eventSource: EventSource | null = null
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  let interpolationInterval: ReturnType<typeof setInterval> | null = null

  let state: PlaybackStreamState = {
    error: null,
    playbackCore: null,
    progress: 0,
    status: 'disconnected',
  }

  // Track last server update for interpolation
  let lastServerUpdate = 0
  let lastServerProgress = 0
  // Track previous track ID for change detection
  let previousTrackId: string | null = null
  let previousTrackUri: string | null = null

  function notifyCoreListeners(): void {
    coreListeners.forEach(listener => listener())
  }

  function notifyProgressListeners(): void {
    progressListeners.forEach(listener => listener())
  }

  function notifyAllListeners(): void {
    notifyCoreListeners()
    notifyProgressListeners()
  }

  function setCoreState(updates: Partial<Omit<PlaybackStreamState, 'progress'>>): void {
    state = {...state, ...updates}
    notifyAllListeners()
  }

  function setProgressOnly(progress: number): void {
    state = {...state, progress}
    notifyProgressListeners()
  }

  /**
   * Interpolate progress between server updates
   * Updates progress every 250ms when playing
   * Only notifies progress listeners to minimize re-renders
   */
  function startInterpolation(): void {
    if (interpolationInterval) return

    interpolationInterval = setInterval(() => {
      if (!state.playbackCore || !state.playbackCore.isPlaying) return

      const elapsed = Date.now() - lastServerUpdate
      const interpolatedProgress = Math.min(
        lastServerProgress + elapsed,
        state.playbackCore.duration
      )

      // Only update if progress changed by at least 200ms
      if (Math.abs(interpolatedProgress - state.progress) > 200) {
        setProgressOnly(interpolatedProgress)
      }
    }, 250)
  }

  function stopInterpolation(): void {
    if (interpolationInterval) {
      clearInterval(interpolationInterval)
      interpolationInterval = null
    }
  }

  function connect(token: string): void {
    // Don't reconnect if already connected
    if (eventSource?.readyState === EventSource.OPEN) return

    // Close existing connection
    if (eventSource) {
      eventSource.close()
    }

    setCoreState({status: 'connecting', error: null})

    // Create SSE connection with auth header via query param
    // Note: EventSource doesn't support custom headers, so we use fetch
    const url = `/api/player/stream`

    // Use fetch for SSE with custom headers
    fetch(url, {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      },
    })
      .then(response => {
        if (!response.ok) {
          if (response.status === HTTP_STATUS.UNAUTHORIZED) {
            setCoreState({status: 'error', error: 'Session expired'})
            return
          }
          throw new Error(`HTTP ${response.status}`)
        }

        if (!response.body) {
          throw new Error('No response body')
        }

        setCoreState({status: 'connected'})
        startInterpolation()

        // Read the stream
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        const read = async (): Promise<void> => {
          try {
            const {done, value} = await reader.read()

            if (done) {
              // Stream ended, schedule reconnect
              scheduleReconnect(token)
              return
            }

            buffer += decoder.decode(value, {stream: true})

            // Parse SSE events from buffer
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? '' // Keep incomplete line in buffer

            let currentEvent = ''
            let currentData = ''

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7)
              } else if (line.startsWith('data: ')) {
                currentData = line.slice(6)
              } else if (line === '' && currentEvent && currentData) {
                // End of event, process it
                handleEvent(currentEvent, currentData, token)
                currentEvent = ''
                currentData = ''
              }
            }

            // Continue reading
            read()
          } catch (err) {
            console.error('[PlaybackStream] Read error:', err)
            scheduleReconnect(token)
          }
        }

        read()
      })
      .catch(err => {
        console.error('[PlaybackStream] Connection error:', err)
        setCoreState({
          status: 'error',
          error: err instanceof Error ? err.message : 'Connection failed',
        })
        scheduleReconnect(token)
      })
  }

  function handleEvent(event: string, data: string, token: string): void {
    try {
      const parsed = JSON.parse(data)

      switch (event) {
        case 'connected':
          console.log('[PlaybackStream] Connected:', parsed.message)
          break

        case 'playback': {
          // Update playback state and interpolation baseline
          lastServerUpdate = Date.now()
          lastServerProgress = parsed.progress

          // Detect track change
          const newTrackId = parsed.trackId as string | null
          const newTrackUri = parsed.trackUri as string | null

          if (previousTrackId && newTrackId && previousTrackId !== newTrackId) {
            // Track changed! Notify all callbacks
            console.log('[PlaybackStream] Track changed:', previousTrackId, '->', newTrackId)
            trackChangeCallbacks.forEach(cb => {
              try {
                cb(previousTrackId!, previousTrackUri!, newTrackId)
              } catch (err) {
                console.error('[PlaybackStream] Track change callback error:', err)
              }
            })
          }

          // Update previous track tracking
          previousTrackId = newTrackId
          previousTrackUri = newTrackUri

          // Separate core playback data from progress
          const playbackCore: PlaybackCore = {
            albumArt: parsed.albumArt,
            artistName: parsed.artistName,
            deviceId: parsed.deviceId,
            deviceName: parsed.deviceName,
            duration: parsed.duration,
            isPlaying: parsed.isPlaying,
            trackId: parsed.trackId,
            trackName: parsed.trackName,
            trackUri: parsed.trackUri,
            timestamp: parsed.timestamp,
          }

          // Update core state and progress together
          state = {
            ...state,
            playbackCore,
            progress: parsed.progress,
            error: null,
          }
          notifyAllListeners()

          // Start/stop interpolation based on playing state
          if (parsed.isPlaying) {
            startInterpolation()
          } else {
            stopInterpolation()
          }
          break
        }

        case 'error':
          console.warn('[PlaybackStream] Server error:', parsed.message)
          if (parsed.retriesRemaining !== undefined) {
            setCoreState({error: `Error: ${parsed.message} (${parsed.retriesRemaining} retries left)`})
          }
          break

        case 'reconnect':
          console.log('[PlaybackStream] Server requested reconnect')
          scheduleReconnect(token)
          break

        default:
          // Ignore unknown events (like heartbeats)
          break
      }
    } catch (err) {
      console.error('[PlaybackStream] Parse error:', err, data)
    }
  }

  function scheduleReconnect(token: string): void {
    stopInterpolation()
    setCoreState({status: 'disconnected'})

    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
    }

    // Reconnect after 2 seconds
    reconnectTimeout = setTimeout(() => {
      if (coreListeners.size > 0 || progressListeners.size > 0) {
        connect(token)
      }
    }, 2000)
  }

  function disconnect(): void {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
    stopInterpolation()
    state = {
      status: 'disconnected',
      playbackCore: null,
      progress: 0,
      error: null,
    }
    notifyAllListeners()
  }

  // Combine core and progress into full PlaybackState for backward compatibility
  function getPlaybackState(): PlaybackState | null {
    if (!state.playbackCore) return null
    return {
      ...state.playbackCore,
      progress: state.progress,
    }
  }

  return {
    connect,
    disconnect,
    getState: () => state,
    getPlaybackState,
    subscribeToCore: (listener: StreamListener) => {
      coreListeners.add(listener)
      return () => {
        coreListeners.delete(listener)
        if (coreListeners.size === 0 && progressListeners.size === 0) {
          disconnect()
        }
      }
    },
    subscribeToProgress: (listener: StreamListener) => {
      progressListeners.add(listener)
      return () => {
        progressListeners.delete(listener)
        if (coreListeners.size === 0 && progressListeners.size === 0) {
          disconnect()
        }
      }
    },
    // Legacy subscribe that listens to everything
    subscribe: (listener: StreamListener) => {
      coreListeners.add(listener)
      progressListeners.add(listener)
      return () => {
        coreListeners.delete(listener)
        progressListeners.delete(listener)
        if (coreListeners.size === 0 && progressListeners.size === 0) {
          disconnect()
        }
      }
    },
    subscribeToTrackChange: (callback: TrackChangeCallback) => {
      trackChangeCallbacks.add(callback)
      return () => {
        trackChangeCallbacks.delete(callback)
      }
    },
  }
}

// Singleton store
const playbackStreamStore = createPlaybackStreamStore()

// =============================================================================
// HOOK
// =============================================================================

interface UsePlaybackStreamOptions {
  /** Whether to auto-connect when token is available */
  autoConnect?: boolean
  /** Callback when track changes (previous track ID, previous URI, new track ID) */
  onTrackChange?: (previousTrackId: string, previousTrackUri: string, newTrackId: string) => void
}

interface UsePlaybackStreamReturn {
  /** Connection status */
  status: ConnectionStatus
  /** Current playback state (updated in real-time) */
  playback: PlaybackState | null
  /** Error message if any */
  error: string | null
  /** Manually connect to stream */
  connect: () => void
  /** Manually disconnect from stream */
  disconnect: () => void
}

/**
 * Hook for real-time Spotify playback state via SSE
 *
 * @example
 * ```tsx
 * function NowPlaying({ token }) {
 *   const { playback, status } = usePlaybackStream(token)
 *
 *   if (status === 'connecting') return <div>Connecting...</div>
 *   if (!playback) return <div>No active playback</div>
 *
 *   return (
 *     <div>
 *       <h2>{playback.trackName}</h2>
 *       <p>{playback.artistName}</p>
 *       <progress value={playback.progress} max={playback.duration} />
 *     </div>
 *   )
 * }
 * ```
 */
export function usePlaybackStream(
  token: string | null,
  options: UsePlaybackStreamOptions = {}
): UsePlaybackStreamReturn {
  const {autoConnect = true, onTrackChange} = options
  const tokenRef = useRef(token)
  const hasConnectedRef = useRef(false)
  const onTrackChangeRef = useRef(onTrackChange)
  const trackChangeUnsubRef = useRef<(() => void) | null>(null)

  // Keep ref updated
  onTrackChangeRef.current = onTrackChange

  // Subscribe to store - uses getPlaybackState for backward compatibility
  const state = useSyncExternalStore(
    playbackStreamStore.subscribe,
    playbackStreamStore.getState,
    () => ({status: 'disconnected' as const, playbackCore: null, progress: 0, error: null})
  )

  // Manual connect
  const connect = useCallback(() => {
    if (tokenRef.current) {
      playbackStreamStore.connect(tokenRef.current)
    }
  }, [])

  // Manual disconnect
  const disconnect = useCallback(() => {
    playbackStreamStore.disconnect()
    hasConnectedRef.current = false
  }, [])

  // Update token ref
  tokenRef.current = token

  // Subscribe to track changes when callback is provided
  if (onTrackChange && !trackChangeUnsubRef.current) {
    trackChangeUnsubRef.current = playbackStreamStore.subscribeToTrackChange(
      (prevId, prevUri, newId) => {
        onTrackChangeRef.current?.(prevId, prevUri, newId)
      }
    )
  }

  // Unsubscribe when callback is removed
  if (!onTrackChange && trackChangeUnsubRef.current) {
    trackChangeUnsubRef.current()
    trackChangeUnsubRef.current = null
  }

  // Auto-connect when token becomes available
  if (autoConnect && token && !hasConnectedRef.current && state.status === 'disconnected') {
    hasConnectedRef.current = true
    playbackStreamStore.connect(token)
  }

  // Disconnect when token is removed
  if (!token && hasConnectedRef.current) {
    disconnect()
  }

  // Combine core and progress for backward compatible return
  const playback = playbackStreamStore.getPlaybackState()

  return {
    status: state.status,
    playback,
    error: state.error,
    connect,
    disconnect,
  }
}
