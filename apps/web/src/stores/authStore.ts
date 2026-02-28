/**
 * Auth Store - Zustand 5 + subscribeWithSelector
 * Manages Spotify authentication state with localStorage persistence
 */

import {TokenDataSchema, SpotifyAuthUrlResponseSchema, TokenRefreshResponseSchema} from '@dj/shared-types'
import type {TokenData} from '@dj/shared-types'
import {create} from 'zustand'
import {subscribeWithSelector} from 'zustand/middleware'

import {storage, STORAGE_KEYS} from '../hooks/useLocalStorage'

// =============================================================================
// TYPES
// =============================================================================

interface AuthState {
  // State
  error: string | null
  isAuthenticated: boolean
  isLoading: boolean
  isRefreshing: boolean
  isValidating: boolean
  token: string | null

  // Actions
  clearError: () => void
  clearToken: () => void
  login: () => void
  logout: () => void
  markTokenInvalid: () => void
  refreshToken: () => Promise<boolean>
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

  const json: unknown = await response.json()
  const parsed = SpotifyAuthUrlResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error('No auth URL received from server')
  }

  window.location.href = parsed.data.url
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

// Refresh token helper - calls server endpoint which reads HttpOnly cookie
async function refreshTokenWithAPI(signal: AbortSignal): Promise<{access_token: string; expires_in: number} | null> {
  try {
    const response = await fetch('/api/spotify/refresh', {
      method: 'POST',
      credentials: 'include', // Important: include cookies
      signal,
    })

    if (!response.ok) {
      console.log('[authStore] Refresh failed:', response.status)
      return null
    }

    const json: unknown = await response.json()
    const parsed = TokenRefreshResponseSchema.safeParse(json)
    if (!parsed.success) {
      console.log('[authStore] Invalid refresh response')
      return null
    }
    return parsed.data
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    console.warn('[authStore] Refresh error:', err)
    return null
  }
}

// Check if token is near expiration (within 5 minutes)
function isTokenNearExpiration(tokenData: TokenData): boolean {
  if (!tokenData.expiresAt) return false
  const fiveMinutes = 5 * 60 * 1000
  return Date.now() >= tokenData.expiresAt - fiveMinutes
}

// Proactive refresh timer
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function scheduleProactiveRefresh(expiresAt: number, refreshFn: () => Promise<boolean>): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }

  // Refresh 5 minutes before expiration
  const fiveMinutes = 5 * 60 * 1000
  const refreshTime = expiresAt - fiveMinutes - Date.now()

  if (refreshTime > 0) {
    console.log(`[authStore] Scheduling proactive refresh in ${Math.round(refreshTime / 1000 / 60)} minutes`)
    refreshTimer = setTimeout(() => {
      console.log('[authStore] Proactive refresh triggered')
      refreshFn().catch((err: unknown) => {
        console.warn('[authStore] Proactive refresh failed:', err)
      })
    }, refreshTime)
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
    isRefreshing: false,
    isValidating: false,
    token: initial.token,

    // Actions
    clearError: () => set({error: null}),

    clearToken: () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
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
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
      clearTokenData()
      set({
        error: null,
        isAuthenticated: false,
        isLoading: false,
        isRefreshing: false,
        isValidating: false,
        token: null,
      })
    },

    markTokenInvalid: () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
      clearTokenData()
      set({isAuthenticated: false, token: null})
    },

    refreshToken: async () => {
      const {isRefreshing, setToken, markTokenInvalid} = get()

      // Prevent concurrent refresh attempts
      if (isRefreshing) {
        console.log('[authStore] Refresh already in progress')
        return false
      }

      abortController?.abort()
      abortController = new AbortController()

      set({isRefreshing: true, error: null})

      try {
        const result = await refreshTokenWithAPI(abortController.signal)
        set({isRefreshing: false})

        if (!result) {
          console.log('[authStore] Refresh returned null, marking token invalid')
          markTokenInvalid()
          return false
        }

        console.log('[authStore] Token refreshed successfully')
        setToken(result.access_token, result.expires_in)
        return true
      } catch (err: unknown) {
        set({isRefreshing: false})
        if (err instanceof Error && err.name === 'AbortError') return false
        console.warn('[authStore] Refresh failed:', err)
        return false
      }
    },

    setError: (error) => set({error}),

    setLoading: (isLoading) => set({isLoading}),

    setToken: (token, expiresIn) => {
      const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null
      const tokenData: TokenData = {
        createdAt: Date.now(),
        expiresAt,
        token,
      }
      saveTokenData(tokenData)
      set({isAuthenticated: true, token, error: null})

      // Schedule proactive refresh if we have expiration info
      if (expiresAt) {
        scheduleProactiveRefresh(expiresAt, () => get().refreshToken())
      }
    },

    setValidating: (isValidating) => set({isValidating}),

    validateToken: async () => {
      const {token, refreshToken, markTokenInvalid, setError} = get()
      if (!token) return false

      const tokenData = loadTokenData()

      // If token is expired or near expiration, try to refresh first
      if (tokenData && (isTokenExpired(tokenData) || isTokenNearExpiration(tokenData))) {
        console.log('[authStore] Token expired or near expiration, attempting refresh')
        const refreshed = await refreshToken()
        if (refreshed) {
          return true
        }
        // Refresh failed, token is invalid
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
          // Token validation failed, try to refresh
          console.log('[authStore] Token validation failed, attempting refresh')
          const refreshed = await refreshToken()
          if (refreshed) {
            return true
          }
          markTokenInvalid()
          setError('Session expired. Please log in again.')
          return false
        }

        // Token is valid, schedule proactive refresh if we have expiration data
        if (tokenData?.expiresAt) {
          scheduleProactiveRefresh(tokenData.expiresAt, () => get().refreshToken())
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
  const expiresIn = urlParams.get('expires_in')

  if (!urlError && !(spotifyToken && authSuccess)) return

  oauthProcessed = true

  if (urlError) {
    useAuthStore.getState().setError(`Authentication failed: ${urlError}`)
    window.history.replaceState({}, document.title, window.location.pathname)
  } else if (spotifyToken && authSuccess) {
    console.log('[authStore] OAuth success, storing token')
    // Pass expires_in to enable proactive token refresh
    const expiresInSeconds = expiresIn ? parseInt(expiresIn, 10) : undefined
    useAuthStore.getState().setToken(spotifyToken, expiresInSeconds)
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
      const raw: unknown = JSON.parse(event.newValue)
      const result = TokenDataSchema.safeParse(raw)
      if (!result.success) {
        clearTokenData()
        useAuthStore.setState({isAuthenticated: false, token: null})
        return
      }
      if (isTokenExpired(result.data)) {
        clearTokenData()
        useAuthStore.setState({isAuthenticated: false, token: null})
      } else {
        useAuthStore.setState({isAuthenticated: true, token: result.data.token})
      }
    } catch {
      clearTokenData()
      useAuthStore.setState({isAuthenticated: false, token: null})
    }
  })
}
