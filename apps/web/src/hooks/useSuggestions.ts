/**
 * useSuggestions Hook - Zustand Store Wrapper
 *
 * Manages track suggestions based on current mix session.
 *
 * For new code, prefer using useMixStore directly with atomic selectors:
 *
 * @example
 * // New pattern (recommended)
 * import { useMixStore } from '../stores'
 * const suggestions = useMixStore((s) => s.suggestions)
 * const isLoading = useMixStore((s) => s.suggestionsLoading)
 * const refresh = useMixStore((s) => s.refreshSuggestions)
 *
 * // Legacy pattern (this hook)
 * const { suggestions, isLoading, refresh } = useSuggestions({ session })
 */

import type {MixSession, Suggestion} from '@dj/shared-types'

import {useMixStore} from '../stores'

interface UseSuggestionsOptions {
  session: MixSession | null
  autoRefreshOnVibeChange?: boolean // Now handled by store subscription
}

interface UseSuggestionsReturn {
  // State
  error: string | null
  isLoading: boolean
  suggestions: Suggestion[]

  // Actions
  clearError: () => void
  refresh: () => Promise<void>
}

export function useSuggestions(_options: UseSuggestionsOptions): UseSuggestionsReturn {
  // Note: session is passed for API compatibility but store already knows the session
  // autoRefreshOnVibeChange is now handled by store subscription automatically

  // Atomic selectors
  const suggestions = useMixStore((s) => s.suggestions)
  const isLoading = useMixStore((s) => s.suggestionsLoading)
  const error = useMixStore((s) => s.suggestionsError)

  // Actions
  const refresh = useMixStore((s) => s.refreshSuggestions)
  const clearError = useMixStore((s) => s.clearSuggestionsError)

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
