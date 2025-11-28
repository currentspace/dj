/**
 * useMixSession Hook - Zustand Store Wrapper
 *
 * Manages mix session state with polling and optimistic updates.
 *
 * For new code, prefer using useMixStore directly with atomic selectors:
 *
 * @example
 * // New pattern (recommended)
 * import { useMixStore } from '../stores'
 * const session = useMixStore((s) => s.session)
 * const isLoading = useMixStore((s) => s.isLoading)
 * const startSession = useMixStore((s) => s.startSession)
 *
 * // Legacy pattern (this hook)
 * const { session, isLoading, startSession } = useMixSession()
 */

import {useEffect, useRef} from 'react'
import type {MixSession, SessionPreferences} from '@dj/shared-types'

import {initializeMixStore, useMixStore} from '../stores'

interface UseMixSessionReturn {
  // State
  error: string | null
  isLoading: boolean
  session: MixSession | null

  // Session actions
  endSession: () => Promise<void>
  startSession: (preferences?: SessionPreferences, seedPlaylistId?: string) => Promise<void>

  // Queue actions
  addToQueue: (trackUri: string, position?: number) => Promise<void>
  removeFromQueue: (position: number) => Promise<void>
  reorderQueue: (from: number, to: number) => Promise<void>

  // Utility
  clearError: () => void
  refreshSession: () => Promise<MixSession | null>
}

export function useMixSession(): UseMixSessionReturn {
  const hasInitialized = useRef(false)

  // Atomic selectors
  const session = useMixStore((s) => s.session)
  const isLoading = useMixStore((s) => s.isLoading)
  const error = useMixStore((s) => s.error)

  // Actions (stable references)
  const startSession = useMixStore((s) => s.startSession)
  const endSession = useMixStore((s) => s.endSession)
  const addToQueue = useMixStore((s) => s.addToQueue)
  const removeFromQueue = useMixStore((s) => s.removeFromQueue)
  const reorderQueue = useMixStore((s) => s.reorderQueue)
  const clearError = useMixStore((s) => s.clearError)
  const refreshSession = useMixStore((s) => s.refreshSession)

  // Initialize store on first mount
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true
      initializeMixStore()
    }
  }, [])

  return {
    // State
    error,
    isLoading,
    session,

    // Session actions
    endSession,
    startSession,

    // Queue actions
    addToQueue,
    removeFromQueue,
    reorderQueue,

    // Utility
    clearError,
    refreshSession,
  }
}
