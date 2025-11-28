import type {PlayedTrack, QueuedTrack} from '@dj/shared-types'

import type {PlaybackState} from '../../hooks/usePlaybackStream'

import styles from './mix.module.css'

interface NowPlayingHeroProps {
  /** Real-time playback state from Spotify (preferred) */
  playback?: PlaybackState | null
  /** The current queue */
  queue?: QueuedTrack[]
  /** Fallback track from mix session history */
  track?: PlayedTrack | null
}

/**
 * Format milliseconds as m:ss
 */
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function NowPlayingHero({playback, queue, track}: NowPlayingHeroProps) {
  // Prefer real-time playback state over session history
  const hasPlayback = playback && playback.trackId
  const hasTrack = track

  if (!hasPlayback && !hasTrack) {
    return (
      <div className={styles.nowPlayingHero}>
        <div className={styles.albumArtPlaceholder}>
          <span className={styles.placeholderIcon}>🎵</span>
        </div>
        <div className={styles.trackInfo}>
          <h1 className={styles.trackName}>No track playing</h1>
          <p className={styles.artistName}>Start playing on Spotify to begin</p>
        </div>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{width: '0%'}}></div>
        </div>
      </div>
    )
  }

  // Use playback state if available, otherwise fall back to track
  const albumArt = hasPlayback ? playback.albumArt : track?.albumArt
  const trackName = hasPlayback ? playback.trackName : track?.name ?? 'Unknown'
  const artistName = hasPlayback ? playback.artistName : track?.artist ?? ''
  const progress = hasPlayback ? playback.progress : 0
  const duration = hasPlayback ? playback.duration : 0
  const isPlaying = hasPlayback ? playback.isPlaying : false
  const deviceName = hasPlayback ? playback.deviceName : null

  // Calculate progress percentage
  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0

  // Get next track in queue (first item is next up)
  const upNext = queue && queue.length > 0 ? queue[0] : null

  return (
    <div className={styles.nowPlayingHero}>
      <div className={styles.albumArtContainer}>
        {albumArt ? (
          <img alt={`${trackName} album art`} className={styles.albumArt} src={albumArt} />
        ) : (
          <div className={styles.albumArtPlaceholder}>
            <span className={styles.placeholderIcon}>🎵</span>
          </div>
        )}
        {hasPlayback && (
          <div className={styles.playbackIndicator}>
            <span className={isPlaying ? styles.playingDot : styles.pausedDot}>
              {isPlaying ? '▶' : '⏸'}
            </span>
          </div>
        )}
      </div>

      <div className={styles.trackInfo}>
        <h1 className={styles.trackName}>{trackName}</h1>
        <p className={styles.artistName}>{artistName}</p>

        <div className={styles.trackMeta}>
          {track?.bpm && <span className={styles.metaBadge}>{Math.round(track.bpm)} BPM</span>}
          {track?.energy && <span className={styles.metaBadge}>Energy: {Math.round(track.energy * 100)}%</span>}
          {deviceName && <span className={styles.metaBadge}>{deviceName}</span>}
        </div>
      </div>

      <div className={styles.progressContainer}>
        {hasPlayback && (
          <span className={styles.progressTime}>{formatTime(progress)}</span>
        )}
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{width: `${progressPercent}%`}}></div>
        </div>
        {hasPlayback && (
          <span className={styles.progressTime}>{formatTime(duration)}</span>
        )}
      </div>

      {upNext && (
        <div className={styles.upNextContainer}>
          <span className={styles.upNextLabel}>Up Next</span>
          <div className={styles.upNextTrack}>
            {upNext.albumArt && (
              <img
                alt={`${upNext.name} album art`}
                className={styles.upNextAlbumArt}
                src={upNext.albumArt}
              />
            )}
            <div className={styles.upNextInfo}>
              <span className={styles.upNextName}>{upNext.name}</span>
              <span className={styles.upNextArtist}>{upNext.artist}</span>
            </div>
            {queue && queue.length > 1 && (
              <span className={styles.upNextMore}>+{queue.length - 1} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
