/**
 * DevicePicker - Select Spotify playback device
 */

import {useCallback, useState} from 'react'

import styles from './device-picker.module.css'

interface SpotifyDevice {
  id: string
  is_active: boolean
  is_private_session: boolean
  is_restricted: boolean
  name: string
  type: string
  volume_percent: number | null
}

interface DevicePickerProps {
  /** Currently active device ID from playback state */
  currentDeviceId?: string | null
  /** Currently active device name from playback state */
  currentDeviceName?: string
  /** Callback when device is selected */
  onDeviceSelect?: (deviceId: string) => void
  /** Auth token for API calls */
  token: string | null
}

export function DevicePicker({
  currentDeviceId,
  currentDeviceName,
  onDeviceSelect,
  token,
}: DevicePickerProps) {
  const [devices, setDevices] = useState<SpotifyDevice[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDevices = useCallback(async () => {
    if (!token) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/player/devices', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (!response.ok) {
        throw new Error('Failed to fetch devices')
      }

      const data = (await response.json()) as {devices: SpotifyDevice[]}
      setDevices(data.devices || [])
    } catch (err) {
      console.error('[DevicePicker] Fetch error:', err)
      setError('Could not load devices')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  const handleToggle = useCallback(() => {
    if (!isOpen) {
      fetchDevices()
    }
    setIsOpen(!isOpen)
  }, [isOpen, fetchDevices])

  const handleDeviceSelect = useCallback(
    async (deviceId: string) => {
      if (!token) return

      setIsLoading(true)
      try {
        const response = await fetch('/api/player/device', {
          body: JSON.stringify({device_id: deviceId, play: true}),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          method: 'PUT',
        })

        if (!response.ok) {
          throw new Error('Failed to transfer playback')
        }

        onDeviceSelect?.(deviceId)
        setIsOpen(false)
      } catch (err) {
        console.error('[DevicePicker] Transfer error:', err)
        setError('Could not switch device')
      } finally {
        setIsLoading(false)
      }
    },
    [token, onDeviceSelect]
  )

  const getDeviceIcon = (type: string): string => {
    switch (type.toLowerCase()) {
      case 'computer':
        return '💻'
      case 'smartphone':
        return '📱'
      case 'speaker':
        return '🔊'
      case 'tv':
        return '📺'
      case 'avr':
        return '🎛️'
      case 'stb':
        return '📡'
      case 'audio_dongle':
        return '🔌'
      case 'game_console':
        return '🎮'
      case 'cast_video':
      case 'cast_audio':
        return '📡'
      case 'automobile':
        return '🚗'
      default:
        return '🎵'
    }
  }

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
          {currentDeviceName || 'Select device'}
        </span>
        <span className={styles.deviceDropdownArrow}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className={styles.deviceDropdown}>
          {isLoading ? (
            <div className={styles.deviceLoading}>Loading devices...</div>
          ) : error ? (
            <div className={styles.deviceError}>{error}</div>
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
