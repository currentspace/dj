import {Suspense} from 'react'

import {BuildInfo} from './components/atoms/BuildInfo'
import {ErrorBoundary, PlaylistErrorBoundary} from './components/atoms/ErrorBoundary'
import {ScopeDebugger} from './components/molecules/ScopeDebugger'
import {UpdateBanner} from './components/molecules/UpdateBanner'
import {ChatInterface} from './components/organisms/ChatInterface'
import {NowPlaying} from './components/organisms/NowPlaying'
import {SpotifyAuth} from './components/organisms/SpotifyAuth'
import {UserPlaylists} from './components/organisms/UserPlaylists'
import {MixPage} from './components/pages/MixPage'
import {useSpotifyAuth} from './hooks/useSpotifyAuth'
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
                  <Suspense fallback={<div className="loading">Loading chat interface...</div>}>
                    <ChatInterface />
                  </Suspense>
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
