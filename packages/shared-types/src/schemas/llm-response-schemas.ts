/**
 * Zod schemas for Claude/LLM output validation
 *
 * These schemas validate structured JSON responses from Claude to ensure
 * AI outputs meet expected shapes before being used in tool results.
 */

import {z} from 'zod'

// ===== Vibe Analysis (extract_playlist_vibe output) =====

export const VibeAnalysisSchema = z.object({
  discovery_hints: z
    .object({
      avoid: z.array(z.string()).optional(),
      genre_blends: z.array(z.string()).optional(),
      spotify_params: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  emotional_characteristics: z.array(z.string()).optional(),
  era_feel: z.string().optional(),
  instrumentation: z.array(z.string()).optional(),
  mixing_philosophy: z.string().optional(),
  production_aesthetic: z.string().optional(),
  vibe_profile: z.string().optional(),
  vocal_style: z.string().optional(),
})

// ===== Discovery Strategy (plan_discovery_strategy output) =====

export const DiscoveryStrategySchema = z.object({
  avoid_list: z.array(z.string()).optional(),
  lastfm_similar_priority: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
  recommendation_params: z.record(z.string(), z.unknown()).optional(),
  spotify_queries: z.array(z.string()).optional(),
  tag_searches: z.array(z.array(z.string())).optional(),
})

// ===== Curation Response (curate_recommendations output) =====

export const CuratedTrackSchema = z.object({
  artist: z.string().optional(),
  name: z.string().optional(),
  reasoning: z.string().optional(),
  score: z.number().optional(),
  track_id: z.string(),
})

export const CurationResponseSchema = z.object({
  reasoning: z.string().optional(),
  selected_track_ids: z.array(z.string()).optional(),
  selected_tracks: z.array(CuratedTrackSchema).optional(),
})

// ===== Vibe Adjustments (steer-stream AI output) =====

export const VibeAdjustmentsSchema = z.object({
  bpmRange: z.object({max: z.number(), min: z.number()}).optional(),
  descriptors: z.array(z.string()).optional(),
  energy: z.number().min(1).max(10).optional(),
  energyDirection: z.enum(['building', 'peak', 'cooling', 'steady']).optional(),
  eraRange: z.object({end: z.number(), start: z.number()}).optional(),
  genres: z.array(z.string()).optional(),
  mood: z.array(z.string()).optional(),
})

// ===== AI Suggestion Response (steer-stream suggestions) =====

export const AISuggestionSchema = z.object({
  artist: z.string(),
  name: z.string(),
  reason: z.string().optional(),
})

export const AISuggestionResponseSchema = z.object({
  suggestions: z.array(AISuggestionSchema),
})

// ===== Steer Stream Event (SSE event from /api/mix/vibe/steer-stream) =====

export const SteerStreamEventSchema = z.object({
  data: z
    .object({
      changes: z.array(z.string()).optional(),
      count: z.number().optional(),
      direction: z.string().optional(),
      message: z.string().optional(),
      preview: z.string().optional(),
      queue: z.array(z.unknown()).optional(),
      queueSize: z.number().optional(),
      stage: z.string().optional(),
      track: z
        .object({
          artist: z.string(),
          name: z.string(),
          trackId: z.string(),
          trackUri: z.string(),
        })
        .optional(),
      vibe: z.record(z.string(), z.unknown()).optional(),
    })
    .optional()
    .default({}),
  type: z.enum(['ack', 'thinking', 'progress', 'vibe_update', 'suggestions', 'queue_update', 'error', 'done']),
})

// ===== Type Exports =====

export type AISuggestionResponse = z.infer<typeof AISuggestionResponseSchema>
export type CurationResponse = z.infer<typeof CurationResponseSchema>
export type DiscoveryStrategy = z.infer<typeof DiscoveryStrategySchema>
export type SteerStreamEvent = z.infer<typeof SteerStreamEventSchema>
export type VibeAdjustments = z.infer<typeof VibeAdjustmentsSchema>
export type VibeAnalysis = z.infer<typeof VibeAnalysisSchema>
