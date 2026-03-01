/**
 * NowPlaying Component - Shows current playback state with controls
 * Uses Zustand playbackStore for SSE-based real-time updates
 *
 * Also notifies mix API on track changes to trigger queue auto-fill
 * even when not on the Mix page.
 */

import type {MixSession} from '@dj/shared-types'

import {memo, useCallback, useRef, useState} from 'react'

import {useNextMutation, usePlayerQueue, usePlayPauseMutation, usePreviousMutation, useSeekMutation} from '../../hooks/queries'
import {queryKeys} from '../../hooks/queries/queryKeys'
import {mixApiClient} from '../../lib/mix-api-client'
import {queryClient} from '../../lib/query-client'
import {usePlaybackStore} from '../../stores'
import '../../styles/now-playing.css'

interface NowPlayingProps {
  token: null | string
}

export const NowPlaying = memo(function NowPlaying({token}: NowPlayingProps) {
  // Atomic selectors from playback store
  const playbackCore = usePlaybackStore((s) => s.playbackCore)
  const progress = usePlaybackStore((s) => s.progress)
  const status = usePlaybackStore((s) => s.status)
  const storeError = usePlaybackStore((s) => s.error)
  const connect = usePlaybackStore((s) => s.connect)
  const disconnect = usePlaybackStore((s) => s.disconnect)
  const subscribeToTrackChange = usePlaybackStore((s) => s.subscribeToTrackChange)

  // Local state for queue panel
  const [showQueue, setShowQueue] = useState(false)
  const [controlError, setControlError] = useState<null | string>(null)

  // Refs
  const hasConnectedRef = useRef(false)
  const trackChangeUnsubRef = useRef<(() => void) | null>(null)

  // React-query hooks for queue polling and player controls
  const {data: queue} = usePlayerQueue(token, showQueue)
  const playPauseMutation = usePlayPauseMutation()
  const nextMutation = useNextMutation()
  const previousMutation = usePreviousMutation()
  const seekMutation = useSeekMutation()

  // Connect to SSE stream when token available (component body, no useEffect)
  if (token && !hasConnectedRef.current && status === 'disconnected') {
    hasConnectedRef.current = true
    connect(token)
  }
  if (!token && hasConnectedRef.current) {
    hasConnectedRef.current = false
    disconnect()
  }

  // Subscribe to track changes and notify mix API if session exists
  trackChangeUnsubRef.current ??= subscribeToTrackChange(async (previousTrackId, previousTrackUri, _newTrackId) => {
      const session = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())
      if (!session || !previousTrackId || !previousTrackUri) {
        return
      }

      console.log('[NowPlaying] Track changed, notifying mix API:', previousTrackId)

      try {
        const response = await mixApiClient.notifyTrackPlayed(previousTrackId, previousTrackUri)
        if (response.movedToHistory) {
          console.log('[NowPlaying] Track moved to history, session updated')
          queryClient.setQueryData(queryKeys.mix.session(), response.session)
        }
      } catch (err) {
        console.warn('[NowPlaying] Failed to notify track played:', err)
      }
    })

  const handlePlayPause = useCallback(async () => {
    if (!token || !playbackCore) return
    try {
      await playPauseMutation.mutateAsync(playbackCore.isPlaying)
    } catch (err) {
      console.error('[NowPlaying] Play/pause error:', err)
      setControlError('Failed to toggle playback')
    }
  }, [token, playbackCore, playPauseMutation])

  const handleNext = useCallback(async () => {
    if (!token) return
    try {
      await nextMutation.mutateAsync()
    } catch (err) {
      console.error('[NowPlaying] Next error:', err)
      setControlError('Failed to skip track')
    }
  }, [token, nextMutation])

  const handlePrevious = useCallback(async () => {
    if (!token) return
    try {
      await previousMutation.mutateAsync()
    } catch (err) {
      console.error('[NowPlaying] Previous error:', err)
      setControlError('Failed to go to previous track')
    }
  }, [token, previousMutation])

  const handleSeek = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (!token || !playbackCore?.track) return

      const bar = e.currentTarget
      const rect = bar.getBoundingClientRect()
      const percent = (e.clientX - rect.left) / rect.width
      const positionMs = Math.floor(percent * playbackCore.track.duration)

      try {
        await seekMutation.mutateAsync(positionMs)
      } catch (err) {
        console.error('[NowPlaying] Seek error:', err)
        setControlError('Failed to seek')
      }
    },
    [token, playbackCore, seekMutation]
  )

  const handleToggleQueue = useCallback(() => {
    setShowQueue((prev) => !prev)
  }, [])

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
  const error = storeError ?? controlError
  if (error?.includes('expired')) {
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
          <div
            aria-label="Seek"
            aria-valuemax={duration}
            aria-valuemin={0}
            aria-valuenow={progress}
            className="now-playing__progress"
            onClick={handleSeek}
            onKeyDown={(e) => {
              if (!token || !playbackCore?.track) return
              const seekStep = duration * 0.05
              let newPosition: null | number = null
              if (e.key === 'ArrowRight') newPosition = Math.min(progress + seekStep, duration)
              else if (e.key === 'ArrowLeft') newPosition = Math.max(progress - seekStep, 0)
              if (newPosition !== null) {
                e.preventDefault()
                seekMutation.mutate(Math.floor(newPosition))
              }
            }}
            role="slider"
            tabIndex={0}
          >
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
              onClick={() => setShowQueue(false)}
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
