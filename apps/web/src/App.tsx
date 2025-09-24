import { Suspense, useState } from 'react';
import { ChatInterface } from './features/chat/ChatInterface';
import { SpotifyAuth } from './features/auth/SpotifyAuth';
import { TestPage } from './features/test/TestPage';
import { ErrorBoundary, PlaylistErrorBoundary } from './app/ErrorBoundary';
import { useSpotifyAuth } from './hooks/useSpotifyAuth';
import { BuildInfo } from './components/BuildInfo';
import './styles/build-info.css';

function App() {
  const { isAuthenticated, login, logout } = useSpotifyAuth();
  const [showTestPage, setShowTestPage] = useState(false);

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
              <div className="chat-section">
                <Suspense fallback={<div className="loading">Loading chat interface...</div>}>
                  <ChatInterface />
                </Suspense>
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
          .chat-section {
            max-width: 1200px;
            margin: 0 auto;
            padding: 1rem;
            height: calc(100vh - 200px);
            display: flex;
            flex-direction: column;
          }

          @media (max-width: 768px) {
            .chat-section {
              height: calc(100vh - 160px);
              padding: 0.5rem;
            }
          }
        `}</style>

        <BuildInfo />
      </div>
    </ErrorBoundary>
  );
}

export default App;