/**
 * NowPlaying Component - Shows current playback state with controls
 * Phase 1 of DJ Live Mode implementation
 */

import {memo, useCallback, useRef, useState, useSyncExternalStore} from 'react'
import {HTTP_STATUS, TIMING} from '../../constants'

import '../../styles/now-playing.css'

interface PlaybackState {
  albumArt: string | null
  artistName: string
  deviceName: string
  duration: number
  isPlaying: boolean
  progress: number
  trackName: string
}

interface QueueTrack {
  albumArt: string | null
  artistName: string
  duration: number
  name: string
  uri: string
}

interface SpotifyQueue {
  currently_playing: QueueTrack | null
  queue: QueueTrack[]
}

/** Progress interpolation interval (ms) */
const INTERPOLATION_INTERVAL_MS = 100

interface NowPlayingProps {
  token: string | null
}

// ============================================================================
// POLLING EXTERNAL STORE - Manages playback polling lifecycle
// ============================================================================

type PollingListener = () => void

interface PollingState {
  isPolling: boolean
  token: null | string
}

function createPlaybackPollingStore() {
  const listeners = new Set<PollingListener>()
  let pollingInterval: NodeJS.Timeout | null = null
  let interpolationInterval: NodeJS.Timeout | null = null
  let state: PollingState = {isPolling: false, token: null}
  let fetchCallback: (() => Promise<void>) | null = null
  let interpolationCallback: ((elapsed: number) => void) | null = null
  let lastFetchTime = 0

  function notifyListeners(): void {
    listeners.forEach(listener => listener())
  }

  function startInterpolation(): void {
    if (interpolationInterval) return
    lastFetchTime = Date.now()

    interpolationInterval = setInterval(() => {
      if (interpolationCallback) {
        const elapsed = Date.now() - lastFetchTime
        interpolationCallback(elapsed)
      }
    }, INTERPOLATION_INTERVAL_MS)
  }

  function stopInterpolation(): void {
    if (interpolationInterval) {
      clearInterval(interpolationInterval)
      interpolationInterval = null
    }
  }

  return {
    getState(): PollingState {
      return state
    },

    setFetchCallback(callback: () => Promise<void>): void {
      fetchCallback = callback
    },

    setInterpolationCallback(callback: (elapsed: number) => void): void {
      interpolationCallback = callback
    },

    resetFetchTime(): void {
      lastFetchTime = Date.now()
    },

    startPolling(token: string): void {
      // Don't restart if already polling for same token
      if (state.isPolling && state.token === token) return

      // Stop existing polling
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }

      state = {isPolling: true, token}
      notifyListeners()

      // Initial fetch
      if (fetchCallback) {
        fetchCallback()
      }

      // Start interpolation for smooth progress updates
      startInterpolation()

      pollingInterval = setInterval(async () => {
        if (fetchCallback) {
          try {
            await fetchCallback()
            lastFetchTime = Date.now()
          } catch (err) {
            console.error('[NowPlaying] Polling error:', err)
          }
        }
      }, TIMING.PLAYBACK_POLLING_INTERVAL_MS)
    },

    stopPolling(): void {
      if (pollingInterval) {
        clearInterval(pollingInterval)
        pollingInterval = null
      }
      stopInterpolation()
      state = {isPolling: false, token: null}
      notifyListeners()
    },

    subscribe(listener: PollingListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        // Cleanup when last listener unsubscribes
        if (listeners.size === 0 && pollingInterval) {
          clearInterval(pollingInterval)
          pollingInterval = null
          stopInterpolation()
          state = {isPolling: false, token: null}
        }
      }
    },
  }
}

// Singleton polling store
const playbackPollingStore = createPlaybackPollingStore()

export const NowPlaying = memo(function NowPlaying({token}: NowPlayingProps) {
  const [playback, setPlayback] = useState<PlaybackState | null>(null)
  const [queue, setQueue] = useState<SpotifyQueue | null>(null)
  const [showQueue, setShowQueue] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastFetchRef = useRef<number>(0)
  const lastServerProgressRef = useRef<number>(0)
  const lastQueueFetchRef = useRef<number>(0)
  const showQueueRef = useRef(false)

  // Subscribe to polling state for cleanup
  const pollingState = useSyncExternalStore(
    playbackPollingStore.subscribe.bind(playbackPollingStore),
    playbackPollingStore.getState.bind(playbackPollingStore),
    () => ({isPolling: false, token: null})
  )

  // Set up interpolation callback for smooth progress updates
  playbackPollingStore.setInterpolationCallback((elapsed: number) => {
    setPlayback(prev => {
      if (!prev || !prev.isPlaying) return prev

      const interpolatedProgress = Math.min(
        lastServerProgressRef.current + elapsed,
        prev.duration
      )

      // Only update if progress actually changed significantly
      if (Math.abs(interpolatedProgress - prev.progress) < 50) return prev

      return {...prev, progress: interpolatedProgress}
    })
  })

  const fetchQueue = useCallback(async () => {
    if (!token) return

    const now = Date.now()
    // Debounce queue fetches (every 5 seconds max)
    if (now - lastQueueFetchRef.current < 5000) return
    lastQueueFetchRef.current = now

    try {
      const response = await fetch('/api/player/queue', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (!response.ok) {
        console.error('[NowPlaying] Queue fetch failed:', response.status)
        return
      }

      const data = (await response.json()) as {
        currently_playing?: {
          album?: {images?: Array<{url: string}>}
          artists?: Array<{name: string}>
          duration_ms?: number
          name?: string
          uri?: string
        } | null
        queue?: Array<{
          album?: {images?: Array<{url: string}>}
          artists?: Array<{name: string}>
          duration_ms?: number
          name?: string
          uri?: string
        }>
      }

      setQueue({
        currently_playing: data.currently_playing
          ? {
              albumArt: data.currently_playing.album?.images?.[0]?.url ?? null,
              artistName: data.currently_playing.artists?.map(a => a.name).join(', ') ?? '',
              duration: data.currently_playing.duration_ms ?? 0,
              name: data.currently_playing.name ?? 'Unknown',
              uri: data.currently_playing.uri ?? '',
            }
          : null,
        queue: (data.queue ?? []).slice(0, 10).map(track => ({
          albumArt: track.album?.images?.[0]?.url ?? null,
          artistName: track.artists?.map(a => a.name).join(', ') ?? '',
          duration: track.duration_ms ?? 0,
          name: track.name ?? 'Unknown',
          uri: track.uri ?? '',
        })),
      })
    } catch (err) {
      console.error('[NowPlaying] Queue fetch error:', err)
    }
  }, [token])

  const fetchPlaybackState = useCallback(async () => {
    if (!token) return

    // Debounce rapid calls
    const now = Date.now()
    if (now - lastFetchRef.current < TIMING.FETCH_DEBOUNCE_MS) return
    lastFetchRef.current = now

    try {
      const response = await fetch('/api/player/state', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (response.status === HTTP_STATUS.UNAUTHORIZED) {
        setError('Session expired')
        return
      }

      if (!response.ok) {
        console.error('[NowPlaying] Fetch failed:', response.status)
        return
      }

      const data = (await response.json()) as {
        device?: {name: string}
        is_playing?: boolean
        item?: {
          album?: {images?: Array<{url: string}>}
          artists?: Array<{name: string}>
          duration_ms?: number
          name?: string
        }
        progress_ms?: number
      }

      if (!data.item) {
        setPlayback(null)
        setError(null)
        return
      }

      const progress = data.progress_ms ?? 0
      lastServerProgressRef.current = progress
      playbackPollingStore.resetFetchTime()

      setPlayback({
        albumArt: data.item?.album?.images?.[0]?.url ?? null,
        artistName: data.item?.artists?.map(a => a.name).join(', ') ?? '',
        deviceName: data.device?.name ?? 'Unknown',
        duration: data.item?.duration_ms ?? 0,
        isPlaying: data.is_playing ?? false,
        progress,
        trackName: data.item?.name ?? 'Unknown',
      })
      setError(null)
    } catch (err) {
      console.error('[NowPlaying] Fetch error:', err)
    }
  }, [token])

  // Set up fetch callback for polling store - also fetch queue when open
  playbackPollingStore.setFetchCallback(async () => {
    await fetchPlaybackState()
    // Refresh queue periodically when panel is open (use ref to avoid stale closure)
    if (showQueueRef.current) {
      fetchQueue()
    }
  })

  // Direct state sync: manage polling based on token
  if (token && !pollingState.isPolling) {
    playbackPollingStore.startPolling(token)
  } else if (!token && pollingState.isPolling) {
    playbackPollingStore.stopPolling()
  } else if (token && pollingState.token !== token) {
    // Token changed, restart polling
    playbackPollingStore.startPolling(token)
  }

  const handlePlayPause = useCallback(async () => {
    if (!token) return

    const endpoint = playback?.isPlaying ? '/api/player/pause' : '/api/player/play'

    try {
      await fetch(endpoint, {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })
      // Optimistically update UI
      setPlayback(prev => (prev ? {...prev, isPlaying: !prev.isPlaying} : null))
    } catch (err) {
      console.error('[NowPlaying] Play/pause error:', err)
    }
  }, [token, playback?.isPlaying])

  const handleNext = useCallback(async () => {
    if (!token) return

    try {
      await fetch('/api/player/next', {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })
      // Fetch new state after short delay
      setTimeout(fetchPlaybackState, TIMING.PLAYBACK_REFRESH_DELAY_MS)
    } catch (err) {
      console.error('[NowPlaying] Next error:', err)
    }
  }, [token, fetchPlaybackState])

  const handlePrevious = useCallback(async () => {
    if (!token) return

    try {
      await fetch('/api/player/previous', {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })
      setTimeout(fetchPlaybackState, TIMING.PLAYBACK_REFRESH_DELAY_MS)
    } catch (err) {
      console.error('[NowPlaying] Previous error:', err)
    }
  }, [token, fetchPlaybackState])

  const handleSeek = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (!token || !playback) return

      const bar = e.currentTarget
      const rect = bar.getBoundingClientRect()
      const percent = (e.clientX - rect.left) / rect.width
      const positionMs = Math.floor(percent * playback.duration)

      try {
        await fetch('/api/player/seek', {
          body: JSON.stringify({position_ms: positionMs}),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })
        // Optimistically update progress
        setPlayback(prev => (prev ? {...prev, progress: positionMs} : null))
      } catch (err) {
        console.error('[NowPlaying] Seek error:', err)
      }
    },
    [token, playback]
  )

  const handleToggleQueue = useCallback(() => {
    const newShowQueue = !showQueue
    setShowQueue(newShowQueue)
    showQueueRef.current = newShowQueue
    if (newShowQueue) {
      // Force refresh queue when opening
      lastQueueFetchRef.current = 0
      fetchQueue()
    }
  }, [showQueue, fetchQueue])

  // Format time as m:ss
  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  if (!token) {
    return null
  }

  if (error) {
    return (
      <div className="now-playing now-playing--error">
        <span className="now-playing__error-text">{error}</span>
      </div>
    )
  }

  if (!playback) {
    return (
      <div className="now-playing now-playing--inactive">
        <span className="now-playing__inactive-text">No active playback - Start playing on Spotify</span>
      </div>
    )
  }

  const progressPercent = playback.duration > 0 ? (playback.progress / playback.duration) * 100 : 0

  return (
    <div className="now-playing">
      <div className="now-playing__track">
        {playback.albumArt && <img alt="Album art" className="now-playing__album-art" src={playback.albumArt} />}
        <div className="now-playing__info">
          <span className="now-playing__track-name">{playback.trackName}</span>
          <span className="now-playing__artist-name">{playback.artistName}</span>
        </div>
      </div>

      <div className="now-playing__center">
        <div className="now-playing__controls">
          <button className="now-playing__control-btn" onClick={handlePrevious} title="Previous" type="button">
            Previous
          </button>
          <button
            className="now-playing__control-btn now-playing__control-btn--play"
            onClick={handlePlayPause}
            title={playback.isPlaying ? 'Pause' : 'Play'}
            type="button"
          >
            {playback.isPlaying ? 'Pause' : 'Play'}
          </button>
          <button className="now-playing__control-btn" onClick={handleNext} title="Next" type="button">
            Next
          </button>
        </div>

        <div className="now-playing__progress-container">
          <span className="now-playing__time">{formatTime(playback.progress)}</span>
          <div className="now-playing__progress" onClick={handleSeek} role="slider" tabIndex={0}>
            <div className="now-playing__progress-bar" style={{width: `${progressPercent}%`}} />
          </div>
          <span className="now-playing__time">{formatTime(playback.duration)}</span>
        </div>
      </div>

      <div className="now-playing__right">
        <button
          className={`now-playing__queue-btn ${showQueue ? 'now-playing__queue-btn--active' : ''}`}
          onClick={handleToggleQueue}
          title="Show queue"
          type="button"
        >
          Queue
        </button>
        <div className="now-playing__device">
          <span className="now-playing__device-icon">Speaker</span>
          <span className="now-playing__device-name">{playback.deviceName}</span>
        </div>
      </div>

      {showQueue && queue && (
        <div className="now-playing__queue-panel">
          <div className="now-playing__queue-header">
            <span className="now-playing__queue-title">Up Next</span>
            <button
              className="now-playing__queue-close"
              onClick={() => {
                setShowQueue(false)
                showQueueRef.current = false
              }}
              type="button"
            >
              Close
            </button>
          </div>
          {queue.queue.length === 0 ? (
            <div className="now-playing__queue-empty">Queue is empty</div>
          ) : (
            <div className="now-playing__queue-list">
              {queue.queue.map((track, index) => (
                <div className="now-playing__queue-item" key={`${track.uri}-${index}`}>
                  {track.albumArt && (
                    <img
                      alt="Album art"
                      className="now-playing__queue-item-art"
                      src={track.albumArt}
                    />
                  )}
                  <div className="now-playing__queue-item-info">
                    <span className="now-playing__queue-item-name">{track.name}</span>
                    <span className="now-playing__queue-item-artist">{track.artistName}</span>
                  </div>
                  <span className="now-playing__queue-item-duration">{formatTime(track.duration)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
