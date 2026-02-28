import {describe, expect, it} from 'vitest'

import {
  AISuggestionResponseSchema,
  CurationResponseSchema,
  DiscoveryStrategySchema,
  SteerStreamEventSchema,
  VibeAdjustmentsSchema,
  VibeAnalysisSchema,
} from '../schemas/llm-response-schemas'

describe('LLM Response Schemas', () => {
  describe('VibeAnalysisSchema', () => {
    it('validates a full vibe analysis', () => {
      const analysis = {
        discovery_hints: {
          avoid: ['heavy metal', 'hard rock'],
          genre_blends: ['dream pop', 'chillwave'],
          spotify_params: {target_energy: 0.3, target_valence: 0.4},
        },
        emotional_characteristics: ['melancholic', 'nostalgic', 'introspective'],
        era_feel: 'Late 2010s bedroom pop',
        instrumentation: ['synth pads', 'muted guitar', 'programmed drums'],
        mixing_philosophy: 'Compressed and warm, vocals buried in mix',
        production_aesthetic: 'Lo-fi with tape hiss and warm analog synths',
        vibe_profile: 'Dreamy, lo-fi bedroom pop with ethereal textures',
        vocal_style: 'Soft, breathy, intimate delivery',
      }
      expect(VibeAnalysisSchema.safeParse(analysis).success).toBe(true)
    })

    it('validates minimal vibe analysis (all optional)', () => {
      expect(VibeAnalysisSchema.safeParse({}).success).toBe(true)
    })
  })

  describe('DiscoveryStrategySchema', () => {
    it('validates a full discovery strategy', () => {
      const strategy = {
        avoid_list: ['hard rock', 'metal'],
        lastfm_similar_priority: ['Radiohead - Everything In Its Right Place', 'Portishead - Wandering Star'],
        reasoning: 'Focusing on atmospheric textures matching the playlist vibe',
        recommendation_params: {seed_genres: ['dream-pop'], target_energy: 0.3},
        spotify_queries: ['dream pop ambient', 'shoegaze ethereal'],
        tag_searches: [['dreampop', 'ambient'], ['shoegaze']],
      }
      expect(DiscoveryStrategySchema.safeParse(strategy).success).toBe(true)
    })

    it('validates empty strategy', () => {
      expect(DiscoveryStrategySchema.safeParse({}).success).toBe(true)
    })
  })

  describe('CurationResponseSchema', () => {
    it('validates curation with selected tracks', () => {
      const curation = {
        reasoning: 'Selected based on energy and mood alignment',
        selected_track_ids: ['abc123'],
        selected_tracks: [
          {artist: 'Test Artist', name: 'Test Song', reasoning: 'Perfect vibe match', score: 0.9, track_id: 'abc123'},
        ],
      }
      expect(CurationResponseSchema.safeParse(curation).success).toBe(true)
    })

    it('validates minimal curation (ids only)', () => {
      const curation = {selected_track_ids: ['abc', 'def']}
      expect(CurationResponseSchema.safeParse(curation).success).toBe(true)
    })
  })

  describe('VibeAdjustmentsSchema', () => {
    it('validates complete vibe adjustments', () => {
      const adjustments = {
        bpmRange: {max: 140, min: 90},
        descriptors: ['driving', 'melodic'],
        energy: 7,
        energyDirection: 'building' as const,
        eraRange: {end: 2025, start: 2000},
        genres: ['electronic', 'house'],
        mood: ['uplifting', 'euphoric'],
      }
      expect(VibeAdjustmentsSchema.safeParse(adjustments).success).toBe(true)
    })

    it('rejects energy outside 1-10', () => {
      expect(VibeAdjustmentsSchema.safeParse({energy: 0}).success).toBe(false)
      expect(VibeAdjustmentsSchema.safeParse({energy: 11}).success).toBe(false)
    })

    it('rejects invalid energy direction', () => {
      expect(VibeAdjustmentsSchema.safeParse({energyDirection: 'invalid'}).success).toBe(false)
    })
  })

  describe('AISuggestionResponseSchema', () => {
    it('validates suggestion response', () => {
      const response = {
        suggestions: [
          {artist: 'Artist 1', name: 'Song 1', reason: 'Matches vibe'},
          {artist: 'Artist 2', name: 'Song 2'},
        ],
      }
      expect(AISuggestionResponseSchema.safeParse(response).success).toBe(true)
    })

    it('rejects missing suggestions array', () => {
      expect(AISuggestionResponseSchema.safeParse({}).success).toBe(false)
    })
  })

  describe('SteerStreamEventSchema', () => {
    it('validates ack event', () => {
      const event = {data: {direction: 'more chill', message: 'Acknowledged'}, type: 'ack'}
      expect(SteerStreamEventSchema.safeParse(event).success).toBe(true)
    })

    it('validates vibe_update event', () => {
      const event = {data: {changes: ['lowered energy'], vibe: {energy: 5}}, type: 'vibe_update'}
      expect(SteerStreamEventSchema.safeParse(event).success).toBe(true)
    })

    it('validates queue_update event', () => {
      const event = {
        data: {queueSize: 5, track: {artist: 'Artist', name: 'Song', trackId: 'id', trackUri: 'uri'}},
        type: 'queue_update',
      }
      expect(SteerStreamEventSchema.safeParse(event).success).toBe(true)
    })

    it('validates done event with minimal data', () => {
      const event = {type: 'done'}
      expect(SteerStreamEventSchema.safeParse(event).success).toBe(true)
    })

    it('rejects invalid event type', () => {
      expect(SteerStreamEventSchema.safeParse({data: {}, type: 'invalid_type'}).success).toBe(false)
    })
  })
})
