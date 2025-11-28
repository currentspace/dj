/**
 * usePlaybackStream Hook - Zustand Store Wrapper
 *
 * Connects to SSE stream for real-time Spotify playback state
 * with client-side progress interpolation for smooth UI updates.
 *
 * For new code, prefer using usePlaybackStore directly with atomic selectors:
 *
 * @example
 * // New pattern (recommended) - Only subscribe to what you need
 * import { usePlaybackStore } from '../stores'
 * const status = usePlaybackStore((s) => s.status)
 * const playbackCore = usePlaybackStore((s) => s.playbackCore)
 * const progress = usePlaybackStore((s) => s.progress)
 *
 * // Legacy pattern (this hook)
 * const { status, playback, error } = usePlaybackStream(token)
 */

import {useCallback, useEffect, useRef} from 'react'

import {usePlaybackStore, type ConnectionStatus, type PlaybackState} from '../stores'

// Re-export types for backward compatibility
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

  // Keep callback ref updated
  onTrackChangeRef.current = onTrackChange

  // Atomic selectors for state
  const status = usePlaybackStore((s) => s.status)
  const error = usePlaybackStore((s) => s.error)
  const playbackCore = usePlaybackStore((s) => s.playbackCore)
  const progress = usePlaybackStore((s) => s.progress)
  const storeConnect = usePlaybackStore((s) => s.connect)
  const storeDisconnect = usePlaybackStore((s) => s.disconnect)
  const subscribeToTrackChange = usePlaybackStore((s) => s.subscribeToTrackChange)

  // Update token ref
  tokenRef.current = token

  // Subscribe to track changes
  useEffect(() => {
    if (!onTrackChange) return

    return subscribeToTrackChange((prevId, prevUri, newId) => {
      onTrackChangeRef.current?.(prevId, prevUri, newId)
    })
  }, [subscribeToTrackChange, onTrackChange])

  // Auto-connect when token becomes available
  useEffect(() => {
    if (autoConnect && token && !hasConnectedRef.current && status === 'disconnected') {
      hasConnectedRef.current = true
      storeConnect(token)
    }
  }, [autoConnect, token, status, storeConnect])

  // Disconnect when token is removed
  useEffect(() => {
    if (!token && hasConnectedRef.current) {
      hasConnectedRef.current = false
      storeDisconnect()
    }
  }, [token, storeDisconnect])

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

  // Combine core and progress for backward compatible return
  const playback: PlaybackState | null = playbackCore
    ? {...playbackCore, progress}
    : null

  return {
    connect,
    disconnect,
    error,
    playback,
    status,
  }
}
