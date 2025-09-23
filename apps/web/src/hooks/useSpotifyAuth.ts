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

    // Check for authorization code in URL (OAuth callback)
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')

    if (code) {
      // Exchange code for tokens
      const codeVerifier = localStorage.getItem('spotify_code_verifier')
      if (codeVerifier) {
        exchangeCodeForToken(code, codeVerifier)
        // Clean up
        localStorage.removeItem('spotify_code_verifier')
        window.history.replaceState({}, document.title, window.location.pathname)
      }
    }
  }, [])

  const exchangeCodeForToken = async (code: string, codeVerifier: string) => {
    try {
      const response = await fetch('/api/spotify/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, codeVerifier }),
      })

      if (!response.ok) {
        throw new Error('Token exchange failed')
      }

      const tokenData = await response.json()
      localStorage.setItem('spotify_token', tokenData.access_token)
      setToken(tokenData.access_token)
      setIsAuthenticated(true)
    } catch (error) {
      console.error('Failed to exchange code for token:', error)
    }
  }

  const login = async () => {
    try {
      const response = await fetch('/api/spotify/auth-url')
      const { url, codeVerifier } = await response.json()

      // Store code verifier for later use
      localStorage.setItem('spotify_code_verifier', codeVerifier)

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