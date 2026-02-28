/**
 * PlaylistPicker - Horizontal scrollable strip of user's playlists
 * Shown when no session is active. Tap to select seed playlist.
 */

import type {SpotifyPlaylist} from '@dj/shared-types'

import {useCallback, useRef, useState} from 'react'

import {useSpotifyAuth} from '../../hooks/useSpotifyAuth'
import styles from './DJPage.module.css'

interface PlaylistPickerProps {
  onSelect: (playlist: SpotifyPlaylist) => void
  selected: null | SpotifyPlaylist
}

export function PlaylistPicker({onSelect, selected}: PlaylistPickerProps) {
  const {token} = useSpotifyAuth()
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<null | string>(null)
  const hasLoadedRef = useRef<boolean | null>(null)

  // Load playlists once (component body, no useEffect)
  /* eslint-disable react-hooks/refs -- intentional: one-time fetch initialization in hook body per React 19 project guidelines (no useEffect) */
  if (token && hasLoadedRef.current === null) {
    hasLoadedRef.current = true
    fetch('/api/spotify/playlists', {
      headers: {Authorization: `Bearer ${token}`},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load playlists')
        const data = (await res.json()) as {items?: SpotifyPlaylist[]}
        setPlaylists(data.items ?? [])
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load')
        setLoading(false)
      })
  }
  /* eslint-enable react-hooks/refs */

  const handleSelect = useCallback(
    (playlist: SpotifyPlaylist) => {
      onSelect(playlist)
    },
    [onSelect],
  )

  if (loading) {
    return (
      <div className={styles.pickerLoading}>Loading your playlists...</div>
    )
  }

  if (error) {
    return (
      <div className={styles.pickerError}>{error}</div>
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
