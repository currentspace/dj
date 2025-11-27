import type {PlayedTrack} from '@dj/shared-types'

import styles from './mix.module.css'

interface NowPlayingHeroProps {
  track: PlayedTrack | null
}

export function NowPlayingHero({track}: NowPlayingHeroProps) {
  if (!track) {
    return (
      <div className={styles.nowPlayingHero}>
        <div className={styles.albumArtPlaceholder}>
          <span className={styles.placeholderIcon}>🎵</span>
        </div>
        <div className={styles.trackInfo}>
          <h1 className={styles.trackName}>No track playing</h1>
          <p className={styles.artistName}>Start your mix to begin</p>
        </div>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{width: '0%'}}></div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.nowPlayingHero}>
      <div className={styles.albumArtContainer}>
        {track.albumArt ? (
          <img alt={`${track.name} album art`} className={styles.albumArt} src={track.albumArt} />
        ) : (
          <div className={styles.albumArtPlaceholder}>
            <span className={styles.placeholderIcon}>🎵</span>
          </div>
        )}
      </div>

      <div className={styles.trackInfo}>
        <h1 className={styles.trackName}>{track.name}</h1>
        <p className={styles.artistName}>{track.artist}</p>

        <div className={styles.trackMeta}>
          {track.bpm && <span className={styles.metaBadge}>{Math.round(track.bpm)} BPM</span>}
          {track.energy && <span className={styles.metaBadge}>Energy: {Math.round(track.energy * 100)}%</span>}
        </div>
      </div>

      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{width: '35%'}}></div>
      </div>
    </div>
  )
}
