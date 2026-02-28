import {Suspense} from 'react'

import {BuildInfo} from './components/atoms/BuildInfo'
import {ErrorBoundary} from './components/atoms/ErrorBoundary'
import {UpdateBanner} from './components/molecules/UpdateBanner'
import {DebugPanel} from './components/organisms/DebugPanel'
import {SpotifyAuth} from './components/organisms/SpotifyAuth'
import {DJPage} from './features/dj/DJPage'
import {useSpotifyAuth} from './hooks/useSpotifyAuth'
import {useDebugStore} from './stores'
import './styles/app-layout.css'
import './styles/build-info.css'

function App() {
  const {clearError, error, isAuthenticated, isLoading, login, logout, token} = useSpotifyAuth()
  const debugIsOpen = useDebugStore((s) => s.isOpen)
  const toggleDebug = useDebugStore((s) => s.toggle)

  return (
    <ErrorBoundary>
      <UpdateBanner />
      <div className="app">
        <header className="app-header">
          <h1>DJ</h1>
          <div className="header-buttons">
            {isAuthenticated && (
              <>
                <button
                  className={`test-button ${debugIsOpen ? 'active' : ''}`}
                  onClick={toggleDebug}
                >
                  {debugIsOpen ? 'Hide Debug' : 'Debug'}
                </button>
                <button className="logout-button" onClick={logout}>
                  Logout
                </button>
              </>
            )}
          </div>
        </header>

        <main className="app-main">
          {!isAuthenticated ? (
            <Suspense fallback={<div className="loading">Loading...</div>}>
              <SpotifyAuth error={error} isLoading={isLoading} onClearError={clearError} onLogin={login} />
            </Suspense>
          ) : (
            <DJPage token={token} />
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

        <BuildInfo />

        {debugIsOpen && <DebugPanel />}
      </div>
    </ErrorBoundary>
  )
}

export default App
