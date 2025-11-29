import {useCallback, useState} from 'react'

import {playerApiClient} from '../../lib/player-api-client'

import styles from './playback-controls.module.css'

interface PlaybackControlsProps {
  isPlaying: boolean
  volumePercent: number | null
  supportsVolume: boolean
  onPlaybackChange?: () => void
}

export function PlaybackControls({
  isPlaying,
  volumePercent,
  supportsVolume,
  onPlaybackChange,
}: PlaybackControlsProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [localVolume, setLocalVolume] = useState(volumePercent ?? 50)

  const handlePlayPause = useCallback(async () => {
    setIsLoading(true)
    try {
      if (isPlaying) {
        await playerApiClient.pause()
      } else {
        await playerApiClient.play()
      }
      onPlaybackChange?.()
    } catch (error) {
      console.error('[PlaybackControls] Play/pause error:', error)
    } finally {
      setIsLoading(false)
    }
  }, [isPlaying, onPlaybackChange])

  const handlePrevious = useCallback(async () => {
    setIsLoading(true)
    try {
      await playerApiClient.previous()
      onPlaybackChange?.()
    } catch (error) {
      console.error('[PlaybackControls] Previous error:', error)
    } finally {
      setIsLoading(false)
    }
  }, [onPlaybackChange])

  const handleNext = useCallback(async () => {
    setIsLoading(true)
    try {
      await playerApiClient.next()
      onPlaybackChange?.()
    } catch (error) {
      console.error('[PlaybackControls] Next error:', error)
    } finally {
      setIsLoading(false)
    }
  }, [onPlaybackChange])

  const handleVolumeChange = useCallback(async (newVolume: number) => {
    setLocalVolume(newVolume)
    try {
      await playerApiClient.setVolume(newVolume)
    } catch (error) {
      console.error('[PlaybackControls] Volume error:', error)
    }
  }, [])

  // Sync local volume with prop when it changes
  if (volumePercent !== null && volumePercent !== localVolume) {
    setLocalVolume(volumePercent)
  }

  return (
    <div className={styles.controls}>
      <div className={styles.transportControls}>
        <button
          aria-label="Previous track"
          className={styles.controlButton}
          disabled={isLoading}
          onClick={handlePrevious}
          title="Previous"
          type="button"
        >
          <svg fill="currentColor" height="20" viewBox="0 0 24 24" width="20">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>

        <button
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className={`${styles.controlButton} ${styles.playPauseButton}`}
          disabled={isLoading}
          onClick={handlePlayPause}
          title={isPlaying ? 'Pause' : 'Play'}
          type="button"
        >
          {isPlaying ? (
            <svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <button
          aria-label="Next track"
          className={styles.controlButton}
          disabled={isLoading}
          onClick={handleNext}
          title="Next"
          type="button"
        >
          <svg fill="currentColor" height="20" viewBox="0 0 24 24" width="20">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>

      {supportsVolume && (
        <div className={styles.volumeControl}>
          <svg
            className={styles.volumeIcon}
            fill="currentColor"
            height="18"
            viewBox="0 0 24 24"
            width="18"
          >
            {localVolume === 0 ? (
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
            ) : localVolume < 50 ? (
              <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
            ) : (
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            )}
          </svg>
          <input
            aria-label="Volume"
            className={styles.volumeSlider}
            max={100}
            min={0}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            type="range"
            value={localVolume}
          />
          <span className={styles.volumeValue}>{Math.round(localVolume)}%</span>
        </div>
      )}
    </div>
  )
}
