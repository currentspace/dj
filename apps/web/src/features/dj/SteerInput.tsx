/**
 * SteerInput - Fixed-bottom text input for steering the DJ vibe
 * Submits to steer-stream endpoint with inline feedback
 */

import {useCallback, useState} from 'react'

import styles from './DJPage.module.css'

interface SteerInputProps {
  disabled?: boolean
  isLoading?: boolean
  onSteer: (direction: string) => void
}

const QUICK_PRESETS = [
  {direction: 'More energy and upbeat tracks', label: 'More Energy'},
  {direction: 'Chill out with mellow vibes', label: 'Chill Out'},
  {direction: 'Go retro with classic sounds', label: 'Go Retro'},
  {direction: 'Something fresh and unexpected', label: 'Surprise Me'},
] as const

export function SteerInput({disabled, isLoading, onSteer}: SteerInputProps) {
  const [input, setInput] = useState('')

  const isDisabled = disabled ?? isLoading ?? false

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = input.trim()
      if (!trimmed || isDisabled) return
      onSteer(trimmed)
      setInput('')
    },
    [input, isDisabled, onSteer],
  )

  const handlePreset = useCallback(
    (direction: string) => {
      if (isDisabled) return
      onSteer(direction)
    },
    [isDisabled, onSteer],
  )

  return (
    <div className={styles.steerInput}>
      <div className={styles.steerPresets}>
        {QUICK_PRESETS.map((preset) => (
          <button
            className={styles.steerPresetBtn}
            disabled={isDisabled}
            key={preset.label}
            onClick={() => handlePreset(preset.direction)}
            type="button"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <form className={styles.steerForm} onSubmit={handleSubmit}>
        <input
          className={styles.steerTextInput}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isLoading ? 'Steering...' : 'Steer the vibe (e.g., "more acoustic guitar")'}
          type="text"
          value={input}
        />
        <button
          className={styles.steerSubmitBtn}
          disabled={!input.trim() || isDisabled}
          type="submit"
        >
          {isLoading ? 'Steering...' : 'Steer'}
        </button>
      </form>
    </div>
  )
}
