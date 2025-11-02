import { useCallback, useEffect, useState } from 'react'

import { useSpotifyAuth } from '../../hooks/useSpotifyAuth'

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

interface UserPlaylistsProps {
  onPlaylistSelect?: (playlist: SpotifyPlaylist) => void
  selectedPlaylist?: null | SpotifyPlaylist
}

function UserPlaylists({ onPlaylistSelect, selectedPlaylist }: UserPlaylistsProps) {
  const { token } = useSpotifyAuth()
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<null | string>(null)

  const loadPlaylists = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/spotify/playlists', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to load playlists')
      }

      const data = (await response.json()) as { items?: SpotifyPlaylist[] }
      setPlaylists(data.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playlists')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) {
      loadPlaylists()
    }
  }, [loadPlaylists, token])

  if (loading) {
    return (
      <div className="user-playlists">
        <div className="playlists-header">
          <h2>🎵 Your Playlists</h2>
        </div>
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading your playlists...</p>
        </div>
        <style>{playlistsStyles}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div className="user-playlists">
        <div className="playlists-header">
          <h2>🎵 Your Playlists</h2>
        </div>
        <div className="error-state">
          <p>❌ {error}</p>
          <button className="retry-button" onClick={loadPlaylists}>
            Try Again
          </button>
        </div>
        <style>{playlistsStyles}</style>
      </div>
    )
  }

  return (
    <div className="user-playlists">
      <div className="playlists-header">
        <h2>🎵 Your Playlists</h2>
        <p>
          {playlists.length} playlist{playlists.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="playlists-grid">
        {playlists.map(playlist => (
          <div
            className={`playlist-card ${selectedPlaylist?.id === playlist.id ? 'selected' : ''}`}
            key={playlist.id}
            onClick={() => onPlaylistSelect?.(playlist)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPlaylistSelect?.(playlist)
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="playlist-image">
              {playlist.images && playlist.images.length > 0 ? (
                <img alt={playlist.name} loading="lazy" src={playlist.images[0].url} />
              ) : (
                <div className="placeholder-image">🎵</div>
              )}
            </div>

            <div className="playlist-info">
              <h3 className="playlist-name">{playlist.name}</h3>
              <p className="playlist-meta">
                {playlist.tracks.total} track
                {playlist.tracks.total !== 1 ? 's' : ''} •{playlist.public ? ' Public' : ' Private'}
              </p>
              {playlist.description && (
                <p className="playlist-description">{playlist.description}</p>
              )}
            </div>

            <div className="playlist-actions">
              <a
                className="open-spotify-button"
                href={playlist.external_urls.spotify}
                onClick={e => e.stopPropagation()}
                rel="noopener noreferrer"
                target="_blank"
              >
                Open in Spotify
              </a>
            </div>
          </div>
        ))}
      </div>

      <style>{playlistsStyles}</style>
    </div>
  )
}

const playlistsStyles = `
  .user-playlists {
    background: #1a1a1a;
    border-radius: 12px;
    padding: 1.5rem;
    border: 1px solid #333;
  }

  .playlists-header {
    margin-bottom: 1.5rem;
    text-align: center;
  }

  .playlists-header h2 {
    margin: 0 0 0.5rem 0;
    color: white;
    font-size: 1.5rem;
  }

  .playlists-header p {
    margin: 0;
    color: #666;
    font-size: 0.875rem;
  }

  .loading-state, .error-state {
    text-align: center;
    padding: 2rem;
    color: #666;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #333;
    border-top: 3px solid #1db954;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 1rem;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .retry-button {
    background: #1db954;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.875rem;
    margin-top: 1rem;
    transition: background 0.2s ease;
  }

  .retry-button:hover {
    background: #1ed760;
  }

  .playlists-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
    max-height: 400px;
    overflow-y: auto;
    padding-right: 0.5rem;
  }

  .playlist-card {
    background: #2a2a2a;
    border-radius: 8px;
    padding: 1rem;
    border: 1px solid #333;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .playlist-card:hover {
    background: #333;
    border-color: #1db954;
    transform: translateY(-2px);
  }

  .playlist-card.selected {
    background: #1db954;
    border-color: #1ed760;
    transform: translateY(-2px);
  }

  .playlist-card.selected .playlist-name {
    color: white;
  }

  .playlist-card.selected .playlist-meta {
    color: rgba(255, 255, 255, 0.8);
  }

  .playlist-card.selected .playlist-description {
    color: rgba(255, 255, 255, 0.9);
  }

  .playlist-image {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 0.75rem;
    background: #333;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .playlist-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .placeholder-image {
    font-size: 2rem;
    color: #666;
  }

  .playlist-info {
    margin-bottom: 1rem;
  }

  .playlist-name {
    margin: 0 0 0.5rem 0;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .playlist-meta {
    margin: 0 0 0.5rem 0;
    color: #999;
    font-size: 0.75rem;
  }

  .playlist-description {
    margin: 0;
    color: #ccc;
    font-size: 0.75rem;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.3;
  }

  .playlist-actions {
    display: flex;
    gap: 0.5rem;
  }

  .open-spotify-button {
    background: #1db954;
    color: white;
    text-decoration: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 500;
    text-align: center;
    transition: background 0.2s ease;
    flex: 1;
  }

  .open-spotify-button:hover {
    background: #1ed760;
  }

  .playlists-grid::-webkit-scrollbar {
    width: 6px;
  }

  .playlists-grid::-webkit-scrollbar-track {
    background: #1a1a1a;
    border-radius: 3px;
  }

  .playlists-grid::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 3px;
  }

  .playlists-grid::-webkit-scrollbar-thumb:hover {
    background: #444;
  }
`

export { UserPlaylists }
