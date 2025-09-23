import { Suspense } from 'react';
import { PlaylistGenerator } from './features/playlist/PlaylistGenerator';
import { SpotifyAuth } from './features/auth/SpotifyAuth';
import { ErrorBoundary, PlaylistErrorBoundary } from './app/ErrorBoundary';
import { useSpotifyAuth } from './hooks/useSpotifyAuth';

function App() {
  const { isAuthenticated, login, logout } = useSpotifyAuth();

  return (
    <ErrorBoundary>
      <div className="app">
        <header className="app-header">
          <h1>🎵 DJ</h1>
          <p className="app-subtitle">AI-Powered Playlist Generator</p>
          {isAuthenticated && (
            <button onClick={logout} className="logout-button">
              Logout from Spotify
            </button>
          )}
        </header>

        <main className="app-main">
          {!isAuthenticated ? (
            <Suspense fallback={<div className="loading">Loading...</div>}>
              <SpotifyAuth onLogin={login} />
            </Suspense>
          ) : (
            <PlaylistErrorBoundary>
              <Suspense fallback={<div className="loading">Loading playlist generator...</div>}>
                <PlaylistGenerator />
              </Suspense>
            </PlaylistErrorBoundary>
          )}
        </main>

        <footer className="app-footer">
          <p>
            Powered by{' '}
            <a href="https://www.anthropic.com" target="_blank" rel="noopener noreferrer">
              Anthropic Claude
            </a>{' '}
            &{' '}
            <a href="https://www.spotify.com" target="_blank" rel="noopener noreferrer">
              Spotify
            </a>
          </p>
        </footer>
      </div>
    </ErrorBoundary>
  );
}

export default App;