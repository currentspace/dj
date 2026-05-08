/**
 * DebugPanel - Slide-up panel showing timestamped debug events
 * with category filters and auto-scroll to newest
 */

import {useRef, useState} from 'react'

import {type DebugCategory, type DebugEvent, useDebugStore} from '../../stores/debugStore'
import styles from './debug-panel.module.css'

const CATEGORY_LABELS: Record<'all' | DebugCategory, string> = {
  all: 'All',
  api: 'API',
  error: 'Errors',
  sse: 'SSE',
  state: 'State',
  steer: 'Steer',
}

const FILTER_ORDER: ('all' | DebugCategory)[] = ['all', 'sse', 'api', 'error', 'steer', 'state']

export function DebugPanel() {
  const events = useDebugStore((s) => s.events)
  const filter = useDebugStore((s) => s.filter)
  const errorCount = useDebugStore((s) => s.errorCount)
  const connectedAt = useDebugStore((s) => s.connectedAt)
  const setFilter = useDebugStore((s) => s.setFilter)
  const clear = useDebugStore((s) => s.clear)
  const toggle = useDebugStore((s) => s.toggle)

  const listRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filtered = filter ? events.filter((e) => e.category === filter) : events

  // Auto-scroll to bottom on new events
  const prevCountRef = useRef(0)
  /* eslint-disable react-hooks/refs -- intentional: scroll tracking for auto-scroll in hook body per React 19 project guidelines (no useEffect) */
  if (filtered.length > prevCountRef.current) {
    prevCountRef.current = filtered.length
    queueMicrotask(() => {
      listRef.current?.scrollTo({behavior: 'smooth', top: listRef.current.scrollHeight})
    })
  }
  if (filtered.length < prevCountRef.current) {
    prevCountRef.current = filtered.length
  }
  /* eslint-enable react-hooks/refs */

  const handleToggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.filters}>
          {FILTER_ORDER.map((cat) => (
            <button
              className={`${styles.filterChip} ${(cat === 'all' ? !filter : filter === cat) ? styles.filterActive : ''}`}
              key={cat}
              onClick={() => setFilter(cat === 'all' ? null : cat)}
              type="button"
            >
              {CATEGORY_LABELS[cat]}
              {cat === 'error' && errorCount > 0 && (
                <span className={styles.errorBadge}>{errorCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className={styles.headerActions}>
          <button className={styles.clearBtn} onClick={clear} type="button">Clear</button>
          <button className={styles.closeBtn} onClick={toggle} type="button">Close</button>
        </div>
      </div>

      <div className={styles.eventList} ref={listRef}>
        {filtered.length === 0 ? (
          <div className={styles.emptyState}>No events{filter ? ` in "${filter}" category` : ''}</div>
        ) : (
          filtered.map((event) => (
            <EventRow
              event={event}
              isExpanded={expanded.has(event.id)}
              key={event.id}
              onToggle={() => handleToggleExpand(event.id)}
            />
          ))
        )}
      </div>

      <div className={styles.footer}>
        <span>{filtered.length} events</span>
        <span>{errorCount} errors</span>
        <span>Uptime: {formatUptime(connectedAt)}</span>
      </div>
    </div>
  )
}

function CategoryBadge({category}: {category: DebugCategory}) {
  return <span className={`${styles.badge} ${styles[`badge_${category}`]}`}>{category}</span>
}

function EventRow({event, isExpanded, onToggle}: {event: DebugEvent; isExpanded: boolean; onToggle: () => void}) {
  return (
    <div className={styles.eventRow}>
      <button className={styles.eventHeader} onClick={onToggle} type="button">
        <span className={styles.eventTime}>{formatTimestamp(event.timestamp)}</span>
        <CategoryBadge category={event.category} />
        <span className={styles.eventSummary}>{event.summary}</span>
        {event.meta?.durationMs !== undefined && (
          <span className={styles.eventDuration}>{event.meta.durationMs}ms</span>
        )}
        {event.meta?.status !== undefined && (
          <span className={event.meta.status >= 400 ? styles.statusError : styles.statusOk}>
            {event.meta.status}
          </span>
        )}
      </button>
      {isExpanded && event.data !== undefined && (
        <pre className={styles.eventData}>{JSON.stringify(event.data, null, 2)}</pre>
      )}
    </div>
  )
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', {hour12: false}) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function formatUptime(connectedAt: null | number): string {
  if (!connectedAt) return '—'
  const seconds = Math.floor((Date.now() - connectedAt) / 1000)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}
