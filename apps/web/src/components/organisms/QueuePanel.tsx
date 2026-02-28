import type {QueuedTrack} from '@dj/shared-types'

import sharedStyles from '../templates/mix-shared.module.css'
import styles from './queue-panel.module.css'

interface QueuePanelProps {
  onRemove: (position: number) => void
  onReorder: (from: number, to: number) => void
  queue: QueuedTrack[]
}

export function QueuePanel({queue, onRemove, onReorder: _onReorder}: QueuePanelProps) {
  return (
    <div className={styles.queuePanel}>
      <div className={sharedStyles.panelHeader}>
        <h2>Queue</h2>
        <span className={styles.queueCount}>{queue.length} tracks</span>
      </div>

      <div className={styles.queueList}>
        {queue.length === 0 ? (
          <div className={sharedStyles.emptyState}>
            <span className={sharedStyles.emptyIcon}>🎵</span>
            <p>Queue is empty</p>
            <p className={sharedStyles.emptyHint}>Add tracks from suggestions or search</p>
          </div>
        ) : (
          queue.map((track, index) => (
            <div className={styles.queueItem} key={`${track.trackId}-${track.position}`}>
              <div className={styles.queuePosition}>{index + 1}</div>

              <div className={styles.queueItemContent}>
                {track.albumArt && (
                  <img alt={`${track.name} album art`} className={styles.queueAlbumArt} src={track.albumArt} />
                )}

                <div className={styles.queueTrackInfo}>
                  <div className={styles.queueTrackName}>{track.name}</div>
                  <div className={styles.queueTrackArtist}>{track.artist}</div>

                  <div className={styles.queueTrackMeta}>
                    <span className={track.addedBy === 'ai' ? styles.badgeAi : styles.badgeUser}>
                      {track.addedBy === 'ai' ? '🤖 Added by AI' : '👤 Added by you'}
                    </span>

                    {track.addedBy === 'ai' && (
                      <>
                        <span className={styles.vibeScore}>{track.vibeScore}% match</span>
                        {track.reason && <span className={styles.aiReason}>{track.reason}</span>}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <button className={styles.removeButton} onClick={() => onRemove(track.position)} title="Remove from queue" type="button">
                <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
