import type {SpotifyPlaylist} from '@dj/shared-types'

import {usePlaylistsQuery} from '../../hooks/queries'
import {useSpotifyAuth} from '../../hooks/useSpotifyAuth'
import {usePlaylistStore} from '../../stores'
import {LoadingSpinner} from '../atoms/LoadingSpinner'
import '../../styles/user-playlists.css'

interface UserPlaylistsProps {
  onPlaylistSelect?: (playlist: SpotifyPlaylist) => void
}

function UserPlaylists({onPlaylistSelect}: UserPlaylistsProps) {
  // Get selected playlist from store (for highlighting)
  const selectedPlaylist = usePlaylistStore((s) => s.selectedPlaylist)
  const {logout, token} = useSpotifyAuth()
  const {data: playlists = [], error, isLoading, refetch} = usePlaylistsQuery(token)

  // Handle 401 auth errors
  if (error && 'isAuthError' in error && (error as Error & {isAuthError: boolean}).isAuthError) {
    console.log('[UserPlaylists] Token expired (401), logging out...')
    logout()
  }

  if (isLoading) {
    return (
      <div className="user-playlists">
        <div className="playlists-header">
          <h2>🎵 Your Playlists</h2>
        </div>
        <div className="loading-state">
          <LoadingSpinner size="md" text="Loading your playlists..." />
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
          <p>❌ {error.message}</p>
          <button className="retry-button" onClick={() => refetch()}>
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
