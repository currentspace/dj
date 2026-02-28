import type {VibeProfile} from '@dj/shared-types'

import {useCallback, useState} from 'react'

import styles from './vibe-controls.module.css'

interface VibeControlsProps {
  onEnergyChange: (level: number) => void
  onSteer: (direction: string) => void
  vibe: null | VibeProfile
}

const ENERGY_DIRECTION_MAP = {
  building: {icon: '↗', label: 'Building'},
  steady: {icon: '→', label: 'Steady'},
  winding_down: {icon: '↘', label: 'Winding down'},
} as const

const QUICK_PRESETS = [
  {direction: 'More energy and upbeat tracks', label: 'More Energy'},
  {direction: 'Chill out with mellow vibes', label: 'Chill Out'},
  {direction: 'Go retro with classic sounds', label: 'Go Retro'},
  {direction: 'Something fresh and unexpected', label: 'Something Fresh'},
] as const

export function VibeControls({onEnergyChange, onSteer, vibe}: VibeControlsProps) {
  const [customInput, setCustomInput] = useState('')

  const handleEnergySliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const level = parseInt(e.target.value, 10)
      onEnergyChange(level)
    },
    [onEnergyChange],
  )

  const handlePresetClick = useCallback(
    (direction: string) => {
      onSteer(direction)
    },
    [onSteer],
  )

  const handleCustomSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (customInput.trim()) {
        onSteer(customInput.trim())
        setCustomInput('')
      }
    },
    [customInput, onSteer],
  )

  if (!vibe) {
    return (
      <div className={styles.vibeControls}>
        <div className={styles.vibeLoading}>
          <p>Analyzing vibe...</p>
        </div>
      </div>
    )
  }

  const energyDirection = ENERGY_DIRECTION_MAP[vibe.energyDirection]

  return (
    <div className={styles.vibeControls}>
      <div className={styles.vibeHeader}>
        <h2>Vibe Controls</h2>
        <div className={styles.energyDirection}>
          <span className={styles.energyDirectionIcon}>{energyDirection.icon}</span>
          <span>{energyDirection.label}</span>
        </div>
      </div>

      <div className={styles.energySliderSection}>
        <label className={styles.sliderLabel}>
          Energy Level: {vibe.energyLevel}/10
          <input
            className={styles.energySlider}
            max="10"
            min="1"
            onChange={handleEnergySliderChange}
            type="range"
            value={vibe.energyLevel}
          />
        </label>
      </div>

      <div className={styles.quickPresetsSection}>
        <h3 className={styles.sectionTitle}>Quick Presets</h3>
        <div className={styles.presetButtons}>
          {QUICK_PRESETS.map(preset => (
            <button
              className={styles.presetButton}
              key={preset.label}
              onClick={() => handlePresetClick(preset.direction)}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.customSteerSection}>
        <h3 className={styles.sectionTitle}>Steer the Vibe</h3>
        <form className={styles.customSteerForm} onSubmit={handleCustomSubmit}>
          <input
            className={styles.customSteerInput}
            onChange={e => setCustomInput(e.target.value)}
            placeholder="Describe the vibe you want (e.g., 'more acoustic guitar')"
            type="text"
            value={customInput}
          />
          <button className={styles.customSteerButton} disabled={!customInput.trim()} type="submit">
            Steer
          </button>
        </form>
      </div>

      <div className={styles.vibeInfo}>
        <div className={styles.vibeInfoItem}>
          <span className={styles.vibeLabel}>Genres:</span>
          <span className={styles.vibeValue}>{vibe.genres.length > 0 ? vibe.genres.join(', ') : 'Any'}</span>
        </div>
        <div className={styles.vibeInfoItem}>
          <span className={styles.vibeLabel}>Era:</span>
          <span className={styles.vibeValue}>
            {vibe.era.start} - {vibe.era.end}
          </span>
        </div>
        <div className={styles.vibeInfoItem}>
          <span className={styles.vibeLabel}>BPM Range:</span>
          <span className={styles.vibeValue}>
            {vibe.bpmRange.min} - {vibe.bpmRange.max}
          </span>
        </div>
      </div>
    </div>
  )
}
