/**
 * useSpotifyAuth Hook
 *
 * Handles Spotify OAuth authentication state and initialization.
 * Processes OAuth callbacks and validates tokens on mount.
 */

import {useRef} from 'react'
import {useShallow} from 'zustand/react/shallow'

import {processOAuthCallback, useAuthStore} from '../stores'

export interface UseSpotifyAuthReturn {
  clearError: () => void
  error: null | string
  isAuthenticated: boolean
  isLoading: boolean
  isValidating: boolean
  login: () => void
  logout: () => void
  token: null | string
  validateToken: () => Promise<boolean>
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

  // Direct state sync: Process OAuth callback on first render (React 19 pattern)
  if (!hasInitialized.current) {
    hasInitialized.current = true
    processOAuthCallback()

    // Schedule token validation after render (if we have a token)
    const {isValidating: currentIsValidating, token: currentToken, validateToken} = useAuthStore.getState()
    if (currentToken && !currentIsValidating) {
      // Use queueMicrotask to run after render without blocking
      queueMicrotask(() => {
        validateToken()
      })
    }
  }

  return state
}
