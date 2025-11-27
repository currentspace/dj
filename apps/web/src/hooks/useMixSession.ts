/**
 * useMixSession Hook
 * Manages mix session state with polling and optimistic updates
 */

import {useCallback, useEffect, useRef, useState} from 'react'
import type {MixSession, QueuedTrack, SessionPreferences} from '@dj/shared-types'
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
  refreshSession: () => Promise<void>
}

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

  // Track if component is mounted
  const isMounted = useRef(true)
  const pollingInterval = useRef<NodeJS.Timeout | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current)
      }
    }
  }, [])

  // Fetch session from API
  const refreshSession = useCallback(async () => {
    try {
      const fetchedSession = await mixApiClient.getCurrentSession()
      if (isMounted.current) {
        setSession(fetchedSession)
        setError(null)
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch session')
      }
    }
  }, [])

  // Start polling when session exists
  useEffect(() => {
    if (!session) {
      // Clear polling if no session
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current)
        pollingInterval.current = null
      }
      return
    }

    // Start polling for session updates
    pollingInterval.current = setInterval(async () => {
      try {
        const fetchedSession = await mixApiClient.getCurrentSession()
        if (isMounted.current) {
          setSession(fetchedSession)
        }
      } catch (err) {
        console.error('[useMixSession] Polling error:', err)
        // Don't set error state for polling failures - just log
      }
    }, 2000)

    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current)
        pollingInterval.current = null
      }
    }
  }, [session?.id]) // Re-start polling if session ID changes

  // Initial fetch on mount
  useEffect(() => {
    refreshSession()
  }, [refreshSession])

  // Start a new session
  const startSession = useCallback(
    async (preferences?: SessionPreferences, seedPlaylistId?: string) => {
      setIsLoading(true)
      setError(null)

      try {
        const newSession = await mixApiClient.startSession(preferences, seedPlaylistId)
        if (isMounted.current) {
          setSession(newSession)
          setIsLoading(false)
        }
      } catch (err) {
        if (isMounted.current) {
          setError(err instanceof Error ? err.message : 'Failed to start session')
          setIsLoading(false)
        }
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
      if (isMounted.current) {
        setSession(null)
        setIsLoading(false)
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : 'Failed to end session')
        setIsLoading(false)
      }
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
        if (isMounted.current) {
          setSession(prev => (prev ? {...prev, queue: updatedQueue} : null))
        }
      } catch (err) {
        // Revert on error
        if (isMounted.current) {
          setSession(prev => (prev ? {...prev, queue: previousQueue} : null))
          setError(err instanceof Error ? err.message : 'Failed to add to queue')
        }
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
        if (isMounted.current) {
          setSession(prev => (prev ? {...prev, queue: updatedQueue} : null))
        }
      } catch (err) {
        // Revert on error
        if (isMounted.current) {
          setSession(prev => (prev ? {...prev, queue: previousQueue} : null))
          setError(err instanceof Error ? err.message : 'Failed to remove from queue')
        }
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
        if (isMounted.current) {
          setSession(prev => (prev ? {...prev, queue: updatedQueue} : null))
        }
      } catch (err) {
        // Revert on error
        if (isMounted.current) {
          setSession(prev => (prev ? {...prev, queue: previousQueue} : null))
          setError(err instanceof Error ? err.message : 'Failed to reorder queue')
        }
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
