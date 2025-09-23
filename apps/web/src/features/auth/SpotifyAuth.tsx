import { startTransition } from 'react';
import { apiClient } from '@dj/api-client';

interface SpotifyAuthProps {
  onLogin: () => void;
}

export function SpotifyAuth({ onLogin: _onLogin }: SpotifyAuthProps) {
  const handleLogin = async () => {
    try {
      startTransition(async () => {
        const authData = await apiClient.getSpotifyAuthUrl();
        window.location.href = authData.url;
      });
    } catch (error) {
      console.error('Failed to get auth URL:', error);
    }
  };

  return (
    <div className="spotify-auth">
      <div className="auth-container">
        <div className="auth-icon">🎵</div>
        <h2>Connect to Spotify</h2>
        <p>
          Login with your Spotify account to create AI-powered playlists
          and save them directly to your library.
        </p>

        <button
          onClick={handleLogin}
          className="spotify-login-btn"
          type="button"
        >
          <span className="spotify-logo">♪</span>
          Login with Spotify
        </button>

        <div className="auth-info">
          <p className="privacy-note">
            We only access your playlist creation permissions.
            Your listening history and personal data remain private.
          </p>
        </div>
      </div>

    </div>
  );
}