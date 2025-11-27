/**
 * useSuggestions Hook
 * Manages track suggestions based on current mix session
 */

import {useCallback, useRef, useState} from 'react'
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

  // Track previous session ID and vibe for direct state sync
  const previousSessionIdRef = useRef<null | string>(null)
  const previousVibeRef = useRef<null | string>(null)

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
      setSuggestions(fetchedSuggestions)
      setIsLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch suggestions')
      setIsLoading(false)
    }
  }, [session])

  // Direct state sync: fetch when session changes
  if (session?.id !== previousSessionIdRef.current) {
    previousSessionIdRef.current = session?.id ?? null
    if (session) {
      refresh()
    } else {
      // Session ended, clear suggestions synchronously
      if (suggestions.length > 0) {
        setSuggestions([])
      }
    }
  }

  // Direct state sync: auto-refresh when vibe changes significantly
  if (autoRefreshOnVibeChange && session) {
    // Create a simple hash of vibe for comparison
    const vibeHash = JSON.stringify({
      bpmRange: session.vibe.bpmRange,
      energyDirection: session.vibe.energyDirection,
      energyLevel: session.vibe.energyLevel,
      era: session.vibe.era,
      genres: session.vibe.genres,
      mood: session.vibe.mood,
    })

    // Check if vibe changed significantly (only after initial fetch)
    if (previousVibeRef.current !== null && previousVibeRef.current !== vibeHash) {
      console.log('[useSuggestions] Vibe changed, refreshing suggestions...')
      previousVibeRef.current = vibeHash
      refresh()
    } else if (previousVibeRef.current === null) {
      // Initialize vibe hash on first render with session
      previousVibeRef.current = vibeHash
    }
  }

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
