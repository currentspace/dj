import { useState, useEffect } from 'react'

export function useSpotifyAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    // Check for existing token in localStorage
    const storedToken = localStorage.getItem('spotify_token')
    if (storedToken) {
      setToken(storedToken)
      setIsAuthenticated(true)
    }

    // Check for token in URL hash (OAuth callback)
    const hash = window.location.hash
    if (hash) {
      const params = new URLSearchParams(hash.substring(1))
      const accessToken = params.get('access_token')
      if (accessToken) {
        localStorage.setItem('spotify_token', accessToken)
        setToken(accessToken)
        setIsAuthenticated(true)
        // Clean up URL
        window.location.hash = ''
      }
    }
  }, [])

  const login = async () => {
    try {
      const response = await fetch('/api/spotify/auth-url')
      const { url } = await response.json()
      window.location.href = url
    } catch (error) {
      console.error('Failed to get auth URL:', error)
    }
  }

  const logout = () => {
    localStorage.removeItem('spotify_token')
    setToken(null)
    setIsAuthenticated(false)
  }

  return {
    isAuthenticated,
    token,
    login,
    logout,
  }
}