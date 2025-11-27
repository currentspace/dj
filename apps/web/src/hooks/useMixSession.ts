/**
 * useMixSession Hook
 * Manages mix session state with polling and optimistic updates
 */

import {useCallback, useRef, useState, useSyncExternalStore} from 'react'
import type {MixSession, QueuedTrack, SessionPreferences} from '@dj/shared-types'
import {TIMING} from '../constants'
import {mixApiClient} from '../lib/mix-api-client'

interface UseMixSessionReturn {
  // State
  error: null | string
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

// ============================================================================
// POLLING EXTERNAL STORE - Manages session polling lifecycle
// ============================================================================

type PollingListener = () => void

interface PollingState {
  isPolling: boolean
  sessionId: null | string
}

function createPollingStore() {
  const listeners = new Set<PollingListener>()
  let pollingInterval: NodeJS.Timeout | null = null
  let state: PollingState = {isPolling: false, sessionId: null}
  let fetchCallback: (() => Promise<MixSession | null>) | null = null
  let updateCallback: ((session: MixSession | null) => void) | null = null

  function notifyListeners(): void {
    listeners.forEach(listener => listener())
  }

  return {
    getState(): PollingState {
      return state
    },

    setCallbacks(
      fetch: () => Promise<MixSession | null>,
      update: (session: MixSession | null) => void
    ): void {
      fetchCallback = fetch
      updateCallback = update
    },

    startPolling(sessionId: string): void {
      // Don't restart if already polling for same session
      if (state.isPolling && state.sessionId === sessionId) return

      // Stop existing polling
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }

      state = {isPolling: true, sessionId}
      notifyListeners()

      pollingInterval = setInterval(async () => {
        if (fetchCallback && updateCallback) {
          try {
            const fetchedSession = await fetchCallback()
            updateCallback(fetchedSession)
          } catch (err) {
            console.error('[useMixSession] Polling error:', err)
          }
        }
      }, TIMING.POLLING_INTERVAL_MS)
    },

    stopPolling(): void {
      if (pollingInterval) {
        clearInterval(pollingInterval)
        pollingInterval = null
      }
      state = {isPolling: false, sessionId: null}
      notifyListeners()
    },

    subscribe(listener: PollingListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        // Cleanup when last listener unsubscribes
        if (listeners.size === 0 && pollingInterval) {
          clearInterval(pollingInterval)
          pollingInterval = null
          state = {isPolling: false, sessionId: null}
        }
      }
    },
  }
}

// Singleton polling store
const pollingStore = createPollingStore()

/**
 * Hook to manage mix session state
 *
 * Features:
 * - Polling for session updates (every 2 seconds)
 * - Optimistic updates for queue operations
 * - Error handling with automatic revert
 */
export function useMixSession(): UseMixSessionReturn {
  const [session, setSession] = useState<MixSession | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)

  // Track initial fetch
  const hasInitialFetchRef = useRef(false)

  // Subscribe to polling state for cleanup
  const pollingState = useSyncExternalStore(
    pollingStore.subscribe.bind(pollingStore),
    pollingStore.getState.bind(pollingStore),
    () => ({isPolling: false, sessionId: null})
  )

  // Fetch session from API
  const refreshSession = useCallback(async () => {
    try {
      const fetchedSession = await mixApiClient.getCurrentSession()
      setSession(fetchedSession)
      setError(null)
      return fetchedSession
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch session')
      return null
    }
  }, [])

  // Set up callbacks for polling store
  pollingStore.setCallbacks(
    async () => mixApiClient.getCurrentSession(),
    (fetchedSession) => setSession(fetchedSession)
  )

  // Direct state sync: initial fetch on first render
  if (!hasInitialFetchRef.current) {
    hasInitialFetchRef.current = true
    refreshSession()
  }

  // Direct state sync: manage polling based on session state
  if (session?.id && !pollingState.isPolling) {
    pollingStore.startPolling(session.id)
  } else if (!session && pollingState.isPolling) {
    pollingStore.stopPolling()
  } else if (session?.id && pollingState.sessionId !== session.id) {
    // Session ID changed, restart polling
    pollingStore.startPolling(session.id)
  }

  // Start a new session
  const startSession = useCallback(
    async (preferences?: SessionPreferences, seedPlaylistId?: string) => {
      setIsLoading(true)
      setError(null)

      try {
        const newSession = await mixApiClient.startSession(preferences, seedPlaylistId)
        setSession(newSession)
        setIsLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start session')
        setIsLoading(false)
      }
    },
    [],
  )

  // End the current session
  const endSession = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      await mixApiClient.endSession()
      pollingStore.stopPolling()
      setSession(null)
      setIsLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end session')
      setIsLoading(false)
    }
  }, [])

  // Add to queue with optimistic update
  const addToQueue = useCallback(
    async (trackUri: string, position?: number) => {
      if (!session) {
        setError('No active session')
        return
      }

      // Create optimistic track
      const optimisticTrack: QueuedTrack = {
        addedBy: 'user',
        albumArt: undefined,
        artist: 'Loading...',
        name: 'Loading...',
        position: position ?? session.queue.length,
        trackId: trackUri,
        trackUri,
        vibeScore: 0,
      }

      // Optimistically update UI
      const previousQueue = session.queue
      const newQueue =
        position !== undefined
          ? [...session.queue.slice(0, position), optimisticTrack, ...session.queue.slice(position)]
          : [...session.queue, optimisticTrack]

      setSession({
        ...session,
        queue: newQueue,
      })
      setError(null)

      try {
        // Make API call
        const updatedQueue = await mixApiClient.addToQueue(trackUri, position)
        setSession(prev => (prev ? {...prev, queue: updatedQueue} : null))
      } catch (err) {
        // Revert on error
        setSession(prev => (prev ? {...prev, queue: previousQueue} : null))
        setError(err instanceof Error ? err.message : 'Failed to add to queue')
      }
    },
    [session],
  )

  // Remove from queue with optimistic update
  const removeFromQueue = useCallback(
    async (position: number) => {
      if (!session) {
        setError('No active session')
        return
      }

      // Optimistically update UI
      const previousQueue = session.queue
      const newQueue = session.queue.filter(track => track.position !== position)

      setSession({
        ...session,
        queue: newQueue,
      })
      setError(null)

      try {
        // Make API call
        const updatedQueue = await mixApiClient.removeFromQueue(position)
        setSession(prev => (prev ? {...prev, queue: updatedQueue} : null))
      } catch (err) {
        // Revert on error
        setSession(prev => (prev ? {...prev, queue: previousQueue} : null))
        setError(err instanceof Error ? err.message : 'Failed to remove from queue')
      }
    },
    [session],
  )

  // Reorder queue with optimistic update
  const reorderQueue = useCallback(
    async (from: number, to: number) => {
      if (!session) {
        setError('No active session')
        return
      }

      // Optimistically update UI
      const previousQueue = session.queue
      const newQueue = [...session.queue]
      const [movedTrack] = newQueue.splice(from, 1)
      newQueue.splice(to, 0, movedTrack)

      setSession({
        ...session,
        queue: newQueue,
      })
      setError(null)

      try {
        // Make API call
        const updatedQueue = await mixApiClient.reorderQueue(from, to)
        setSession(prev => (prev ? {...prev, queue: updatedQueue} : null))
      } catch (err) {
        // Revert on error
        setSession(prev => (prev ? {...prev, queue: previousQueue} : null))
        setError(err instanceof Error ? err.message : 'Failed to reorder queue')
      }
    },
    [session],
  )

  // Clear error
  const clearError = useCallback(() => {
    setError(null)
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
