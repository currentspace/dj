import {useCallback, useState} from 'react'

import {storage, STORAGE_KEYS} from '../../hooks/useLocalStorage'

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
      const tokenData = storage.get<null | {expiresAt: null | number; token: string;}>(
        STORAGE_KEYS.SPOTIFY_TOKEN_DATA,
        null,
      )
      const token = tokenData?.token

      if (!token) {
        throw new Error('No auth token')
      }

      const response = await fetch('/api/mix/preferences', {
        body: JSON.stringify({autoFill: newValue}),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'PATCH',
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({error: 'Request failed'}))
        throw new Error(error.error || 'Failed to update preferences')
      }

      onToggle?.(newValue)
    } catch (error) {
      console.error('[AutoFillToggle] Error:', error)
      setLocalAutoFill(!newValue)
    } finally {
      setIsLoading(false)
    }
  }, [localAutoFill, onToggle])

  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-white/70">Queue Auto-Fill</span>
      <button
        aria-label={localAutoFill ? 'Disable auto-fill' : 'Enable auto-fill'}
        aria-pressed={localAutoFill}
        className={`flex items-center gap-2 px-2.5 py-1.5 border rounded-[20px] cursor-pointer transition-all duration-200 text-white disabled:opacity-50 disabled:cursor-not-allowed ${
          localAutoFill
            ? 'border-spotify-green bg-spotify-green/15'
            : 'border-white/20 bg-black/30 hover:border-white/40 hover:bg-black/40'
        }`}
        disabled={isLoading}
        onClick={handleToggle}
        title={localAutoFill ? 'Auto (AI fills queue)' : 'Manual (you control queue)'}
        type="button"
      >
        <span className={`relative w-8 h-[18px] rounded-[9px] transition-colors duration-200 ${localAutoFill ? 'bg-spotify-green' : 'bg-white/30'}`}>
          <span className={`absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white transition-transform duration-200 ${localAutoFill ? 'translate-x-3.5' : ''}`} />
        </span>
        <span className="text-xs font-medium min-w-12">
          {localAutoFill ? 'Auto' : 'Manual'}
        </span>
      </button>
    </div>
  )
}
