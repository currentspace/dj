/**
 * Zod schemas for Mix Session (Live DJ Mode)
 * Provides validation for mix sessions, vibe profiles, queues, and history
 */

import {z} from 'zod'

// ===== Vibe Profile =====

export const VibeProfileSchema = z.object({
  bpmRange: z.object({
    max: z.number().min(20).max(220),
    min: z.number().min(20).max(220),
  }).default({max: 140, min: 80}),
  energyDirection: z.enum(['building', 'steady', 'winding_down']).default('steady'),
  energyLevel: z.number().min(1).max(10).default(5),
  era: z.object({
    end: z.number().int().min(1900).max(2100),
    start: z.number().int().min(1900).max(2100),
  }).default({end: 2025, start: 2000}),
  genres: z.array(z.string()).default([]),
  mood: z.array(z.string()).default([]),
})

// ===== Played Track (History) =====

export const PlayedTrackSchema = z.object({
  albumArt: z.string().url().optional(),
  artist: z.string(),
  bpm: z.number().min(20).max(220).nullable(),
  energy: z.number().min(0).max(1).nullable(),
  name: z.string(),
  playedAt: z.string().datetime(),
  trackId: z.string(),
  trackUri: z.string(),
})

// ===== Queued Track =====

export const QueuedTrackSchema = z.object({
  addedBy: z.enum(['user', 'ai']),
  albumArt: z.string().url().optional(),
  artist: z.string(),
  name: z.string(),
  position: z.number().int().min(0),
  reason: z.string().optional(),
  trackId: z.string(),
  trackUri: z.string(),
  vibeScore: z.number().min(0).max(100),
})

// ===== Suggestion =====

export const SuggestionSchema = z.object({
  albumArt: z.string().url().optional(),
  artist: z.string(),
  bpm: z.number().min(20).max(220).nullable(),
  name: z.string(),
  reason: z.string(),
  trackId: z.string(),
  trackUri: z.string(),
  vibeScore: z.number().min(0).max(100),
})

// ===== Conversation Entry =====

export const ConversationEntrySchema = z.object({
  content: z.string(),
  role: z.enum(['user', 'assistant']),
  timestamp: z.number(),
  toolCalls: z.array(z.string()).optional(),
})

// ===== Listener Signal =====

export const ListenerSignalSchema = z.object({
  listenDuration: z.number().min(0),
  timestamp: z.number(),
  trackDuration: z.number().min(0),
  trackId: z.string(),
  type: z.enum(['completed', 'skipped', 'partial', 'user-queued', 'steer']),
})

// ===== Arc Template & Set Plan =====

export const ArcPhaseSchema = z.object({
  durationMinutes: z.number().min(1).max(120),
  genreHints: z.array(z.string()).default([]),
  name: z.string(),
  targetBpmRange: z.tuple([z.number().min(20).max(220), z.number().min(20).max(220)]),
  targetEnergy: z.number().min(0).max(1),
})

export const ArcTemplateSchema = z.object({
  name: z.string(),
  phases: z.array(ArcPhaseSchema).min(1),
  totalDurationMinutes: z.number().min(1).max(240),
})

export const PlannedTrackSchema = z.object({
  arcPhase: z.string(),
  artist: z.string(),
  bpm: z.number().min(20).max(220).nullable(),
  energy: z.number().min(0).max(1),
  name: z.string(),
  reason: z.string(),
  spotifyUri: z.string(),
  transitionScore: z.number().min(0).max(1),
})

export const SetPlanSchema = z.object({
  arc: ArcTemplateSchema,
  currentPosition: z.number().int().min(0),
  expiresAt: z.number(),
  generatedAt: z.number(),
  tracks: z.array(PlannedTrackSchema),
})

// ===== Taste Model =====

export const TasteModelSchema = z.object({
  artistAffinities: z.record(z.string(), z.number().min(-1).max(1)).default({}),
  bpmPreference: z.tuple([z.number().min(20).max(220), z.number().min(20).max(220)]).default([80, 140]),
  energyPreference: z.number().min(0).max(1).default(0.5),
  genreWeights: z.record(z.string(), z.number().min(-1).max(1)).default({}),
  skipPatterns: z.array(z.string()).default([]),
  updatedAt: z.number().default(0),
})

// ===== Session Health =====

export const SessionHealthSchema = z.object({
  consecutiveErrors: z.number().int().min(0),
  fallbacksUsed: z.number().int().min(0),
  lastAICallMs: z.number().min(0),
  planRemaining: z.number().int().min(0),
  queueDepth: z.number().int().min(0),
})

// ===== Session Preferences =====

export const SessionPreferencesSchema = z.object({
  autoFill: z.boolean().default(true),
  avoidGenres: z.array(z.string()).default([]),
  bpmLock: z.object({
    max: z.number().min(20).max(220),
    min: z.number().min(20).max(220),
  }).nullable().default(null),
  favoriteArtists: z.array(z.string()).default([]),
})

// ===== Mix Session =====

export const MixSessionSchema = z.object({
  // Server-side conversation context (Phase 1)
  conversation: z.array(ConversationEntrySchema).max(50).default([]),
  createdAt: z.string().datetime(),
  // Fallback track pool for playback guarantee (Phase 3)
  fallbackPool: z.array(z.string()).max(10).default([]),
  // Recent track history for context (last 20)
  history: z.array(PlayedTrackSchema).max(20).default([]),

  id: z.string().uuid(),

  // Batch set plan (Phase 2)
  plan: SetPlanSchema.nullable().default(null),

  // User preferences for this session
  preferences: SessionPreferencesSchema,

  // App-managed smart queue (next 10 tracks)
  queue: z.array(QueuedTrackSchema).max(10).default([]),

  // Listener feedback signals (Phase 3/4)
  signals: z.array(ListenerSignalSchema).max(50).default([]),

  // Learned taste model (Phase 4)
  tasteModel: TasteModelSchema.nullable().default(null),

  updatedAt: z.string().datetime(),

  userId: z.string(),

  // Current vibe profile (updated as tracks play)
  vibe: VibeProfileSchema,
})

// ===== API Request/Response Schemas =====

// Start Mix Session
export const StartMixRequestSchema = z.object({
  preferences: SessionPreferencesSchema.optional(),
  seedPlaylistId: z.string().optional(),
})

export const StartMixResponseSchema = z.object({
  session: MixSessionSchema,
})

// Get Current Session Response
export const GetMixSessionResponseSchema = z.object({
  session: MixSessionSchema.nullable(),
})

// Add to Queue Request
export const AddToQueueRequestSchema = z.object({
  position: z.number().int().min(0).optional(),
  trackUri: z.string(),
})

export const GetQueueResponseSchema = z.object({
  queue: z.array(QueuedTrackSchema),
})

export const AddToQueueResponseSchema = z.object({
  queue: z.array(QueuedTrackSchema),
  success: z.boolean(),
})

// Remove from Queue Request
export const RemoveFromQueueRequestSchema = z.object({
  position: z.number().int().min(0),
})

export const RemoveFromQueueResponseSchema = z.object({
  queue: z.array(QueuedTrackSchema),
  success: z.boolean(),
})

// Reorder Queue Request
export const ReorderQueueRequestSchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
})

export const ReorderQueueResponseSchema = z.object({
  queue: z.array(QueuedTrackSchema),
  success: z.boolean(),
})

// Update Vibe Request
export const UpdateVibeRequestSchema = z.object({
  bpmRange: z.object({
    max: z.number().min(20).max(220),
    min: z.number().min(20).max(220),
  }).optional(),
  energyDirection: z.enum(['building', 'steady', 'winding_down']).optional(),
  energyLevel: z.number().min(1).max(10).optional(),
})

export const GetVibeResponseSchema = z.object({
  vibe: VibeProfileSchema,
})

export const UpdateVibeResponseSchema = z.object({
  queue: z.array(QueuedTrackSchema).optional(), // Server returns rebuilt queue after vibe change
  vibe: VibeProfileSchema,
})

// Steer Vibe Request (Natural Language)
export const SteerVibeRequestSchema = z.object({
  direction: z.string().min(1).max(500),
  intensity: z.number().min(1).max(10).default(5),
})

export const SteerVibeResponseSchema = z.object({
  changes: z.array(z.string()),
  queue: z.array(QueuedTrackSchema).optional(), // Server returns rebuilt queue after vibe steer
  vibe: VibeProfileSchema,
})

// Get Suggestions Response
export const GetSuggestionsResponseSchema = z.object({
  basedOn: z.object({
    currentTrack: z.string().optional(),
    vibeProfile: z.string(),
  }),
  suggestions: z.array(SuggestionSchema),
})

// Save Mix as Playlist Request
export const SaveMixRequestSchema = z.object({
  description: z.string().max(500).optional(),
  includeQueue: z.boolean().default(true),
  name: z.string().min(1).max(200),
})

export const SaveMixResponseSchema = z.object({
  playlistId: z.string().optional(),
  playlistUrl: z.string().url().optional(),
  success: z.boolean(),
  trackCount: z.number().int().min(0),
})

// End Session Response
export const EndMixResponseSchema = z.object({
  sessionDuration: z.number().int().min(0), // in seconds
  success: z.boolean(),
  tracksPlayed: z.number().int().min(0),
})

// Track Played Request (notify that a track was played/changed)
export const TrackPlayedRequestSchema = z.object({
  trackId: z.string(),
  trackUri: z.string(),
})

export const TrackPlayedResponseSchema = z.object({
  movedToHistory: z.boolean(),
  session: MixSessionSchema,
  success: z.boolean(),
})

// Queue to Spotify Request
export const QueueToSpotifyRequestSchema = z.object({
  trackUri: z.string(),
})

export const QueueToSpotifyResponseSchema = z.object({
  message: z.string().optional(),
  queued: z.boolean(),
  success: z.boolean(),
})

// Update Preferences Request
export const UpdatePreferencesRequestSchema = z.object({
  autoFill: z.boolean().optional(),
})

export const UpdatePreferencesResponseSchema = z.object({
  preferences: SessionPreferencesSchema,
  session: MixSessionSchema,
  success: z.boolean(),
})

// ===== Signal Batch Request =====

export const SubmitSignalsRequestSchema = z.object({
  signals: z.array(ListenerSignalSchema).min(1).max(50),
})

export const SubmitSignalsResponseSchema = z.object({
  processed: z.number().int().min(0),
  success: z.boolean(),
  tasteModel: TasteModelSchema.nullable(),
})

// ===== Mix Chat Request =====

export const MixChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
})

// ===== Type Exports =====

export type AddToQueueRequest = z.infer<typeof AddToQueueRequestSchema>
export type AddToQueueResponse = z.infer<typeof AddToQueueResponseSchema>
export type ArcPhase = z.infer<typeof ArcPhaseSchema>
export type ArcTemplate = z.infer<typeof ArcTemplateSchema>
export type ConversationEntry = z.infer<typeof ConversationEntrySchema>
export type EndMixResponse = z.infer<typeof EndMixResponseSchema>
export type GetMixSessionResponse = z.infer<typeof GetMixSessionResponseSchema>
export type GetQueueResponse = z.infer<typeof GetQueueResponseSchema>
export type GetSuggestionsResponse = z.infer<typeof GetSuggestionsResponseSchema>
export type GetVibeResponse = z.infer<typeof GetVibeResponseSchema>
export type ListenerSignal = z.infer<typeof ListenerSignalSchema>
export type MixSession = z.infer<typeof MixSessionSchema>
export type PlannedTrack = z.infer<typeof PlannedTrackSchema>
export type PlayedTrack = z.infer<typeof PlayedTrackSchema>

export type QueuedTrack = z.infer<typeof QueuedTrackSchema>
export type QueueToSpotifyRequest = z.infer<typeof QueueToSpotifyRequestSchema>
export type QueueToSpotifyResponse = z.infer<typeof QueueToSpotifyResponseSchema>
export type RemoveFromQueueRequest = z.infer<typeof RemoveFromQueueRequestSchema>
export type RemoveFromQueueResponse = z.infer<typeof RemoveFromQueueResponseSchema>
export type ReorderQueueRequest = z.infer<typeof ReorderQueueRequestSchema>
export type ReorderQueueResponse = z.infer<typeof ReorderQueueResponseSchema>
export type SaveMixRequest = z.infer<typeof SaveMixRequestSchema>
export type SaveMixResponse = z.infer<typeof SaveMixResponseSchema>
export type SessionHealth = z.infer<typeof SessionHealthSchema>
export type SessionPreferences = z.infer<typeof SessionPreferencesSchema>
export type SetPlan = z.infer<typeof SetPlanSchema>
export type StartMixRequest = z.infer<typeof StartMixRequestSchema>
export type StartMixResponse = z.infer<typeof StartMixResponseSchema>
export type SteerVibeRequest = z.infer<typeof SteerVibeRequestSchema>
export type SteerVibeResponse = z.infer<typeof SteerVibeResponseSchema>
export type Suggestion = z.infer<typeof SuggestionSchema>
export type TasteModel = z.infer<typeof TasteModelSchema>
export type TrackPlayedRequest = z.infer<typeof TrackPlayedRequestSchema>
export type TrackPlayedResponse = z.infer<typeof TrackPlayedResponseSchema>
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequestSchema>
export type UpdatePreferencesResponse = z.infer<typeof UpdatePreferencesResponseSchema>
export type UpdateVibeRequest = z.infer<typeof UpdateVibeRequestSchema>
export type UpdateVibeResponse = z.infer<typeof UpdateVibeResponseSchema>
export type VibeProfile = z.infer<typeof VibeProfileSchema>
