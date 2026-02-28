/**
 * Comprehensive Zod schema validation tests for Mix Session (Live DJ Mode)
 * Tests all schemas for vibe profiles, sessions, queues, and API requests/responses
 */

import {describe, expect, it} from 'vitest'
import {z} from 'zod'

import {
  AddToQueueRequestSchema,
  MixSessionSchema,
  PlayedTrackSchema,
  QueuedTrackSchema,
  SaveMixRequestSchema,
  SessionPreferencesSchema,
  StartMixRequestSchema,
  SteerVibeRequestSchema,
  SuggestionSchema,
  UpdateVibeRequestSchema,
  VibeProfileSchema,
} from '../schemas/mix-session-schemas'

// ===== Helper Functions =====

function createTestPlayedTrack() {
  return {
    albumArt: 'https://example.com/album.jpg',
    artist: 'Test Artist',
    bpm: 120,
    energy: 0.8,
    name: 'Test Song',
    playedAt: new Date().toISOString(),
    trackId: 'track123',
    trackUri: 'spotify:track:track123',
  }
}

function createTestQueuedTrack() {
  return {
    addedBy: 'ai' as const,
    albumArt: 'https://example.com/queued.jpg',
    artist: 'Queued Artist',
    name: 'Queued Song',
    position: 0,
    reason: 'Great energy match for the current vibe',
    trackId: 'track456',
    trackUri: 'spotify:track:track456',
    vibeScore: 85,
  }
}

// ===== Test Fixtures =====

function createTestSession() {
  return {
    createdAt: new Date().toISOString(),
    history: [createTestPlayedTrack()],
    id: '123e4567-e89b-12d3-a456-426614174000',
    preferences: {
      autoFill: true,
      avoidGenres: ['metal'],
      bpmLock: null,
      favoriteArtists: ['Radiohead'],
    },
    queue: [createTestQueuedTrack()],
    updatedAt: new Date().toISOString(),
    userId: 'user123',
    vibe: createTestVibeProfile(),
  }
}

function createTestVibeProfile() {
  return {
    bpmRange: {max: 140, min: 100},
    energyDirection: 'building' as const,
    energyLevel: 7,
    era: {end: 2024, start: 2010},
    genres: ['indie rock', 'alt pop'],
    mood: ['upbeat', 'energetic'],
  }
}

function expectSchemaToFail<T>(schema: z.ZodSchema<T>, data: unknown, description?: string) {
  const result = schema.safeParse(data)
  if (result.success) {
    throw new Error(
      `Schema validation should have failed${description ? `: ${description}` : ''}\nData: ${JSON.stringify(data)}`,
    )
  }
  expect(result.success).toBe(false)
}

function expectSchemaToPass<T>(schema: z.ZodSchema<T>, data: unknown, description?: string) {
  try {
    schema.parse(data)
  } catch (error) {
    throw new Error(
      `Schema validation failed${description ? `: ${description}` : ''}\nData: ${JSON.stringify(data)}\nError: ${error}`,
    )
  }
  const result = schema.safeParse(data)
  expect(result.success).toBe(true)
}

// ===== Vibe Profile Tests =====

describe('VibeProfile Schema', () => {
  it('validates complete vibe profile', () => {
    expectSchemaToPass(VibeProfileSchema, createTestVibeProfile())
  })

  it('enforces energy level bounds (1-10)', () => {
    const lowEnergy = {...createTestVibeProfile(), energyLevel: 0}
    expectSchemaToFail(VibeProfileSchema, lowEnergy, 'energy too low')

    const highEnergy = {...createTestVibeProfile(), energyLevel: 11}
    expectSchemaToFail(VibeProfileSchema, highEnergy, 'energy too high')
  })

  it('validates energy level at boundaries', () => {
    const minEnergy = {...createTestVibeProfile(), energyLevel: 1}
    expectSchemaToPass(VibeProfileSchema, minEnergy, 'minimum energy')

    const maxEnergy = {...createTestVibeProfile(), energyLevel: 10}
    expectSchemaToPass(VibeProfileSchema, maxEnergy, 'maximum energy')
  })

  it('enforces BPM range bounds (20-220)', () => {
    const lowBpm = {...createTestVibeProfile(), bpmRange: {max: 100, min: 10}}
    expectSchemaToFail(VibeProfileSchema, lowBpm, 'BPM too low')

    const highBpm = {...createTestVibeProfile(), bpmRange: {max: 250, min: 100}}
    expectSchemaToFail(VibeProfileSchema, highBpm, 'BPM too high')
  })

  it('validates era bounds (1900-2100)', () => {
    const oldEra = {...createTestVibeProfile(), era: {end: 2000, start: 1850}}
    expectSchemaToFail(VibeProfileSchema, oldEra, 'era too old')

    const futureEra = {...createTestVibeProfile(), era: {end: 2150, start: 2000}}
    expectSchemaToFail(VibeProfileSchema, futureEra, 'era too far future')
  })

  it('validates energy direction enum', () => {
    const directions = ['building', 'steady', 'winding_down']
    for (const direction of directions) {
      const profile = {...createTestVibeProfile(), energyDirection: direction}
      expectSchemaToPass(VibeProfileSchema, profile, `direction: ${direction}`)
    }

    const invalid = {...createTestVibeProfile(), energyDirection: 'unknown'}
    expectSchemaToFail(VibeProfileSchema, invalid, 'invalid direction')
  })

  it('provides sensible defaults', () => {
    const minimal = {}
    const parsed = VibeProfileSchema.parse(minimal)

    expect(parsed.mood).toEqual([])
    expect(parsed.genres).toEqual([])
    expect(parsed.energyLevel).toBe(5)
    expect(parsed.energyDirection).toBe('steady')
  })
})

// ===== Played Track Tests =====

describe('PlayedTrack Schema', () => {
  it('validates complete played track', () => {
    expectSchemaToPass(PlayedTrackSchema, createTestPlayedTrack())
  })

  it('allows null BPM and energy', () => {
    const track = {...createTestPlayedTrack(), bpm: null, energy: null}
    expectSchemaToPass(PlayedTrackSchema, track)
  })

  it('requires valid datetime for playedAt', () => {
    const invalid = {...createTestPlayedTrack(), playedAt: 'not-a-date'}
    expectSchemaToFail(PlayedTrackSchema, invalid)
  })

  it('allows missing optional albumArt', () => {
    const {albumArt: _albumArt, ...track} = createTestPlayedTrack()
    expectSchemaToPass(PlayedTrackSchema, track)
  })

  it('enforces BPM bounds when provided (20-220)', () => {
    const lowBpm = {...createTestPlayedTrack(), bpm: 10} // below minimum of 20
    expectSchemaToFail(PlayedTrackSchema, lowBpm)

    const highBpm = {...createTestPlayedTrack(), bpm: 250}
    expectSchemaToFail(PlayedTrackSchema, highBpm)
  })

  it('enforces energy bounds (0-1)', () => {
    const lowEnergy = {...createTestPlayedTrack(), energy: -0.1}
    expectSchemaToFail(PlayedTrackSchema, lowEnergy)

    const highEnergy = {...createTestPlayedTrack(), energy: 1.5}
    expectSchemaToFail(PlayedTrackSchema, highEnergy)
  })
})

// ===== Queued Track Tests =====

describe('QueuedTrack Schema', () => {
  it('validates complete queued track', () => {
    expectSchemaToPass(QueuedTrackSchema, createTestQueuedTrack())
  })

  it('validates addedBy enum', () => {
    const userAdded = {...createTestQueuedTrack(), addedBy: 'user'}
    expectSchemaToPass(QueuedTrackSchema, userAdded)

    const aiAdded = {...createTestQueuedTrack(), addedBy: 'ai'}
    expectSchemaToPass(QueuedTrackSchema, aiAdded)

    const invalid = {...createTestQueuedTrack(), addedBy: 'guest'}
    expectSchemaToFail(QueuedTrackSchema, invalid)
  })

  it('enforces vibe score bounds (0-100)', () => {
    const lowScore = {...createTestQueuedTrack(), vibeScore: -5}
    expectSchemaToFail(QueuedTrackSchema, lowScore)

    const highScore = {...createTestQueuedTrack(), vibeScore: 150}
    expectSchemaToFail(QueuedTrackSchema, highScore)
  })

  it('allows missing optional reason', () => {
    const {reason: _reason, ...track} = createTestQueuedTrack()
    expectSchemaToPass(QueuedTrackSchema, track)
  })

  it('enforces non-negative position', () => {
    const negative = {...createTestQueuedTrack(), position: -1}
    expectSchemaToFail(QueuedTrackSchema, negative)
  })
})

// ===== Suggestion Tests =====

describe('Suggestion Schema', () => {
  it('validates complete suggestion', () => {
    const suggestion = {
      albumArt: 'https://example.com/suggested.jpg',
      artist: 'Suggested Artist',
      bpm: 125,
      name: 'Suggested Song',
      reason: 'Perfect BPM transition from current track',
      trackId: 'track789',
      trackUri: 'spotify:track:track789',
      vibeScore: 92,
    }
    expectSchemaToPass(SuggestionSchema, suggestion)
  })

  it('requires reason field (unlike QueuedTrack)', () => {
    const noReason = {
      artist: 'Suggested Artist',
      bpm: 125,
      name: 'Suggested Song',
      trackId: 'track789',
      trackUri: 'spotify:track:track789',
      vibeScore: 92,
    }
    expectSchemaToFail(SuggestionSchema, noReason)
  })

  it('allows null BPM', () => {
    const suggestion = {
      artist: 'Suggested Artist',
      bpm: null,
      name: 'Suggested Song',
      reason: 'Great vibe match',
      trackId: 'track789',
      trackUri: 'spotify:track:track789',
      vibeScore: 92,
    }
    expectSchemaToPass(SuggestionSchema, suggestion)
  })
})

// ===== Session Preferences Tests =====

describe('SessionPreferences Schema', () => {
  it('validates complete preferences', () => {
    const preferences = {
      autoFill: true,
      avoidGenres: ['metal', 'country'],
      bpmLock: {max: 130, min: 110},
      favoriteArtists: ['Radiohead', 'Arcade Fire'],
    }
    expectSchemaToPass(SessionPreferencesSchema, preferences)
  })

  it('allows null bpmLock', () => {
    const preferences = {
      autoFill: false,
      avoidGenres: [],
      bpmLock: null,
      favoriteArtists: [],
    }
    expectSchemaToPass(SessionPreferencesSchema, preferences)
  })

  it('provides sensible defaults', () => {
    const parsed = SessionPreferencesSchema.parse({})

    expect(parsed.avoidGenres).toEqual([])
    expect(parsed.favoriteArtists).toEqual([])
    expect(parsed.bpmLock).toBeNull()
    expect(parsed.autoFill).toBe(true)
  })

  it('enforces BPM lock bounds when set', () => {
    const invalid = {
      autoFill: true,
      avoidGenres: [],
      bpmLock: {max: 100, min: 10}, // 10 is below minimum of 20
      favoriteArtists: [],
    }
    expectSchemaToFail(SessionPreferencesSchema, invalid)
  })
})

// ===== Mix Session Tests =====

describe('MixSession Schema', () => {
  it('validates complete session', () => {
    expectSchemaToPass(MixSessionSchema, createTestSession())
  })

  it('requires valid UUID for id', () => {
    const invalid = {...createTestSession(), id: 'not-a-uuid'}
    expectSchemaToFail(MixSessionSchema, invalid)
  })

  it('enforces max 20 tracks in history', () => {
    const manyTracks = Array(25).fill(null).map((_, i) => ({
      ...createTestPlayedTrack(),
      trackId: `track${i}`,
      trackUri: `spotify:track:track${i}`,
    }))
    const invalid = {...createTestSession(), history: manyTracks}
    expectSchemaToFail(MixSessionSchema, invalid)
  })

  it('enforces max 10 tracks in queue', () => {
    const manyTracks = Array(15).fill(null).map((_, i) => ({
      ...createTestQueuedTrack(),
      position: i,
      trackId: `track${i}`,
      trackUri: `spotify:track:track${i}`,
    }))
    const invalid = {...createTestSession(), queue: manyTracks}
    expectSchemaToFail(MixSessionSchema, invalid)
  })

  it('allows empty history and queue', () => {
    const empty = {
      ...createTestSession(),
      history: [],
      queue: [],
    }
    expectSchemaToPass(MixSessionSchema, empty)
  })

  it('validates nested vibe profile', () => {
    const invalid = {
      ...createTestSession(),
      vibe: {...createTestVibeProfile(), energyLevel: 100},
    }
    expectSchemaToFail(MixSessionSchema, invalid)
  })
})

// ===== API Request Tests =====

describe('API Request Schemas', () => {
  describe('StartMixRequest', () => {
    it('validates with seed playlist', () => {
      const request = {
        preferences: {autoFill: true},
        seedPlaylistId: 'playlist123',
      }
      expectSchemaToPass(StartMixRequestSchema, request)
    })

    it('validates without any options', () => {
      expectSchemaToPass(StartMixRequestSchema, {})
    })
  })

  describe('AddToQueueRequest', () => {
    it('validates with position', () => {
      const request = {
        position: 0,
        trackUri: 'spotify:track:track123',
      }
      expectSchemaToPass(AddToQueueRequestSchema, request)
    })

    it('validates without position (appends)', () => {
      const request = {
        trackUri: 'spotify:track:track123',
      }
      expectSchemaToPass(AddToQueueRequestSchema, request)
    })

    it('requires trackUri', () => {
      const invalid = {position: 0}
      expectSchemaToFail(AddToQueueRequestSchema, invalid)
    })
  })

  describe('UpdateVibeRequest', () => {
    it('validates partial updates', () => {
      const request = {energyLevel: 8}
      expectSchemaToPass(UpdateVibeRequestSchema, request)
    })

    it('validates multiple fields', () => {
      const request = {
        bpmRange: {max: 140, min: 120},
        energyDirection: 'building' as const,
        energyLevel: 7,
      }
      expectSchemaToPass(UpdateVibeRequestSchema, request)
    })

    it('validates empty request (no changes)', () => {
      expectSchemaToPass(UpdateVibeRequestSchema, {})
    })
  })

  describe('SteerVibeRequest', () => {
    it('validates natural language direction', () => {
      const request = {
        direction: 'Make it more chill and add some 80s vibes',
        intensity: 7,
      }
      expectSchemaToPass(SteerVibeRequestSchema, request)
    })

    it('enforces direction length limits', () => {
      const tooLong = {
        direction: 'x'.repeat(501),
        intensity: 5,
      }
      expectSchemaToFail(SteerVibeRequestSchema, tooLong)
    })

    it('uses default intensity', () => {
      const request = {direction: 'more energy'}
      const parsed = SteerVibeRequestSchema.parse(request)
      expect(parsed.intensity).toBe(5)
    })

    it('enforces intensity bounds', () => {
      const lowIntensity = {direction: 'test', intensity: 0}
      expectSchemaToFail(SteerVibeRequestSchema, lowIntensity)

      const highIntensity = {direction: 'test', intensity: 11}
      expectSchemaToFail(SteerVibeRequestSchema, highIntensity)
    })
  })

  describe('SaveMixRequest', () => {
    it('validates complete save request', () => {
      const request = {
        description: 'Songs from the party last night',
        includeQueue: true,
        name: 'My Party Mix',
      }
      expectSchemaToPass(SaveMixRequestSchema, request)
    })

    it('enforces name length limits', () => {
      const tooLong = {
        name: 'x'.repeat(201),
      }
      expectSchemaToFail(SaveMixRequestSchema, tooLong)
    })

    it('requires non-empty name', () => {
      const empty = {name: ''}
      expectSchemaToFail(SaveMixRequestSchema, empty)
    })

    it('uses default for includeQueue', () => {
      const request = {name: 'Test'}
      const parsed = SaveMixRequestSchema.parse(request)
      expect(parsed.includeQueue).toBe(true)
    })
  })
})

// ===== Type Inference Tests =====

describe('Schema Type Inference', () => {
  it('VibeProfile inferred types match runtime', () => {
    const profile = createTestVibeProfile()
    const parsed = VibeProfileSchema.parse(profile)

    expect(typeof parsed.energyLevel).toBe('number')
    expect(Array.isArray(parsed.mood)).toBe(true)
    expect(typeof parsed.energyDirection).toBe('string')
  })

  it('MixSession inferred types handle nested objects', () => {
    const session = createTestSession()
    const parsed = MixSessionSchema.parse(session)

    expect(typeof parsed.vibe.energyLevel).toBe('number')
    expect(Array.isArray(parsed.history)).toBe(true)
    expect(Array.isArray(parsed.queue)).toBe(true)
  })

  it('Optional fields are properly typed', () => {
    const track = {
      addedBy: 'user' as const,
      artist: 'Artist',
      name: 'Song',
      position: 0,
      trackId: 'track123',
      trackUri: 'spotify:track:track123',
      vibeScore: 80,
    }
    const parsed = QueuedTrackSchema.parse(track)

    expect(parsed.reason).toBeUndefined()
    expect(parsed.albumArt).toBeUndefined()
  })
})
