/**
 * NowPlaying Component - Shows current playback state with controls
 * Uses Zustand playbackStore for SSE-based real-time updates
 */

import {memo, useCallback, useEffect, useRef, useState} from 'react'

import {usePlaybackStore} from '../../stores'

import '../../styles/now-playing.css'

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

interface NowPlayingProps {
  token: string | null
}

export const NowPlaying = memo(function NowPlaying({token}: NowPlayingProps) {
  // Atomic selectors from playback store
  const playbackCore = usePlaybackStore((s) => s.playbackCore)
  const progress = usePlaybackStore((s) => s.progress)
  const status = usePlaybackStore((s) => s.status)
  const storeError = usePlaybackStore((s) => s.error)
  const connect = usePlaybackStore((s) => s.connect)
  const disconnect = usePlaybackStore((s) => s.disconnect)

  // Local state for queue panel
  const [queue, setQueue] = useState<SpotifyQueue | null>(null)
  const [showQueue, setShowQueue] = useState(false)
  const [controlError, setControlError] = useState<string | null>(null)

  // Refs
  const lastQueueFetchRef = useRef<number>(0)
  const showQueueRef = useRef(false)
  const hasConnectedRef = useRef(false)

  // Connect to SSE stream when token available
  useEffect(() => {
    if (token && !hasConnectedRef.current && status === 'disconnected') {
      hasConnectedRef.current = true
      connect(token)
    }

    if (!token && hasConnectedRef.current) {
      hasConnectedRef.current = false
      disconnect()
    }

    return () => {
      // Cleanup on unmount is handled by store
    }
  }, [token, status, connect, disconnect])

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

  // Periodically refresh queue when panel is open
  useEffect(() => {
    if (!showQueue || !token) return

    // Fetch immediately when opening
    fetchQueue()

    const interval = setInterval(() => {
      if (showQueueRef.current) {
        fetchQueue()
      }
    }, 10000) // Refresh every 10 seconds when open

    return () => clearInterval(interval)
  }, [showQueue, token, fetchQueue])

  const handlePlayPause = useCallback(async () => {
    if (!token || !playbackCore) return

    const endpoint = playbackCore.isPlaying ? '/api/player/pause' : '/api/player/play'

    try {
      await fetch(endpoint, {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })
      // SSE will update state automatically
    } catch (err) {
      console.error('[NowPlaying] Play/pause error:', err)
      setControlError('Failed to toggle playback')
    }
  }, [token, playbackCore])

  const handleNext = useCallback(async () => {
    if (!token) return

    try {
      await fetch('/api/player/next', {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })
      // SSE will update state automatically
    } catch (err) {
      console.error('[NowPlaying] Next error:', err)
      setControlError('Failed to skip track')
    }
  }, [token])

  const handlePrevious = useCallback(async () => {
    if (!token) return

    try {
      await fetch('/api/player/previous', {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })
      // SSE will update state automatically
    } catch (err) {
      console.error('[NowPlaying] Previous error:', err)
      setControlError('Failed to go to previous track')
    }
  }, [token])

  const handleSeek = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (!token || !playbackCore?.track) return

      const bar = e.currentTarget
      const rect = bar.getBoundingClientRect()
      const percent = (e.clientX - rect.left) / rect.width
      const positionMs = Math.floor(percent * playbackCore.track.duration)

      try {
        await fetch('/api/player/seek', {
          body: JSON.stringify({position_ms: positionMs}),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })
        // SSE will update progress automatically
      } catch (err) {
        console.error('[NowPlaying] Seek error:', err)
        setControlError('Failed to seek')
      }
    },
    [token, playbackCore]
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

  // Show error if session expired
  const error = storeError || controlError
  if (error && error.includes('expired')) {
    return (
      <div className="now-playing now-playing--error">
        <span className="now-playing__error-text">{error}</span>
      </div>
    )
  }

  // Show connecting state
  if (status === 'connecting') {
    return (
      <div className="now-playing now-playing--inactive">
        <span className="now-playing__inactive-text">Connecting to playback...</span>
      </div>
    )
  }

  if (!playbackCore) {
    return (
      <div className="now-playing now-playing--inactive">
        <span className="now-playing__inactive-text">No active playback - Start playing on Spotify</span>
      </div>
    )
  }

  // Extract nested values for easier access
  const track = playbackCore.track
  const device = playbackCore.device
  const duration = track?.duration ?? 0
  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0

  return (
    <div className="now-playing">
      <div className="now-playing__track">
        {track?.albumArt && <img alt="Album art" className="now-playing__album-art" src={track.albumArt} />}
        <div className="now-playing__info">
          <span className="now-playing__track-name">{track?.name ?? 'Unknown'}</span>
          <span className="now-playing__artist-name">{track?.artist ?? ''}</span>
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
            title={playbackCore.isPlaying ? 'Pause' : 'Play'}
            type="button"
          >
            {playbackCore.isPlaying ? 'Pause' : 'Play'}
          </button>
          <button className="now-playing__control-btn" onClick={handleNext} title="Next" type="button">
            Next
          </button>
        </div>

        <div className="now-playing__progress-container">
          <span className="now-playing__time">{formatTime(progress)}</span>
          <div className="now-playing__progress" onClick={handleSeek} role="slider" tabIndex={0}>
            <div className="now-playing__progress-bar" style={{width: `${progressPercent}%`}} />
          </div>
          <span className="now-playing__time">{formatTime(duration)}</span>
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
          <span className="now-playing__device-name">{device.name}</span>
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
