import type { Playlist } from '@dj/shared-types'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787/api' : '/api'

/**
 * Base fetch wrapper that always includes the Spotify token
 */
async function apiFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('spotify_token')

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
    // Always include the Spotify token if available
    ...(token && { 'Authorization': `Bearer ${token}` })
  }

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers
  })

  // Handle common error cases
  if (response.status === 401) {
    // Token expired or invalid
    localStorage.removeItem('spotify_token')
    window.location.href = '/'
    throw new Error('Authentication expired. Please log in again.')
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Request failed: ${response.statusText}`)
  }

  return response
}

/**
 * Chat with the AI DJ assistant
 */
export async function sendChatMessage(
  message: string,
  conversationHistory: Array<{ role: 'user' | 'assistant', content: string }> = [],
  mode: 'analyze' | 'create' | 'edit' = 'analyze'
) {
  const response = await apiFetch('/chat/message', {
    method: 'POST',
    body: JSON.stringify({
      message,
      conversationHistory,
      mode
    })
  })

  return response.json()
}

/**
 * Get user's Spotify playlists
 */
export async function getUserPlaylists() {
  const response = await apiFetch('/spotify/playlists')
  return response.json()
}

/**
 * Search Spotify tracks
 */
export async function searchTracks(query: string) {
  const response = await apiFetch('/spotify/search', {
    method: 'POST',
    body: JSON.stringify({ query, type: 'track' })
  })
  return response.json()
}

/**
 * Generate a playlist (old endpoint - consider migrating to chat)
 */
export async function generatePlaylist(prompt: string) {
  const response = await apiFetch('/playlist/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt })
  })
  return response.json()
}

/**
 * Save playlist to Spotify
 */
export async function savePlaylistToSpotify(playlist: Playlist) {
  const response = await apiFetch('/playlist/save', {
    method: 'POST',
    body: JSON.stringify({ playlist })
  })
  return response.json()
}

/**
 * Create a new Spotify playlist
 */
export async function createPlaylist(
  name: string,
  description?: string,
  trackUris?: string[],
  isPublic = false
) {
  const response = await apiFetch('/spotify/playlists', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      public: isPublic,
      trackUris: trackUris || []
    })
  })
  return response.json()
}

/**
 * Modify an existing playlist
 */
export async function modifyPlaylist(
  playlistId: string,
  action: 'add' | 'remove',
  trackUris: string[]
) {
  const response = await apiFetch('/spotify/playlists/modify', {
    method: 'POST',
    body: JSON.stringify({
      playlistId,
      action,
      trackUris
    })
  })
  return response.json()
}

/**
 * Get tracks from a playlist
 */
export async function getPlaylistTracks(playlistId: string) {
  const response = await apiFetch(`/spotify/playlists/${playlistId}/tracks`)
  return response.json()
}