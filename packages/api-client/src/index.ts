import type {
  ApiError,
  ChatRequest,
  ChatResponse,
  GeneratePlaylistRequest,
  GeneratePlaylistResponse,
  Playlist,
  SavePlaylistRequest,
  SavePlaylistResponse,
  SpotifyAuthResponse,
} from '@dj/shared-types'

// Export type-safe fetch utilities
export {createApiClient, createTypedFetch} from './typed-fetch'
export type {ApiClientConfig} from './typed-fetch'

export class DJApiClient {
  private baseUrl: string
  private token: null | string = null

  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl
    this.token = localStorage.getItem('spotify_token')
  }

  clearToken() {
    this.token = null
    localStorage.removeItem('spotify_token')
  }

  async generatePlaylist(prompt: string): Promise<GeneratePlaylistResponse> {
    return this.request<GeneratePlaylistResponse>('/playlist/generate', {
      body: JSON.stringify({prompt} as GeneratePlaylistRequest),
      method: 'POST',
    })
  }

  async getSpotifyAuthUrl(): Promise<SpotifyAuthResponse> {
    return this.request<SpotifyAuthResponse>('/spotify/auth-url')
  }

  async savePlaylistToSpotify(playlist: Playlist): Promise<SavePlaylistResponse> {
    if (!this.token) {
      throw new Error('Not authenticated with Spotify')
    }

    return this.request<SavePlaylistResponse>('/playlist/save', {
      body: JSON.stringify({playlist} as SavePlaylistRequest),
      method: 'POST',
    })
  }

  async searchSpotify(query: string, type = 'track') {
    return this.request(`/spotify/search`, {
      body: JSON.stringify({query, type}),
      method: 'POST',
    })
  }

  async sendChatMessage(chatRequest: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>('/chat/message', {
      body: JSON.stringify(chatRequest),
      method: 'POST',
    })
  }

  setToken(token: string) {
    this.token = token
    localStorage.setItem('spotify_token', token)
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: response.statusText,
        status: response.status,
      }))
      throw new Error(error.error || `Request failed: ${response.status}`)
    }

    return response.json()
  }
}

// Export a singleton instance for convenience
export const apiClient = new DJApiClient(
  typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:8787/api' : '/api',
)
