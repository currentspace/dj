import { Suspense, useState } from 'react';
import { ChatInterface } from './features/chat/ChatInterface';
import { SpotifyAuth } from './features/auth/SpotifyAuth';
import { TestPage } from './features/test/TestPage';
import { UserPlaylists } from './features/playlist/UserPlaylists';
import { ErrorBoundary, PlaylistErrorBoundary } from './app/ErrorBoundary';
import { useSpotifyAuth } from './hooks/useSpotifyAuth';
import { usePlaylistCreation } from './hooks/usePlaylistCreation';
import type { Playlist } from '@dj/shared-types';


function App() {
  const { isAuthenticated, login, logout } = useSpotifyAuth();
  const { createPlaylist, isCreating, error: createError } = usePlaylistCreation();
  const [generatedPlaylist, setGeneratedPlaylist] = useState<Playlist | null>(null);
  const [showTestPage, setShowTestPage] = useState(false);
  const [createdPlaylist, setCreatedPlaylist] = useState<any>(null);
  const [showCreateButton, setShowCreateButton] = useState(false);

  const handlePlaylistGenerated = (playlist: Playlist) => {
    setGeneratedPlaylist(playlist);
    setShowCreateButton(true);
    setCreatedPlaylist(null);
  };

  const handleCreatePlaylist = async () => {
    if (!generatedPlaylist) return;

    try {
      const newPlaylist = await createPlaylist({
        name: generatedPlaylist.name,
        description: generatedPlaylist.description,
        tracks: generatedPlaylist.tracks
      });

      setCreatedPlaylist(newPlaylist);
      setShowCreateButton(false);
    } catch (err) {
      console.error('Failed to create playlist:', err);
    }
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
                <div className="chat-section">
                  <Suspense fallback={<div className="loading">Loading chat interface...</div>}>
                    <ChatInterface onPlaylistGenerated={handlePlaylistGenerated} />
                  </Suspense>

                  {generatedPlaylist && (
                    <div className="playlist-actions">
                      {showCreateButton && (
                        <div className="create-playlist-section">
                          <p>✨ Playlist "{generatedPlaylist.name}" generated with {generatedPlaylist.tracks.length} tracks!</p>
                          <button
                            onClick={handleCreatePlaylist}
                            disabled={isCreating}
                            className="create-playlist-button"
                          >
                            {isCreating ? 'Creating...' : '🎵 Save to Spotify'}
                          </button>
                          {createError && (
                            <p className="error-message">❌ {createError}</p>
                          )}
                        </div>
                      )}

                      {createdPlaylist && (
                        <div className="playlist-created">
                          <p>🎉 Playlist saved to Spotify!</p>
                          <a
                            href={createdPlaylist.external_urls?.spotify}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="open-playlist-link"
                          >
                            Open "{createdPlaylist.name}" in Spotify
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="playlists-section">
                  <Suspense fallback={<div className="loading">Loading playlists...</div>}>
                    <UserPlaylists />
                  </Suspense>
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
            grid-template-columns: 1fr 400px;
            gap: 2rem;
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 1rem;
          }

          .chat-section {
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }

          .playlist-actions {
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 12px;
            padding: 1.5rem;
          }

          .create-playlist-section {
            text-align: center;
          }

          .create-playlist-section p {
            margin: 0 0 1rem 0;
            color: #e0e0e0;
            font-weight: 500;
          }

          .create-playlist-button {
            background: linear-gradient(135deg, #1db954 0%, #1ed760 100%);
            color: white;
            border: none;
            padding: 1rem 2rem;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 4px 12px rgba(29, 185, 84, 0.3);
          }

          .create-playlist-button:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(29, 185, 84, 0.4);
          }

          .create-playlist-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
          }

          .playlist-created {
            text-align: center;
            padding: 1rem;
            background: linear-gradient(135deg, #1db954 0%, #1ed760 100%);
            border-radius: 8px;
            margin-top: 1rem;
          }

          .playlist-created p {
            margin: 0 0 0.75rem 0;
            color: white;
            font-weight: 600;
          }

          .open-playlist-link {
            color: white;
            text-decoration: none;
            font-weight: 500;
            padding: 0.5rem 1rem;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 6px;
            transition: background 0.2s ease;
          }

          .open-playlist-link:hover {
            background: rgba(255, 255, 255, 0.3);
          }

          .error-message {
            margin: 0.75rem 0 0 0;
            color: #ff6b6b;
            font-size: 0.875rem;
          }

          .playlists-section {
            height: fit-content;
            max-height: calc(100vh - 200px);
            overflow: hidden;
          }

          @media (max-width: 768px) {
            .main-content {
              grid-template-columns: 1fr;
              gap: 1.5rem;
            }

            .playlists-section {
              max-height: 400px;
            }
          }
        `}</style>
      </div>
    </ErrorBoundary>
  );
}

export default App;