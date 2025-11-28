/**
 * Auth Store - Zustand 5 + subscribeWithSelector
 * Manages Spotify authentication state with localStorage persistence
 */

import {create} from 'zustand'
import {subscribeWithSelector} from 'zustand/middleware'

import {storage, STORAGE_KEYS} from '../hooks/useLocalStorage'

// =============================================================================
// TYPES
// =============================================================================

interface TokenData {
  createdAt: number
  expiresAt: number | null
  token: string
}

interface AuthState {
  // State
  error: string | null
  isAuthenticated: boolean
  isLoading: boolean
  isValidating: boolean
  token: string | null

  // Actions
  clearError: () => void
  clearToken: () => void
  login: () => void
  logout: () => void
  markTokenInvalid: () => void
  setError: (error: string | null) => void
  setLoading: (loading: boolean) => void
  setToken: (token: string, expiresIn?: number) => void
  setValidating: (validating: boolean) => void
  validateToken: () => Promise<boolean>
}

// =============================================================================
// HELPERS
// =============================================================================

function loadTokenData(): TokenData | null {
  return storage.get<TokenData | null>(STORAGE_KEYS.SPOTIFY_TOKEN_DATA, null)
}

function saveTokenData(tokenData: TokenData): void {
  storage.set(STORAGE_KEYS.SPOTIFY_TOKEN_DATA, tokenData)
}

function clearTokenData(): void {
  storage.remove(STORAGE_KEYS.SPOTIFY_TOKEN_DATA)
  storage.remove(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY)
}

function isTokenExpired(tokenData: TokenData): boolean {
  if (!tokenData.expiresAt) return false
  return Date.now() >= tokenData.expiresAt
}

function getInitialState(): {isAuthenticated: boolean; token: string | null} {
  if (typeof window === 'undefined') {
    return {isAuthenticated: false, token: null}
  }

  const tokenData = loadTokenData()
  if (!tokenData) {
    return {isAuthenticated: false, token: null}
  }

  if (isTokenExpired(tokenData)) {
    clearTokenData()
    return {isAuthenticated: false, token: null}
  }

  return {isAuthenticated: true, token: tokenData.token}
}

// Async login helper
async function performLogin(signal: AbortSignal): Promise<void> {
  const response = await fetch('/api/spotify/auth-url', {signal})

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to get auth URL: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as {url?: string}
  if (!data.url) {
    throw new Error('No auth URL received from server')
  }

  window.location.href = data.url
}

// Token validation helper
async function validateTokenWithAPI(token: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch('/api/spotify/me', {
      headers: {Authorization: `Bearer ${token}`},
      signal,
    })

    if (response.status === 401) return false
    return response.ok || true // Don't clear on non-401 errors
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    return true // Don't clear on network errors
  }
}

// =============================================================================
// STORE
// =============================================================================

const initial = getInitialState()

// Abort controller for async operations
let abortController: AbortController | null = null

export const useAuthStore = create<AuthState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    error: null,
    isAuthenticated: initial.isAuthenticated,
    isLoading: false,
    isValidating: false,
    token: initial.token,

    // Actions
    clearError: () => set({error: null}),

    clearToken: () => {
      clearTokenData()
      set({isAuthenticated: false, token: null, error: null})
    },

    login: () => {
      abortController?.abort()
      abortController = new AbortController()

      set({error: null, isLoading: true})

      performLogin(abortController.signal).catch((err: unknown) => {
        if (abortController?.signal.aborted) return
        set({
          error: err instanceof Error ? err.message : 'Failed to start authentication',
          isLoading: false,
        })
      })
    },

    logout: () => {
      abortController?.abort()
      abortController = null
      clearTokenData()
      set({
        error: null,
        isAuthenticated: false,
        isLoading: false,
        isValidating: false,
        token: null,
      })
    },

    markTokenInvalid: () => {
      clearTokenData()
      set({isAuthenticated: false, token: null})
    },

    setError: (error) => set({error}),

    setLoading: (isLoading) => set({isLoading}),

    setToken: (token, expiresIn) => {
      const tokenData: TokenData = {
        createdAt: Date.now(),
        expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
        token,
      }
      saveTokenData(tokenData)
      set({isAuthenticated: true, token, error: null})
    },

    setValidating: (isValidating) => set({isValidating}),

    validateToken: async () => {
      const {token, markTokenInvalid, setError} = get()
      if (!token) return false

      const tokenData = loadTokenData()
      if (tokenData && isTokenExpired(tokenData)) {
        markTokenInvalid()
        setError('Session expired. Please log in again.')
        return false
      }

      abortController?.abort()
      abortController = new AbortController()

      set({isValidating: true, error: null})

      try {
        const isValid = await validateTokenWithAPI(token, abortController.signal)
        set({isValidating: false})

        if (!isValid) {
          markTokenInvalid()
          setError('Session expired. Please log in again.')
          return false
        }

        return true
      } catch (err: unknown) {
        set({isValidating: false})
        if (err instanceof Error && err.name === 'AbortError') return false
        console.warn('Token validation failed:', err)
        return false
      }
    },
  }))
)

// =============================================================================
// INITIALIZATION - Process OAuth callback
// =============================================================================

let oauthProcessed = false

export function processOAuthCallback(): void {
  if (typeof window === 'undefined' || oauthProcessed) return

  const urlParams = new URLSearchParams(window.location.search)
  const urlError = urlParams.get('error')
  const spotifyToken = urlParams.get('spotify_token')
  const authSuccess = urlParams.get('auth_success')

  if (!urlError && !(spotifyToken && authSuccess)) return

  oauthProcessed = true

  if (urlError) {
    useAuthStore.getState().setError(`Authentication failed: ${urlError}`)
    window.history.replaceState({}, document.title, window.location.pathname)
  } else if (spotifyToken && authSuccess) {
    console.log('[authStore] OAuth success, storing token')
    useAuthStore.getState().setToken(spotifyToken)
    window.history.replaceState({}, document.title, window.location.pathname)
  }
}

// =============================================================================
// STORAGE SYNC - Listen for cross-tab changes
// =============================================================================

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEYS.SPOTIFY_TOKEN_DATA) return

    if (!event.newValue) {
      useAuthStore.setState({isAuthenticated: false, token: null})
      return
    }

    try {
      const tokenData = JSON.parse(event.newValue) as TokenData
      if (isTokenExpired(tokenData)) {
        clearTokenData()
        useAuthStore.setState({isAuthenticated: false, token: null})
      } else {
        useAuthStore.setState({isAuthenticated: true, token: tokenData.token})
      }
    } catch {
      clearTokenData()
      useAuthStore.setState({isAuthenticated: false, token: null})
    }
  })
}
