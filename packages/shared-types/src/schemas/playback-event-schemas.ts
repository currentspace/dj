/**
 * Zod schemas for Playback Stream SSE events (delta-based protocol v2)
 *
 * These schemas validate the real-time playback state updates sent over SSE.
 * Every event parsed from the playback stream should be validated through these schemas.
 */

import {z} from 'zod'

// ===== Enums =====

export const RepeatStateSchema = z.enum(['off', 'track', 'context'])

export const DeviceTypeSchema = z.enum([
  'computer',
  'smartphone',
  'speaker',
  'tv',
  'avr',
  'stb',
  'audio_dongle',
  'game_console',
  'cast_video',
  'cast_audio',
  'automobile',
  'unknown',
])

export const ContextTypeSchema = z.enum(['album', 'artist', 'playlist', 'show', 'collection'])

export const PlayingTypeSchema = z.enum(['track', 'episode', 'ad', 'unknown'])

// ===== Component Schemas =====

export const PlaybackTrackSchema = z.object({
  id: z.string(),
  uri: z.string(),
  name: z.string(),
  artist: z.string(),
  albumArt: z.string().nullable(),
  albumName: z.string(),
  duration: z.number(),
  explicit: z.boolean(),
  popularity: z.number(),
  isLocal: z.boolean(),
  previewUrl: z.string().nullable(),
})

export const PlaybackDeviceSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  type: DeviceTypeSchema,
  volumePercent: z.number().nullable(),
  supportsVolume: z.boolean(),
  isPrivateSession: z.boolean(),
  isRestricted: z.boolean(),
})

export const PlaybackContextSchema = z.object({
  type: ContextTypeSchema,
  uri: z.string(),
  name: z.string().nullable(),
  href: z.string().nullable(),
})

export const PlaybackModesSchema = z.object({
  shuffle: z.boolean(),
  repeat: RepeatStateSchema,
})

// ===== Event Schemas =====

export const PlaybackStateInitSchema = z.object({
  track: PlaybackTrackSchema.nullable(),
  device: PlaybackDeviceSchema,
  context: PlaybackContextSchema.nullable(),
  modes: PlaybackModesSchema,
  playingType: PlayingTypeSchema,
  isPlaying: z.boolean(),
  progress: z.number(),
  timestamp: z.number(),
  seq: z.number(),
})

export const PlaybackTickEventSchema = z.object({
  p: z.number(),
  ts: z.number(),
})

export const PlaybackTrackEventSchema = PlaybackTrackSchema.extend({
  seq: z.number(),
})

export const PlaybackStateEventSchema = z.object({
  isPlaying: z.boolean(),
  seq: z.number(),
})

export const PlaybackDeviceEventSchema = PlaybackDeviceSchema.extend({
  seq: z.number(),
})

export const PlaybackModesEventSchema = PlaybackModesSchema.extend({
  seq: z.number(),
})

export const PlaybackVolumeEventSchema = z.object({
  percent: z.number(),
  seq: z.number(),
})

export const PlaybackContextEventSchema = z.object({
  context: PlaybackContextSchema.nullable(),
  seq: z.number(),
})

export const PlaybackIdleEventSchema = z.object({
  seq: z.number(),
})

export const PlaybackConnectedEventSchema = z.object({
  message: z.string().optional(),
})

export const PlaybackErrorEventSchema = z.object({
  message: z.string().optional(),
  retriesRemaining: z.number().optional(),
})

// ===== Type Exports =====

export type PlaybackStateInitData = z.infer<typeof PlaybackStateInitSchema>
export type PlaybackTickEventData = z.infer<typeof PlaybackTickEventSchema>
export type PlaybackTrackEventData = z.infer<typeof PlaybackTrackEventSchema>
export type PlaybackStateEventData = z.infer<typeof PlaybackStateEventSchema>
export type PlaybackDeviceEventData = z.infer<typeof PlaybackDeviceEventSchema>
export type PlaybackModesEventData = z.infer<typeof PlaybackModesEventSchema>
export type PlaybackVolumeEventData = z.infer<typeof PlaybackVolumeEventSchema>
export type PlaybackContextEventData = z.infer<typeof PlaybackContextEventSchema>
export type PlaybackIdleEventData = z.infer<typeof PlaybackIdleEventSchema>
