/**
 * Zod schemas for internal API requests and responses
 * Provides validation for client-server communication
 */

import {z} from 'zod'

import {SpotifyPlaylistSimpleSchema} from './spotify-schemas'

// ===== Error Response =====

export const ApiErrorSchema = z.object({
  details: z.unknown().optional(),
  error: z.string(),
  status: z.number().optional(),
})

// ===== Chat Types =====

export const ChatMessageSchema = z.object({
  content: z.string(),
  role: z.enum(['assistant', 'user']),
})

export const ChatRequestSchema = z.object({
  conversationHistory: z.array(ChatMessageSchema).optional(),
  message: z.string().min(1),
  mode: z.enum(['analyze', 'create', 'edit']).optional(),
})

export const ChatResponseSchema = z.object({
  conversationHistory: z.array(ChatMessageSchema),
  message: z.string(),
  playlist: z.unknown().optional(), // Will reference PlaylistSchema
  playlistModified: z.boolean().optional(),
})

// ===== Playlist Types =====

export const TrackSchema = z.object({
  artist: z.string(),
  externalUrl: z.string().url().optional(),
  id: z.string().optional(),
  name: z.string(),
  previewUrl: z.string().url().optional(),
  query: z.string(),
  spotifyId: z.string().optional(),
  spotifyUri: z.string().optional(),
})

export const PlaylistSchema = z.object({
  description: z.string(),
  externalUrl: z.string().url().optional(),
  id: z.string().optional(),
  name: z.string(),
  spotifyId: z.string().optional(),
  tracks: z.array(TrackSchema),
})

export const GeneratePlaylistRequestSchema = z.object({
  prompt: z.string().min(1),
})

export const GeneratePlaylistResponseSchema = z.object({
  playlist: PlaylistSchema,
})

export const SavePlaylistRequestSchema = z.object({
  playlist: PlaylistSchema,
})

export const SavePlaylistResponseSchema = z.object({
  error: z.string().optional(),
  playlistId: z.string().optional(),
  playlistUrl: z.string().url().optional(),
  success: z.boolean(),
})

// ===== Spotify Auth =====

export const SpotifyAuthResponseSchema = z.object({
  url: z.string().url(),
})

// ===== Search =====

export const SpotifySearchRequestSchema = z.object({
  query: z.string().min(1),
  type: z.enum(['album', 'artist', 'track']).optional(),
})

// ===== User Playlists Response =====

export const UserPlaylistsResponseSchema = z.object({
  items: z.array(SpotifyPlaylistSimpleSchema).optional(),
})

// ===== Webhook Types =====

export const SpotifyWebhookPayloadSchema = z.object({
  event: z.enum(['playlist.created', 'playlist.deleted', 'playlist.updated']),
  playlistId: z.string(),
  timestamp: z.string(),
  userId: z.string(),
})

export const WebhookEventSchema = z.object({
  payload: z.unknown(),
  signature: z.string().optional(),
  timestamp: z.number(),
  type: z.string(),
})

// ===== Type Exports =====

export type ApiError = z.infer<typeof ApiErrorSchema>

export type ChatMessage = z.infer<typeof ChatMessageSchema>
export type ChatRequest = z.infer<typeof ChatRequestSchema>
export type ChatResponse = z.infer<typeof ChatResponseSchema>

export type GeneratePlaylistRequest = z.infer<typeof GeneratePlaylistRequestSchema>
export type GeneratePlaylistResponse = z.infer<typeof GeneratePlaylistResponseSchema>
export type Playlist = z.infer<typeof PlaylistSchema>
export type SavePlaylistRequest = z.infer<typeof SavePlaylistRequestSchema>
export type SavePlaylistResponse = z.infer<typeof SavePlaylistResponseSchema>
export type SpotifyAuthResponse = z.infer<typeof SpotifyAuthResponseSchema>

export type SpotifySearchRequest = z.infer<typeof SpotifySearchRequestSchema>
export type SpotifyWebhookPayload = z.infer<typeof SpotifyWebhookPayloadSchema>

export type Track = z.infer<typeof TrackSchema>

export type UserPlaylistsResponse = z.infer<typeof UserPlaylistsResponseSchema>
export type WebhookEvent = z.infer<typeof WebhookEventSchema>
