import { Suspense, useState } from 'react';
import { ChatInterface } from './features/chat/ChatInterface';
import { SpotifyAuth } from './features/auth/SpotifyAuth';
import { TestPage } from './features/test/TestPage';
import { UserPlaylists } from './features/playlist/UserPlaylists';
import { ErrorBoundary, PlaylistErrorBoundary } from './app/ErrorBoundary';
import { useSpotifyAuth } from './hooks/useSpotifyAuth';


interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  external_urls: {
    spotify: string;
  };
  images: Array<{
    url: string;
    height: number;
    width: number;
  }>;
  tracks: {
    total: number;
  };
  public: boolean;
  owner: {
    display_name: string;
  };
}

function App() {
  const { isAuthenticated, login, logout } = useSpotifyAuth();
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylist | null>(null);
  const [showTestPage, setShowTestPage] = useState(false);

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
              <button onClick={logout} className="logout-button">
                Logout from Spotify
              </button>
            )}
            <button onClick={() => setShowTestPage(!showTestPage)} className="test-button">
              {showTestPage ? '🎵 Back to App' : '🧪 Test Mode'}
            </button>
          </div>
        </header>

        <main className="app-main">
          {showTestPage ? (
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
                      <ChatInterface
                        selectedPlaylist={selectedPlaylist}
                        onPlaylistModified={() => {
                          // Refresh playlist info if needed
                        }}
                      />
                    </Suspense>
                  ) : (
                    <div className="no-playlist-selected">
                      <h2>🎵 Select a Playlist</h2>
                      <p>Choose a playlist from the left to start chatting about adding or removing songs!</p>
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
            <a href="https://www.anthropic.com" target="_blank" rel="noopener noreferrer">
              Anthropic Claude
            </a>{' '}
            &{' '}
            <a href="https://www.spotify.com" target="_blank" rel="noopener noreferrer">
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
      </div>
    </ErrorBoundary>
  );
}

export default App;