import { useState } from 'react'
import { PlaylistGenerator } from './components/PlaylistGenerator'
import { SpotifyAuth } from './components/SpotifyAuth'
import { useSpotifyAuth } from './hooks/useSpotifyAuth'

function App() {
  const { isAuthenticated, login, logout } = useSpotifyAuth()

  return (
    <div className="app">
      <header className="app-header">
        <h1>DJ - AI Playlist Generator</h1>
        {isAuthenticated ? (
          <button onClick={logout}>Logout from Spotify</button>
        ) : null}
      </header>

      <main className="app-main">
        {!isAuthenticated ? (
          <SpotifyAuth onLogin={login} />
        ) : (
          <PlaylistGenerator />
        )}
      </main>
    </div>
  )
}

export default App