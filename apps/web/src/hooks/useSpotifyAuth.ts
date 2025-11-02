import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

type AuthListener = () => void

// ============================================================================
// EXTERNAL STORE - Auth State Management (localStorage-based)
// ============================================================================

interface AuthState {
  isAuthenticated: boolean
  token: null | string
}

interface TokenData {
  createdAt: number
  expiresAt: null | number // null if no expiry info from server
  token: string
}

interface UseSpotifyAuthReturn {
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

function createSpotifyAuthStore() {
  // Private state in closure
  const listeners = new Set<AuthListener>()
  let state: AuthState = getInitialState()

  // Private helpers
  function getInitialState(): AuthState {
    if (typeof window === 'undefined') {
      return { isAuthenticated: false, token: null }
    }

    const tokenData = loadTokenData()
    if (!tokenData) {
      return { isAuthenticated: false, token: null }
    }

    // Check expiry
    if (isTokenExpired(tokenData)) {
      clearTokenData()
      return { isAuthenticated: false, token: null }
    }

    return {
      isAuthenticated: true,
      token: tokenData.token,
    }
  }

  function loadTokenData(): null | TokenData {
    if (typeof window === 'undefined') {
      return null
    }

    const stored = localStorage.getItem('spotify_token_data')
    if (!stored) {
      // Try legacy format for backwards compatibility
      const legacyToken = localStorage.getItem('spotify_token')
      if (legacyToken) {
        // Migrate to new format (no expiry info, will validate on first use)
        const tokenData: TokenData = {
          createdAt: Date.now(),
          expiresAt: null,
          token: legacyToken,
        }
        saveTokenData(tokenData)
        localStorage.removeItem('spotify_token')
        return tokenData
      }
      return null
    }

    try {
      return JSON.parse(stored) as TokenData
    } catch {
      return null
    }
  }

  function saveTokenData(tokenData: TokenData): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('spotify_token_data', JSON.stringify(tokenData))
    }
  }

  function clearTokenData(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('spotify_token_data')
      localStorage.removeItem('spotify_token') // Legacy cleanup
    }
  }

  function isTokenExpired(tokenData: TokenData): boolean {
    if (!tokenData.expiresAt) {
      return false // No expiry info, assume valid
    }
    return Date.now() >= tokenData.expiresAt
  }

  function notifyListeners(): void {
    listeners.forEach(listener => listener())
  }

  function handleStorageChange(event: StorageEvent): void {
    if (event.key === 'spotify_token_data') {
      if (!event.newValue) {
        // Token cleared
        state = {
          isAuthenticated: false,
          token: null,
        }
        notifyListeners()
        return
      }

      try {
        const tokenData = JSON.parse(event.newValue) as TokenData
        if (isTokenExpired(tokenData)) {
          clearTokenData()
          state = {
            isAuthenticated: false,
            token: null,
          }
        } else {
          state = {
            isAuthenticated: true,
            token: tokenData.token,
          }
        }
        notifyListeners()
      } catch {
        // Invalid data, clear
        clearTokenData()
        state = {
          isAuthenticated: false,
          token: null,
        }
        notifyListeners()
      }
    }
  }

  // Listen to storage events from other tabs
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageChange)
  }

  // Public API
  return {
    cleanup(): void {
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageChange)
      }
      listeners.clear()
    },

    clearToken(): void {
      clearTokenData()
      state = {
        isAuthenticated: false,
        token: null,
      }
      notifyListeners()
    },

    getState(): AuthState {
      return state
    },

    getTokenData(): null | TokenData {
      return loadTokenData()
    },

    isTokenExpired(): boolean {
      const tokenData = loadTokenData()
      return tokenData ? isTokenExpired(tokenData) : true
    },

    markTokenInvalid(): void {
      clearTokenData()
      state = {
        isAuthenticated: false,
        token: null,
      }
      notifyListeners()
    },

    setToken(token: string, expiresIn?: number): void {
      const tokenData: TokenData = {
        createdAt: Date.now(),
        expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null, // expiresIn in seconds, convert to ms
        token,
      }
      saveTokenData(tokenData)
      state = {
        isAuthenticated: true,
        token,
      }
      notifyListeners()
    },

    subscribe(listener: AuthListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// Singleton instance
const authStore = createSpotifyAuthStore()

// ============================================================================
// ASYNC STATE MANAGEMENT (Not part of external store)
// ============================================================================

interface AsyncState {
  error: null | string
  isLoading: boolean
  isValidating: boolean
}

type AsyncStateListener = (state: AsyncState) => void

function createAsyncStateManager() {
  // Private state in closure
  let abortController: AbortController | null = null
  const listeners = new Set<AsyncStateListener>()
  let state: AsyncState = {
    error: null,
    isLoading: false,
    isValidating: false,
  }

  // Private helpers
  function notifyListeners(): void {
    listeners.forEach(listener => listener(state))
  }

  // Public API
  return {
    abort(): void {
      if (abortController) {
        abortController.abort()
        abortController = null
      }
    },

    createAbortSignal(): AbortSignal {
      // Abort any existing request
      if (abortController) {
        abortController.abort()
      }
      abortController = new AbortController()
      return abortController.signal
    },

    getState(): AsyncState {
      return state
    },

    isAborted(): boolean {
      return abortController?.signal.aborted ?? false
    },

    reset(): void {
      if (abortController) {
        abortController.abort()
        abortController = null
      }
      state = { error: null, isLoading: false, isValidating: false }
      notifyListeners()
    },

    setError(error: null | string): void {
      state = { ...state, error }
      notifyListeners()
    },

    setLoading(isLoading: boolean): void {
      state = { ...state, isLoading }
      notifyListeners()
    },

    setValidating(isValidating: boolean): void {
      state = { ...state, isValidating }
      notifyListeners()
    },

    subscribe(listener: AsyncStateListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// Singleton instance
const asyncStateManager = createAsyncStateManager()

// Flag to prevent multiple OAuth callback processing
let oauthCallbackProcessed = false

// Flag to prevent multiple token validations
let tokenValidationInProgress = false

// ============================================================================
// ASYNC LOGIN LOGIC
// ============================================================================

const performLogin = async (signal: AbortSignal): Promise<void> => {
  const response = await fetch('/api/spotify/auth-url', { signal })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to get auth URL: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as { url?: string }
  const { url } = data

  if (!url) {
    throw new Error('No auth URL received from server')
  }

  // Redirect terminates execution
  window.location.href = url
}

// Token validation with API call
const validateTokenWithAPI = async (token: string, signal: AbortSignal): Promise<boolean> => {
  try {
    const response = await fetch('/api/spotify/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal,
    })

    if (response.status === 401) {
      // Token invalid
      return false
    }

    if (!response.ok) {
      // Other error, assume token might be valid but API issue
      return true // Don't clear token on non-401 errors
    }

    // Token is valid
    return true
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err // Re-throw abort errors
    }
    // Network error or other issue, assume token might still be valid
    return true // Don't clear token on network errors
  }
}

// ============================================================================
// REACT HOOK
// ============================================================================

// Optional: Cleanup function for when app unmounts (useful for tests)
export function cleanupAuthStore(): void {
  authStore.cleanup()
  asyncStateManager.reset()
  oauthCallbackProcessed = false
  tokenValidationInProgress = false
}

export function useSpotifyAuth(): UseSpotifyAuthReturn {
  // Subscribe to external auth store (token state)
  const authState = useSyncExternalStore(
    authStore.subscribe.bind(authStore),
    authStore.getState.bind(authStore),
    () => ({ isAuthenticated: false, token: null }), // SSR fallback
  )

  // Subscribe to external async state store (loading/error state)
  // Singleton instance shared across all components
  const asyncState = useSyncExternalStore(
    asyncStateManager.subscribe.bind(asyncStateManager),
    asyncStateManager.getState.bind(asyncStateManager),
    () => ({ error: null, isLoading: false, isValidating: false }), // SSR fallback
  )

  // Handle OAuth callback from URL (only once globally, not per component)
  useEffect(() => {
    if (typeof window === 'undefined' || oauthCallbackProcessed) return

    const urlParams = new URLSearchParams(window.location.search)
    const urlError = urlParams.get('error')
    const spotifyToken = urlParams.get('spotify_token')
    const authSuccess = urlParams.get('auth_success')

    // Only process if we have OAuth params
    if (urlError || (spotifyToken && authSuccess)) {
      oauthCallbackProcessed = true

      if (urlError) {
        asyncStateManager.setError(`Authentication failed: ${urlError}`)
        window.history.replaceState({}, document.title, window.location.pathname)
      } else if (spotifyToken && authSuccess) {
        console.log('🎉 Server-side OAuth success! Storing token...')
        // Store token (no expiry info from OAuth callback, will validate on first use)
        authStore.setToken(spotifyToken)
        window.history.replaceState({}, document.title, window.location.pathname)
      }
    }
  }, []) // Only run once on mount - asyncStateManager is singleton

  // Automatic token validation on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !authState.token) {
      return
    }

    // Check if token is expired first
    if (authStore.isTokenExpired()) {
      authStore.markTokenInvalid()
      asyncStateManager.setError('Session expired. Please log in again.')
      return
    }

    // Validate token with API if not already validating
    if (tokenValidationInProgress) {
      return
    }

    tokenValidationInProgress = true
    const signal = asyncStateManager.createAbortSignal()

    asyncStateManager.setValidating(true)
    asyncStateManager.setError(null)

    validateTokenWithAPI(authState.token, signal)
      .then(isValid => {
        if (isMountedRef.current && !asyncStateManager.isAborted()) {
          tokenValidationInProgress = false
          asyncStateManager.setValidating(false)

          if (!isValid) {
            authStore.markTokenInvalid()
            asyncStateManager.setError('Session expired. Please log in again.')
          }
        }
      })
      .catch((err: unknown) => {
        if (isMountedRef.current && !asyncStateManager.isAborted()) {
          tokenValidationInProgress = false
          asyncStateManager.setValidating(false)

          // Only show error if it's an abort error
          if (err instanceof Error && err.name === 'AbortError') {
            // Aborted, don't show error
            return
          }

          // Other errors - don't clear token, just log
          console.warn('Token validation failed:', err)
        }
      })
  }, [authState.token])

  // Refs for cleanup
  const isMountedRef = useRef(true)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
      asyncStateManager.abort() // Cleaner!
    }
  }, [])

  // Synchronous login function
  const login = useCallback(() => {
    const signal = asyncStateManager.createAbortSignal() // Creates new, aborts old

    asyncStateManager.setError(null)
    asyncStateManager.setLoading(true)

    performLogin(signal).catch((err: unknown) => {
      if (isMountedRef.current && !asyncStateManager.isAborted()) {
        asyncStateManager.setError(
          err instanceof Error ? err.message : 'Failed to start authentication',
        )
        asyncStateManager.setLoading(false)
      }
    })
  }, [])

  const logout = useCallback(() => {
    authStore.clearToken()
    asyncStateManager.reset() // Now also aborts any in-flight requests
  }, [])

  const clearError = useCallback(() => {
    asyncStateManager.setError(null)
  }, [])

  const validateToken = useCallback(async (): Promise<boolean> => {
    if (!authState.token) {
      return false
    }

    // Check if token is expired first
    if (authStore.isTokenExpired()) {
      authStore.markTokenInvalid()
      asyncStateManager.setError('Session expired. Please log in again.')
      return false
    }

    const signal = asyncStateManager.createAbortSignal()
    asyncStateManager.setValidating(true)
    asyncStateManager.setError(null)

    try {
      const isValid = await validateTokenWithAPI(authState.token, signal)
      asyncStateManager.setValidating(false)

      if (!isValid) {
        authStore.markTokenInvalid()
        asyncStateManager.setError('Session expired. Please log in again.')
        return false
      }

      return true
    } catch (err: unknown) {
      asyncStateManager.setValidating(false)

      if (err instanceof Error && err.name === 'AbortError') {
        // Aborted, don't show error
        return false
      }

      // Other errors - don't clear token, just return false
      console.warn('Token validation failed:', err)
      return false
    }
  }, [authState.token])

  return {
    clearError,
    error: asyncState.error,
    isAuthenticated: authState.isAuthenticated,
    isLoading: asyncState.isLoading,
    isValidating: asyncState.isValidating,
    login,
    logout,
    token: authState.token,
    validateToken,
  }
}
