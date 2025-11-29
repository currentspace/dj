/**
 * Player API Client - Controls Spotify playback via backend proxy
 */

import {storage, STORAGE_KEYS} from '../hooks/useLocalStorage'

function getSpotifyToken(): string | null {
  const tokenData = storage.get<{token: string; expiresAt: number | null} | null>(
    STORAGE_KEYS.SPOTIFY_TOKEN_DATA,
    null,
  )
  return tokenData?.token ?? null
}

async function playerRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: Record<string, unknown>,
): Promise<T> {
  const token = getSpotifyToken()
  if (!token) {
    throw new Error('No Spotify token available')
  }

  const response = await fetch(`/api/player${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({error: 'Request failed'}))
    throw new Error(error.error || 'Request failed')
  }

  return response.json()
}

export const playerApiClient = {
  /**
   * Start or resume playback
   */
  async play(): Promise<{success: boolean}> {
    return playerRequest('/play', 'POST')
  },

  /**
   * Pause playback
   */
  async pause(): Promise<{success: boolean}> {
    return playerRequest('/pause', 'POST')
  },

  /**
   * Skip to next track
   */
  async next(): Promise<{success: boolean}> {
    return playerRequest('/next', 'POST')
  },

  /**
   * Go to previous track
   */
  async previous(): Promise<{success: boolean}> {
    return playerRequest('/previous', 'POST')
  },

  /**
   * Set volume (0-100)
   */
  async setVolume(volumePercent: number): Promise<{success: boolean; volume_percent: number}> {
    return playerRequest('/volume', 'PUT', {volume_percent: volumePercent})
  },

  /**
   * Seek to position
   */
  async seek(positionMs: number): Promise<{success: boolean}> {
    return playerRequest('/seek', 'POST', {position_ms: positionMs})
  },
}
