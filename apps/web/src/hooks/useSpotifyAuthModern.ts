import { useCallback, useSyncExternalStore } from 'react'

// External store for auth state that syncs with localStorage
const authStore = {
  emit() {
    authStore.listeners.forEach(listener => listener())
  },

  getSnapshot() {
    // Check URL hash first for OAuth callback
    const hash = window.location.hash
    if (hash) {
      const params = new URLSearchParams(hash.substring(1))
      const accessToken = params.get('access_token')
      if (accessToken) {
        localStorage.setItem('spotify_token', accessToken)
        window.location.hash = ''
        return { isAuthenticated: true, token: accessToken }
      }
    }

    // Then check localStorage
    const token = localStorage.getItem('spotify_token')
    return { isAuthenticated: !!token, token }
  },

  listeners: new Set<() => void>(),

  subscribe(listener: () => void) {
    authStore.listeners.add(listener)

    // Listen for storage events from other tabs
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'spotify_token') {
        listener()
      }
    }
    window.addEventListener('storage', handleStorage)

    return () => {
      authStore.listeners.delete(listener)
      window.removeEventListener('storage', handleStorage)
    }
  }
}

export function useSpotifyAuth() {
  // Use React 18+ useSyncExternalStore to sync with localStorage
  const { isAuthenticated, token } = useSyncExternalStore(
    authStore.subscribe,
    authStore.getSnapshot,
    authStore.getSnapshot // server snapshot (same as client for localStorage)
  )

  const login = useCallback(async () => {
    try {
      const response = await fetch('/api/spotify/auth-url')
      const { url } = await response.json()
      window.location.href = url
    } catch (error) {
      console.error('Failed to get auth URL:', error)
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('spotify_token')
    authStore.emit() // Notify all listeners of the change
  }, [])

  return {
    isAuthenticated,
    login,
    logout,
    token,
  }
}