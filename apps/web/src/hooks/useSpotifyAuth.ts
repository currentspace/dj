import { useState, useEffect } from 'react'

export function useSpotifyAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [token, setToken] = useState<string | null>(null)

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
    const error = urlParams.get('error')

    console.log('🔗 URL params:', { code: code ? 'Found' : 'Not found', error });

    if (error) {
      console.error('❌ OAuth error:', error);
      return;
    }

    if (code) {
      console.log('🔑 Authorization code found, exchanging for token...');

      // Debug: Check all localStorage keys
      console.log('🔍 All localStorage keys:', Object.keys(localStorage));
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          console.log(`📋 localStorage[${key}]:`, value?.substring(0, 50) + '...');
        }
      }

      // Exchange code for tokens
      const codeVerifier = localStorage.getItem('spotify_code_verifier')
      console.log('🔐 Code verifier:', codeVerifier ? 'Found' : 'Not found');

      if (codeVerifier) {
        exchangeCodeForToken(code, codeVerifier)
        // Clean up
        localStorage.removeItem('spotify_code_verifier')
        window.history.replaceState({}, document.title, window.location.pathname)
      } else {
        console.error('❌ No code verifier found in localStorage');
        console.log('🔄 Attempting to start fresh auth flow...');
        // Clear the URL and let user try again
        window.history.replaceState({}, document.title, window.location.pathname)
      }
    }
  }, [])

  const exchangeCodeForToken = async (code: string, codeVerifier: string) => {
    try {
      console.log('🔄 Making token exchange request...');

      const response = await fetch('/api/spotify/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, codeVerifier }),
      })

      console.log('📡 Token exchange response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Token exchange failed:', response.status, errorText);
        throw new Error(`Token exchange failed: ${response.status} ${errorText}`)
      }

      const tokenData = await response.json()
      console.log('🎉 Token received:', tokenData.access_token ? 'Success' : 'No token in response');

      if (tokenData.access_token) {
        localStorage.setItem('spotify_token', tokenData.access_token)
        setToken(tokenData.access_token)
        setIsAuthenticated(true)
        console.log('✅ Authentication complete!');
      } else {
        console.error('❌ No access_token in response:', tokenData);
      }
    } catch (error) {
      console.error('💥 Failed to exchange code for token:', error)
    }
  }

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

      const { url, codeVerifier } = await response.json()
      console.log('🔗 Auth URL received:', url ? 'Success' : 'No URL');
      console.log('🔐 Code verifier:', codeVerifier ? 'Generated' : 'Missing');

      // Store code verifier for later use
      localStorage.setItem('spotify_code_verifier', codeVerifier)
      console.log('💾 Code verifier stored');

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
    token,
    login,
    logout,
  }
}