/**
 * Spotify API Contract Tests
 *
 * These tests validate that the real Spotify API responses match our Zod schemas.
 * They use actual HTTP requests to Spotify's API (not mocks) to catch schema drift.
 *
 * Requirements:
 * - SPOTIFY_ACCESS_TOKEN environment variable must be set
 * - Tests are rate-limited (1 second between requests)
 * - Tests are skipped if credentials are missing
 *
 * Run with: SPOTIFY_ACCESS_TOKEN=your_token pnpm test contracts
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  SpotifyAudioFeaturesSchema,
  SpotifyPlaylistFullSchema,
  SpotifyPlaylistTracksResponseSchema,
  SpotifyRecommendationsResponseSchema,
  SpotifySearchResponseSchema,
  SpotifyTrackFullSchema,
  SpotifyUserSchema,
} from '@dj/shared-types'

// ===== Test Configuration =====

const SPOTIFY_BASE_URL = 'https://api.spotify.com/v1'
const RATE_LIMIT_DELAY = 1000 // 1 second between requests

// Well-known test data (stable public Spotify resources)
const TEST_TRACK_ID = '6rqhFgbbKwnb9MLmUQDhG6' // Bohemian Rhapsody by Queen
const TEST_TRACK_IDS = [
  '6rqhFgbbKwnb9MLmUQDhG6', // Bohemian Rhapsody
  '3n3Ppam7vgaVa1iaRUc9Lp', // Mr. Brightside - The Killers
  '5CQ30WqJwcep0pYcV4AMNc', // Stairway to Heaven - Led Zeppelin
]
const TEST_PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M' // Spotify's "Today's Top Hits"
const TEST_ARTIST_ID = '1dfeR4HaWDbWqFHLkxsg1d' // Queen

// ===== Test Helpers =====

/**
 * Check if Spotify access token is available
 */
const hasSpotifyToken = (): boolean => {
  return !!process.env.SPOTIFY_ACCESS_TOKEN
}

/**
 * Make authenticated request to Spotify API
 */
const spotifyRequest = async (endpoint: string): Promise<Response> => {
  const response = await fetch(`${SPOTIFY_BASE_URL}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${process.env.SPOTIFY_ACCESS_TOKEN}`,
    },
  })

  if (!response.ok) {
    throw new Error(
      `Spotify API request failed: ${response.status} ${response.statusText}\n` +
      `Endpoint: ${endpoint}\n` +
      `Response: ${await response.text()}`
    )
  }

  return response
}

/**
 * Rate limiting delay between tests
 */
const rateLimit = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY))
}

// ===== Contract Tests =====

describe('Spotify API Contracts', () => {
  beforeAll(() => {
    if (!hasSpotifyToken()) {
      console.warn(
        '\n⚠️  Skipping Spotify contract tests: SPOTIFY_ACCESS_TOKEN not set\n' +
        'To run these tests, get a token from developer.spotify.com and set:\n' +
        'export SPOTIFY_ACCESS_TOKEN=your_token_here\n'
      )
    }
  })

  // Add rate limiting after each test
  afterEach(async () => {
    if (hasSpotifyToken()) {
      await rateLimit()
    }
  })

  describe('GET /tracks/{id}', () => {
    it.skipIf(!hasSpotifyToken())('matches SpotifyTrackFullSchema', async () => {
      // Fetch a well-known track (Bohemian Rhapsody)
      const response = await spotifyRequest(`/tracks/${TEST_TRACK_ID}`)
      const data = await response.json()

      // Validate against schema
      const result = SpotifyTrackFullSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation failed:')
        console.error(JSON.stringify(result.error.format(), null, 2))
      }

      expect(result.success).toBe(true)

      // Verify expected fields are present
      if (result.success) {
        expect(result.data.name).toBe('Bohemian Rhapsody')
        expect(result.data.artists[0].name).toBe('Queen')
        expect(result.data.id).toBe(TEST_TRACK_ID)
        expect(result.data.type).toBe('track')
        expect(result.data.album).toBeDefined()
        expect(result.data.popularity).toBeGreaterThanOrEqual(0)
        expect(result.data.popularity).toBeLessThanOrEqual(100)
      }
    })
  })

  describe('GET /tracks (bulk)', () => {
    it.skipIf(!hasSpotifyToken())('returns array matching SpotifyTrackFullSchema', async () => {
      // Fetch multiple tracks at once
      const ids = TEST_TRACK_IDS.join(',')
      const response = await spotifyRequest(`/tracks?ids=${ids}`)
      const data = await response.json()

      // Response should have tracks array
      expect(data.tracks).toBeDefined()
      expect(Array.isArray(data.tracks)).toBe(true)
      expect(data.tracks.length).toBe(TEST_TRACK_IDS.length)

      // Validate each track against schema
      for (let i = 0; i < data.tracks.length; i++) {
        const track = data.tracks[i]
        const result = SpotifyTrackFullSchema.safeParse(track)

        if (!result.success) {
          console.error(`Track ${i} schema validation failed:`)
          console.error(JSON.stringify(result.error.format(), null, 2))
        }

        expect(result.success).toBe(true)
      }
    })
  })

  describe('GET /playlists/{id}', () => {
    it.skipIf(!hasSpotifyToken())('matches SpotifyPlaylistFullSchema', async () => {
      // Fetch Spotify's official "Today's Top Hits" playlist
      const response = await spotifyRequest(`/playlists/${TEST_PLAYLIST_ID}`)
      const data = await response.json()

      // Validate against schema
      const result = SpotifyPlaylistFullSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation failed:')
        console.error(JSON.stringify(result.error.format(), null, 2))
      }

      expect(result.success).toBe(true)

      // Verify expected structure
      if (result.success) {
        expect(result.data.name).toBeDefined()
        expect(result.data.id).toBe(TEST_PLAYLIST_ID)
        expect(result.data.type).toBe('playlist')
        expect(result.data.tracks).toBeDefined()
        expect(result.data.tracks.items).toBeDefined()
        expect(Array.isArray(result.data.tracks.items)).toBe(true)
        expect(result.data.tracks.total).toBeGreaterThan(0)
        expect(result.data.owner).toBeDefined()
        expect(result.data.followers).toBeDefined()
      }
    })
  })

  describe('GET /playlists/{id}/tracks', () => {
    it.skipIf(!hasSpotifyToken())('matches SpotifyPlaylistTracksResponseSchema', async () => {
      // Fetch playlist tracks with pagination
      const response = await spotifyRequest(`/playlists/${TEST_PLAYLIST_ID}/tracks?limit=10`)
      const data = await response.json()

      // Validate against paging schema
      const result = SpotifyPlaylistTracksResponseSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation failed:')
        console.error(JSON.stringify(result.error.format(), null, 2))
      }

      expect(result.success).toBe(true)

      // Verify pagination structure
      if (result.success) {
        expect(result.data.items).toBeDefined()
        expect(Array.isArray(result.data.items)).toBe(true)
        expect(result.data.items.length).toBeGreaterThan(0)
        expect(result.data.items.length).toBeLessThanOrEqual(10)
        expect(result.data.limit).toBe(10)
        expect(result.data.offset).toBeDefined()
        expect(result.data.total).toBeGreaterThan(0)

        // Verify track items structure
        const firstItem = result.data.items[0]
        expect(firstItem.track).toBeDefined()
        expect(firstItem.added_at).toBeDefined()
      }
    })

    it.skipIf(!hasSpotifyToken())('supports pagination with offset', async () => {
      // Test pagination by fetching second page
      const response = await spotifyRequest(`/playlists/${TEST_PLAYLIST_ID}/tracks?limit=5&offset=5`)
      const data = await response.json()

      const result = SpotifyPlaylistTracksResponseSchema.safeParse(data)

      if (!result.success) {
        console.error('Pagination schema validation failed:')
        console.error(JSON.stringify(result.error.format(), null, 2))
      }

      expect(result.success).toBe(true)

      if (result.success) {
        expect(result.data.offset).toBe(5)
        expect(result.data.limit).toBe(5)
      }
    })
  })

  describe('GET /audio-features/{id}', () => {
    it.skipIf(!hasSpotifyToken())('matches SpotifyAudioFeaturesSchema', async () => {
      // Fetch audio features for a track
      const response = await spotifyRequest(`/audio-features/${TEST_TRACK_ID}`)
      const data = await response.json()

      // Validate against schema
      const result = SpotifyAudioFeaturesSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation failed:')
        console.error(JSON.stringify(result.error.format(), null, 2))
      }

      expect(result.success).toBe(true)

      // Verify audio feature fields are present and in valid ranges
      if (result.success) {
        expect(result.data.id).toBe(TEST_TRACK_ID)
        expect(result.data.type).toBe('audio_features')

        // Verify all features are in 0-1 range
        expect(result.data.acousticness).toBeGreaterThanOrEqual(0)
        expect(result.data.acousticness).toBeLessThanOrEqual(1)
        expect(result.data.danceability).toBeGreaterThanOrEqual(0)
        expect(result.data.danceability).toBeLessThanOrEqual(1)
        expect(result.data.energy).toBeGreaterThanOrEqual(0)
        expect(result.data.energy).toBeLessThanOrEqual(1)
        expect(result.data.valence).toBeGreaterThanOrEqual(0)
        expect(result.data.valence).toBeLessThanOrEqual(1)

        // Verify tempo is positive
        expect(result.data.tempo).toBeGreaterThan(0)

        // Verify key is in valid range (-1 to 11)
        expect(result.data.key).toBeGreaterThanOrEqual(-1)
        expect(result.data.key).toBeLessThanOrEqual(11)
      }
    })
  })

  describe('GET /audio-features (bulk)', () => {
    it.skipIf(!hasSpotifyToken())('returns array of audio features matching schema', async () => {
      // Fetch audio features for multiple tracks
      const ids = TEST_TRACK_IDS.join(',')
      const response = await spotifyRequest(`/audio-features?ids=${ids}`)
      const data = await response.json()

      // Response should have audio_features array
      expect(data.audio_features).toBeDefined()
      expect(Array.isArray(data.audio_features)).toBe(true)
      expect(data.audio_features.length).toBe(TEST_TRACK_IDS.length)

      // Validate each audio feature (note: can be null for some tracks)
      for (let i = 0; i < data.audio_features.length; i++) {
        const features = data.audio_features[i]

        if (features !== null) {
          const result = SpotifyAudioFeaturesSchema.safeParse(features)

          if (!result.success) {
            console.error(`Audio features ${i} schema validation failed:`)
            console.error(JSON.stringify(result.error.format(), null, 2))
          }

          expect(result.success).toBe(true)
        }
      }
    })
  })

  describe('GET /recommendations', () => {
    it.skipIf(!hasSpotifyToken())('matches SpotifyRecommendationsResponseSchema', async () => {
      // Get recommendations based on seed tracks
      const seedTracks = TEST_TRACK_IDS.slice(0, 2).join(',')
      const response = await spotifyRequest(
        `/recommendations?seed_tracks=${seedTracks}&limit=10`
      )
      const data = await response.json()

      // Validate against schema
      const result = SpotifyRecommendationsResponseSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation failed:')
        console.error(JSON.stringify(result.error.format(), null, 2))
      }

      expect(result.success).toBe(true)

      // Verify recommendations structure
      if (result.success) {
        expect(result.data.tracks).toBeDefined()
        expect(Array.isArray(result.data.tracks)).toBe(true)
        expect(result.data.tracks.length).toBeGreaterThan(0)
        expect(result.data.tracks.length).toBeLessThanOrEqual(10)

        expect(result.data.seeds).toBeDefined()
        expect(Array.isArray(result.data.seeds)).toBe(true)
        expect(result.data.seeds.length).toBeGreaterThan(0)

        // Verify each track is a valid SpotifyTrackFull
        for (const track of result.data.tracks) {
          const trackResult = SpotifyTrackFullSchema.safeParse(track)
          expect(trackResult.success).toBe(true)
        }
      }
    })

    it.skipIf(!hasSpotifyToken())('supports audio feature parameters', async () => {
      // Test recommendations with tunable audio features
      const response = await spotifyRequest(
        `/recommendations?seed_artists=${TEST_ARTIST_ID}&` +
        `target_energy=0.8&target_danceability=0.7&limit=5`
      )
      const data = await response.json()

      const result = SpotifyRecommendationsResponseSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation with audio params failed:')
        console.error(JSON.stringify(result.error.format(), null, 2))
      }

      expect(result.success).toBe(true)

      if (result.success) {
        expect(result.data.tracks.length).toBeGreaterThan(0)
        expect(result.data.tracks.length).toBeLessThanOrEqual(5)
      }
    })
  })

  describe('GET /search', () => {
    it.skipIf(!hasSpotifyToken())('matches SpotifySearchResponseSchema for track search', async () => {
      // Search for tracks
      const query = encodeURIComponent('Bohemian Rhapsody')
      const response = await spotifyRequest(`/search?q=${query}&type=track&limit=10`)
      const data = await response.json()

      // Validate against schema
      const result = SpotifySearchResponseSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation failed:')
        console.error(JSON.stringify(result.error.format(), null, 2))
      }

      expect(result.success).toBe(true)

      // Verify search results structure
      if (result.success) {
        expect(result.data.tracks).toBeDefined()
        expect(result.data.tracks?.items).toBeDefined()
        expect(Array.isArray(result.data.tracks?.items)).toBe(true)

        if (result.data.tracks && result.data.tracks.items.length > 0) {
          // Verify each track matches schema
          for (const track of result.data.tracks.items) {
            const trackResult = SpotifyTrackFullSchema.safeParse(track)
            expect(trackResult.success).toBe(true)
          }
        }
      }
    })

    it.skipIf(!hasSpotifyToken())('supports multiple search types', async () => {
      // Search for both tracks and artists
      const query = encodeURIComponent('Queen')
      const response = await spotifyRequest(`/search?q=${query}&type=track,artist&limit=5`)
      const data = await response.json()

      const result = SpotifySearchResponseSchema.safeParse(data)

      if (!result.success) {
        console.error('Multi-type search schema validation failed:')
        console.error(JSON.stringify(result.error.format(), null, 2))
      }

      expect(result.success).toBe(true)

      if (result.success) {
        // Should have both tracks and artists in response
        expect(result.data.tracks).toBeDefined()
        expect(result.data.artists).toBeDefined()
      }
    })
  })

  describe('GET /me', () => {
    it.skipIf(!hasSpotifyToken())('matches SpotifyUserSchema', async () => {
      // Fetch current user profile
      const response = await spotifyRequest('/me')
      const data = await response.json()

      // Validate against schema
      const result = SpotifyUserSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation failed:')
        console.error(JSON.stringify(result.error.format(), null, 2))
      }

      expect(result.success).toBe(true)

      // Verify user profile structure
      if (result.success) {
        expect(result.data.id).toBeDefined()
        expect(result.data.type).toBe('user')
        expect(result.data.external_urls).toBeDefined()
        expect(result.data.href).toBeDefined()
        expect(result.data.images).toBeDefined()
        expect(Array.isArray(result.data.images)).toBe(true)
      }
    })
  })

  describe('Schema Coverage Summary', () => {
    it('documents tested endpoints', () => {
      const testedEndpoints = [
        'GET /tracks/{id}',
        'GET /tracks (bulk)',
        'GET /playlists/{id}',
        'GET /playlists/{id}/tracks',
        'GET /audio-features/{id}',
        'GET /audio-features (bulk)',
        'GET /recommendations',
        'GET /search',
        'GET /me',
      ]

      const testedSchemas = [
        'SpotifyTrackFullSchema',
        'SpotifyPlaylistFullSchema',
        'SpotifyPlaylistTracksResponseSchema',
        'SpotifyAudioFeaturesSchema',
        'SpotifyRecommendationsResponseSchema',
        'SpotifySearchResponseSchema',
        'SpotifyUserSchema',
      ]

      console.log('\n✅ Contract Test Coverage:')
      console.log(`   - ${testedEndpoints.length} endpoints tested`)
      console.log(`   - ${testedSchemas.length} schemas validated`)
      console.log('\nTested Endpoints:')
      testedEndpoints.forEach(endpoint => console.log(`   - ${endpoint}`))
      console.log('\nValidated Schemas:')
      testedSchemas.forEach(schema => console.log(`   - ${schema}`))

      // This test always passes - it's just documentation
      expect(true).toBe(true)
    })
  })
})
