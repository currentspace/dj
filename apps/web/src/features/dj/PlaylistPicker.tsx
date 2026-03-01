/**
 * PlaylistPicker - Horizontal scrollable strip of user's playlists
 * Shown when no session is active. Tap to select seed playlist.
 */

import type {SpotifyPlaylist} from '@dj/shared-types'

import {useCallback} from 'react'

import {usePlaylistsQuery} from '../../hooks/queries'
import {useSpotifyAuth} from '../../hooks/useSpotifyAuth'
import styles from './DJPage.module.css'

interface PlaylistPickerProps {
  onSelect: (playlist: SpotifyPlaylist) => void
  selected: null | SpotifyPlaylist
}

export function PlaylistPicker({onSelect, selected}: PlaylistPickerProps) {
  const {token} = useSpotifyAuth()
  const {data: playlists = [], error, isLoading} = usePlaylistsQuery(token)

  const handleSelect = useCallback(
    (playlist: SpotifyPlaylist) => {
      onSelect(playlist)
    },
    [onSelect],
  )

  if (isLoading) {
    return (
      <div className={styles.pickerLoading}>Loading your playlists...</div>
    )
  }

  if (error) {
    return (
      <div className={styles.pickerError}>{error.message}</div>
    )
  }

  return (
    <div className={styles.playlistPicker}>
      <h3 className={styles.pickerTitle}>Pick a seed playlist</h3>
      <div className={styles.pickerStrip}>
        {playlists.map((playlist) => (
          <button
            className={`${styles.pickerItem} ${selected?.id === playlist.id ? styles.pickerItemSelected : ''}`}
            key={playlist.id}
            onClick={() => handleSelect(playlist)}
            type="button"
          >
            {playlist.images?.[0]?.url ? (
              <img
                alt={playlist.name}
                className={styles.pickerArt}
                src={playlist.images[0].url}
              />
            ) : (
              <div className={styles.pickerArtPlaceholder}>🎵</div>
            )}
            <span className={styles.pickerName}>{playlist.name}</span>
            <span className={styles.pickerCount}>{playlist.tracks?.total ?? 0} tracks</span>
          </button>
        ))}
      </div>
    </div>
  )
}
