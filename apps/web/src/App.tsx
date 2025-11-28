import {Suspense, useState} from 'react'

import {ErrorBoundary, PlaylistErrorBoundary} from './app/ErrorBoundary'
import {BuildInfo} from './components/BuildInfo'
import {SpotifyAuth} from './features/auth/SpotifyAuth'
import {ChatInterface} from './features/chat/ChatInterface'
import {ScopeDebugger} from './features/debug/ScopeDebugger'
import {NowPlaying} from './features/playback/NowPlaying'
import {UserPlaylists} from './features/playlist/UserPlaylists'
import {useSpotifyAuth} from './hooks/useSpotifyAuth'
import {MixPage} from './pages/MixPage'
import './styles/app-layout.css'
import './styles/build-info.css'

interface SpotifyPlaylist {
  description: string
  external_urls: {
    spotify: string
  }
  id: string
  images: {
    height: number
    url: string
    width: number
  }[]
  name: string
  owner: {
    display_name: string
  }
  public: boolean
  tracks: {
    total: number
  }
}

function App() {
  const {clearError, error, isAuthenticated, isLoading, login, logout, token} = useSpotifyAuth()

  const [selectedPlaylist, setSelectedPlaylist] = useState<null | SpotifyPlaylist>(null)
  const [showScopeDebug, setShowScopeDebug] = useState(false)
  const [showMixMode, setShowMixMode] = useState(false)

  const handlePlaylistSelect = (playlist: SpotifyPlaylist) => {
    setSelectedPlaylist(playlist)
  }

  return (
    <ErrorBoundary>
      <div className="app">
        <header className="app-header">
          <h1>🎵 DJ</h1>
          <p className="app-subtitle">AI-Powered Playlist Generator</p>
          <div className="header-buttons">
            {isAuthenticated && (
              <>
                <button
                  className="test-button"
                  onClick={() => {
                    setShowMixMode(!showMixMode)
                    setShowScopeDebug(false)
                  }}
                >
                  {showMixMode ? '💬 Back to Chat' : '🎧 Live DJ Mode'}
                </button>
                <button className="test-button" onClick={() => {
                  setShowScopeDebug(!showScopeDebug)
                  setShowMixMode(false)
                }}>
                  {showScopeDebug ? '🎵 Back to Chat' : '🔍 Scope Debug'}
                </button>
                <button className="logout-button" onClick={logout}>
                  Logout from Spotify
                </button>
              </>
            )}
          </div>
        </header>

        <main className="app-main">
          {showMixMode && isAuthenticated ? (
            <Suspense fallback={<div className="loading">Loading Live DJ Mode...</div>}>
              <MixPage
                onBackToChat={() => setShowMixMode(false)}
                seedPlaylistId={selectedPlaylist?.id}
                token={token}
              />
            </Suspense>
          ) : showScopeDebug && isAuthenticated ? (
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
                    <UserPlaylists onPlaylistSelect={handlePlaylistSelect} selectedPlaylist={selectedPlaylist} />
                  </Suspense>
                </div>

                <div className="chat-section">
                  {selectedPlaylist ? (
                    <Suspense fallback={<div className="loading">Loading chat interface...</div>}>
                      <ChatInterface selectedPlaylist={selectedPlaylist} />
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

        {isAuthenticated && <NowPlaying token={token} />}

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
