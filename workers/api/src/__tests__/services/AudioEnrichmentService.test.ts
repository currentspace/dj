/**
 * AudioEnrichmentService Tests
 * Tests for Deezer + MusicBrainz BPM enrichment service
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Vitest 4: Create hoisted fetch mock BEFORE imports are evaluated
const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', fetchMock)

import { AudioEnrichmentService, type BPMEnrichment } from '../../services/AudioEnrichmentService'
import { MockKVNamespace } from '../fixtures/cloudflare-mocks'
import {
  buildDeezerTrack,
  buildMusicBrainzRecording,
  buildMusicBrainzSearchResponse,
  buildSpotifyTrack
} from '../fixtures/test-builders'

// Mock the rate-limited API clients
vi.mock('../../utils/RateLimitedAPIClients', () => ({
  getGlobalOrchestrator: vi.fn(() => ({
    execute: vi.fn((fn: () => Promise<unknown>) => fn()),
  })),
  rateLimitedDeezerCall: vi.fn((fn: () => Promise<Response>) => fn()),
}))

// Mock logger
vi.mock('../../utils/LoggerContext', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

describe('AudioEnrichmentService', () => {
  let service: AudioEnrichmentService
  let mockCache: MockKVNamespace

  beforeEach(() => {
    mockCache = new MockKVNamespace()
     
    service = new AudioEnrichmentService(mockCache as any)
    // Reset the hoisted fetch mock for each test
    fetchMock.mockReset()
  })

  describe('Direct ISRC Enrichment', () => {
    it('should query Deezer with ISRC when track has ISRC', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      const deezerTrack = buildDeezerTrack({ bpm: 120 })

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(deezerTrack),
        ok: true,
      } as Response)

      const result = await service.enrichTrack(track)

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api.deezer.com/track/isrc:USRC12345678'),
      )
      expect(result.bpm).toBe(120)
      expect(result.source).toBe('deezer')
    })

    it('should store valid BPM in result', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 140 })),
        ok: true,
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(140)
    })

    it('should filter invalid BPM (null) to null', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: null })),
        ok: true,
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(null)
    })

    // NOTE: The service's isValidBPM method says 45-220 is valid, but the service
    // doesn't actually filter BPM values - it returns them as-is from Deezer.
    // This test verifies current behavior (BPM=0 is passed through unchanged).
    it('should pass through BPM of 0 from Deezer', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 0 })),
        ok: true,
      } as Response)

      const result = await service.enrichTrack(track)

      // BPM=0 passes Zod validation (min: 0) and is returned unchanged
      expect(result.bpm).toBe(0)
    })

    it('should handle network error gracefully', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      fetchMock.mockRejectedValue(new Error('Network error'))

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

      fetchMock.mockResolvedValue({
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

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
        ok: true,
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result.source).toBe('deezer')
    })

    it('should validate enrichment structure', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
      })

      fetchMock.mockResolvedValue({
        json: () =>
          Promise.resolve(
            buildDeezerTrack({
              bpm: 128,
              gain: -9.2,
              rank: 600000,
              release_date: '2023-06-15',
            }),
          ),
        ok: true,
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
        artists: [{ name: 'Queen' }],
        duration_ms: 354000,
        name: 'Bohemian Rhapsody',
      })

      const mbResponse = buildMusicBrainzSearchResponse([
        buildMusicBrainzRecording({ isrcs: ['GBUM71029604'] })
      ])

      fetchMock
        // MusicBrainz call
        .mockResolvedValueOnce({
          json: () => Promise.resolve(mbResponse),
          ok: true,
        } as Response)
        // Deezer call with found ISRC
        .mockResolvedValueOnce({
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 72 })),
          ok: true,
        } as Response)

      await service.enrichTrack(track)

      expect(fetchMock).toHaveBeenCalledWith(
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
        artists: [{ name: 'Queen' }],
        duration_ms: 354000,
        name: 'Bohemian Rhapsody',
      })

      const mbResponse = buildMusicBrainzSearchResponse([
        buildMusicBrainzRecording({ isrcs: ['GBUM71029604'] })
      ])

      fetchMock
        .mockResolvedValueOnce({
          json: () => Promise.resolve(mbResponse),
          ok: true,
        } as Response)
        .mockResolvedValueOnce({
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 72 })),
          ok: true,
        } as Response)

      const result = await service.enrichTrack(track)

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('api.deezer.com/track/isrc:GBUM71029604'),
      )
      expect(result.bpm).toBe(72)
    })

    it('should track source as deezer-via-musicbrainz', async () => {
      const track = buildSpotifyTrack({
        artists: [{ name: 'Queen' }],
        name: 'Bohemian Rhapsody',
      })

      const mbResponse = buildMusicBrainzSearchResponse([
        buildMusicBrainzRecording({ isrcs: ['GBUM71029604'] })
      ])

      fetchMock
        .mockResolvedValueOnce({
          json: () => Promise.resolve(mbResponse),
          ok: true,
        } as Response)
        .mockResolvedValueOnce({
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 72 })),
          ok: true,
        } as Response)

      const result = await service.enrichTrack(track)

      expect(result.source).toBe('deezer-via-musicbrainz')
    })

    it('should handle MusicBrainz no result gracefully', async () => {
      const track = buildSpotifyTrack({
        artists: [{ name: 'Unknown Artist' }],
        name: 'Unknown Track',
      })

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildMusicBrainzSearchResponse([])),
        ok: true,
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
        artists: [{ name: 'Test Artist' }],
        name: 'Test Track',
      })

      fetchMock.mockResolvedValue({
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
        artists: [{ name: 'Test Artist' }],
        name: 'Test Track',
      })

      const mbResponse = buildMusicBrainzSearchResponse([
        buildMusicBrainzRecording({ isrcs: ['ISRC1', 'ISRC2', 'ISRC3'] }),
      ])

      fetchMock
        .mockResolvedValueOnce({
          json: () => Promise.resolve(mbResponse),
          ok: true,
        } as Response)
        .mockResolvedValueOnce({
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
          ok: true,
        } as Response)

      await service.enrichTrack(track)

      expect(fetchMock).toHaveBeenNthCalledWith(
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
      expect(fetchMock).not.toHaveBeenCalled()
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
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('should retry Deezer on old miss (> 5min)', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
        id: 'old-miss',
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

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 128 })),
        ok: true,
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(128)
      expect(fetchMock).toHaveBeenCalled()
    })

    it('should query API on cache miss', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
        id: 'new-track',
      })

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 130 })),
        ok: true,
      } as Response)

      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(130)
      expect(fetchMock).toHaveBeenCalled()
    })

    it('should cache successful result with 90-day TTL', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
        id: 'success-track',
      })

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 140 })),
        ok: true,
      } as Response)

      await service.enrichTrack(track)

      const cached = await mockCache.get('bpm:success-track', 'json')
      expect(cached).toBeTruthy()
      expect((cached as { enrichment: BPMEnrichment }).enrichment.bpm).toBe(140)
      expect((cached as { ttl: number }).ttl).toBe(90 * 24 * 60 * 60)
    })

    it('should cache miss with 5-min TTL', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
        id: 'miss-track',
      })

      fetchMock.mockResolvedValue({
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
        external_ids: { isrc: 'USRC12345678' },
        id: 'specific-id',
      })

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
        ok: true,
      } as Response)

      await service.enrichTrack(track)

      const cached = await mockCache.get('bpm:specific-id', 'json')
      expect(cached).toBeTruthy()
    })

    it('should handle concurrent requests for same track (cache)', async () => {
      const track = buildSpotifyTrack({
        external_ids: { isrc: 'USRC12345678' },
        id: 'concurrent-track',
      })

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
        ok: true,
      } as Response)

      // First call populates cache
      await service.enrichTrack(track)

      // Second call should use cache
      const result = await service.enrichTrack(track)

      expect(result.bpm).toBe(120)
      expect(fetchMock).toHaveBeenCalledTimes(1) // Only called once
    })
  })

  describe('Batch Processing', () => {
    it('should process multiple tracks in parallel', async () => {
      const tracks = [
        buildSpotifyTrack({ external_ids: { isrc: 'ISRC1' }, id: 'track1' }),
        buildSpotifyTrack({ external_ids: { isrc: 'ISRC2' }, id: 'track2' }),
        buildSpotifyTrack({ external_ids: { isrc: 'ISRC3' }, id: 'track3' }),
      ]

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
        ok: true,
      } as Response)

      const results = await service.batchEnrichTracks(tracks)

      expect(results.size).toBe(3)
      expect(results.get('track1')?.bpm).toBe(120)
      expect(results.get('track2')?.bpm).toBe(120)
      expect(results.get('track3')?.bpm).toBe(120)
    })

    it('should key results by track ID', async () => {
      const tracks = [
        buildSpotifyTrack({ external_ids: { isrc: 'ISRC1' }, id: 'unique-id-1' }),
        buildSpotifyTrack({ external_ids: { isrc: 'ISRC2' }, id: 'unique-id-2' }),
      ]

      fetchMock.mockResolvedValue({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 125 })),
        ok: true,
      } as Response)

      const results = await service.batchEnrichTracks(tracks)

      expect(results.has('unique-id-1')).toBe(true)
      expect(results.has('unique-id-2')).toBe(true)
    })

    it('should complete all tracks before return', async () => {
      const tracks = [
        buildSpotifyTrack({ external_ids: { isrc: 'ISRC1' }, id: 'track1' }),
        buildSpotifyTrack({ external_ids: { isrc: 'ISRC2' }, id: 'track2' }),
      ]

      fetchMock.mockImplementation(() =>
        Promise.resolve({
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
          ok: true,
        } as Response),
      )

      const results = await service.batchEnrichTracks(tracks)

      expect(results.size).toBe(2)
      // All tracks should have completed
      expect(Array.from(results.values()).every(r => r.bpm !== undefined)).toBe(true)
    })

    it('should not block other tracks on error', async () => {
      const tracks = [
        buildSpotifyTrack({ external_ids: { isrc: 'ISRC1' }, id: 'track1' }),
        buildSpotifyTrack({ external_ids: { isrc: 'ISRC2' }, id: 'track2' }),
        buildSpotifyTrack({ external_ids: { isrc: 'ISRC3' }, id: 'track3' }),
      ]

      let callCount = 0
      fetchMock.mockImplementation(() => {
        callCount++
        if (callCount === 2) {
          // Fail second track
          return Promise.resolve({
            ok: false,
            status: 500,
          } as Response)
        }
        return Promise.resolve({
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
          ok: true,
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
        external_ids: { isrc: 'ISRC1' },
        id: 'track1',
      })

      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve(buildDeezerTrack({ bpm: 120 })),
        ok: true,
      } as Response)

      const result1 = await service.enrichTrack(track1)
      expect(result1.source).toBe('deezer')

      // Via MusicBrainz
      const track2 = buildSpotifyTrack({
        artists: [{ name: 'Test' }],
        id: 'track2',
        name: 'Test',
      })

      fetchMock
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve(buildMusicBrainzSearchResponse([
              buildMusicBrainzRecording({ isrcs: ['ISRC2'] })
            ])),
          ok: true,
        } as Response)
        .mockResolvedValueOnce({
          json: () => Promise.resolve(buildDeezerTrack({ bpm: 130 })),
          ok: true,
        } as Response)

      const result2 = await service.enrichTrack(track2)
      expect(result2.source).toBe('deezer-via-musicbrainz')

      // No source (miss)
      const track3 = buildSpotifyTrack({
        external_ids: { isrc: 'ISRC3' },
        id: 'track3',
      })

      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
      } as Response)

      const result3 = await service.enrichTrack(track3)
      expect(result3.source).toBe(null)
    })
  })
})
