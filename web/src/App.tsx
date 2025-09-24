import { useState, Suspense, lazy } from 'react'
import { PlaylistGenerator } from './components/PlaylistGenerator'
import { SpotifyAuth } from './components/SpotifyAuth'
import { ChatInterfaceStreaming } from './components/ChatInterfaceStreaming'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BuildInfo } from './components/BuildInfo'
import { useSpotifyAuth } from './hooks/useSpotifyAuth'
import { preloadPlaylists } from './lib/playlist-resource'

// Lazy load PlaylistGenerator for better performance
const LazyPlaylistGenerator = lazy(() =>
  import('./components/PlaylistGenerator').then(m => ({ default: m.PlaylistGenerator }))
)

function App() {
  const { isAuthenticated, login, logout } = useSpotifyAuth()
  const [view, setView] = useState<'chat' | 'classic'>('chat')

  // Preload playlists when authenticated
  if (isAuthenticated) {
    preloadPlaylists()
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>DJ - AI Playlist Generator</h1>
        {isAuthenticated ? (
          <div className="header-controls">
            <button
              className="view-toggle"
              onClick={() => setView(view === 'chat' ? 'classic' : 'chat')}
            >
              {view === 'chat' ? '📝 Classic Mode' : '💬 Chat Mode'}
            </button>
            <button onClick={logout}>Logout from Spotify</button>
          </div>
        ) : null}
      </header>

      <main className="app-main">
        {!isAuthenticated ? (
          <SpotifyAuth onLogin={login} />
        ) : (
          <ErrorBoundary>
            <Suspense fallback={<div className="loading">Loading...</div>}>
              {view === 'chat' ? (
                <ChatInterfaceStreaming />
              ) : (
                <LazyPlaylistGenerator />
              )}
            </Suspense>
          </ErrorBoundary>
        )}
      </main>

      <BuildInfo />
    </div>
  )
}

export default App