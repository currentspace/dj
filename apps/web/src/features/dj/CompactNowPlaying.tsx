/**
 * CompactNowPlaying - Merged playback display
 * Combines NowPlayingHero art/badges with NowPlaying controls
 * Always visible at top of DJPage when session is active
 */

import type {PlaybackState} from '../../stores'

import {PlaybackControls} from '../../components/molecules/PlaybackControls'
import {useDevice} from '../../stores'
import styles from './DJPage.module.css'

interface CompactNowPlayingProps {
  playback: null | PlaybackState
}

export function CompactNowPlaying({playback}: CompactNowPlayingProps) {
  const device = useDevice()

  if (!playback?.trackId) {
    return (
      <div className={styles.nowPlaying}>
        <div className={styles.npArtPlaceholder}>🎵</div>
        <div className={styles.npInfo}>
          <span className={styles.npTrackName}>No track playing</span>
          <span className={styles.npArtist}>Start playing on Spotify</span>
        </div>
      </div>
    )
  }

  const progressPercent = playback.duration > 0 ? (playback.progress / playback.duration) * 100 : 0

  return (
    <div className={styles.nowPlaying}>
      {playback.albumArt ? (
        <img alt="Album art" className={styles.npArt} src={playback.albumArt} />
      ) : (
        <div className={styles.npArtPlaceholder}>🎵</div>
      )}

      <div className={styles.npInfo}>
        <span className={styles.npTrackName}>{playback.trackName}</span>
        <span className={styles.npArtist}>{playback.artistName}</span>
      </div>

      <div className={styles.npControls}>
        <PlaybackControls
          isPlaying={playback.isPlaying}
          supportsVolume={device?.supportsVolume ?? false}
          volumePercent={device?.volumePercent ?? null}
        />
      </div>

      <div className={styles.npProgress}>
        <span className={styles.npTime}>{formatTime(playback.progress)}</span>
        <div className={styles.npProgressBar}>
          <div className={styles.npProgressFill} style={{width: `${progressPercent}%`}} />
        </div>
        <span className={styles.npTime}>{formatTime(playback.duration)}</span>
      </div>
    </div>
  )
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
