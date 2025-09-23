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