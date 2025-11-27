/**
 * API client for Mix Session (Live DJ Mode)
 * Handles all communication with /api/mix/* endpoints
 */

import type {
  AddToQueueResponse,
  EndMixResponse,
  GetMixSessionResponse,
  GetSuggestionsResponse,
  MixSession,
  QueuedTrack,
  RemoveFromQueueResponse,
  ReorderQueueResponse,
  SessionPreferences,
  StartMixResponse,
  SteerVibeResponse,
  Suggestion,
  UpdateVibeResponse,
  VibeProfile,
} from '@dj/shared-types'

/**
 * Get Spotify token from localStorage
 * @returns Token string or null
 */
function getSpotifyToken(): null | string {
  if (typeof window === 'undefined') {
    return null
  }

  const tokenDataStr = localStorage.getItem('spotify_token_data')
  if (!tokenDataStr) {
    return null
  }

  try {
    const tokenData = JSON.parse(tokenDataStr) as {expiresAt: null | number; token: string}
    return tokenData.token
  } catch {
    return null
  }
}

/**
 * Handle API response with error checking
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // Handle 401 specially
    if (response.status === 401) {
      // Redirect to login
      window.location.href = '/login'
      throw new Error('Authentication required')
    }

    // Try to get error details
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.slice(0, 300)}` : ''}`,
    )
  }

  return response.json() as Promise<T>
}

/**
 * Mix API Client
 * Provides methods for all mix session operations
 */
export const mixApiClient = {
  // ===== Session Management =====

  /**
   * Start a new mix session
   * @param preferences Optional session preferences
   * @param seedPlaylistId Optional playlist to seed the session
   * @returns MixSession object
   */
  async startSession(preferences?: SessionPreferences, seedPlaylistId?: string): Promise<MixSession> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/mix/start', {
      body: JSON.stringify({
        preferences,
        seedPlaylistId,
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    const data = await handleResponse<StartMixResponse>(response)
    return data.session
  },

  /**
   * Get current mix session
   * @returns MixSession or null if no active session
   */
  async getCurrentSession(): Promise<MixSession | null> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/mix/current', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      method: 'GET',
    })

    const data = await handleResponse<GetMixSessionResponse>(response)
    return data.session
  },

  /**
   * End the current mix session
   * @returns Session statistics
   */
  async endSession(): Promise<EndMixResponse> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/mix/end', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      method: 'POST',
    })

    return handleResponse<EndMixResponse>(response)
  },

  // ===== Queue Management =====

  /**
   * Get current queue
   * @returns Array of queued tracks
   */
  async getQueue(): Promise<QueuedTrack[]> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/mix/queue', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      method: 'GET',
    })

    const data = await handleResponse<{queue: QueuedTrack[]}>(response)
    return data.queue
  },

  /**
   * Add a track to the queue
   * @param trackUri Spotify track URI
   * @param position Optional position in queue (default: end)
   * @returns Updated queue
   */
  async addToQueue(trackUri: string, position?: number): Promise<QueuedTrack[]> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/mix/queue/add', {
      body: JSON.stringify({
        position,
        trackUri,
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    const data = await handleResponse<AddToQueueResponse>(response)
    return data.queue
  },

  /**
   * Remove a track from the queue
   * @param position Position in queue to remove
   * @returns Updated queue
   */
  async removeFromQueue(position: number): Promise<QueuedTrack[]> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch(`/api/mix/queue/${position}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      method: 'DELETE',
    })

    const data = await handleResponse<RemoveFromQueueResponse>(response)
    return data.queue
  },

  /**
   * Reorder queue (move track from one position to another)
   * @param from Source position
   * @param to Destination position
   * @returns Updated queue
   */
  async reorderQueue(from: number, to: number): Promise<QueuedTrack[]> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/mix/queue/reorder', {
      body: JSON.stringify({
        from,
        to,
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    })

    const data = await handleResponse<ReorderQueueResponse>(response)
    return data.queue
  },

  // ===== Vibe Management =====

  /**
   * Get current vibe profile
   * @returns Current vibe profile
   */
  async getVibe(): Promise<VibeProfile> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/mix/vibe', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      method: 'GET',
    })

    const data = await handleResponse<{vibe: VibeProfile}>(response)
    return data.vibe
  },

  /**
   * Update vibe profile with specific values
   * @param updates Partial vibe profile updates
   * @returns Updated vibe profile
   */
  async updateVibe(updates: Partial<VibeProfile>): Promise<VibeProfile> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/mix/vibe', {
      body: JSON.stringify(updates),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    })

    const data = await handleResponse<UpdateVibeResponse>(response)
    return data.vibe
  },

  /**
   * Steer vibe using natural language
   * @param direction Natural language direction (e.g., "more energetic", "slower")
   * @param intensity Intensity of change (1-10, default 5)
   * @returns Updated vibe profile and applied changes
   */
  async steerVibe(direction: string, intensity?: number): Promise<SteerVibeResponse> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/mix/vibe/steer', {
      body: JSON.stringify({
        direction,
        intensity: intensity ?? 5,
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    return handleResponse<SteerVibeResponse>(response)
  },

  // ===== Suggestions =====

  /**
   * Get track suggestions based on current session
   * @returns Array of suggested tracks
   */
  async getSuggestions(): Promise<Suggestion[]> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/mix/suggestions', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      method: 'GET',
    })

    const data = await handleResponse<GetSuggestionsResponse>(response)
    return data.suggestions
  },

  // ===== Save =====

  /**
   * Save the current mix as a Spotify playlist
   * @param name Playlist name
   * @param description Optional playlist description
   * @returns Playlist ID and URL
   */
  async saveMixAsPlaylist(
    name: string,
    description?: string,
  ): Promise<{playlistId: string; playlistUrl: string}> {
    const token = getSpotifyToken()
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetch('/api/mix/save', {
      body: JSON.stringify({
        description,
        includeQueue: true,
        name,
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    const data = await handleResponse<{playlistId?: string; playlistUrl?: string; success: boolean}>(response)

    if (!data.success || !data.playlistId || !data.playlistUrl) {
      throw new Error('Failed to save playlist')
    }

    return {
      playlistId: data.playlistId,
      playlistUrl: data.playlistUrl,
    }
  },
}
