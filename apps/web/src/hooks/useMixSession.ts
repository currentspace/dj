/**
 * useMixSession Hook
 *
 * Manages mix session state with automatic initialization.
 */

import {useRef} from 'react'
import type {MixSession, SessionPreferences} from '@dj/shared-types'

import {initializeMixStore, useMixStore} from '../stores'

interface UseMixSessionReturn {
  // State
  error: string | null
  isLoading: boolean
  session: MixSession | null

  // Session actions
  endSession: () => Promise<void>
  setSession: (session: MixSession | null) => void
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
  const setSession = useMixStore((s) => s.setSession)
  const addToQueue = useMixStore((s) => s.addToQueue)
  const removeFromQueue = useMixStore((s) => s.removeFromQueue)
  const reorderQueue = useMixStore((s) => s.reorderQueue)
  const clearError = useMixStore((s) => s.clearError)
  const refreshSession = useMixStore((s) => s.refreshSession)

  // Direct state sync: Initialize store on first render (React 19 pattern)
  if (!hasInitialized.current) {
    hasInitialized.current = true
    initializeMixStore()
  }

  return {
    // State
    error,
    isLoading,
    session,

    // Session actions
    endSession,
    setSession,
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
