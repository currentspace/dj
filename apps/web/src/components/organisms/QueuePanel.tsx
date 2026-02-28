import type {QueuedTrack} from '@dj/shared-types'

import sharedStyles from '../templates/mix-shared.module.css'
import styles from './queue-panel.module.css'

/** Extended queue track with optional enrichment data */
type EnrichedQueuedTrack = QueuedTrack & {bpm?: number; energy?: number}

interface QueuePanelProps {
  isSearching?: boolean
  onRemove: (position: number) => void
  onReorder: (from: number, to: number) => void
  queue: EnrichedQueuedTrack[]
}

export function QueuePanel({isSearching, onRemove, onReorder, queue}: QueuePanelProps) {
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
                      {track.addedBy === 'ai' ? 'AI' : 'You'}
                    </span>

                    {track.addedBy === 'ai' && (
                      <span className={styles.vibeScore}>{track.vibeScore}%</span>
                    )}

                    {track.bpm && (
                      <span className={styles.bpmBadge}>{Math.round(track.bpm)} BPM</span>
                    )}

                    {track.energy !== undefined && track.energy !== null && (
                      <span className={styles.energyBadge} style={{
                        '--energy-hue': `${120 * track.energy}`,
                      } as React.CSSProperties}>
                        E:{Math.round(track.energy * 100)}%
                      </span>
                    )}
                  </div>

                  {track.reason && (
                    <div className={styles.aiReason}>{track.reason}</div>
                  )}
                </div>
              </div>

              <div className={styles.queueActions}>
                <button
                  className={styles.reorderButton}
                  disabled={index === 0}
                  onClick={() => onReorder(index, index - 1)}
                  title="Move up"
                  type="button"
                >
                  <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path d="M5 15l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  className={styles.reorderButton}
                  disabled={index === queue.length - 1}
                  onClick={() => onReorder(index, index + 1)}
                  title="Move down"
                  type="button"
                >
                  <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button className={styles.removeButton} onClick={() => onRemove(track.position)} title="Remove from queue" type="button">
                  <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}

        {isSearching && (
          <div className={styles.searchingIndicator}>
            <div className={sharedStyles.loadingSpinner}></div>
            <span>Finding more tracks...</span>
          </div>
        )}
      </div>
    </div>
  )
}
