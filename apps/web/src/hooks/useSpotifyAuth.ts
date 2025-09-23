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

    if (code && state) {
      console.log('🔑 Authorization code found, decoding state parameter...');

      try {
        // Decode the state parameter to get the code verifier (stateless approach)
        const stateData = JSON.parse(atob(state));
        const codeVerifier = stateData.verifier;
        const timestamp = stateData.timestamp;

        console.log('🔐 Code verifier from state:', codeVerifier ? 'Found' : 'Missing');
        console.log('⏰ Auth timestamp:', new Date(timestamp).toISOString());

        // Check if the auth request is not too old (15 minutes max)
        const maxAge = 15 * 60 * 1000; // 15 minutes
        const isExpired = Date.now() - timestamp > maxAge;

        if (codeVerifier && !isExpired) {
          console.log('✅ Valid OAuth flow with fresh state, proceeding with token exchange');
          exchangeCodeForToken(code, codeVerifier);
          // Clean up URL
          window.history.replaceState({}, document.title, window.location.pathname);
        } else {
          console.error('❌ Invalid OAuth flow:');
          if (!codeVerifier) console.error('  - Missing code verifier in state');
          if (isExpired) console.error('  - Auth request expired (older than 15 minutes)');
          console.log('🔄 Please try logging in again');
          // Clean up URL
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (error) {
        console.error('❌ Failed to decode state parameter:', error);
        console.log('🔄 Invalid state format, please try logging in again');
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
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

      const { url } = await response.json()
      console.log('🔗 Auth URL received:', url ? 'Success' : 'No URL');
      console.log('🔒 Using stateless OAuth flow (code verifier encoded in state parameter)');

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