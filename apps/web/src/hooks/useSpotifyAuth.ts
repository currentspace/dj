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
    const state = urlParams.get('state')
    const error = urlParams.get('error')

    console.log('🔗 URL params:', {
      code: code ? 'Found' : 'Not found',
      state: state ? 'Found' : 'Not found',
      error
    });

    if (error) {
      console.error('❌ OAuth error:', error);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname)
      return;
    }

    if (code) {
      console.log('🔑 Authorization code found, exchanging for token...');

      // Debug sessionStorage contents
      console.log('🔍 All sessionStorage keys:', Object.keys(sessionStorage));
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          const value = sessionStorage.getItem(key);
          console.log(`📋 sessionStorage[${key}]:`, value?.substring(0, 50) + '...');
        }
      }

      // Retrieve code verifier from sessionStorage (canonical approach)
      const codeVerifier = sessionStorage.getItem('spotify_code_verifier')
      const storedState = sessionStorage.getItem('spotify_auth_state')
      console.log('🔐 Code verifier in sessionStorage:', codeVerifier ? 'Found' : 'Not found');
      console.log('🔑 Stored state in sessionStorage:', storedState ? 'Found' : 'Not found');
      console.log('🔍 State match:', state === storedState ? 'Valid' : 'Invalid');

      if (codeVerifier && storedState === state) {
        console.log('✅ Valid OAuth flow, proceeding with token exchange');
        exchangeCodeForToken(code, codeVerifier)
        // Clean up
        sessionStorage.removeItem('spotify_code_verifier')
        sessionStorage.removeItem('spotify_auth_state')
        window.history.replaceState({}, document.title, window.location.pathname)
      } else {
        console.error('❌ Invalid OAuth flow detected:');
        console.error('  - Code verifier:', codeVerifier ? 'Found' : 'Missing');
        console.error('  - State validation:', state === storedState ? 'Valid' : 'Invalid');
        console.log('🔄 Please try logging in again');
        // Clean up URL and let user try again
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

      const { url, codeVerifier, state } = await response.json()
      console.log('🔗 Auth URL received:', url ? 'Success' : 'No URL');
      console.log('🔐 Code verifier received:', codeVerifier ? 'Success' : 'Missing');
      console.log('🔑 State received:', state ? 'Success' : 'Missing');

      // Store code verifier in sessionStorage (canonical approach for SPAs)
      sessionStorage.setItem('spotify_code_verifier', codeVerifier)
      sessionStorage.setItem('spotify_auth_state', state)
      console.log('💾 Code verifier and state stored in sessionStorage');

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