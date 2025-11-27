/**
 * useSuggestions Hook
 * Manages track suggestions based on current mix session
 */

import {useCallback, useEffect, useRef, useState} from 'react'
import type {MixSession, Suggestion} from '@dj/shared-types'
import {mixApiClient} from '../lib/mix-api-client'

interface UseSuggestionsOptions {
  /** Current mix session */
  session: MixSession | null
  /** Auto-refresh when vibe changes significantly */
  autoRefreshOnVibeChange?: boolean
}

interface UseSuggestionsReturn {
  // State
  error: null | string
  isLoading: boolean
  suggestions: Suggestion[]

  // Actions
  clearError: () => void
  refresh: () => Promise<void>
}

/**
 * Hook to manage track suggestions
 *
 * Features:
 * - Fetches suggestions based on current session
 * - Auto-refreshes when vibe changes significantly
 * - Manual refresh capability
 * - Loading and error states
 */
export function useSuggestions(options: UseSuggestionsOptions): UseSuggestionsReturn {
  const {autoRefreshOnVibeChange = true, session} = options

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)

  // Track previous vibe to detect significant changes
  const previousVibeRef = useRef<null | string>(null)
  const isMounted = useRef(true)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false
    }
  }, [])

  // Fetch suggestions
  const refresh = useCallback(async () => {
    if (!session) {
      setSuggestions([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const fetchedSuggestions = await mixApiClient.getSuggestions()
      if (isMounted.current) {
        setSuggestions(fetchedSuggestions)
        setIsLoading(false)
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch suggestions')
        setIsLoading(false)
      }
    }
  }, [session])

  // Initial fetch when session starts
  useEffect(() => {
    if (session) {
      refresh()
    } else {
      setSuggestions([])
    }
  }, [session?.id, refresh])

  // Auto-refresh when vibe changes significantly
  useEffect(() => {
    if (!autoRefreshOnVibeChange || !session) {
      return
    }

    // Create a simple hash of vibe for comparison
    const vibeHash = JSON.stringify({
      bpmRange: session.vibe.bpmRange,
      energyDirection: session.vibe.energyDirection,
      energyLevel: session.vibe.energyLevel,
      era: session.vibe.era,
      genres: session.vibe.genres,
      mood: session.vibe.mood,
    })

    // Check if vibe changed significantly
    if (previousVibeRef.current && previousVibeRef.current !== vibeHash) {
      console.log('[useSuggestions] Vibe changed, refreshing suggestions...')
      refresh()
    }

    previousVibeRef.current = vibeHash
  }, [session?.vibe, autoRefreshOnVibeChange, refresh])

  // Clear error
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    // State
    error,
    isLoading,
    suggestions,

    // Actions
    clearError,
    refresh,
  }
}
