/**
 * SuggestionEngine Tests
 * Tests for Mix Session suggestion generation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Vitest 4: Create hoisted fetch mock BEFORE imports
const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', fetchMock)

// Mock logger
vi.mock('../utils/LoggerContext', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

import type { MixSession, PlayedTrack, VibeProfile } from '@dj/shared-types'

import { MockKVNamespace } from '../__tests__/fixtures/cloudflare-mocks'
import { AudioEnrichmentService } from '../services/AudioEnrichmentService'
import { LastFmService, type LastFmSignals } from '../services/LastFmService'
import { SuggestionEngine } from './SuggestionEngine'

function buildLastFmSignals(overrides?: Partial<LastFmSignals>): LastFmSignals {
  return {
    album: null,
    artistInfo: null,
    canonicalArtist: 'Test Artist',
    canonicalTrack: 'Test Track',
    duration: null,
    listeners: 1000,
    mbid: null,
    playcount: 5000,
    similar: [],
    topTags: [],
    url: null,
    wiki: null,
    ...overrides,
  }
}

function buildMixSession(overrides?: Partial<MixSession>): MixSession {
  return {
    conversation: [],
    createdAt: new Date().toISOString(),
    fallbackPool: [],
    history: [],
    id: crypto.randomUUID(),
    plan: null,
    preferences: {
      autoFill: true,
      avoidGenres: [],
      bpmLock: null,
      favoriteArtists: [],
    },
    queue: [],
    signals: [],
    tasteModel: null,
    updatedAt: new Date().toISOString(),
    userId: 'user-123',
    vibe: buildVibeProfile(),
    ...overrides,
  }
}

function buildPlayedTrack(overrides?: Partial<PlayedTrack>): PlayedTrack {
  return {
    artist: 'Test Artist',
    bpm: 120,
    energy: 0.7,
    name: 'Test Track',
    playedAt: new Date().toISOString(),
    trackId: 'track-123',
    trackUri: 'spotify:track:123',
    ...overrides,
  }
}

function buildSpotifyTrack(id: string, name: string, artist: string, overrides?: {
  bpm?: number
  energy?: number
  genres?: string[]
  release_date?: string
}) {
  return {
    album: {
      images: [{ url: 'https://example.com/image.jpg' }],
      name: 'Test Album',
      release_date: overrides?.release_date ?? '2015-01-01',
    },
    artists: [{ name: artist }],
    duration_ms: 200000,
    external_ids: { isrc: 'TEST123' },
    id,
    name,
    popularity: 70,
    uri: `spotify:track:${id}`,
  }
}

// Test data builders
function buildVibeProfile(overrides?: Partial<VibeProfile>): VibeProfile {
  return {
    bpmRange: { max: 140, min: 100 },
    energyDirection: 'steady',
    energyLevel: 7,
    era: { end: 2020, start: 2000 },
    genres: ['rock', 'indie'],
    mood: ['energetic', 'upbeat'],
    ...overrides,
  }
}

describe('SuggestionEngine', () => {
  let engine: SuggestionEngine
  let lastFmService: LastFmService
  let audioService: AudioEnrichmentService
  let mockKv: MockKVNamespace
  const mockSpotifyToken = 'test-token'

  beforeEach(() => {
    vi.clearAllMocks()
    mockKv = new MockKVNamespace()
    lastFmService = new LastFmService('test-key', mockKv as unknown as KVNamespace)
    audioService = new AudioEnrichmentService(mockKv as unknown as KVNamespace)
    engine = new SuggestionEngine(lastFmService, audioService, mockSpotifyToken)
  })

  describe('generateSuggestions', () => {
    it('should generate suggestions based on session vibe', async () => {
      const session = buildMixSession({
        history: [
          buildPlayedTrack({ artist: 'Artist 1', bpm: 120, name: 'Song 1', trackId: 'track1' }),
        ],
        vibe: buildVibeProfile({ bpmRange: { max: 130, min: 110 }, genres: ['rock', 'indie'] }),
      })

      // Spy on Last.fm service
      vi.spyOn(lastFmService, 'getTrackSignals').mockResolvedValue(
        buildLastFmSignals({
          similar: [
            { artist: 'Artist 2', match: 0.9, name: 'Song 2' },
            { artist: 'Artist 3', match: 0.8, name: 'Song 3' },
          ],
          topTags: ['rock', 'indie'],
        })
      )

      // Mock Spotify search for similar tracks
      const mockTrack2 = buildSpotifyTrack('track2', 'Song 2', 'Artist 2')
      const mockTrack3 = buildSpotifyTrack('track3', 'Song 3', 'Artist 3')

      fetchMock
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ tracks: { items: [mockTrack2] } }),
          ok: true,
        } as Response)
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ tracks: { items: [mockTrack3] } }),
          ok: true,
        } as Response)

      // Spy on audio enrichment
      vi.spyOn(audioService, 'enrichTrack')
        .mockResolvedValueOnce({ bpm: 118, gain: null, rank: 500, release_date: '2015-01-01', source: 'deezer' })
        .mockResolvedValueOnce({ bpm: 125, gain: null, rank: 450, release_date: '2016-01-01', source: 'deezer' })

      const suggestions = await engine.generateSuggestions(session, 5)

      expect(suggestions).toBeDefined()
      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions.length).toBeLessThanOrEqual(5)

      // Check that suggestions have required fields
      suggestions.forEach(suggestion => {
        expect(suggestion).toHaveProperty('trackId')
        expect(suggestion).toHaveProperty('trackUri')
        expect(suggestion).toHaveProperty('name')
        expect(suggestion).toHaveProperty('artist')
        expect(suggestion).toHaveProperty('vibeScore')
        expect(suggestion).toHaveProperty('reason')
        expect(suggestion.vibeScore).toBeGreaterThanOrEqual(0)
        expect(suggestion.vibeScore).toBeLessThanOrEqual(100)
      })
    })

    it('should not suggest tracks already in history', async () => {
      const session = buildMixSession({
        history: [
          buildPlayedTrack({ artist: 'Artist 1', name: 'Song 1', trackId: 'track1' }),
          buildPlayedTrack({ artist: 'Artist 2', name: 'Song 2', trackId: 'track2' }),
        ],
      })

      vi.spyOn(lastFmService, 'getTrackSignals').mockResolvedValue(
        buildLastFmSignals({
          similar: [
            { artist: 'Artist 2', match: 0.9, name: 'Song 2' }, // Already in history
            { artist: 'Artist 3', match: 0.8, name: 'Song 3' },
          ],
        })
      )

      const mockTrack3 = buildSpotifyTrack('track3', 'Song 3', 'Artist 3')
      fetchMock.mockResolvedValue({
        json: () => Promise.resolve({ tracks: { items: [mockTrack3] } }),
        ok: true,
      } as Response)

      vi.spyOn(audioService, 'enrichTrack').mockResolvedValue({
        bpm: 120,
        gain: null,
        rank: 500,
        release_date: '2015-01-01',
        source: 'deezer',
      })

      const suggestions = await engine.generateSuggestions(session, 5)

      // Should not include track2 from history
      expect(suggestions.every(s => s.trackId !== 'track2')).toBe(true)
    })

    it('should not suggest tracks already in queue', async () => {
      const session = buildMixSession({
        history: [buildPlayedTrack({ artist: 'Artist 1', name: 'Song 1', trackId: 'track1' })],
        queue: [
          {
            addedBy: 'user',
            artist: 'Artist 2',
            name: 'Song 2',
            position: 0,
            trackId: 'track2',
            trackUri: 'spotify:track:track2',
            vibeScore: 85,
          },
        ],
      })

      vi.spyOn(lastFmService, 'getTrackSignals').mockResolvedValue(
        buildLastFmSignals({
          similar: [
            { artist: 'Artist 2', match: 0.9, name: 'Song 2' }, // Already in queue
            { artist: 'Artist 3', match: 0.8, name: 'Song 3' },
          ],
        })
      )

      const mockTrack3 = buildSpotifyTrack('track3', 'Song 3', 'Artist 3')
      fetchMock.mockResolvedValue({
        json: () => Promise.resolve({ tracks: { items: [mockTrack3] } }),
        ok: true,
      } as Response)

      vi.spyOn(audioService, 'enrichTrack').mockResolvedValue({
        bpm: 120,
        gain: null,
        rank: 500,
        release_date: '2015-01-01',
        source: 'deezer',
      })

      const suggestions = await engine.generateSuggestions(session, 5)

      // Should not include track2 from queue
      expect(suggestions.every(s => s.trackId !== 'track2')).toBe(true)
    })

    it('should return empty array when no similar tracks found', async () => {
      const session = buildMixSession({
        history: [buildPlayedTrack({ trackId: 'track1' })],
      })

      vi.spyOn(lastFmService, 'getTrackSignals').mockResolvedValue(
        buildLastFmSignals({ similar: [] })
      )

      const suggestions = await engine.generateSuggestions(session, 5)

      expect(suggestions).toEqual([])
    })

    it('should handle Last.fm API failures gracefully', async () => {
      const session = buildMixSession({
        history: [buildPlayedTrack({ trackId: 'track1' })],
      })

      vi.spyOn(lastFmService, 'getTrackSignals').mockRejectedValue(new Error('API error'))

      const suggestions = await engine.generateSuggestions(session, 5)

      expect(suggestions).toEqual([])
    })
  })

  describe('scoreSuggestion', () => {
    it('should score perfect BPM match highly', () => {
      const vibe = buildVibeProfile({ bpmRange: { max: 125, min: 115 } })
      const track = buildSpotifyTrack('track1', 'Test', 'Artist')
      const lastTrack = buildPlayedTrack({ bpm: 120 })

      // Mock track with BPM 120 (perfect match)
      const score = engine.scoreSuggestion(track, vibe, lastTrack, 120, 0.7)

      // BPM match component should be high (within ±5 = 30 points)
      expect(score).toBeGreaterThan(40)
    })

    it('should score genre overlap highly', () => {
      const vibe = buildVibeProfile({ genres: ['rock', 'indie', 'alternative'] })
      const track = buildSpotifyTrack('track1', 'Test', 'Artist')

      // Mock track with matching genres
      const score = engine.scoreSuggestion(track, vibe, undefined, 120, 0.7, ['rock', 'indie'])

      // Genre overlap should boost score (2 matches * 15 = 30 points)
      expect(score).toBeGreaterThan(30)
    })

    it('should score energy match correctly', () => {
      const vibe = buildVibeProfile({ energyLevel: 7 }) // 0.7 energy
      const track = buildSpotifyTrack('track1', 'Test', 'Artist')

      // Energy match within 0.2
      const score = engine.scoreSuggestion(track, vibe, undefined, 120, 0.75)

      expect(score).toBeGreaterThan(0)
    })

    it('should score era match correctly', () => {
      const vibe = buildVibeProfile({ era: { end: 2020, start: 2010 } })
      const track = buildSpotifyTrack('track1', 'Test', 'Artist', { release_date: '2015-06-15' })

      const score = engine.scoreSuggestion(track, vibe, undefined, 120, 0.7)

      // Era match should contribute to score (25 points)
      expect(score).toBeGreaterThan(20)
    })

    it('should return lower score for poor BPM match', () => {
      const vibe = buildVibeProfile({ bpmRange: { max: 120, min: 100 } })
      const track = buildSpotifyTrack('track1', 'Test', 'Artist')

      // BPM way off (150) - still gets neutral points from energy and era
      const score = engine.scoreSuggestion(track, vibe, undefined, 150, 0.7)

      // Should get low BPM score but neutral from other factors
      expect(score).toBeLessThan(70)
      expect(score).toBeGreaterThan(0)
    })

    it('should handle null BPM gracefully', () => {
      const vibe = buildVibeProfile({ bpmRange: { max: 120, min: 100 } })
      const track = buildSpotifyTrack('track1', 'Test', 'Artist')

      const score = engine.scoreSuggestion(track, vibe, undefined, null, 0.7)

      // Should still return a valid score based on other factors
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    })
  })

  describe('scoreTransition', () => {
    it('should score perfect BPM transition highly', () => {
      const fromTrack = buildPlayedTrack({ bpm: 120 })
      const toTrack = { bpm: 122, energy: 0.7 }

      const score = engine.scoreTransition(fromTrack, toTrack)

      // BPM difference of 2 is within ±10 tolerance, should score high
      expect(score).toBeGreaterThan(75)
    })

    it('should score moderate BPM transition appropriately', () => {
      const fromTrack = buildPlayedTrack({ bpm: 120 })
      const toTrack = { bpm: 128, energy: 0.7 }

      const score = engine.scoreTransition(fromTrack, toTrack)

      // BPM difference of 8 is within tolerance, should score well
      expect(score).toBeGreaterThan(60)
    })

    it('should score large BPM transition lower', () => {
      const fromTrack = buildPlayedTrack({ bpm: 120 })
      const toTrack = { bpm: 155, energy: 0.7 }

      const score = engine.scoreTransition(fromTrack, toTrack)

      // BPM difference of 35 should score significantly lower
      expect(score).toBeLessThan(60)
    })

    it('should handle null BPM values', () => {
      const fromTrack = buildPlayedTrack({ bpm: 120 })
      const toTrack = { bpm: null, energy: 0.7 }

      const score = engine.scoreTransition(fromTrack, toTrack)

      // Should return a neutral-ish score when BPM unknown
      expect(score).toBeGreaterThanOrEqual(20)
      expect(score).toBeLessThanOrEqual(80)
    })
  })

  describe('edge cases', () => {
    it('should handle empty session history', async () => {
      const session = buildMixSession({ history: [] })

      const suggestions = await engine.generateSuggestions(session, 5)

      // Should return empty array (no history to base suggestions on)
      expect(suggestions).toEqual([])
    })

    it('should handle Spotify API failures gracefully', async () => {
      const session = buildMixSession({
        history: [buildPlayedTrack({ trackId: 'track1' })],
      })

      vi.spyOn(lastFmService, 'getTrackSignals').mockResolvedValue(
        buildLastFmSignals({
          similar: [{ artist: 'Artist', match: 0.9, name: 'Song' }],
        })
      )

      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
      } as Response)

      const suggestions = await engine.generateSuggestions(session, 5)

      expect(suggestions).toEqual([])
    })

    it('should handle missing album art', async () => {
      const session = buildMixSession({
        history: [buildPlayedTrack({ trackId: 'track1' })],
      })

      vi.spyOn(lastFmService, 'getTrackSignals').mockResolvedValue(
        buildLastFmSignals({
          similar: [{ artist: 'Artist', match: 0.9, name: 'Song' }],
        })
      )

      const trackNoArt = {
        ...buildSpotifyTrack('track2', 'Song', 'Artist'),
        album: {
          images: [], // No images
          name: 'Album',
          release_date: '2015-01-01',
        },
      }

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve({ tracks: { items: [trackNoArt] } }),
        ok: true,
      } as Response)

      vi.spyOn(audioService, 'enrichTrack').mockResolvedValue({
        bpm: 120,
        gain: null,
        rank: 500,
        release_date: '2015-01-01',
        source: 'deezer',
      })

      const suggestions = await engine.generateSuggestions(session, 5)

      // Should still work, but albumArt should be undefined
      if (suggestions.length > 0) {
        expect(suggestions[0].albumArt).toBeUndefined()
      }
    })
  })
})
