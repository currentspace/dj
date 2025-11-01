interface SpotifyAuthProps {
  onLogin: () => void
}

export function SpotifyAuth({ onLogin }: SpotifyAuthProps) {
  return (
    <div className="spotify-auth">
      <h2>Connect to Spotify</h2>
      <p>Login with your Spotify account to create AI-powered playlists</p>
      <button className="spotify-login-btn" onClick={onLogin}>
        Login with Spotify
      </button>
    </div>
  )
}