/**
 * DevicePicker - Select Spotify playback device
 */

import {useCallback, useState} from 'react'

import {useDevicesQuery, useTransferPlaybackMutation} from '../../hooks/queries'
import styles from './device-picker.module.css'

interface DevicePickerProps {
  /** Currently active device ID from playback state */
  currentDeviceId?: null | string
  /** Currently active device name from playback state */
  currentDeviceName?: string
  /** Callback when device is selected */
  onDeviceSelect?: (deviceId: string) => void
  /** Auth token for API calls */
  token: null | string
}

export function DevicePicker({
  currentDeviceId,
  currentDeviceName,
  onDeviceSelect,
  token,
}: DevicePickerProps) {
  const [isOpen, setIsOpen] = useState(false)

  const {data: devices = [], error, isLoading} = useDevicesQuery(token, isOpen)
  const transferMutation = useTransferPlaybackMutation(token)

  const handleToggle = useCallback(() => {
    setIsOpen(!isOpen)
  }, [isOpen])

  const handleDeviceSelect = useCallback(
    async (deviceId: string) => {
      try {
        await transferMutation.mutateAsync(deviceId)
        onDeviceSelect?.(deviceId)
        setIsOpen(false)
      } catch (err) {
        console.error('[DevicePicker] Transfer error:', err)
      }
    },
    [transferMutation, onDeviceSelect]
  )

  const getDeviceIcon = (type: string): string => {
    switch (type.toLowerCase()) {
      case 'audio_dongle':
        return '🔌'
      case 'automobile':
        return '🚗'
      case 'avr':
        return '🎛️'
      case 'cast_audio':
      case 'cast_video':
        return '📡'
      case 'computer':
        return '💻'
      case 'game_console':
        return '🎮'
      case 'smartphone':
        return '📱'
      case 'speaker':
        return '🔊'
      case 'stb':
        return '📡'
      case 'tv':
        return '📺'
      default:
        return '🎵'
    }
  }

  const combinedLoading = isLoading || transferMutation.isPending
  const combinedError = error?.message ?? (transferMutation.error?.message ? 'Could not switch device' : null)

  return (
    <div className={styles.devicePicker}>
      <button
        className={styles.devicePickerButton}
        disabled={!token}
        onClick={handleToggle}
        title="Select playback device"
        type="button"
      >
        <span className={styles.deviceIcon}>🔊</span>
        <span className={styles.deviceCurrentName}>
          {currentDeviceName ?? 'Select device'}
        </span>
        <span className={styles.deviceDropdownArrow}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className={styles.deviceDropdown}>
          {combinedLoading ? (
            <div className={styles.deviceLoading}>Loading devices...</div>
          ) : combinedError ? (
            <div className={styles.deviceError}>{combinedError}</div>
          ) : devices.length === 0 ? (
            <div className={styles.deviceEmpty}>
              <p>No devices found</p>
              <p className={styles.deviceHint}>Open Spotify on a device to see it here</p>
            </div>
          ) : (
            <ul className={styles.deviceList}>
              {devices.map(device => (
                <li key={device.id}>
                  <button
                    className={`${styles.deviceItem} ${
                      device.id === currentDeviceId ? styles.deviceItemActive : ''
                    }`}
                    disabled={device.is_restricted}
                    onClick={() => handleDeviceSelect(device.id)}
                    type="button"
                  >
                    <span className={styles.deviceItemIcon}>
                      {getDeviceIcon(device.type)}
                    </span>
                    <span className={styles.deviceItemInfo}>
                      <span className={styles.deviceItemName}>{device.name}</span>
                      <span className={styles.deviceItemType}>{device.type}</span>
                    </span>
                    {device.is_active && (
                      <span className={styles.deviceItemActive}>●</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
