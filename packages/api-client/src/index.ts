import type {
  Playlist,
  GeneratePlaylistRequest,
  GeneratePlaylistResponse,
  SavePlaylistRequest,
  SavePlaylistResponse,
  SpotifyAuthResponse,
  ChatRequest,
  ChatResponse,
  ApiError
} from '@dj/shared-types';

export class DJApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
    this.token = localStorage.getItem('spotify_token');
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('spotify_token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('spotify_token');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {})
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: response.statusText,
        status: response.status
      }));
      throw new Error(error.error || `Request failed: ${response.status}`);
    }

    return response.json();
  }

  async getSpotifyAuthUrl(): Promise<SpotifyAuthResponse> {
    return this.request<SpotifyAuthResponse>('/spotify/auth-url');
  }

  async generatePlaylist(prompt: string): Promise<GeneratePlaylistResponse> {
    return this.request<GeneratePlaylistResponse>('/playlist/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt } as GeneratePlaylistRequest)
    });
  }

  async savePlaylistToSpotify(playlist: Playlist): Promise<SavePlaylistResponse> {
    if (!this.token) {
      throw new Error('Not authenticated with Spotify');
    }

    return this.request<SavePlaylistResponse>('/playlist/save', {
      method: 'POST',
      body: JSON.stringify({ playlist } as SavePlaylistRequest)
    });
  }

  async searchSpotify(query: string, type: string = 'track') {
    return this.request(`/spotify/search`, {
      method: 'POST',
      body: JSON.stringify({ query, type })
    });
  }

  async sendChatMessage(chatRequest: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>('/chat/message', {
      method: 'POST',
      body: JSON.stringify(chatRequest)
    });
  }
}

// Export a singleton instance for convenience
export const apiClient = new DJApiClient(
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8787/api'
    : '/api'
);