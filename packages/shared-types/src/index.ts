export interface ApiError {
  details?: unknown;
  error: string;
  status?: number;
}

// Chat interfaces
export interface ChatMessage {
  content: string;
  role: 'assistant' | 'user';
}

export interface ChatRequest {
  conversationHistory?: ChatMessage[];
  message: string;
}

export interface ChatResponse {
  conversationHistory: ChatMessage[];
  message: string;
  playlist?: Playlist;
  playlistModified?: boolean;
}

export interface GeneratePlaylistRequest {
  prompt: string;
}

export interface GeneratePlaylistResponse {
  playlist: Playlist;
}

export interface Playlist {
  description: string;
  externalUrl?: string;
  id?: string;
  name: string;
  spotifyId?: string;
  tracks: Track[];
}

export interface SavePlaylistRequest {
  playlist: Playlist;
}

export interface SavePlaylistResponse {
  error?: string;
  playlistId?: string;
  playlistUrl?: string;
  success: boolean;
}

export interface SpotifyAudioFeatures {
  acousticness: number;
  danceability: number;
  energy: number;
  id: string;
  instrumentalness: number;
  key: number;
  liveness: number;
  loudness: number;
  mode: number;
  speechiness: number;
  tempo: number;
  valence: number;
}

export interface SpotifyAuthResponse {
  url: string;
}

export interface SpotifyPlaylist {
  description: string;
  external_urls: { spotify: string };
  id: string;
  images: { height: number; url: string; width: number }[];
  name: string;
  owner: { display_name: string };
  public: boolean;
  tracks: { total: number };
}

export interface SpotifySearchRequest {
  query: string;
  type?: 'album' | 'artist' | 'track';
}

// Spotify API response types
export interface SpotifyTrack {
  album: {
    id: string;
    images: { height: number; url: string; width: number }[];
    name: string;
  };
  artists: { id: string; name: string }[];
  external_urls: { spotify: string };
  id: string;
  name: string;
  preview_url: null | string;
  uri: string;
}

export interface SpotifyUser {
  display_name: string;
  email?: string;
  id: string;
  images: { height: number; url: string; width: number }[];
}

export interface SpotifyWebhookPayload {
  event: 'playlist.created' | 'playlist.deleted' | 'playlist.updated';
  playlistId: string;
  timestamp: string;
  userId: string;
}

export type StreamDebugData = Record<string, unknown>;

export interface StreamLogData {
  level: 'error' | 'info' | 'warn';
  message: string;
}

// Streaming types
export interface StreamToolData {
  args: Record<string, unknown>;
  tool: string;
}

export interface StreamToolResult {
  result: unknown;
  tool: string;
}

export interface Track {
  artist: string;
  externalUrl?: string;
  id?: string;
  name: string;
  previewUrl?: string;
  query: string;
  spotifyId?: string;
  spotifyUri?: string;
}

export interface WebhookEvent {
  payload: unknown;
  signature?: string;
  timestamp: number;
  type: string;
}

// ===== Zod Schemas and Validation =====
// Export all Zod schemas for runtime validation

export * from './validation';
export * from './schemas/spotify-schemas';
export * from './schemas/external-api-schemas';
export * from './schemas/sse-schemas';
export * from './schemas/api-schemas';