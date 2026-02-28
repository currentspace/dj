/**
 * useMixSession Hook
 *
 * Manages mix session state with automatic initialization.
 */

import type {MixSession, SessionPreferences} from '@dj/shared-types'

import {useRef} from 'react'

import {initializeMixStore, useMixStore} from '../stores'

interface UseMixSessionReturn {
  // Queue actions
  addToQueue: (trackUri: string, position?: number) => Promise<void>
  // Utility
  clearError: () => void
  // Session actions
  endSession: () => Promise<void>

  // State
  error: null | string
  isLoading: boolean
  refreshSession: () => Promise<MixSession | null>

  removeFromQueue: (position: number) => Promise<void>
  reorderQueue: (from: number, to: number) => Promise<void>
  session: MixSession | null

  setSession: (session: MixSession | null) => void
  startSession: (preferences?: SessionPreferences, seedPlaylistId?: string) => Promise<void>
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
  const setSession = useMixStore((s) => s.setSession)
  const addToQueue = useMixStore((s) => s.addToQueue)
  const removeFromQueue = useMixStore((s) => s.removeFromQueue)
  const reorderQueue = useMixStore((s) => s.reorderQueue)
  const clearError = useMixStore((s) => s.clearError)
  const refreshSession = useMixStore((s) => s.refreshSession)

  // Direct state sync: Initialize store on first render (React 19 pattern)
  /* eslint-disable react-hooks/refs -- intentional: one-time store initialization in hook body per React 19 project guidelines (no useEffect) */
  if (!hasInitialized.current) {
    hasInitialized.current = true
    initializeMixStore()
  }
  /* eslint-enable react-hooks/refs */

  return {
    // Queue actions
    addToQueue,
    // Utility
    clearError,
    // Session actions
    endSession,

    // State
    error,
    isLoading,
    refreshSession,

    removeFromQueue,
    reorderQueue,
    session,

    setSession,
    startSession,
  }
}
