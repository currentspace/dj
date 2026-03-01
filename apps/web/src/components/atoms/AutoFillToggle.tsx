import {useState} from 'react'

import {useAutoFillMutation} from '../../hooks/queries'

interface AutoFillToggleProps {
  autoFill: boolean
  onToggle?: (enabled: boolean) => void
}

export function AutoFillToggle({autoFill, onToggle}: AutoFillToggleProps) {
  const mutation = useAutoFillMutation(onToggle)
  const [localAutoFill, setLocalAutoFill] = useState(autoFill)

  // Sync local state with prop
  if (autoFill !== localAutoFill && !mutation.isPending) {
    setLocalAutoFill(autoFill)
  }

  const handleToggle = () => {
    const newValue = !localAutoFill
    setLocalAutoFill(newValue)
    mutation.mutate(newValue, {
      onError: () => {
        setLocalAutoFill(!newValue)
      },
    })
  }

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
        disabled={mutation.isPending}
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
