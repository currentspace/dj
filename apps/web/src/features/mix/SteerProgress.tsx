/**
 * SteerProgress - Shows real-time feedback during vibe steering
 */

import { useEffect, useRef } from 'react'

import styles from './steer-progress.module.css'

export interface SteerProgressEvent {
  type: 'ack' | 'thinking' | 'progress' | 'vibe_update' | 'suggestions' | 'queue_update' | 'error' | 'done'
  data: {
    message?: string
    stage?: string
    preview?: string
    vibe?: unknown
    changes?: string[]
    track?: { name: string; artist: string }
    queueSize?: number
    count?: number
    queue?: unknown[]
  }
}

interface SteerProgressProps {
  direction: string
  events: SteerProgressEvent[]
  isComplete: boolean
  onClose: () => void
}

export function SteerProgress({ direction, events, isComplete, onClose }: SteerProgressProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  // Get the latest progress messages for display
  const progressMessages = events
    .filter(e => e.type === 'ack' || e.type === 'progress')
    .map(e => e.data.message)
    .filter(Boolean) as string[]

  // Get vibe changes if available
  const vibeUpdate = events.find(e => e.type === 'vibe_update')
  const changes = vibeUpdate?.data.changes || []

  // Get queue updates
  const queueUpdates = events.filter(e => e.type === 'queue_update')

  // Get final done message
  const doneEvent = events.find(e => e.type === 'done')

  // Get any errors
  const errorEvent = events.find(e => e.type === 'error')

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h3 className={styles.title}>Steering the Vibe</h3>
          <span className={styles.direction}>"{direction}"</span>
        </div>

        <div className={styles.content}>
          {/* Progress Messages */}
          <div className={styles.progressSection}>
            {progressMessages.map((msg, i) => (
              <div
                key={i}
                className={`${styles.progressMessage} ${i === progressMessages.length - 1 ? styles.active : styles.completed}`}
              >
                <span className={styles.progressDot}>
                  {i === progressMessages.length - 1 && !isComplete ? (
                    <span className={styles.spinner} />
                  ) : (
                    '✓'
                  )}
                </span>
                <span className={styles.progressText}>{msg}</span>
              </div>
            ))}
          </div>

          {/* Vibe Changes */}
          {changes.length > 0 && (
            <div className={styles.changesSection}>
              <h4 className={styles.changesTitle}>Vibe Adjustments</h4>
              <ul className={styles.changesList}>
                {changes.map((change, i) => (
                  <li key={i} className={styles.changeItem}>{change}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Queue Building Progress */}
          {queueUpdates.length > 0 && (
            <div className={styles.queueSection}>
              <h4 className={styles.queueTitle}>Building Queue</h4>
              <div className={styles.queueTracks}>
                {queueUpdates.slice(-5).map((update, i) => (
                  <div key={i} className={styles.queueTrack}>
                    <span className={styles.trackName}>{update.data.track?.name}</span>
                    <span className={styles.trackArtist}>{update.data.track?.artist}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {errorEvent && (
            <div className={styles.error}>
              {errorEvent.data.message || 'Something went wrong'}
            </div>
          )}

          {/* Done */}
          {doneEvent && (
            <div className={styles.doneSection}>
              <div className={styles.doneMessage}>{doneEvent.data.message}</div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {isComplete ? (
            <button className={styles.closeButton} onClick={onClose} type="button">
              Done
            </button>
          ) : (
            <div className={styles.loadingText}>
              <span className={styles.loadingDots}>
                <span>.</span><span>.</span><span>.</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
