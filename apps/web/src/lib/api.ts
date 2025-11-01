import type { Playlist } from '@dj/shared-types'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787/api' : '/api'

export async function generatePlaylist(prompt: string) {
  const token = localStorage.getItem('spotify_token')

  const response = await fetch(`${API_BASE}/playlist/generate`, {
    body: JSON.stringify({ prompt }),
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    },
    method: 'POST'
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
    body: JSON.stringify({ playlist }),
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  })

  if (!response.ok) {
    throw new Error(`Failed to save playlist: ${response.statusText}`)
  }

  return response.json()
}