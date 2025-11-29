import type {SpotifyPlaylist} from '@dj/shared-types'

import {useCallback, useRef, useState} from 'react'

import {useSpotifyAuth} from '../../hooks/useSpotifyAuth'
import {usePlaylistStore} from '../../stores'
import '../../styles/user-playlists.css'

interface UserPlaylistsProps {
  onPlaylistSelect?: (playlist: SpotifyPlaylist) => void
}

function UserPlaylists({onPlaylistSelect}: UserPlaylistsProps) {
  // Get selected playlist from store (for highlighting)
  const selectedPlaylist = usePlaylistStore((s) => s.selectedPlaylist)
  const {logout, token} = useSpotifyAuth()
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<null | string>(null)
  const hasLoadedRef = useRef(false)
  const lastTokenRef = useRef<null | string>(null)

  const loadPlaylists = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/spotify/playlists', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      // Handle 401 Unauthorized - token expired
      if (response.status === 401) {
        console.log('[UserPlaylists] Token expired (401), logging out...')
        logout() // Clear expired token and trigger re-auth
        throw new Error('Session expired. Please log in again.')
      }

      if (!response.ok) {
        throw new Error('Failed to load playlists')
      }

      const data = (await response.json()) as {items?: SpotifyPlaylist[]}
      setPlaylists(data.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playlists')
    } finally {
      setLoading(false)
    }
  }, [logout, token])

  // Direct state sync: load playlists when token changes or on initial mount
  if (token && (!hasLoadedRef.current || lastTokenRef.current !== token)) {
    hasLoadedRef.current = true
    lastTokenRef.current = token
    loadPlaylists()
  }

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
            tabIndex={0}>
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
              {playlist.description && <p className="playlist-description">{playlist.description}</p>}
            </div>

            <div className="playlist-actions">
              <a
                className="open-spotify-button"
                href={playlist.external_urls.spotify}
                onClick={e => e.stopPropagation()}
                rel="noopener noreferrer"
                target="_blank">
                Open in Spotify
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export {UserPlaylists}
