/**
 * DJLog - Scrollable narration/message stream
 * Shows DJ messages, user steer messages, track changes, and system events
 */

import {useRef} from 'react'

import styles from './DJPage.module.css'

export interface DJLogEntry {
  id: string
  message: string
  timestamp: number
  type: 'dj' | 'info' | 'steer' | 'track' | 'user'
}

interface DJLogProps {
  entries: DJLogEntry[]
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', {hour: '2-digit', hour12: false, minute: '2-digit'})
}

const TYPE_PREFIX: Record<DJLogEntry['type'], string> = {
  dj: 'DJ',
  info: '',
  steer: 'Steering',
  track: 'Now playing',
  user: 'You',
}

export function DJLog({entries}: DJLogProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when entry count changes
  const prevCountRef = useRef(0)
  const currentCount = entries.length
  /* eslint-disable react-hooks/refs -- intentional: scroll tracking for auto-scroll in hook body per React 19 project guidelines (no useEffect) */
  if (currentCount > prevCountRef.current) {
    prevCountRef.current = currentCount
    queueMicrotask(() => {
      listRef.current?.scrollTo({behavior: 'smooth', top: listRef.current.scrollHeight})
    })
  }
  /* eslint-enable react-hooks/refs */

  if (entries.length === 0) {
    return (
      <div className={styles.djLog}>
        <div className={styles.djLogEmpty}>Waiting for the DJ to start...</div>
      </div>
    )
  }

  return (
    <div className={styles.djLog} ref={listRef}>
      {entries.map((entry) => (
        <div className={`${styles.djLogEntry} ${styles[`djLogEntry_${entry.type}`]}`} key={entry.id}>
          <span className={styles.djLogTime}>{formatTime(entry.timestamp)}</span>
          {TYPE_PREFIX[entry.type] && (
            <span className={styles.djLogPrefix}>{TYPE_PREFIX[entry.type]}</span>
          )}
          <span className={styles.djLogMessage}>{entry.message}</span>
        </div>
      ))}
    </div>
  )
}
