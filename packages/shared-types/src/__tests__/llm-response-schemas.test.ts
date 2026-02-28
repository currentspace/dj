import {describe, expect, it} from 'vitest'
import {
  VibeAnalysisSchema,
  DiscoveryStrategySchema,
  CurationResponseSchema,
  VibeAdjustmentsSchema,
  AISuggestionResponseSchema,
  SteerStreamEventSchema,
} from '../schemas/llm-response-schemas'

describe('LLM Response Schemas', () => {
  describe('VibeAnalysisSchema', () => {
    it('validates a full vibe analysis', () => {
      const analysis = {
        vibe_profile: 'Dreamy, lo-fi bedroom pop with ethereal textures',
        emotional_characteristics: ['melancholic', 'nostalgic', 'introspective'],
        production_aesthetic: 'Lo-fi with tape hiss and warm analog synths',
        vocal_style: 'Soft, breathy, intimate delivery',
        instrumentation: ['synth pads', 'muted guitar', 'programmed drums'],
        era_feel: 'Late 2010s bedroom pop',
        mixing_philosophy: 'Compressed and warm, vocals buried in mix',
        discovery_hints: {
          genre_blends: ['dream pop', 'chillwave'],
          spotify_params: {target_energy: 0.3, target_valence: 0.4},
          avoid: ['heavy metal', 'hard rock'],
        },
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
        lastfm_similar_priority: ['Radiohead - Everything In Its Right Place', 'Portishead - Wandering Star'],
        spotify_queries: ['dream pop ambient', 'shoegaze ethereal'],
        tag_searches: [['dreampop', 'ambient'], ['shoegaze']],
        recommendation_params: {seed_genres: ['dream-pop'], target_energy: 0.3},
        avoid_list: ['hard rock', 'metal'],
        reasoning: 'Focusing on atmospheric textures matching the playlist vibe',
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
        selected_tracks: [
          {track_id: 'abc123', name: 'Test Song', artist: 'Test Artist', score: 0.9, reasoning: 'Perfect vibe match'},
        ],
        selected_track_ids: ['abc123'],
        reasoning: 'Selected based on energy and mood alignment',
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
        energy: 7,
        energyDirection: 'building' as const,
        bpmRange: {min: 90, max: 140},
        eraRange: {start: 2000, end: 2025},
        genres: ['electronic', 'house'],
        mood: ['uplifting', 'euphoric'],
        descriptors: ['driving', 'melodic'],
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
          {name: 'Song 1', artist: 'Artist 1', reason: 'Matches vibe'},
          {name: 'Song 2', artist: 'Artist 2'},
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
      const event = {type: 'ack', data: {message: 'Acknowledged', direction: 'more chill'}}
      expect(SteerStreamEventSchema.safeParse(event).success).toBe(true)
    })

    it('validates vibe_update event', () => {
      const event = {type: 'vibe_update', data: {vibe: {energy: 5}, changes: ['lowered energy']}}
      expect(SteerStreamEventSchema.safeParse(event).success).toBe(true)
    })

    it('validates queue_update event', () => {
      const event = {
        type: 'queue_update',
        data: {track: {name: 'Song', artist: 'Artist', trackId: 'id', trackUri: 'uri'}, queueSize: 5},
      }
      expect(SteerStreamEventSchema.safeParse(event).success).toBe(true)
    })

    it('validates done event with minimal data', () => {
      const event = {type: 'done'}
      expect(SteerStreamEventSchema.safeParse(event).success).toBe(true)
    })

    it('rejects invalid event type', () => {
      expect(SteerStreamEventSchema.safeParse({type: 'invalid_type', data: {}}).success).toBe(false)
    })
  })
})
