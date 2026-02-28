/**
 * Player API Client - Controls Spotify playback via backend proxy
 */

import {storage, STORAGE_KEYS} from '../hooks/useLocalStorage'

function getSpotifyToken(): null | string {
  const tokenData = storage.get<null | {expiresAt: null | number; token: string;}>(
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
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({error: 'Request failed'}))
    throw new Error(error.error ?? 'Request failed')
  }

  return response.json()
}

export const playerApiClient = {
  /**
   * Skip to next track
   */
  async next(): Promise<{success: boolean}> {
    return playerRequest('/next', 'POST')
  },

  /**
   * Pause playback
   */
  async pause(): Promise<{success: boolean}> {
    return playerRequest('/pause', 'POST')
  },

  /**
   * Start or resume playback
   */
  async play(): Promise<{success: boolean}> {
    return playerRequest('/play', 'POST')
  },

  /**
   * Go to previous track
   */
  async previous(): Promise<{success: boolean}> {
    return playerRequest('/previous', 'POST')
  },

  /**
   * Seek to position
   */
  async seek(positionMs: number): Promise<{success: boolean}> {
    return playerRequest('/seek', 'POST', {position_ms: positionMs})
  },

  /**
   * Set volume (0-100)
   */
  async setVolume(volumePercent: number): Promise<{success: boolean; volume_percent: number}> {
    return playerRequest('/volume', 'PUT', {volume_percent: volumePercent})
  },
}
