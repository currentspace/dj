import { useEffect, useState } from 'react'

export function useSpotifyAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [token, setToken] = useState<null | string>(null)

  useEffect(() => {
    console.log('🔍 Auth check starting...');

    // Check for existing token in localStorage
    const storedToken = localStorage.getItem('spotify_token')
    console.log('📦 Stored token:', storedToken ? 'Found' : 'Not found');

    if (storedToken) {
      setToken(storedToken)
      setIsAuthenticated(true)
      console.log('✅ Using stored token, authenticated');
      return;
    }

    // Check for authorization code in URL (OAuth callback)
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')
    const state = urlParams.get('state')
    const error = urlParams.get('error')

    console.log('🔗 URL params:', {
      code: code ? 'Found' : 'Not found',
      error,
      state: state ? 'Found' : 'Not found'
    });

    if (error) {
      console.error('❌ OAuth error:', error);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname)
      return;
    }

    // Check for server-side OAuth callback results (from /api/spotify/callback)
    const spotifyToken = urlParams.get('spotify_token')
    const authSuccess = urlParams.get('auth_success')

    console.log('🔗 Server callback params:', {
      auth_success: authSuccess ? 'Found' : 'Not found',
      error,
      spotify_token: spotifyToken ? 'Found' : 'Not found'
    });

    if (spotifyToken && authSuccess) {
      console.log('🎉 Server-side OAuth success! Storing token...');
      localStorage.setItem('spotify_token', spotifyToken)
      setToken(spotifyToken)
      setIsAuthenticated(true)
      console.log('✅ Authentication complete!');

      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  const login = async () => {
    try {
      console.log('🚀 Starting Spotify login...');

      const response = await fetch('/api/spotify/auth-url')
      console.log('📡 Auth URL response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to get auth URL:', response.status, errorText);
        return;
      }

      const { url } = await response.json()
      console.log('🔗 Auth URL received:', url ? 'Success' : 'No URL');
      console.log('🔒 Using secure cookie-based PKCE flow with server-side token exchange');

      console.log('➡️ Redirecting to Spotify...');
      window.location.href = url
    } catch (error) {
      console.error('💥 Failed to get auth URL:', error)
    }
  }

  const logout = () => {
    localStorage.removeItem('spotify_token')
    setToken(null)
    setIsAuthenticated(false)
  }

  return {
    isAuthenticated,
    login,
    logout,
    token,
  }
}