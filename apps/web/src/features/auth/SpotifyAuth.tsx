import { use, startTransition } from 'react';
import { apiClient } from '@dj/api-client';
import type { SpotifyAuthResponse } from '@dj/shared-types';

interface SpotifyAuthProps {
  onLogin: () => void;
}

// Create a promise for the auth URL - React 19's use() can handle this
const getAuthUrlPromise = () => apiClient.getSpotifyAuthUrl();

export function SpotifyAuth({ onLogin }: SpotifyAuthProps) {
  const handleLogin = async () => {
    try {
      startTransition(async () => {
        const authData = await getAuthUrlPromise();
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

      <style jsx>{`
        .spotify-auth {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 60vh;
          padding: 2rem;
        }

        .auth-container {
          text-align: center;
          max-width: 400px;
          padding: 3rem 2rem;
          border-radius: 16px;
          background: linear-gradient(135deg, #1db954 0%, #1ed760 100%);
          color: white;
          box-shadow: 0 10px 30px rgba(29, 185, 84, 0.3);
        }

        .auth-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
          animation: bounce 2s infinite;
        }

        .auth-container h2 {
          margin-bottom: 1rem;
          font-size: 1.75rem;
          font-weight: 700;
        }

        .auth-container p {
          margin-bottom: 2rem;
          opacity: 0.9;
          line-height: 1.5;
        }

        .spotify-login-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.75rem;
          background: white;
          color: #1db954;
          border: none;
          padding: 1rem 2rem;
          border-radius: 50px;
          font-size: 1.1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
        }

        .spotify-login-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
          background: #f8f9fa;
        }

        .spotify-login-btn:active {
          transform: translateY(0);
        }

        .spotify-logo {
          font-size: 1.25rem;
        }

        .auth-info {
          margin-top: 2rem;
          padding-top: 2rem;
          border-top: 1px solid rgba(255, 255, 255, 0.2);
        }

        .privacy-note {
          font-size: 0.875rem;
          opacity: 0.8;
          margin: 0;
        }

        @keyframes bounce {
          0%, 20%, 50%, 80%, 100% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(-10px);
          }
          60% {
            transform: translateY(-5px);
          }
        }
      `}</style>
    </div>
  );
}