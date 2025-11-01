import { Suspense, useState } from 'react';

import { ErrorBoundary, PlaylistErrorBoundary } from './app/ErrorBoundary';
import { BuildInfo } from './components/BuildInfo';
import { SpotifyAuth } from './features/auth/SpotifyAuth';
import { ChatInterface } from './features/chat/ChatInterface';
import { ScopeDebugger } from './features/debug/ScopeDebugger';
import { UserPlaylists } from './features/playlist/UserPlaylists';
import { TestPage } from './features/test/TestPage';
import { useSpotifyAuth } from './hooks/useSpotifyAuth';
import { SSETestPage } from './pages/SSETestPage';
import './styles/build-info.css';

interface SpotifyPlaylist {
  description: string;
  external_urls: {
    spotify: string;
  };
  id: string;
  images: {
    height: number;
    url: string;
    width: number;
  }[];
  name: string;
  owner: {
    display_name: string;
  };
  public: boolean;
  tracks: {
    total: number;
  };
}

function App() {
  const { isAuthenticated, login, logout } = useSpotifyAuth();
  const [selectedPlaylist, setSelectedPlaylist] = useState<null | SpotifyPlaylist>(null);
  const [showTestPage, setShowTestPage] = useState(false);
  const [showSSETest, setShowSSETest] = useState(false);
  const [showScopeDebug, setShowScopeDebug] = useState(false);

  const handlePlaylistSelect = (playlist: SpotifyPlaylist) => {
    setSelectedPlaylist(playlist);
  };

  return (
    <ErrorBoundary>
      <div className="app">
        <header className="app-header">
          <h1>🎵 DJ</h1>
          <p className="app-subtitle">AI-Powered Playlist Generator</p>
          <div className="header-buttons">
            {isAuthenticated && (
              <>
                <button className="test-button" onClick={() => { setShowScopeDebug(!showScopeDebug); setShowSSETest(false); setShowTestPage(false); }}>
                  {showScopeDebug ? '🎵 Back to Chat' : '🔍 Scope Debug'}
                </button>
                <button className="test-button" onClick={() => { setShowSSETest(!showSSETest); setShowTestPage(false); setShowScopeDebug(false); }}>
                  {showSSETest ? '🎵 Back to Chat' : '🔧 SSE Debug'}
                </button>
                <button className="test-button" onClick={() => { setShowTestPage(!showTestPage); setShowSSETest(false); setShowScopeDebug(false); }}>
                  {showTestPage ? '🎵 Back to Chat' : '🧪 Test Mode'}
                </button>
                <button className="logout-button" onClick={logout}>
                  Logout from Spotify
                </button>
              </>
            )}
          </div>
        </header>

        <main className="app-main">
          {showScopeDebug && isAuthenticated ? (
            <Suspense fallback={<div className="loading">Loading scope debugger...</div>}>
              <ScopeDebugger />
            </Suspense>
          ) : showSSETest && isAuthenticated ? (
            <Suspense fallback={<div className="loading">Loading SSE test page...</div>}>
              <SSETestPage />
            </Suspense>
          ) : showTestPage && isAuthenticated ? (
            <Suspense fallback={<div className="loading">Loading test page...</div>}>
              <TestPage />
            </Suspense>
          ) : !isAuthenticated ? (
            <Suspense fallback={<div className="loading">Loading...</div>}>
              <SpotifyAuth onLogin={login} />
            </Suspense>
          ) : (
            <PlaylistErrorBoundary>
              <div className="main-content">
                <div className="playlists-section">
                  <Suspense fallback={<div className="loading">Loading playlists...</div>}>
                    <UserPlaylists
                      onPlaylistSelect={handlePlaylistSelect}
                      selectedPlaylist={selectedPlaylist}
                    />
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

        <style>{`
          .main-content {
            display: grid;
            grid-template-columns: 400px 1fr;
            gap: 2rem;
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 1rem;
            height: calc(100vh - 200px);
          }

          .playlists-section {
            height: 100%;
            overflow: hidden;
          }

          .chat-section {
            height: 100%;
            display: flex;
            flex-direction: column;
          }

          .no-playlist-selected {
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 12px;
            padding: 3rem;
            text-align: center;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
          }

          .no-playlist-selected h2 {
            margin: 0 0 1rem 0;
            color: #e0e0e0;
            font-size: 2rem;
          }

          .no-playlist-selected p {
            margin: 0;
            color: #999;
            font-size: 1.125rem;
            max-width: 400px;
            line-height: 1.5;
          }

          @media (max-width: 768px) {
            .main-content {
              grid-template-columns: 1fr;
              grid-template-rows: auto 1fr;
              gap: 1.5rem;
              height: auto;
            }

            .playlists-section {
              height: auto;
              max-height: 300px;
            }

            .chat-section {
              height: 500px;
            }
          }
        `}</style>

        <BuildInfo />
      </div>
    </ErrorBoundary>
  );
}

export default App;