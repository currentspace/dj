import {Suspense} from 'react'

import {ErrorBoundary, PlaylistErrorBoundary} from './app/ErrorBoundary'
import {BuildInfo} from './components/BuildInfo'
import {UpdateBanner} from './components/UpdateBanner'
import {SpotifyAuth} from './features/auth/SpotifyAuth'
import {ChatInterface} from './features/chat/ChatInterface'
import {ScopeDebugger} from './features/debug/ScopeDebugger'
import {NowPlaying} from './features/playback/NowPlaying'
import {UserPlaylists} from './features/playlist/UserPlaylists'
import {useSpotifyAuth} from './hooks/useSpotifyAuth'
import {MixPage} from './pages/MixPage'
import {useNavigationStore, usePlaylistStore} from './stores'
import './styles/app-layout.css'
import './styles/build-info.css'

function App() {
  const {clearError, error, isAuthenticated, isLoading, login, logout, token} = useSpotifyAuth()
  const route = useNavigationStore((s) => s.route)
  const navigate = useNavigationStore((s) => s.navigate)

  // Playlist state from Zustand store (eliminates prop drilling)
  const selectedPlaylist = usePlaylistStore((s) => s.selectedPlaylist)
  const selectPlaylist = usePlaylistStore((s) => s.selectPlaylist)

  return (
    <ErrorBoundary>
      <UpdateBanner />
      <div className="app">
        <header className="app-header">
          <h1>🎵 DJ</h1>
          <p className="app-subtitle">AI-Powered Playlist Generator</p>
          <div className="header-buttons">
            {isAuthenticated && (
              <>
                <button
                  className={`test-button ${route === 'mix' ? 'active' : ''}`}
                  onClick={() => navigate(route === 'mix' ? 'chat' : 'mix')}
                >
                  {route === 'mix' ? '💬 Back to Chat' : '🎧 Live DJ Mode'}
                </button>
                <button
                  className={`test-button ${route === 'debug' ? 'active' : ''}`}
                  onClick={() => navigate(route === 'debug' ? 'chat' : 'debug')}
                >
                  {route === 'debug' ? '🎵 Back to Chat' : '🔍 Scope Debug'}
                </button>
                <button className="logout-button" onClick={logout}>
                  Logout from Spotify
                </button>
              </>
            )}
          </div>
        </header>

        <main className="app-main">
          {route === 'mix' && isAuthenticated ? (
            <Suspense fallback={<div className="loading">Loading Live DJ Mode...</div>}>
              <MixPage
                onBackToChat={() => navigate('chat')}
                seedPlaylistId={selectedPlaylist?.id}
                token={token}
              />
            </Suspense>
          ) : route === 'debug' && isAuthenticated ? (
            <Suspense fallback={<div className="loading">Loading scope debugger...</div>}>
              <ScopeDebugger />
            </Suspense>
          ) : !isAuthenticated ? (
            <Suspense fallback={<div className="loading">Loading...</div>}>
              <SpotifyAuth error={error} isLoading={isLoading} onClearError={clearError} onLogin={login} />
            </Suspense>
          ) : (
            <PlaylistErrorBoundary>
              <div className="main-content">
                <div className="playlists-section">
                  <Suspense fallback={<div className="loading">Loading playlists...</div>}>
                    <UserPlaylists onPlaylistSelect={selectPlaylist} />
                  </Suspense>
                </div>

                <div className="chat-section">
                  {selectedPlaylist ? (
                    <Suspense fallback={<div className="loading">Loading chat interface...</div>}>
                      <ChatInterface />
                    </Suspense>
                  ) : (
                    <div className="no-playlist-selected">
                      <h2>🎵 Select a Playlist</h2>
                      <p>Choose a playlist from the left to start chatting with your AI DJ assistant!</p>
                    </div>
                  )}
                </div>
              </div>
            </PlaylistErrorBoundary>
          )}
        </main>

        {isAuthenticated && route !== 'mix' && <NowPlaying token={token} />}

        <footer className="app-footer">
          <p>
            Powered by{' '}
            <a href="https://www.anthropic.com" rel="noopener noreferrer" target="_blank">
              Anthropic Claude
            </a>{' '}
            &{' '}
            <a href="https://www.spotify.com" rel="noopener noreferrer" target="_blank">
              Spotify
            </a>
          </p>
        </footer>

        <BuildInfo />
      </div>
    </ErrorBoundary>
  )
}

export default App
