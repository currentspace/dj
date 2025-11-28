/**
 * Type-safe API client for Mix Session (Live DJ Mode)
 *
 * Uses route definitions from @dj/api-contracts to ensure:
 * - Paths are compile-time checked
 * - HTTP methods are enforced
 * - Request/response types match schemas
 *
 * If a route path or method changes in the contract, this file
 * will fail to compile, preventing runtime mismatches.
 */

import type {
  MixSession,
  QueuedTrack,
  QueueToSpotifyResponse,
  SessionPreferences,
  SteerVibeResponse,
  Suggestion,
  TrackPlayedResponse,
  VibeProfile,
} from '@dj/shared-types'

import {createApiClient} from '@dj/api-client'
import {
  addToQueue,
  endMix,
  getCurrentMix,
  getQueue,
  getSuggestions,
  getVibe,
  queueToSpotify,
  removeFromQueue,
  reorderQueue,
  saveMix,
  startMix,
  steerVibe,
  trackPlayed,
  updateVibe,
} from '@dj/api-contracts'

import {storage, STORAGE_KEYS} from '../hooks/useLocalStorage'

/**
 * Get Spotify token from centralized storage
 */
function getSpotifyToken(): null | string {
  const tokenData = storage.get<null | {expiresAt: null | number; token: string}>(
    STORAGE_KEYS.SPOTIFY_TOKEN_DATA,
    null,
  )
  return tokenData?.token ?? null
}

/**
 * Create type-safe API client with auth handling
 */
const api = createApiClient({
  getAuthToken: getSpotifyToken,
  onUnauthorized: () => {
    window.location.href = '/login'
  },
})

/**
 * Mix API Client
 *
 * All methods use route definitions from @dj/api-contracts, which means:
 * - Path strings come directly from the contract (e.g., startMix.path = '/api/mix/start')
 * - HTTP methods come from the contract (e.g., startMix.method = 'post')
 * - Request/response types are inferred from the Zod schemas
 *
 * If the contract changes, TypeScript will catch any mismatches at compile time.
 */
export const mixApiClient = {
  // ===== Session Management =====

  /**
   * Add a track to the queue
   * Route: POST /api/mix/queue/add (from addToQueue contract)
   */
  async addToQueue(trackUri: string, position?: number): Promise<QueuedTrack[]> {
    const response = await api(addToQueue)({
      body: {position, trackUri},
    })
    return response.queue
  },

  /**
   * End the current mix session
   * Route: POST /api/mix/end (from endMix contract)
   */
  async endSession() {
    return api(endMix)()
  },

  /**
   * Get current mix session
   * Route: GET /api/mix/current (from getCurrentMix contract)
   */
  async getCurrentSession(): Promise<MixSession | null> {
    const response = await api(getCurrentMix)()
    return response.session
  },

  // ===== Queue Management =====

  /**
   * Get current queue
   * Route: GET /api/mix/queue (from getQueue contract)
   */
  async getQueue(): Promise<QueuedTrack[]> {
    const response = await api(getQueue)()
    return response.queue
  },

  /**
   * Get track suggestions based on current session
   * Route: GET /api/mix/suggestions (from getSuggestions contract)
   */
  async getSuggestions(): Promise<Suggestion[]> {
    const response = await api(getSuggestions)()
    return response.suggestions
  },

  /**
   * Get current vibe profile
   * Route: GET /api/mix/vibe (from getVibe contract)
   */
  async getVibe(): Promise<VibeProfile> {
    const response = await api(getVibe)()
    return response.vibe
  },

  /**
   * Remove a track from the queue
   * Route: DELETE /api/mix/queue/{position} (from removeFromQueue contract)
   */
  async removeFromQueue(position: number): Promise<QueuedTrack[]> {
    const response = await api(removeFromQueue)({
      pathParams: {position},
    })
    return response.queue
  },

  // ===== Vibe Management =====

  /**
   * Reorder queue (move track from one position to another)
   * Route: PUT /api/mix/queue/reorder (from reorderQueue contract)
   */
  async reorderQueue(from: number, to: number): Promise<QueuedTrack[]> {
    const response = await api(reorderQueue)({
      body: {from, to},
    })
    return response.queue
  },

  /**
   * Save the current mix as a Spotify playlist
   * Route: POST /api/mix/save (from saveMix contract)
   */
  async saveMixAsPlaylist(
    name: string,
    description?: string,
  ): Promise<{playlistId: string; playlistUrl: string}> {
    const response = await api(saveMix)({
      body: {description, includeQueue: true, name},
    })

    if (!response.success || !response.playlistId || !response.playlistUrl) {
      throw new Error('Failed to save playlist')
    }

    return {
      playlistId: response.playlistId,
      playlistUrl: response.playlistUrl,
    }
  },

  /**
   * Start a new mix session
   * Route: POST /api/mix/start (from startMix contract)
   */
  async startSession(preferences?: SessionPreferences, seedPlaylistId?: string): Promise<MixSession> {
    const response = await api(startMix)({
      body: {preferences, seedPlaylistId},
    })
    return response.session
  },

  // ===== Suggestions =====

  /**
   * Steer vibe using natural language
   * Route: POST /api/mix/vibe/steer (from steerVibe contract)
   */
  async steerVibe(direction: string, intensity?: number): Promise<SteerVibeResponse> {
    return api(steerVibe)({
      body: {direction, intensity: intensity ?? 5},
    })
  },

  // ===== Save =====

  /**
   * Update vibe profile with specific values
   * Route: PUT /api/mix/vibe (from updateVibe contract)
   */
  async updateVibe(updates: Partial<VibeProfile>): Promise<VibeProfile> {
    const response = await api(updateVibe)({
      body: updates,
    })
    return response.vibe
  },

  // ===== Playback Integration =====

  /**
   * Notify that a track was played (track changed)
   * Route: POST /api/mix/playback/track-played (from trackPlayed contract)
   */
  async notifyTrackPlayed(trackId: string, trackUri: string): Promise<TrackPlayedResponse> {
    return api(trackPlayed)({
      body: {trackId, trackUri},
    })
  },

  /**
   * Add a track to Spotify's playback queue
   * Route: POST /api/mix/queue/spotify (from queueToSpotify contract)
   */
  async queueToSpotify(trackUri: string): Promise<QueueToSpotifyResponse> {
    return api(queueToSpotify)({
      body: {trackUri},
    })
  },
}
