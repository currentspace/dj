import type { Playlist } from '@dj/shared-types'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787/api' : '/api'

export async function generatePlaylist(prompt: string) {
  const token = localStorage.getItem('spotify_token')

  const response = await fetch(`${API_BASE}/playlist/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    },
    body: JSON.stringify({ prompt })
  })

  if (!response.ok) {
    throw new Error(`Failed to generate playlist: ${response.statusText}`)
  }

  return response.json()
}

export async function savePlaylistToSpotify(playlist: Playlist) {
  const token = localStorage.getItem('spotify_token')

  if (!token) {
    throw new Error('Not authenticated with Spotify')
  }

  const response = await fetch(`${API_BASE}/playlist/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ playlist })
  })

  if (!response.ok) {
    throw new Error(`Failed to save playlist: ${response.statusText}`)
  }

  return response.json()
}