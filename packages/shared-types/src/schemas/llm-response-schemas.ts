/**
 * Zod schemas for Claude/LLM output validation
 *
 * These schemas validate structured JSON responses from Claude to ensure
 * AI outputs meet expected shapes before being used in tool results.
 */

import {z} from 'zod'

// ===== Vibe Analysis (extract_playlist_vibe output) =====

export const VibeAnalysisSchema = z.object({
  vibe_profile: z.string().optional(),
  emotional_characteristics: z.array(z.string()).optional(),
  production_aesthetic: z.string().optional(),
  vocal_style: z.string().optional(),
  instrumentation: z.array(z.string()).optional(),
  era_feel: z.string().optional(),
  mixing_philosophy: z.string().optional(),
  discovery_hints: z
    .object({
      genre_blends: z.array(z.string()).optional(),
      spotify_params: z.record(z.string(), z.unknown()).optional(),
      avoid: z.array(z.string()).optional(),
    })
    .optional(),
})

// ===== Discovery Strategy (plan_discovery_strategy output) =====

export const DiscoveryStrategySchema = z.object({
  lastfm_similar_priority: z.array(z.string()).optional(),
  spotify_queries: z.array(z.string()).optional(),
  tag_searches: z.array(z.array(z.string())).optional(),
  recommendation_params: z.record(z.string(), z.unknown()).optional(),
  avoid_list: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
})

// ===== Curation Response (curate_recommendations output) =====

export const CuratedTrackSchema = z.object({
  track_id: z.string(),
  name: z.string().optional(),
  artist: z.string().optional(),
  score: z.number().optional(),
  reasoning: z.string().optional(),
})

export const CurationResponseSchema = z.object({
  selected_tracks: z.array(CuratedTrackSchema).optional(),
  selected_track_ids: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
})

// ===== Vibe Adjustments (steer-stream AI output) =====

export const VibeAdjustmentsSchema = z.object({
  energy: z.number().min(1).max(10).optional(),
  energyDirection: z.enum(['building', 'peak', 'cooling', 'steady']).optional(),
  bpmRange: z.object({min: z.number(), max: z.number()}).optional(),
  eraRange: z.object({start: z.number(), end: z.number()}).optional(),
  genres: z.array(z.string()).optional(),
  mood: z.array(z.string()).optional(),
  descriptors: z.array(z.string()).optional(),
})

// ===== AI Suggestion Response (steer-stream suggestions) =====

export const AISuggestionSchema = z.object({
  name: z.string(),
  artist: z.string(),
  reason: z.string().optional(),
})

export const AISuggestionResponseSchema = z.object({
  suggestions: z.array(AISuggestionSchema),
})

// ===== Steer Stream Event (SSE event from /api/mix/vibe/steer-stream) =====

export const SteerStreamEventSchema = z.object({
  type: z.enum(['ack', 'thinking', 'progress', 'vibe_update', 'suggestions', 'queue_update', 'error', 'done']),
  data: z
    .object({
      message: z.string().optional(),
      direction: z.string().optional(),
      stage: z.string().optional(),
      preview: z.string().optional(),
      vibe: z.record(z.string(), z.unknown()).optional(),
      changes: z.array(z.string()).optional(),
      track: z
        .object({
          name: z.string(),
          artist: z.string(),
          trackId: z.string(),
          trackUri: z.string(),
        })
        .optional(),
      queueSize: z.number().optional(),
      count: z.number().optional(),
      queue: z.array(z.unknown()).optional(),
    })
    .optional()
    .default({}),
})

// ===== Type Exports =====

export type VibeAnalysis = z.infer<typeof VibeAnalysisSchema>
export type DiscoveryStrategy = z.infer<typeof DiscoveryStrategySchema>
export type CurationResponse = z.infer<typeof CurationResponseSchema>
export type VibeAdjustments = z.infer<typeof VibeAdjustmentsSchema>
export type AISuggestionResponse = z.infer<typeof AISuggestionResponseSchema>
export type SteerStreamEvent = z.infer<typeof SteerStreamEventSchema>
