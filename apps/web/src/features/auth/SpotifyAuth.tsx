interface SpotifyAuthProps {
  error: null | string;
  isLoading: boolean;
  onClearError: () => void;
  onLogin: () => void;
}

export function SpotifyAuth({ error, isLoading, onClearError, onLogin }: SpotifyAuthProps) {
  const handleLogin = (): void => {
    onClearError();
    onLogin();
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

        {error && (
          <div className="error-message" style={{ color: '#ff4444', marginBottom: '1rem' }}>
            {error}
            <button
              onClick={onClearError}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#ff4444',
                cursor: 'pointer',
                marginLeft: '0.5rem',
                textDecoration: 'underline',
              }}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}

        <button
          className="spotify-login-btn"
          disabled={isLoading}
          onClick={handleLogin}
          type="button"
        >
          <span className="spotify-logo">♪</span>
          {isLoading ? 'Connecting...' : 'Login with Spotify'}
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