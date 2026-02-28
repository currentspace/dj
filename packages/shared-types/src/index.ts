export interface ApiError {
  details?: unknown
  error: string
  status?: number
}

// Chat interfaces
export interface ChatMessage {
  content: string
  role: 'assistant' | 'user'
}

export interface ChatRequest {
  conversationHistory?: ChatMessage[]
  message: string
}

export interface ChatResponse {
  conversationHistory: ChatMessage[]
  message: string
  playlist?: Playlist
  playlistModified?: boolean
}

/** Playback context type */
export type ContextType = 'album' | 'artist' | 'collection' | 'playlist' | 'show'

/** Device type from Spotify */
export type DeviceType = 'audio_dongle' | 'automobile' | 'avr' | 'cast_audio' | 'cast_video' | 'computer' | 'game_console' | 'smartphone' | 'speaker' | 'stb' | 'tv' | 'unknown'

export interface GeneratePlaylistRequest {
  prompt: string
}

export interface GeneratePlaylistResponse {
  playlist: Playlist
}

/** Playback context (what's being played from) */
export interface PlaybackContext {
  href: null | string
  name: null | string
  type: ContextType
  uri: string
}

/** Context change event */
export interface PlaybackContextEvent {
  context: null | PlaybackContext
  seq: number
}

/** Device info in playback stream */
export interface PlaybackDevice {
  id: null | string
  isPrivateSession: boolean
  isRestricted: boolean
  name: string
  supportsVolume: boolean
  type: DeviceType
  volumePercent: null | number
}

/** Device change event */
export interface PlaybackDeviceEvent extends PlaybackDevice {
  seq: number
}

/** Idle event (no active playback) */
export interface PlaybackIdleEvent {
  seq: number
}

/** Playback modes (shuffle/repeat) */
export interface PlaybackModes {
  repeat: RepeatState
  shuffle: boolean
}

/** Modes change event (shuffle/repeat) */
export interface PlaybackModesEvent extends PlaybackModes {
  seq: number
}

/** State change event (play/pause) */
export interface PlaybackStateEvent {
  isPlaying: boolean
  seq: number
}

/** Full playback state (sent on init) */
export interface PlaybackStateInit {
  context: null | PlaybackContext
  device: PlaybackDevice
  isPlaying: boolean
  modes: PlaybackModes
  playingType: PlayingType
  progress: number
  seq: number
  timestamp: number
  track: null | PlaybackTrack
}

/** All possible playback stream event types */
export type PlaybackStreamEventType =
  | 'connected'
  | 'context'
  | 'device'
  | 'error'
  | 'idle'
  | 'init'
  | 'modes'
  | 'reconnect'
  | 'state'
  | 'tick'
  | 'track'
  | 'volume'

/** Tick event - minimal progress update */
export interface PlaybackTickEvent {
  /** Progress in milliseconds */
  p: number
  /** Server timestamp */
  ts: number
}

/** Track info in playback stream */
export interface PlaybackTrack {
  albumArt: null | string
  albumName: string
  artist: string
  duration: number
  explicit: boolean
  id: string
  isLocal: boolean
  name: string
  popularity: number
  previewUrl: null | string
  uri: string
}

/** Track change event */
export interface PlaybackTrackEvent extends PlaybackTrack {
  seq: number
}

/** Volume change event */
export interface PlaybackVolumeEvent {
  percent: number
  seq: number
}

// ===== Playback Stream Protocol (Delta-based SSE) =====

/** Currently playing item type */
export type PlayingType = 'ad' | 'episode' | 'track' | 'unknown'

export interface Playlist {
  description: string
  externalUrl?: string
  id?: string
  name: string
  spotifyId?: string
  tracks: Track[]
}

/** Repeat mode states */
export type RepeatState = 'context' | 'off' | 'track'

export interface SavePlaylistRequest {
  playlist: Playlist
}

export interface SavePlaylistResponse {
  error?: string
  playlistId?: string
  playlistUrl?: string
  success: boolean
}

export interface SpotifyAudioFeatures {
  acousticness: number
  danceability: number
  energy: number
  id: string
  instrumentalness: number
  key: number
  liveness: number
  loudness: number
  mode: number
  speechiness: number
  tempo: number
  valence: number
}

export interface SpotifyAuthResponse {
  url: string
}

export interface SpotifyPlaylist {
  description: string
  external_urls: {spotify: string}
  id: string
  images: {height: number; url: string; width: number}[]
  name: string
  owner: {display_name: string}
  public: boolean
  tracks: {total: number}
}

export interface SpotifySearchRequest {
  query: string
  type?: 'album' | 'artist' | 'track'
}

// Spotify API response types
export interface SpotifyTrack {
  album: {
    id: string
    images: {height: number; url: string; width: number}[]
    name: string
  }
  artists: {id: string; name: string}[]
  external_urls: {spotify: string}
  id: string
  name: string
  preview_url: null | string
  uri: string
}

export interface SpotifyUser {
  display_name: string
  email?: string
  id: string
  images: {height: number; url: string; width: number}[]
}

export interface SpotifyWebhookPayload {
  event: 'playlist.created' | 'playlist.deleted' | 'playlist.updated'
  playlistId: string
  timestamp: string
  userId: string
}

export type StreamDebugData = Record<string, unknown>

export interface StreamLogData {
  level: 'debug' | 'error' | 'info' | 'warn'
  message: string
}

// Streaming types
export interface StreamToolData {
  args: Record<string, unknown>
  tool: string
}

export interface StreamToolResult {
  result: unknown
  tool: string
}

export interface Track {
  artist: string
  externalUrl?: string
  id?: string
  name: string
  previewUrl?: string
  query: string
  spotifyId?: string
  spotifyUri?: string
}

export interface WebhookEvent {
  payload: unknown
  signature?: string
  timestamp: number
  type: string
}

// ===== Zod Schemas and Validation =====
// Export all Zod schemas for runtime validation

// ===== Utilities =====
export {PromiseTracker} from './promise-tracker'
export * from './schemas/api-schemas'
export * from './schemas/auth-schemas'
export * from './schemas/external-api-schemas'
export * from './schemas/llm-response-schemas'
export * from './schemas/mix-session-schemas'
export * from './schemas/playback-event-schemas'
export * from './schemas/spotify-schemas'

export * from './schemas/sse-schemas'
export {createTypeGuard, formatZodError, parse, parseJsonResponse, safeParse, safeParseJsonResponse} from './validation'
export type {SafeParseResult} from './validation'
