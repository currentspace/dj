/**
 * usePlaybackStream Hook
 *
 * Connects to SSE stream for real-time Spotify playback state
 * with client-side progress interpolation for smooth UI updates.
 *
 * Features:
 * - Auto-connects when token is provided
 * - Disconnects when token is removed
 * - Track change callbacks for queue management
 * - Returns simplified PlaybackState for UI components
 */

import {useCallback, useRef} from 'react'

import {usePlaybackStore, type ConnectionStatus, type PlaybackState} from '../stores'

export type {ConnectionStatus, PlaybackState}
export type {PlaybackCore} from '../stores'

interface UsePlaybackStreamOptions {
  autoConnect?: boolean
  onTrackChange?: (previousTrackId: string, previousTrackUri: string, newTrackId: string) => void
}

interface UsePlaybackStreamReturn {
  connect: () => void
  disconnect: () => void
  error: string | null
  playback: PlaybackState | null
  status: ConnectionStatus
}

export function usePlaybackStream(
  token: string | null,
  options: UsePlaybackStreamOptions = {}
): UsePlaybackStreamReturn {
  const {autoConnect = true, onTrackChange} = options

  const tokenRef = useRef(token)
  const hasConnectedRef = useRef(false)
  const onTrackChangeRef = useRef(onTrackChange)
  const trackChangeUnsubRef = useRef<(() => void) | null>(null)

  // Keep callback ref updated
  onTrackChangeRef.current = onTrackChange
  tokenRef.current = token

  // Atomic selectors for state
  const status = usePlaybackStore((s) => s.status)
  const error = usePlaybackStore((s) => s.error)
  const playbackCore = usePlaybackStore((s) => s.playbackCore)
  const progress = usePlaybackStore((s) => s.progress)
  const storeConnect = usePlaybackStore((s) => s.connect)
  const storeDisconnect = usePlaybackStore((s) => s.disconnect)
  const subscribeToTrackChange = usePlaybackStore((s) => s.subscribeToTrackChange)

  // Subscribe to track changes (component body, no useEffect)
  if (onTrackChange && !trackChangeUnsubRef.current) {
    trackChangeUnsubRef.current = subscribeToTrackChange((prevId, prevUri, newId) => {
      onTrackChangeRef.current?.(prevId, prevUri, newId)
    })
  }
  if (!onTrackChange && trackChangeUnsubRef.current) {
    trackChangeUnsubRef.current()
    trackChangeUnsubRef.current = null
  }

  // Auto-connect when token becomes available (component body)
  if (autoConnect && token && !hasConnectedRef.current && status === 'disconnected') {
    hasConnectedRef.current = true
    storeConnect(token)
  }

  // Disconnect when token is removed (component body)
  if (!token && hasConnectedRef.current) {
    hasConnectedRef.current = false
    storeDisconnect()
  }

  // Manual connect
  const connect = useCallback(() => {
    if (tokenRef.current) {
      storeConnect(tokenRef.current)
    }
  }, [storeConnect])

  // Manual disconnect
  const disconnect = useCallback(() => {
    hasConnectedRef.current = false
    storeDisconnect()
  }, [storeDisconnect])

  // Convert PlaybackCore to simplified PlaybackState for UI
  const playback: PlaybackState | null = playbackCore
    ? {
        albumArt: playbackCore.track?.albumArt ?? null,
        artistName: playbackCore.track?.artist ?? '',
        deviceId: playbackCore.device.id,
        deviceName: playbackCore.device.name,
        duration: playbackCore.track?.duration ?? 0,
        isPlaying: playbackCore.isPlaying,
        progress,
        timestamp: playbackCore.timestamp,
        trackId: playbackCore.track?.id ?? null,
        trackName: playbackCore.track?.name ?? 'Unknown',
        trackUri: playbackCore.track?.uri ?? null,
      }
    : null

  return {
    connect,
    disconnect,
    error,
    playback,
    status,
  }
}
