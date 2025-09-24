import { useSyncExternalStore, useCallback } from 'react'

// External store for auth state that syncs with localStorage
const authStore = {
  listeners: new Set<() => void>(),

  getSnapshot() {
    // Check URL hash first for OAuth callback
    const hash = window.location.hash
    if (hash) {
      const params = new URLSearchParams(hash.substring(1))
      const accessToken = params.get('access_token')
      if (accessToken) {
        localStorage.setItem('spotify_token', accessToken)
        window.location.hash = ''
        return { token: accessToken, isAuthenticated: true }
      }
    }

    // Then check localStorage
    const token = localStorage.getItem('spotify_token')
    return { token, isAuthenticated: !!token }
  },

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
  },

  emit() {
    authStore.listeners.forEach(listener => listener())
  }
}

export function useSpotifyAuth() {
  // Use React 18+ useSyncExternalStore to sync with localStorage
  const { token, isAuthenticated } = useSyncExternalStore(
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
    token,
    login,
    logout,
  }
}