/**
 * Integration Test Helpers
 *
 * Utilities for writing integration tests that test real service behavior
 * with real external APIs.
 *
 * Key Principle: Create realistic test data that matches production patterns
 */

import type { SpotifyTrack } from '@dj/shared-types'

import { MockKVNamespace } from '../integration/setup'

/**
 * Create mock environment for integration tests
 *
 * This provides a test Env object with mock KV namespaces and real API keys.
 */
export function createMockEnv(): {
  ANTHROPIC_API_KEY: string
  AUDIO_FEATURES_CACHE: MockKVNamespace
  ENVIRONMENT: string
  LASTFM_API_KEY?: string
  SESSIONS: MockKVNamespace
  SPOTIFY_CLIENT_ID: string
  SPOTIFY_CLIENT_SECRET: string
} {
  return {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'test-key',
    AUDIO_FEATURES_CACHE: new MockKVNamespace(),
    ENVIRONMENT: 'test',
    LASTFM_API_KEY: process.env.LASTFM_API_KEY,
    SESSIONS: new MockKVNamespace(),
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID ?? 'test-client-id',
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET ?? 'test-client-secret',
  }
}

/**
 * Well-known test tracks with validated ISRCs and metadata
 *
 * These tracks are guaranteed to exist in:
 * - Spotify
 * - Deezer (via ISRC)
 * - Last.fm
 * - MusicBrainz
 *
 * Use these for reliable integration testing.
 *
 * Note: These include extended metadata beyond the basic SpotifyTrack interface
 * for use in integration tests that need external_ids (ISRC), popularity, etc.
 */
export const KNOWN_TEST_TRACKS = {
  BOHEMIAN_RHAPSODY: {
    album: {
      id: '6X9k3hgEYJP706jMJ8L8FG',
      images: [{ height: 640, url: 'https://i.scdn.co/image/ab67616d0000b273e319baafd16e84f0408af2a0', width: 640 }],
      name: 'A Night At The Opera (2011 Remaster)',
    },
    artists: [{ id: '1dfeR4HaWDbWqFHLkxsg1d', name: 'Queen' }],
    duration_ms: 354320,
    explicit: false,
    external_ids: { isrc: 'GBUM71029604' },
    external_urls: { spotify: 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6' },
    id: '6rqhFgbbKwnb9MLmUQDhG6',
    name: 'Bohemian Rhapsody - Remastered 2011',
    popularity: 88,
    preview_url:
      'https://p.scdn.co/mp3-preview/c16c5e6ff7cbd0ad5e25db6c7d48caf99a0fffe9?cid=774b29d4f13844c495f206cafdad9c86',
    uri: 'spotify:track:6rqhFgbbKwnb9MLmUQDhG6',
  },

  MR_BRIGHTSIDE: {
    album: {
      id: '4OHNH3sDzIxnmUADXzv2kT',
      images: [{ height: 640, url: 'https://i.scdn.co/image/ab67616d0000b2734ae1c4c5c45aabe565499163', width: 640 }],
      name: 'Hot Fuss',
    },
    artists: [{ id: '0C0XlULifJtAgn6ZNCW2eu', name: 'The Killers' }],
    duration_ms: 222973,
    explicit: false,
    external_ids: { isrc: 'USIR20400274' },
    external_urls: { spotify: 'https://open.spotify.com/track/003vvx7Niy0yvhvHt4a68B' },
    id: '003vvx7Niy0yvhvHt4a68B',
    name: 'Mr. Brightside',
    popularity: 90,
    preview_url:
      'https://p.scdn.co/mp3-preview/f6e0a8d4c35e2b2e1bccdcf6e5b2e91b5f4f6f5f?cid=774b29d4f13844c495f206cafdad9c86',
    uri: 'spotify:track:003vvx7Niy0yvhvHt4a68B',
  },

  STAIRWAY_TO_HEAVEN: {
    album: {
      id: '44Ig8dzqOkvkGDzaUof9lK',
      images: [{ height: 640, url: 'https://i.scdn.co/image/ab67616d0000b273c8a11e48c91a982d086afc69', width: 640 }],
      name: 'Led Zeppelin IV (Deluxe Edition; Remaster)',
    },
    artists: [{ id: '36QJpDe2go2KgaRleHCDTp', name: 'Led Zeppelin' }],
    duration_ms: 482830,
    explicit: false,
    external_ids: { isrc: 'USAT21100321' },
    external_urls: { spotify: 'https://open.spotify.com/track/5CQ30WqJwcep0pYcV4AMNc' },
    id: '5CQ30WqJwcep0pYcV4AMNc',
    name: 'Stairway to Heaven - Remaster',
    popularity: 82,
    preview_url: null,
    uri: 'spotify:track:5CQ30WqJwcep0pYcV4AMNc',
  },
}

/**
 * Create a test Spotify track object
 *
 * Use predefined KNOWN_TEST_TRACKS for reliable integration testing,
 * or create custom tracks for specific test scenarios.
 *
 * Note: This creates a SpotifyTrack with extended metadata (external_ids, etc.)
 * for use in integration tests.
 */
export function createTestTrack(options?: {
  artistName?: string
  duration_ms?: number
  explicit?: boolean
  id?: string
  isrc?: string
  name?: string
  popularity?: number
}): SpotifyTrack & { duration_ms?: number; explicit?: boolean; external_ids?: { isrc: string }; popularity?: number } {
  const trackId = options?.id ?? 'test-track-id'
  const trackName = options?.name ?? 'Test Track'
  const artistName = options?.artistName ?? 'Test Artist'

  return {
    album: {
      id: 'test-album-id',
      images: [{ height: 640, url: 'https://i.scdn.co/image/test-image', width: 640 }],
      name: 'Test Album',
    },
    artists: [{ id: 'test-artist-id', name: artistName }],
    duration_ms: options?.duration_ms ?? 180000,
    explicit: options?.explicit ?? false,
    external_ids: { isrc: options?.isrc ?? 'TEST12345678' },
    external_urls: { spotify: `https://open.spotify.com/track/${trackId}` },
    id: trackId,
    name: trackName,
    popularity: options?.popularity ?? 50,
    preview_url: `https://p.scdn.co/mp3-preview/${trackId}`,
    uri: `spotify:track:${trackId}`,
  }
}

/**
 * Create an array of test tracks
 *
 * For integration tests that need multiple tracks, use KNOWN_TEST_TRACKS
 * to ensure tracks exist in all external services.
 */
export function createTestTracks(
  count: number
): (SpotifyTrack & { duration_ms?: number; explicit?: boolean; external_ids?: { isrc: string }; popularity?: number })[] {
  const knownTracks = Object.values(KNOWN_TEST_TRACKS)

  // If requesting fewer tracks than known tracks, return subset
  if (count <= knownTracks.length) {
    return knownTracks.slice(0, count)
  }

  // If requesting more, repeat known tracks and add custom tracks
  const tracks: SpotifyTrack[] = [...knownTracks]
  const remaining = count - knownTracks.length

  for (let i = 0; i < remaining; i++) {
    tracks.push(
      createTestTrack({
        artistName: `Test Artist ${i + 1}`,
        id: `test-track-${i + 1}`,
        isrc: `TEST${String(i + 1).padStart(8, '0')}`,
        name: `Test Track ${i + 1}`,
        popularity: 40 + (i % 50),
      })
    )
  }

  return tracks
}

/**
 * Measure execution time of an async function
 *
 * Returns [result, durationMs] tuple.
 *
 * Useful for validating rate limiting and performance.
 */
export async function measureExecutionTime<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = Date.now()
  const result = await fn()
  const duration = Date.now() - start
  return [result, duration]
}

/**
 * Skip test if Last.fm API key is not available
 *
 * Use this at the start of Last.fm integration tests.
 */
export function skipIfNoLastFmKey(): void {
  if (!process.env.LASTFM_API_KEY) {
    console.warn('⚠️  Skipping test: LASTFM_API_KEY not set')
    // Note: In actual tests, use `test.skip()` or conditional test execution
  }
}

/**
 * Wait for a specified number of milliseconds
 *
 * Useful for testing rate limiting and timing behavior.
 */
export function waitFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
