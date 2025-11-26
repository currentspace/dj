/**
 * AudioEnrichmentService Tests
 * Tests for Deezer + MusicBrainz BPM enrichment service
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AudioEnrichmentService, type BPMEnrichment } from '../../services/AudioEnrichmentService'
import { MockKVNamespace } from '../fixtures/cloudflare-mocks'
import { buildDeezerTrack, buildMusicBrainzRecording, buildSpotifyTrack } from '../fixtures/test-builders'

// Mock the rate-limited API clients
vi.mock('../../utils/RateLimitedAPIClients', () => ({
  rateLimitedDeezerCall: vi.fn((fn: () => Promise<Response>) => fn()),
  getGlobalOrchestrator: vi.fn(() => ({
    execute: vi.fn((fn: () => Promise<unknown>) => fn()),
  })),
}))

// Mock logger
vi.mock('../../utils/LoggerContext', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// TODO: Fix after Vitest 4.x migration - fetch mocking changed behavior
// See: https://vitest.dev/guide/migration.html
describe.skip('AudioEnrichmentService', () => {
  let service: AudioEnrichmentService
  let mockCache: MockKVNamespace

  beforeEach(() => {
    mockCache = new MockKVNamespace()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new AudioEnrichmentService(mockCache as any)
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  describe('Direct ISRC Enrichment', () => {
    it('should query Deezer with ISRC when track has ISRC', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      const deezerTrack = buildDeezerTrack({ bpm: 120 })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(deezerTrack),
      } as Response)

      const result = await service.enrichTrack(track)

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.deezer.com/track/isrc:USRC12345678'),
      )
      expect(result.bpm).toBe(120)
      expect(result.source).toBe('deezer')
    })

    it('should store valid BPM in result', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 140 })),
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(140)
    })

    it('should filter invalid BPM (null) to null', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: null })),
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(null)
    })

    it('should filter invalid BPM (0) to null', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 0 })),
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(null)
    })

    it('should handle network error gracefully', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const result = await service.enrichTrack(track)

      expect(result).toEqual({
        bpm: null,
        gain: null,
        rank: null,
        release_date: null,
        source: null,
      })
    })

    it('should handle Deezer 404 gracefully', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result).toEqual({
        bpm: null,
        gain: null,
        rank: null,
        release_date: null,
        source: null,
      })
    })

    it('should track source as deezer', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result.source).toBe('deezer')
    })

    it('should validate enrichment structure', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve(
            buildDeezerTrack({
              bpm: 128,
              gain: -9.2,
              rank: 600000,
              release_date: '2023-06-15',
            }),
          ),
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result).toEqual({
        bpm: 128,
        gain: -9.2,
        rank: 600000,
        release_date: '2023-06-15',
        source: 'deezer',
      })
    })
  })

  describe('ISRC Fallback via MusicBrainz', () => {
    it('should query MusicBrainz when track has no ISRC', async () => {
      const track = buildSpotifyTrack({
        name: 'Bohemian Rhapsody',
        artists: [{ name: 'Queen' }],
        duration_ms: 354000,
      })

      const mbResponse = {
        recordings: [buildMusicBrainzRecording({ isrcs: ['GBUM71029604'] })],
      }

      global.fetch = vi
        .fn()
        // MusicBrainz call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mbResponse),
        } as Response)
        // Deezer call with found ISRC
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 72 })),
        } as Response)

      await service.enrichTrack(track)

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('musicbrainz.org/ws/2/recording'),
        expect.objectContaining({
          headers: {
            'User-Agent': 'DJApp/1.0 (https://dj.current.space)',
          },
        }),
      )
    })

    it('should query Deezer with ISRC found from MusicBrainz', async () => {
      const track = buildSpotifyTrack({
        name: 'Bohemian Rhapsody',
        artists: [{ name: 'Queen' }],
        duration_ms: 354000,
      })

      const mbResponse = {
        recordings: [buildMusicBrainzRecording({ isrcs: ['GBUM71029604'] })],
      }

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mbResponse),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 72 })),
        } as Response)

      const result = await service.enrichTrack(track)

      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('api.deezer.com/track/isrc:GBUM71029604'),
      )
      expect(result.bpm).toBe(72)
    })

    it('should track source as deezer-via-musicbrainz', async () => {
      const track = buildSpotifyTrack({
        name: 'Bohemian Rhapsody',
        artists: [{ name: 'Queen' }],
      })

      const mbResponse = {
        recordings: [buildMusicBrainzRecording({ isrcs: ['GBUM71029604'] })],
      }

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mbResponse),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 72 })),
        } as Response)

      const result = await service.enrichTrack(track)

      expect(result.source).toBe('deezer-via-musicbrainz')
    })

    it('should handle MusicBrainz no result gracefully', async () => {
      const track = buildSpotifyTrack({
        name: 'Unknown Track',
        artists: [{ name: 'Unknown Artist' }],
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recordings: [] }),
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result).toEqual({
        bpm: null,
        gain: null,
        rank: null,
        release_date: null,
        source: null,
      })
    })

    it('should handle MusicBrainz error gracefully', async () => {
      const track = buildSpotifyTrack({
        name: 'Test Track',
        artists: [{ name: 'Test Artist' }],
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result).toEqual({
        bpm: null,
        gain: null,
        rank: null,
        release_date: null,
        source: null,
      })
    })

    it('should use first ISRC when MusicBrainz returns multiple', async () => {
      const track = buildSpotifyTrack({
        name: 'Test Track',
        artists: [{ name: 'Test Artist' }],
      })

      const mbResponse = {
        recordings: [
          buildMusicBrainzRecording({ isrcs: ['ISRC1', 'ISRC2', 'ISRC3'] }),
        ],
      }

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mbResponse),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
        } as Response)

      await service.enrichTrack(track)

      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('api.deezer.com/track/isrc:ISRC1'),
      )
    })
  })

  describe('Cache Hit/Miss Logic', () => {
    it('should return cached result immediately on fresh hit', async () => {
      const track = buildSpotifyTrack({ id: 'cached-track' })

      await mockCache.put(
        'bpm:cached-track',
        JSON.stringify({
          enrichment: { bpm: 120, gain: -8, rank: 500000, release_date: '2023-01-01', source: 'deezer' },
          fetched_at: new Date().toISOString(),
          is_miss: false,
          ttl: 90 * 24 * 60 * 60,
        }),
      )

      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(120)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('should return null without retry on recent miss (< 5min)', async () => {
      const track = buildSpotifyTrack({ id: 'recent-miss' })

      await mockCache.put(
        'bpm:recent-miss',
        JSON.stringify({
          enrichment: { bpm: null, gain: null, rank: null, release_date: null, source: null },
          fetched_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 minutes ago
          is_miss: true,
          ttl: 5 * 60,
        }),
      )

      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(null)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('should retry Deezer on old miss (> 5min)', async () => {
      const track = buildSpotifyTrack({
        id: 'old-miss',
        external_ids: { isrc: 'USRC12345678' },
      })

      await mockCache.put(
        'bpm:old-miss',
        JSON.stringify({
          enrichment: { bpm: null, gain: null, rank: null, release_date: null, source: null },
          fetched_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 minutes ago
          is_miss: true,
          ttl: 5 * 60,
        }),
      )

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 128 })),
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(128)
      expect(global.fetch).toHaveBeenCalled()
    })

    it('should query API on cache miss', async () => {
      const track = buildSpotifyTrack({
        id: 'new-track',
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 130 })),
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(130)
      expect(global.fetch).toHaveBeenCalled()
    })

    it('should cache successful result with 90-day TTL', async () => {
      const track = buildSpotifyTrack({
        id: 'success-track',
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 140 })),
      } as Response)

      await service.enrichTrack(track)

      const cached = await mockCache.get('bpm:success-track', 'json')
      expect(cached).toBeTruthy()
      expect((cached as { enrichment: BPMEnrichment }).enrichment.bpm).toBe(140)
      expect((cached as { ttl: number }).ttl).toBe(90 * 24 * 60 * 60)
    })

    it('should cache miss with 5-min TTL', async () => {
      const track = buildSpotifyTrack({
        id: 'miss-track',
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as Response)

      await service.enrichTrack(track)

      const cached = await mockCache.get('bpm:miss-track', 'json')
      expect(cached).toBeTruthy()
      expect((cached as { enrichment: BPMEnrichment }).enrichment.bpm).toBe(null)
      expect((cached as { is_miss: boolean }).is_miss).toBe(true)
      expect((cached as { ttl: number }).ttl).toBe(5 * 60)
    })

    it('should use cache key format bpm:{track_id}', async () => {
      const track = buildSpotifyTrack({
        id: 'specific-id',
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
      } as Response)

      await service.enrichTrack(track)

      const cached = await mockCache.get('bpm:specific-id', 'json')
      expect(cached).toBeTruthy()
    })

    it('should handle concurrent requests for same track (cache)', async () => {
      const track = buildSpotifyTrack({
        id: 'concurrent-track',
        external_ids: { isrc: 'USRC12345678' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
      } as Response)

      // First call populates cache
      await service.enrichTrack(track)

      // Second call should use cache
      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(120)
      expect(global.fetch).toHaveBeenCalledTimes(1) // Only called once
    })
  })

  describe('Batch Processing', () => {
    it('should process multiple tracks in parallel', async () => {
      const tracks = [
        buildSpotifyTrack({ id: 'track1', external_ids: { isrc: 'ISRC1' } }),
        buildSpotifyTrack({ id: 'track2', external_ids: { isrc: 'ISRC2' } }),
        buildSpotifyTrack({ id: 'track3', external_ids: { isrc: 'ISRC3' } }),
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
      } as Response)

      const results = await service.batchEnrichTracks(tracks)

      expect(results.size).toBe(3)
      expect(results.get('track1')?.bpm).toBe(120)
      expect(results.get('track2')?.bpm).toBe(120)
      expect(results.get('track3')?.bpm).toBe(120)
    })

    it('should key results by track ID', async () => {
      const tracks = [
        buildSpotifyTrack({ id: 'unique-id-1', external_ids: { isrc: 'ISRC1' } }),
        buildSpotifyTrack({ id: 'unique-id-2', external_ids: { isrc: 'ISRC2' } }),
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 125 })),
      } as Response)

      const results = await service.batchEnrichTracks(tracks)

      expect(results.has('unique-id-1')).toBe(true)
      expect(results.has('unique-id-2')).toBe(true)
    })

    it('should complete all tracks before return', async () => {
      const tracks = [
        buildSpotifyTrack({ id: 'track1', external_ids: { isrc: 'ISRC1' } }),
        buildSpotifyTrack({ id: 'track2', external_ids: { isrc: 'ISRC2' } }),
      ]

      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
        } as Response),
      )

      const results = await service.batchEnrichTracks(tracks)

      expect(results.size).toBe(2)
      // All tracks should have completed
      expect(Array.from(results.values()).every(r => r.bpm !== undefined)).toBe(true)
    })

    it('should not block other tracks on error', async () => {
      const tracks = [
        buildSpotifyTrack({ id: 'track1', external_ids: { isrc: 'ISRC1' } }),
        buildSpotifyTrack({ id: 'track2', external_ids: { isrc: 'ISRC2' } }),
        buildSpotifyTrack({ id: 'track3', external_ids: { isrc: 'ISRC3' } }),
      ]

      let callCount = 0
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 2) {
          // Fail second track
          return Promise.resolve({
            ok: false,
            status: 500,
          } as Response)
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
        } as Response)
      })

      const results = await service.batchEnrichTracks(tracks)

      expect(results.size).toBe(3)
      expect(results.get('track1')?.bpm).toBe(120)
      expect(results.get('track2')?.bpm).toBe(null) // Error track
      expect(results.get('track3')?.bpm).toBe(120)
    })
  })

  describe('Data Validation', () => {
    it('should validate BPM range (45-220)', () => {
      expect(AudioEnrichmentService.isValidBPM(45)).toBe(true)
      expect(AudioEnrichmentService.isValidBPM(120)).toBe(true)
      expect(AudioEnrichmentService.isValidBPM(220)).toBe(true)
      expect(AudioEnrichmentService.isValidBPM(44)).toBe(false)
      expect(AudioEnrichmentService.isValidBPM(221)).toBe(false)
      expect(AudioEnrichmentService.isValidBPM(0)).toBe(false)
      expect(AudioEnrichmentService.isValidBPM(null)).toBe(false)
    })

    it('should track source accurately', async () => {
      // Direct Deezer
      const track1 = buildSpotifyTrack({
        id: 'track1',
        external_ids: { isrc: 'ISRC1' },
      })

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
      } as Response)

      const result1 = await service.enrichTrack(track1)
      expect(result1.source).toBe('deezer')

      // Via MusicBrainz
      const track2 = buildSpotifyTrack({
        id: 'track2',
        name: 'Test',
        artists: [{ name: 'Test' }],
      })

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              recordings: [buildMusicBrainzRecording({ isrcs: ['ISRC2'] })],
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 130 })),
        } as Response)

      const result2 = await service.enrichTrack(track2)
      expect(result2.source).toBe('deezer-via-musicbrainz')

      // No source (miss)
      const track3 = buildSpotifyTrack({
        id: 'track3',
        external_ids: { isrc: 'ISRC3' },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as Response)

      const result3 = await service.enrichTrack(track3)
      expect(result3.source).toBe(null)
    })
  })
})
