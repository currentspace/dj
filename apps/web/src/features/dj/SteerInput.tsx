/**
 * SteerInput - Fixed-bottom text input for steering the DJ vibe
 * Uses React 19 form actions; no controlled input state.
 */

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
] as const satisfies readonly {direction: string; label: string}[]

export function SteerInput({disabled, isLoading, onSteer}: SteerInputProps) {
  const isDisabled = disabled ?? isLoading ?? false

  // React 19 form action: receives the FormData on submit; the form auto-resets.
  function steerAction(formData: FormData) {
    const direction = String(formData.get('direction') ?? '').trim()
    if (!direction || isDisabled) return
    onSteer(direction)
  }

  return (
    <div className={styles.steerInput}>
      <div className={styles.steerPresets}>
        {QUICK_PRESETS.map(preset => (
          <button
            className={styles.steerPresetBtn}
            disabled={isDisabled}
            key={preset.label}
            onClick={() => !isDisabled && onSteer(preset.direction)}
            type="button">
            {preset.label}
          </button>
        ))}
      </div>

      <form action={steerAction} className={styles.steerForm}>
        <input
          className={styles.steerTextInput}
          disabled={disabled}
          name="direction"
          placeholder={isLoading ? 'Steering...' : 'Steer the vibe (e.g., "more acoustic guitar")'}
          type="text"
        />
        <button className={styles.steerSubmitBtn} disabled={isDisabled} type="submit">
          {isLoading ? 'Steering...' : 'Steer'}
        </button>
      </form>
    </div>
  )
}
