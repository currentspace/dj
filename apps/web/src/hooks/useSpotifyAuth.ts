/**
 * useSpotifyAuth Hook - Zustand Store Wrapper
 *
 * This hook wraps the Zustand auth store for backward compatibility.
 * For new code, prefer using useAuthStore directly with atomic selectors:
 *
 * @example
 * // New pattern (recommended)
 * import { useAuthStore } from '../stores'
 * const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
 * const token = useAuthStore((s) => s.token)
 * const login = useAuthStore((s) => s.login)
 *
 * // Legacy pattern (this hook)
 * const { isAuthenticated, token, login } = useSpotifyAuth()
 */

import {useEffect, useRef} from 'react'
import {useShallow} from 'zustand/react/shallow'

import {processOAuthCallback, useAuthStore} from '../stores'

export interface UseSpotifyAuthReturn {
  clearError: () => void
  error: string | null
  isAuthenticated: boolean
  isLoading: boolean
  isValidating: boolean
  login: () => void
  logout: () => void
  token: string | null
  validateToken: () => Promise<boolean>
}

export function useSpotifyAuth(): UseSpotifyAuthReturn {
  const hasInitialized = useRef(false)

  // Use useShallow for the object selection
  const state = useAuthStore(
    useShallow((s) => ({
      clearError: s.clearError,
      error: s.error,
      isAuthenticated: s.isAuthenticated,
      isLoading: s.isLoading,
      isValidating: s.isValidating,
      login: s.login,
      logout: s.logout,
      token: s.token,
      validateToken: s.validateToken,
    }))
  )

  // Process OAuth callback on mount (once)
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true
      processOAuthCallback()

      // Validate token if we have one
      if (state.token && !state.isValidating) {
        state.validateToken()
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}

// Export cleanup function for tests
export function cleanupAuthStore(): void {
  useAuthStore.setState({
    error: null,
    isAuthenticated: false,
    isLoading: false,
    isValidating: false,
    token: null,
  })
}
