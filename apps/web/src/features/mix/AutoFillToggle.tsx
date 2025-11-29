import {useCallback, useState} from 'react'

import {storage, STORAGE_KEYS} from '../../hooks/useLocalStorage'

import styles from './auto-fill-toggle.module.css'

interface AutoFillToggleProps {
  autoFill: boolean
  onToggle?: (enabled: boolean) => void
}

export function AutoFillToggle({autoFill, onToggle}: AutoFillToggleProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [localAutoFill, setLocalAutoFill] = useState(autoFill)

  // Sync local state with prop
  if (autoFill !== localAutoFill && !isLoading) {
    setLocalAutoFill(autoFill)
  }

  const handleToggle = useCallback(async () => {
    const newValue = !localAutoFill
    setIsLoading(true)
    setLocalAutoFill(newValue)

    try {
      const tokenData = storage.get<{token: string; expiresAt: number | null} | null>(
        STORAGE_KEYS.SPOTIFY_TOKEN_DATA,
        null,
      )
      const token = tokenData?.token

      if (!token) {
        throw new Error('No auth token')
      }

      const response = await fetch('/api/mix/preferences', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({autoFill: newValue}),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({error: 'Request failed'}))
        throw new Error(error.error || 'Failed to update preferences')
      }

      onToggle?.(newValue)
    } catch (error) {
      console.error('[AutoFillToggle] Error:', error)
      // Revert on error
      setLocalAutoFill(!newValue)
    } finally {
      setIsLoading(false)
    }
  }, [localAutoFill, onToggle])

  return (
    <div className={styles.container}>
      <span className={styles.label}>Queue Auto-Fill</span>
      <button
        aria-label={localAutoFill ? 'Disable auto-fill' : 'Enable auto-fill'}
        aria-pressed={localAutoFill}
        className={`${styles.toggle} ${localAutoFill ? styles.active : ''}`}
        disabled={isLoading}
        onClick={handleToggle}
        title={localAutoFill ? 'Auto (AI fills queue)' : 'Manual (you control queue)'}
        type="button"
      >
        <span className={styles.toggleTrack}>
          <span className={styles.toggleThumb} />
        </span>
        <span className={styles.toggleLabel}>
          {localAutoFill ? 'Auto' : 'Manual'}
        </span>
      </button>
    </div>
  )
}
