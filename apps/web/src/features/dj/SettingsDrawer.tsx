/**
 * SettingsDrawer - Slide-up drawer with vibe controls
 * Replaces VibeControls as always-visible settings panel
 */

import type {VibeProfile} from '@dj/shared-types'

import {useCallback, useState} from 'react'

import {AutoFillToggle} from '../../components/atoms/AutoFillToggle'
import {DevicePicker} from '../../components/molecules/DevicePicker'
import styles from './DJPage.module.css'

interface SettingsDrawerProps {
  autoFill: boolean
  deviceId: null | string
  deviceName: null | string
  onClose: () => void
  onEnergyChange: (level: number) => void
  token: null | string
  vibe: null | VibeProfile
}

export function SettingsDrawer({
  autoFill,
  deviceId,
  deviceName,
  onClose,
  onEnergyChange,
  token,
  vibe,
}: SettingsDrawerProps) {
  const [localEnergy, setLocalEnergy] = useState(vibe?.energyLevel ?? 5)

  // Sync local energy with vibe prop
  if (vibe && vibe.energyLevel !== localEnergy) {
    setLocalEnergy(vibe.energyLevel)
  }

  const handleEnergySlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const level = parseInt(e.target.value, 10)
      setLocalEnergy(level)
      onEnergyChange(level)
    },
    [onEnergyChange],
  )

  return (
    <div
      className={styles.settingsOverlay}
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      role="button"
      tabIndex={0}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- keyboard handled by overlay wrapper */}
      <div
        className={styles.settingsDrawer}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.settingsHeader}>
          <h3>Settings</h3>
          <button className={styles.settingsCloseBtn} onClick={onClose} type="button">Close</button>
        </div>

        <div className={styles.settingsBody}>
          <div className={styles.settingsSection}>
            <label className={styles.settingsLabel}>
              Energy Level: {localEnergy}/10
              <input
                className={styles.settingsSlider}
                max="10"
                min="1"
                onChange={handleEnergySlider}
                type="range"
                value={localEnergy}
              />
            </label>
          </div>

          {vibe && (
            <>
              <div className={styles.settingsSection}>
                <span className={styles.settingsLabel}>BPM Range</span>
                <span className={styles.settingsValue}>{vibe.bpmRange.min} - {vibe.bpmRange.max}</span>
              </div>

              <div className={styles.settingsSection}>
                <span className={styles.settingsLabel}>Genres</span>
                <span className={styles.settingsValue}>
                  {vibe.genres.length > 0 ? vibe.genres.join(', ') : 'Any'}
                </span>
              </div>

              <div className={styles.settingsSection}>
                <span className={styles.settingsLabel}>Era</span>
                <span className={styles.settingsValue}>{vibe.era.start} - {vibe.era.end}</span>
              </div>
            </>
          )}

          <div className={styles.settingsSection}>
            <AutoFillToggle autoFill={autoFill} />
          </div>

          <div className={styles.settingsSection}>
            <DevicePicker
              currentDeviceId={deviceId}
              currentDeviceName={deviceName ?? undefined}
              token={token}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
