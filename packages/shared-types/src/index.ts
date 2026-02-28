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

export interface GeneratePlaylistRequest {
  prompt: string
}

export interface GeneratePlaylistResponse {
  playlist: Playlist
}

export interface Playlist {
  description: string
  externalUrl?: string
  id?: string
  name: string
  spotifyId?: string
  tracks: Track[]
}

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

// ===== Playback Stream Protocol (Delta-based SSE) =====

/** Repeat mode states */
export type RepeatState = 'off' | 'track' | 'context'

/** Device type from Spotify */
export type DeviceType = 'computer' | 'smartphone' | 'speaker' | 'tv' | 'avr' | 'stb' | 'audio_dongle' | 'game_console' | 'cast_video' | 'cast_audio' | 'automobile' | 'unknown'

/** Playback context type */
export type ContextType = 'album' | 'artist' | 'playlist' | 'show' | 'collection'

/** Currently playing item type */
export type PlayingType = 'track' | 'episode' | 'ad' | 'unknown'

/** Track info in playback stream */
export interface PlaybackTrack {
  id: string
  uri: string
  name: string
  artist: string
  albumArt: string | null
  albumName: string
  duration: number
  explicit: boolean
  popularity: number
  isLocal: boolean
  previewUrl: string | null
}

/** Device info in playback stream */
export interface PlaybackDevice {
  id: string | null
  name: string
  type: DeviceType
  volumePercent: number | null
  supportsVolume: boolean
  isPrivateSession: boolean
  isRestricted: boolean
}

/** Playback context (what's being played from) */
export interface PlaybackContext {
  type: ContextType
  uri: string
  name: string | null
  href: string | null
}

/** Playback modes (shuffle/repeat) */
export interface PlaybackModes {
  shuffle: boolean
  repeat: RepeatState
}

/** Full playback state (sent on init) */
export interface PlaybackStateInit {
  track: PlaybackTrack | null
  device: PlaybackDevice
  context: PlaybackContext | null
  modes: PlaybackModes
  playingType: PlayingType
  isPlaying: boolean
  progress: number
  timestamp: number
  seq: number
}

/** Tick event - minimal progress update */
export interface PlaybackTickEvent {
  /** Progress in milliseconds */
  p: number
  /** Server timestamp */
  ts: number
}

/** State change event (play/pause) */
export interface PlaybackStateEvent {
  isPlaying: boolean
  seq: number
}

/** Track change event */
export interface PlaybackTrackEvent extends PlaybackTrack {
  seq: number
}

/** Device change event */
export interface PlaybackDeviceEvent extends PlaybackDevice {
  seq: number
}

/** Modes change event (shuffle/repeat) */
export interface PlaybackModesEvent extends PlaybackModes {
  seq: number
}

/** Volume change event */
export interface PlaybackVolumeEvent {
  percent: number
  seq: number
}

/** Context change event */
export interface PlaybackContextEvent {
  context: PlaybackContext | null
  seq: number
}

/** Idle event (no active playback) */
export interface PlaybackIdleEvent {
  seq: number
}

/** All possible playback stream event types */
export type PlaybackStreamEventType =
  | 'init'
  | 'tick'
  | 'state'
  | 'track'
  | 'device'
  | 'modes'
  | 'volume'
  | 'context'
  | 'idle'
  | 'error'
  | 'reconnect'
  | 'connected'

// ===== Zod Schemas and Validation =====
// Export all Zod schemas for runtime validation

export * from './schemas/api-schemas'
export * from './schemas/auth-schemas'
export * from './schemas/external-api-schemas'
export * from './schemas/llm-response-schemas'
export * from './schemas/mix-session-schemas'
export * from './schemas/playback-event-schemas'
export * from './schemas/spotify-schemas'
export * from './schemas/sse-schemas'

// ===== Utilities =====
export {PromiseTracker} from './promise-tracker'
export {createTypeGuard, formatZodError, parse, parseJsonResponse, safeParse, safeParseJsonResponse} from './validation'
export type {SafeParseResult} from './validation'
