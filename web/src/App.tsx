import { useState } from 'react'
import { PlaylistGenerator } from './components/PlaylistGenerator'
import { SpotifyAuth } from './components/SpotifyAuth'
import { ChatInterface } from './components/ChatInterface'
import { useSpotifyAuth } from './hooks/useSpotifyAuth'

function App() {
  const { isAuthenticated, login, logout } = useSpotifyAuth()
  const [view, setView] = useState<'chat' | 'classic'>('chat')

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
        ) : view === 'chat' ? (
          <ChatInterface />
        ) : (
          <PlaylistGenerator />
        )}
      </main>
    </div>
  )
}

export default App