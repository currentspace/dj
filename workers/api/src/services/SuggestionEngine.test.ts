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
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import type { MixSession, PlayedTrack, VibeProfile } from '@dj/shared-types'
import { AudioEnrichmentService } from '../services/AudioEnrichmentService'
import { LastFmService, type LastFmSignals } from '../services/LastFmService'
import { SuggestionEngine } from './SuggestionEngine'
import { MockKVNamespace } from '../__tests__/fixtures/cloudflare-mocks'

// Test data builders
function buildVibeProfile(overrides?: Partial<VibeProfile>): VibeProfile {
  return {
    mood: ['energetic', 'upbeat'],
    genres: ['rock', 'indie'],
    era: { start: 2000, end: 2020 },
    bpmRange: { min: 100, max: 140 },
    energyLevel: 7,
    energyDirection: 'steady',
    ...overrides,
  }
}

function buildPlayedTrack(overrides?: Partial<PlayedTrack>): PlayedTrack {
  return {
    trackId: 'track-123',
    trackUri: 'spotify:track:123',
    name: 'Test Track',
    artist: 'Test Artist',
    playedAt: new Date().toISOString(),
    bpm: 120,
    energy: 0.7,
    ...overrides,
  }
}

function buildMixSession(overrides?: Partial<MixSession>): MixSession {
  return {
    id: crypto.randomUUID(),
    userId: 'user-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    vibe: buildVibeProfile(),
    history: [],
    queue: [],
    preferences: {
      avoidGenres: [],
      favoriteArtists: [],
      bpmLock: null,
      autoFill: true,
    },
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
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: [{ name: artist }],
    album: {
      name: 'Test Album',
      images: [{ url: 'https://example.com/image.jpg' }],
      release_date: overrides?.release_date || '2015-01-01',
    },
    duration_ms: 200000,
    popularity: 70,
    external_ids: { isrc: 'TEST123' },
  }
}

function buildLastFmSignals(overrides?: Partial<LastFmSignals>): LastFmSignals {
  return {
    canonicalArtist: 'Test Artist',
    canonicalTrack: 'Test Track',
    similar: [],
    topTags: [],
    listeners: 1000,
    playcount: 5000,
    mbid: null,
    url: null,
    album: null,
    artistInfo: null,
    duration: null,
    wiki: null,
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
        vibe: buildVibeProfile({ genres: ['rock', 'indie'], bpmRange: { min: 110, max: 130 } }),
        history: [
          buildPlayedTrack({ trackId: 'track1', name: 'Song 1', artist: 'Artist 1', bpm: 120 }),
        ],
      })

      // Spy on Last.fm service
      vi.spyOn(lastFmService, 'getTrackSignals').mockResolvedValue(
        buildLastFmSignals({
          similar: [
            { artist: 'Artist 2', name: 'Song 2', match: 0.9 },
            { artist: 'Artist 3', name: 'Song 3', match: 0.8 },
          ],
          topTags: ['rock', 'indie'],
        })
      )

      // Mock Spotify search for similar tracks
      const mockTrack2 = buildSpotifyTrack('track2', 'Song 2', 'Artist 2')
      const mockTrack3 = buildSpotifyTrack('track3', 'Song 3', 'Artist 3')

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ tracks: { items: [mockTrack2] } }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ tracks: { items: [mockTrack3] } }),
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
          buildPlayedTrack({ trackId: 'track1', name: 'Song 1', artist: 'Artist 1' }),
          buildPlayedTrack({ trackId: 'track2', name: 'Song 2', artist: 'Artist 2' }),
        ],
      })

      vi.spyOn(lastFmService, 'getTrackSignals').mockResolvedValue(
        buildLastFmSignals({
          similar: [
            { artist: 'Artist 2', name: 'Song 2', match: 0.9 }, // Already in history
            { artist: 'Artist 3', name: 'Song 3', match: 0.8 },
          ],
        })
      )

      const mockTrack3 = buildSpotifyTrack('track3', 'Song 3', 'Artist 3')
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tracks: { items: [mockTrack3] } }),
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
        history: [buildPlayedTrack({ trackId: 'track1', name: 'Song 1', artist: 'Artist 1' })],
        queue: [
          {
            trackId: 'track2',
            trackUri: 'spotify:track:track2',
            name: 'Song 2',
            artist: 'Artist 2',
            addedBy: 'user',
            vibeScore: 85,
            position: 0,
          },
        ],
      })

      vi.spyOn(lastFmService, 'getTrackSignals').mockResolvedValue(
        buildLastFmSignals({
          similar: [
            { artist: 'Artist 2', name: 'Song 2', match: 0.9 }, // Already in queue
            { artist: 'Artist 3', name: 'Song 3', match: 0.8 },
          ],
        })
      )

      const mockTrack3 = buildSpotifyTrack('track3', 'Song 3', 'Artist 3')
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tracks: { items: [mockTrack3] } }),
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
      const vibe = buildVibeProfile({ bpmRange: { min: 115, max: 125 } })
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
      const vibe = buildVibeProfile({ era: { start: 2010, end: 2020 } })
      const track = buildSpotifyTrack('track1', 'Test', 'Artist', { release_date: '2015-06-15' })

      const score = engine.scoreSuggestion(track, vibe, undefined, 120, 0.7)

      // Era match should contribute to score (25 points)
      expect(score).toBeGreaterThan(20)
    })

    it('should return lower score for poor BPM match', () => {
      const vibe = buildVibeProfile({ bpmRange: { min: 100, max: 120 } })
      const track = buildSpotifyTrack('track1', 'Test', 'Artist')

      // BPM way off (150) - still gets neutral points from energy and era
      const score = engine.scoreSuggestion(track, vibe, undefined, 150, 0.7)

      // Should get low BPM score but neutral from other factors
      expect(score).toBeLessThan(70)
      expect(score).toBeGreaterThan(0)
    })

    it('should handle null BPM gracefully', () => {
      const vibe = buildVibeProfile({ bpmRange: { min: 100, max: 120 } })
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

      // BPM difference is 2 (< 5), should score 100
      expect(score).toBe(100)
    })

    it('should score moderate BPM transition appropriately', () => {
      const fromTrack = buildPlayedTrack({ bpm: 120 })
      const toTrack = { bpm: 128, energy: 0.7 }

      const score = engine.scoreTransition(fromTrack, toTrack)

      // BPM difference is 8 (< 10), should score 80
      expect(score).toBe(80)
    })

    it('should score large BPM transition lower', () => {
      const fromTrack = buildPlayedTrack({ bpm: 120 })
      const toTrack = { bpm: 155, energy: 0.7 }

      const score = engine.scoreTransition(fromTrack, toTrack)

      // BPM difference is 35 (> 20), should score 30
      expect(score).toBe(30)
    })

    it('should handle null BPM values', () => {
      const fromTrack = buildPlayedTrack({ bpm: 120 })
      const toTrack = { bpm: null, energy: 0.7 }

      const score = engine.scoreTransition(fromTrack, toTrack)

      // Should return a baseline score (50)
      expect(score).toBe(50)
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
          similar: [{ artist: 'Artist', name: 'Song', match: 0.9 }],
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
          similar: [{ artist: 'Artist', name: 'Song', match: 0.9 }],
        })
      )

      const trackNoArt = {
        ...buildSpotifyTrack('track2', 'Song', 'Artist'),
        album: {
          name: 'Album',
          images: [], // No images
          release_date: '2015-01-01',
        },
      }

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tracks: { items: [trackNoArt] } }),
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
