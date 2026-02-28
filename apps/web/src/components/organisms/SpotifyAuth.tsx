interface SpotifyAuthProps {
  error: null | string
  isLoading: boolean
  onClearError: () => void
  onLogin: () => void
}

export function SpotifyAuth({error, isLoading, onClearError, onLogin}: SpotifyAuthProps) {
  const handleLogin = (): void => {
    onClearError()
    onLogin()
  }

  return (
    <div className="flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">🎵</div>
        <h2 className="text-xl font-bold mb-2">Connect to Spotify</h2>
        <p className="text-text-secondary mb-4">Login with your Spotify account to create AI-powered playlists and save them directly to your library.</p>

        {error && (
          <div className="text-error mb-4">
            {error}
            <button className="bg-transparent border-none text-error ml-2 cursor-pointer underline hover:opacity-80" onClick={onClearError} type="button">
              Dismiss
            </button>
          </div>
        )}

        <button className="spotify-login-btn" disabled={isLoading} onClick={handleLogin} type="button">
          <span className="mr-2">♪</span>
          {isLoading ? 'Connecting...' : 'Login with Spotify'}
        </button>

        <div className="mt-4">
          <p className="text-text-muted text-sm">
            We only access your playlist creation permissions. Your listening history and personal data remain private.
          </p>
        </div>
      </div>
    </div>
  )
}
