export interface Playlist {
  id?: string;
  name: string;
  description: string;
  tracks: Track[];
  spotifyId?: string;
  externalUrl?: string;
}

export interface Track {
  id?: string;
  name: string;
  artist: string;
  query: string;
  spotifyId?: string;
  spotifyUri?: string;
  previewUrl?: string;
  externalUrl?: string;
}

export interface GeneratePlaylistRequest {
  prompt: string;
}

export interface GeneratePlaylistResponse {
  playlist: Playlist;
}

export interface SavePlaylistRequest {
  playlist: Playlist;
}

export interface SavePlaylistResponse {
  success: boolean;
  playlistId?: string;
  playlistUrl?: string;
  error?: string;
}

export interface SpotifyAuthResponse {
  url: string;
}

export interface SpotifySearchRequest {
  query: string;
  type?: 'track' | 'album' | 'artist';
}

export interface ApiError {
  error: string;
  status?: number;
  details?: unknown;
}

export interface WebhookEvent {
  type: string;
  timestamp: number;
  payload: unknown;
  signature?: string;
}

export interface SpotifyWebhookPayload {
  event: 'playlist.created' | 'playlist.updated' | 'playlist.deleted';
  playlistId: string;
  userId: string;
  timestamp: string;
}

// Chat interfaces
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  conversationHistory?: ChatMessage[];
}

export interface ChatResponse {
  message: string;
  playlist?: Playlist;
  playlistModified?: boolean;
  conversationHistory: ChatMessage[];
}

// Spotify API response types
export interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
  album: {
    id: string;
    name: string;
    images: Array<{ url: string; height: number; width: number }>;
  };
  preview_url: string | null;
  external_urls: { spotify: string };
  uri: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  external_urls: { spotify: string };
  images: Array<{ url: string; height: number; width: number }>;
  tracks: { total: number };
  public: boolean;
  owner: { display_name: string };
}

export interface SpotifyAudioFeatures {
  id: string;
  danceability: number;
  energy: number;
  valence: number;
  tempo: number;
  acousticness: number;
  instrumentalness: number;
  speechiness: number;
  liveness: number;
  loudness: number;
  key: number;
  mode: number;
}

export interface SpotifyUser {
  id: string;
  display_name: string;
  email?: string;
  images: Array<{ url: string; height: number; width: number }>;
}

// Streaming types
export interface StreamToolData {
  tool: string;
  args: Record<string, unknown>;
}

export interface StreamToolResult {
  tool: string;
  result: unknown;
}

export interface StreamDebugData {
  [key: string]: unknown;
}

export interface StreamLogData {
  level: 'info' | 'warn' | 'error';
  message: string;
}