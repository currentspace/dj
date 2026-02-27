/**
 * Zod schemas for Mix Session (Live DJ Mode)
 * Provides validation for mix sessions, vibe profiles, queues, and history
 */

import {z} from 'zod'

// ===== Vibe Profile =====

export const VibeProfileSchema = z.object({
  mood: z.array(z.string()).default([]),
  genres: z.array(z.string()).default([]),
  era: z.object({
    start: z.number().int().min(1900).max(2100),
    end: z.number().int().min(1900).max(2100),
  }).default({start: 2000, end: 2025}),
  bpmRange: z.object({
    min: z.number().min(20).max(220),
    max: z.number().min(20).max(220),
  }).default({min: 80, max: 140}),
  energyLevel: z.number().min(1).max(10).default(5),
  energyDirection: z.enum(['building', 'steady', 'winding_down']).default('steady'),
})

// ===== Played Track (History) =====

export const PlayedTrackSchema = z.object({
  trackId: z.string(),
  trackUri: z.string(),
  name: z.string(),
  artist: z.string(),
  albumArt: z.string().url().optional(),
  playedAt: z.string().datetime(),
  bpm: z.number().min(20).max(220).nullable(),
  energy: z.number().min(0).max(1).nullable(),
})

// ===== Queued Track =====

export const QueuedTrackSchema = z.object({
  trackId: z.string(),
  trackUri: z.string(),
  name: z.string(),
  artist: z.string(),
  albumArt: z.string().url().optional(),
  addedBy: z.enum(['user', 'ai']),
  vibeScore: z.number().min(0).max(100),
  reason: z.string().optional(),
  position: z.number().int().min(0),
})

// ===== Suggestion =====

export const SuggestionSchema = z.object({
  trackId: z.string(),
  trackUri: z.string(),
  name: z.string(),
  artist: z.string(),
  albumArt: z.string().url().optional(),
  vibeScore: z.number().min(0).max(100),
  reason: z.string(),
  bpm: z.number().min(20).max(220).nullable(),
})

// ===== Conversation Entry =====

export const ConversationEntrySchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.number(),
  toolCalls: z.array(z.string()).optional(),
})

// ===== Listener Signal =====

export const ListenerSignalSchema = z.object({
  trackId: z.string(),
  type: z.enum(['completed', 'skipped', 'partial', 'user-queued', 'steer']),
  listenDuration: z.number().min(0),
  trackDuration: z.number().min(0),
  timestamp: z.number(),
})

// ===== Arc Template & Set Plan =====

export const ArcPhaseSchema = z.object({
  name: z.string(),
  targetEnergy: z.number().min(0).max(1),
  targetBpmRange: z.tuple([z.number().min(20).max(220), z.number().min(20).max(220)]),
  durationMinutes: z.number().min(1).max(120),
  genreHints: z.array(z.string()).default([]),
})

export const ArcTemplateSchema = z.object({
  name: z.string(),
  phases: z.array(ArcPhaseSchema).min(1),
  totalDurationMinutes: z.number().min(1).max(240),
})

export const PlannedTrackSchema = z.object({
  spotifyUri: z.string(),
  name: z.string(),
  artist: z.string(),
  bpm: z.number().min(20).max(220).nullable(),
  energy: z.number().min(0).max(1),
  arcPhase: z.string(),
  transitionScore: z.number().min(0).max(1),
  reason: z.string(),
})

export const SetPlanSchema = z.object({
  arc: ArcTemplateSchema,
  tracks: z.array(PlannedTrackSchema),
  currentPosition: z.number().int().min(0),
  generatedAt: z.number(),
  expiresAt: z.number(),
})

// ===== Taste Model =====

export const TasteModelSchema = z.object({
  genreWeights: z.record(z.string(), z.number().min(-1).max(1)).default({}),
  energyPreference: z.number().min(0).max(1).default(0.5),
  bpmPreference: z.tuple([z.number().min(20).max(220), z.number().min(20).max(220)]).default([80, 140]),
  artistAffinities: z.record(z.string(), z.number().min(-1).max(1)).default({}),
  skipPatterns: z.array(z.string()).default([]),
  updatedAt: z.number().default(0),
})

// ===== Session Health =====

export const SessionHealthSchema = z.object({
  queueDepth: z.number().int().min(0),
  planRemaining: z.number().int().min(0),
  lastAICallMs: z.number().min(0),
  consecutiveErrors: z.number().int().min(0),
  fallbacksUsed: z.number().int().min(0),
})

// ===== Session Preferences =====

export const SessionPreferencesSchema = z.object({
  avoidGenres: z.array(z.string()).default([]),
  favoriteArtists: z.array(z.string()).default([]),
  bpmLock: z.object({
    min: z.number().min(20).max(220),
    max: z.number().min(20).max(220),
  }).nullable().default(null),
  autoFill: z.boolean().default(true),
})

// ===== Mix Session =====

export const MixSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  // Current vibe profile (updated as tracks play)
  vibe: VibeProfileSchema,

  // Recent track history for context (last 20)
  history: z.array(PlayedTrackSchema).max(20).default([]),

  // App-managed smart queue (next 10 tracks)
  queue: z.array(QueuedTrackSchema).max(10).default([]),

  // User preferences for this session
  preferences: SessionPreferencesSchema,

  // Server-side conversation context (Phase 1)
  conversation: z.array(ConversationEntrySchema).max(50).default([]),

  // Listener feedback signals (Phase 3/4)
  signals: z.array(ListenerSignalSchema).max(50).default([]),

  // Batch set plan (Phase 2)
  plan: SetPlanSchema.nullable().default(null),

  // Learned taste model (Phase 4)
  tasteModel: TasteModelSchema.nullable().default(null),

  // Fallback track pool for playback guarantee (Phase 3)
  fallbackPool: z.array(z.string()).max(10).default([]),
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
  trackUri: z.string(),
  position: z.number().int().min(0).optional(),
})

export const GetQueueResponseSchema = z.object({
  queue: z.array(QueuedTrackSchema),
})

export const AddToQueueResponseSchema = z.object({
  success: z.boolean(),
  queue: z.array(QueuedTrackSchema),
})

// Remove from Queue Request
export const RemoveFromQueueRequestSchema = z.object({
  position: z.number().int().min(0),
})

export const RemoveFromQueueResponseSchema = z.object({
  success: z.boolean(),
  queue: z.array(QueuedTrackSchema),
})

// Reorder Queue Request
export const ReorderQueueRequestSchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
})

export const ReorderQueueResponseSchema = z.object({
  success: z.boolean(),
  queue: z.array(QueuedTrackSchema),
})

// Update Vibe Request
export const UpdateVibeRequestSchema = z.object({
  energyLevel: z.number().min(1).max(10).optional(),
  energyDirection: z.enum(['building', 'steady', 'winding_down']).optional(),
  bpmRange: z.object({
    min: z.number().min(20).max(220),
    max: z.number().min(20).max(220),
  }).optional(),
})

export const GetVibeResponseSchema = z.object({
  vibe: VibeProfileSchema,
})

export const UpdateVibeResponseSchema = z.object({
  vibe: VibeProfileSchema,
  queue: z.array(QueuedTrackSchema).optional(), // Server returns rebuilt queue after vibe change
})

// Steer Vibe Request (Natural Language)
export const SteerVibeRequestSchema = z.object({
  direction: z.string().min(1).max(500),
  intensity: z.number().min(1).max(10).default(5),
})

export const SteerVibeResponseSchema = z.object({
  vibe: VibeProfileSchema,
  changes: z.array(z.string()),
  queue: z.array(QueuedTrackSchema).optional(), // Server returns rebuilt queue after vibe steer
})

// Get Suggestions Response
export const GetSuggestionsResponseSchema = z.object({
  suggestions: z.array(SuggestionSchema),
  basedOn: z.object({
    currentTrack: z.string().optional(),
    vibeProfile: z.string(),
  }),
})

// Save Mix as Playlist Request
export const SaveMixRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  includeQueue: z.boolean().default(true),
})

export const SaveMixResponseSchema = z.object({
  success: z.boolean(),
  playlistId: z.string().optional(),
  playlistUrl: z.string().url().optional(),
  trackCount: z.number().int().min(0),
})

// End Session Response
export const EndMixResponseSchema = z.object({
  success: z.boolean(),
  tracksPlayed: z.number().int().min(0),
  sessionDuration: z.number().int().min(0), // in seconds
})

// Track Played Request (notify that a track was played/changed)
export const TrackPlayedRequestSchema = z.object({
  trackId: z.string(),
  trackUri: z.string(),
})

export const TrackPlayedResponseSchema = z.object({
  success: z.boolean(),
  movedToHistory: z.boolean(),
  session: MixSessionSchema,
})

// Queue to Spotify Request
export const QueueToSpotifyRequestSchema = z.object({
  trackUri: z.string(),
})

export const QueueToSpotifyResponseSchema = z.object({
  success: z.boolean(),
  queued: z.boolean(),
  message: z.string().optional(),
})

// Update Preferences Request
export const UpdatePreferencesRequestSchema = z.object({
  autoFill: z.boolean().optional(),
})

export const UpdatePreferencesResponseSchema = z.object({
  success: z.boolean(),
  preferences: SessionPreferencesSchema,
  session: MixSessionSchema,
})

// ===== Signal Batch Request =====

export const SubmitSignalsRequestSchema = z.object({
  signals: z.array(ListenerSignalSchema).min(1).max(50),
})

export const SubmitSignalsResponseSchema = z.object({
  success: z.boolean(),
  processed: z.number().int().min(0),
  tasteModel: TasteModelSchema.nullable(),
})

// ===== Mix Chat Request =====

export const MixChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
})

// ===== Type Exports =====

export type VibeProfile = z.infer<typeof VibeProfileSchema>
export type PlayedTrack = z.infer<typeof PlayedTrackSchema>
export type QueuedTrack = z.infer<typeof QueuedTrackSchema>
export type Suggestion = z.infer<typeof SuggestionSchema>
export type SessionPreferences = z.infer<typeof SessionPreferencesSchema>
export type MixSession = z.infer<typeof MixSessionSchema>
export type ConversationEntry = z.infer<typeof ConversationEntrySchema>
export type ListenerSignal = z.infer<typeof ListenerSignalSchema>
export type ArcPhase = z.infer<typeof ArcPhaseSchema>
export type ArcTemplate = z.infer<typeof ArcTemplateSchema>
export type PlannedTrack = z.infer<typeof PlannedTrackSchema>
export type SetPlan = z.infer<typeof SetPlanSchema>
export type TasteModel = z.infer<typeof TasteModelSchema>
export type SessionHealth = z.infer<typeof SessionHealthSchema>

export type StartMixRequest = z.infer<typeof StartMixRequestSchema>
export type StartMixResponse = z.infer<typeof StartMixResponseSchema>
export type GetMixSessionResponse = z.infer<typeof GetMixSessionResponseSchema>
export type GetQueueResponse = z.infer<typeof GetQueueResponseSchema>
export type AddToQueueRequest = z.infer<typeof AddToQueueRequestSchema>
export type AddToQueueResponse = z.infer<typeof AddToQueueResponseSchema>
export type RemoveFromQueueRequest = z.infer<typeof RemoveFromQueueRequestSchema>
export type RemoveFromQueueResponse = z.infer<typeof RemoveFromQueueResponseSchema>
export type ReorderQueueRequest = z.infer<typeof ReorderQueueRequestSchema>
export type ReorderQueueResponse = z.infer<typeof ReorderQueueResponseSchema>
export type UpdateVibeRequest = z.infer<typeof UpdateVibeRequestSchema>
export type GetVibeResponse = z.infer<typeof GetVibeResponseSchema>
export type UpdateVibeResponse = z.infer<typeof UpdateVibeResponseSchema>
export type SteerVibeRequest = z.infer<typeof SteerVibeRequestSchema>
export type SteerVibeResponse = z.infer<typeof SteerVibeResponseSchema>
export type GetSuggestionsResponse = z.infer<typeof GetSuggestionsResponseSchema>
export type SaveMixRequest = z.infer<typeof SaveMixRequestSchema>
export type SaveMixResponse = z.infer<typeof SaveMixResponseSchema>
export type EndMixResponse = z.infer<typeof EndMixResponseSchema>
export type TrackPlayedRequest = z.infer<typeof TrackPlayedRequestSchema>
export type TrackPlayedResponse = z.infer<typeof TrackPlayedResponseSchema>
export type QueueToSpotifyRequest = z.infer<typeof QueueToSpotifyRequestSchema>
export type QueueToSpotifyResponse = z.infer<typeof QueueToSpotifyResponseSchema>
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequestSchema>
export type UpdatePreferencesResponse = z.infer<typeof UpdatePreferencesResponseSchema>
