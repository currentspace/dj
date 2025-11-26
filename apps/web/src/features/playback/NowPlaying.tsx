/**
 * NowPlaying Component - Shows current playback state with controls
 * Phase 1 of DJ Live Mode implementation
 */

import {memo, useCallback, useEffect, useRef, useState} from 'react'

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

interface NowPlayingProps {
  token: string | null
}

export const NowPlaying = memo(function NowPlaying({token}: NowPlayingProps) {
  const [playback, setPlayback] = useState<PlaybackState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastFetchRef = useRef<number>(0)

  const fetchPlaybackState = useCallback(async () => {
    if (!token) return

    // Debounce rapid calls
    const now = Date.now()
    if (now - lastFetchRef.current < 500) return
    lastFetchRef.current = now

    try {
      const response = await fetch('/api/player/state', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (response.status === 401) {
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

      setPlayback({
        albumArt: data.item?.album?.images?.[0]?.url ?? null,
        artistName: data.item?.artists?.map(a => a.name).join(', ') ?? '',
        deviceName: data.device?.name ?? 'Unknown',
        duration: data.item?.duration_ms ?? 0,
        isPlaying: data.is_playing ?? false,
        progress: data.progress_ms ?? 0,
        trackName: data.item?.name ?? 'Unknown',
      })
      setError(null)
    } catch (err) {
      console.error('[NowPlaying] Fetch error:', err)
    }
  }, [token])

  // Polling effect - fetches playback state every second
  useEffect(() => {
    if (!token) return

    // Initial fetch
    fetchPlaybackState()

    // Set up polling (every 1 second)
    pollIntervalRef.current = setInterval(fetchPlaybackState, 1000)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [token, fetchPlaybackState])

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
      setTimeout(fetchPlaybackState, 300)
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
      setTimeout(fetchPlaybackState, 300)
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
            ⏮
          </button>
          <button
            className="now-playing__control-btn now-playing__control-btn--play"
            onClick={handlePlayPause}
            title={playback.isPlaying ? 'Pause' : 'Play'}
            type="button"
          >
            {playback.isPlaying ? '⏸' : '▶'}
          </button>
          <button className="now-playing__control-btn" onClick={handleNext} title="Next" type="button">
            ⏭
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

      <div className="now-playing__device">
        <span className="now-playing__device-icon">🔊</span>
        <span className="now-playing__device-name">{playback.deviceName}</span>
      </div>
    </div>
  )
})
