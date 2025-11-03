/**
 * Last.fm API Contract Tests
 *
 * These tests validate that the real Last.fm API responses match our Zod schemas.
 * They use actual API calls with rate limiting to respect Last.fm's 5 requests/second limit.
 *
 * Required environment variable: LASTFM_API_KEY
 *
 * Run with: pnpm test:contracts lastfm
 */

import {
  LastFmArtistInfoResponseSchema,
  LastFmTrackCorrectionResponseSchema,
  LastFmTrackInfoResponseSchema,
  LastFmTrackSimilarResponseSchema,
  LastFmTrackTopTagsResponseSchema,
} from '@dj/shared-types'
import {describe, expect, it} from 'vitest'

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0/'
const RATE_LIMIT_DELAY_MS = 200 // Last.fm allows 5 req/s, we use 200ms = 5 req/s
const hasKey = !!process.env.LASTFM_API_KEY

// Utility to pause between tests for rate limiting
const rateLimitPause = () => new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS))

// Helper to build Last.fm API URL
function buildLastFmUrl(method: string, params: Record<string, string>): string {
  const queryParams = new URLSearchParams({
    api_key: process.env.LASTFM_API_KEY!,
    format: 'json',
    method,
    ...params,
  })
  return `${LASTFM_API_BASE}?${queryParams}`
}

describe('Last.fm API Contract Tests', () => {
  // Test 1: track.getInfo - Core track information with tags, popularity, album
  it.skipIf(!hasKey)('track.getInfo matches LastFmTrackInfoResponseSchema', async () => {
    const url = buildLastFmUrl('track.getInfo', {
      artist: 'Queen',
      autocorrect: '1',
      track: 'Bohemian Rhapsody',
    })

    const response = await fetch(url)
    expect(response.ok).toBe(true)

    const data = await response.json()

    // Validate response structure
    expect(data.track).toBeDefined()
    expect(data.track.name).toBe('Bohemian Rhapsody')
    expect(data.track.artist).toBeDefined()
    expect(data.track.artist.name).toBe('Queen')

    // Validate popularity fields exist (Last.fm returns numbers)
    expect(data.track.listeners).toBeDefined()
    expect(typeof data.track.listeners).toBe('number')
    expect(data.track.playcount).toBeDefined()
    expect(typeof data.track.playcount).toBe('number')

    // Validate top tags structure
    if (data.track.toptags?.tag) {
      expect(Array.isArray(data.track.toptags.tag)).toBe(true)
      if (data.track.toptags.tag.length > 0) {
        const firstTag = data.track.toptags.tag[0]
        expect(firstTag.name).toBeDefined()
        expect(typeof firstTag.name).toBe('string')
        expect(firstTag.url).toBeDefined()
      }
    }

    // Validate album structure if present
    if (data.track.album) {
      expect(data.track.album.title).toBeDefined()
      expect(data.track.album.artist).toBeDefined()
      expect(data.track.album.url).toBeDefined()
    }

    // Validate wiki if present
    if (data.track.wiki) {
      expect(data.track.wiki.summary).toBeDefined()
      expect(typeof data.track.wiki.summary).toBe('string')
    }

    // Validate against Zod schema
    const result = LastFmTrackInfoResponseSchema.safeParse(data)
    if (!result.success) {
      console.error('Schema validation errors:', JSON.stringify(result.error.format(), null, 2))
    }
    expect(result.success).toBe(true)

    await rateLimitPause()
  })

  // Test 2: track.getSimilar - Similar track recommendations
  it.skipIf(!hasKey)('track.getSimilar matches LastFmTrackSimilarResponseSchema', async () => {
    const url = buildLastFmUrl('track.getSimilar', {
      artist: 'Queen',
      autocorrect: '1',
      limit: '10',
      track: 'Bohemian Rhapsody',
    })

    const response = await fetch(url)
    expect(response.ok).toBe(true)

    const data = await response.json()

    // Validate response structure
    expect(data.similartracks).toBeDefined()
    expect(data.similartracks.track).toBeDefined()
    expect(Array.isArray(data.similartracks.track)).toBe(true)

    // Validate first similar track structure
    if (data.similartracks.track.length > 0) {
      const firstTrack = data.similartracks.track[0]
      expect(firstTrack.name).toBeDefined()
      expect(firstTrack.artist).toBeDefined()
      expect(firstTrack.artist.name).toBeDefined()
      expect(firstTrack.match).toBeDefined()
      expect(typeof firstTrack.match).toBe('number')
      expect(firstTrack.match).toBeGreaterThanOrEqual(0)
      expect(firstTrack.match).toBeLessThanOrEqual(1)
      expect(firstTrack.url).toBeDefined()
    }

    // Validate against Zod schema
    const result = LastFmTrackSimilarResponseSchema.safeParse(data)
    if (!result.success) {
      console.error('Schema validation errors:', JSON.stringify(result.error.format(), null, 2))
    }
    expect(result.success).toBe(true)

    await rateLimitPause()
  })

  // Test 3: artist.getInfo - Artist bio, tags, similar artists, stats
  it.skipIf(!hasKey)('artist.getInfo matches LastFmArtistInfoResponseSchema', async () => {
    const url = buildLastFmUrl('artist.getInfo', {
      artist: 'Queen',
      autocorrect: '1',
    })

    const response = await fetch(url)
    expect(response.ok).toBe(true)

    const data = await response.json()

    // Validate response structure
    expect(data.artist).toBeDefined()
    expect(data.artist.name).toBe('Queen')
    expect(data.artist.url).toBeDefined()

    // Validate bio structure
    if (data.artist.bio) {
      expect(data.artist.bio.summary).toBeDefined()
      expect(typeof data.artist.bio.summary).toBe('string')
      if (data.artist.bio.content) {
        expect(typeof data.artist.bio.content).toBe('string')
      }
    }

    // Validate stats
    if (data.artist.stats) {
      expect(data.artist.stats.listeners).toBeDefined()
      expect(typeof data.artist.stats.listeners).toBe('number')
      expect(data.artist.stats.playcount).toBeDefined()
      expect(typeof data.artist.stats.playcount).toBe('number')
    }

    // Validate tags structure
    if (data.artist.tags?.tag) {
      expect(Array.isArray(data.artist.tags.tag)).toBe(true)
      if (data.artist.tags.tag.length > 0) {
        const firstTag = data.artist.tags.tag[0]
        expect(firstTag.name).toBeDefined()
        expect(firstTag.url).toBeDefined()
      }
    }

    // Validate similar artists
    if (data.artist.similar?.artist) {
      expect(Array.isArray(data.artist.similar.artist)).toBe(true)
      if (data.artist.similar.artist.length > 0) {
        const firstSimilar = data.artist.similar.artist[0]
        expect(firstSimilar.name).toBeDefined()
        expect(firstSimilar.url).toBeDefined()
      }
    }

    // Validate images
    if (data.artist.image) {
      expect(Array.isArray(data.artist.image)).toBe(true)
      if (data.artist.image.length > 0) {
        const firstImage = data.artist.image[0]
        expect(firstImage['#text']).toBeDefined()
        expect(firstImage.size).toBeDefined()
      }
    }

    // Validate against Zod schema
    const result = LastFmArtistInfoResponseSchema.safeParse(data)
    if (!result.success) {
      console.error('Schema validation errors:', JSON.stringify(result.error.format(), null, 2))
    }
    expect(result.success).toBe(true)

    await rateLimitPause()
  })

  // Test 4: track.getTopTags - Track-specific genre/mood tags
  it.skipIf(!hasKey)('track.getTopTags matches LastFmTrackTopTagsResponseSchema', async () => {
    const url = buildLastFmUrl('track.getTopTags', {
      artist: 'Queen',
      autocorrect: '1',
      track: 'Bohemian Rhapsody',
    })

    const response = await fetch(url)
    expect(response.ok).toBe(true)

    const data = await response.json()

    // Validate response structure
    expect(data.toptags).toBeDefined()
    expect(data.toptags.tag).toBeDefined()
    expect(Array.isArray(data.toptags.tag)).toBe(true)

    // Validate tag structure
    if (data.toptags.tag.length > 0) {
      const firstTag = data.toptags.tag[0]
      expect(firstTag.name).toBeDefined()
      expect(typeof firstTag.name).toBe('string')
      expect(firstTag.url).toBeDefined()
      expect(typeof firstTag.url).toBe('string')
    }

    // Validate attributes if present
    if (data.toptags['@attr']) {
      expect(data.toptags['@attr'].artist).toBeDefined()
      expect(data.toptags['@attr'].track).toBeDefined()
    }

    // Validate against Zod schema
    const result = LastFmTrackTopTagsResponseSchema.safeParse(data)
    if (!result.success) {
      console.error('Schema validation errors:', JSON.stringify(result.error.format(), null, 2))
    }
    expect(result.success).toBe(true)

    await rateLimitPause()
  })

  // Test 5: track.getCorrection - Autocorrect feature for track names
  it.skipIf(!hasKey)('track.getCorrection matches LastFmTrackCorrectionResponseSchema', async () => {
    // Use intentionally misspelled track name
    const url = buildLastFmUrl('track.getCorrection', {
      artist: 'Qeen', // Misspelled
      track: 'Bohemian Rapsody', // Misspelled
    })

    const response = await fetch(url)
    expect(response.ok).toBe(true)

    const data = await response.json()

    // Validate response structure
    expect(data.corrections).toBeDefined()
    expect(data.corrections.correction).toBeDefined()

    // Validate correction structure
    if (data.corrections.correction?.track) {
      const correctedTrack = data.corrections.correction.track
      expect(correctedTrack.name).toBeDefined()
      expect(typeof correctedTrack.name).toBe('string')
      expect(correctedTrack.artist).toBeDefined()
      expect(correctedTrack.artist.name).toBeDefined()
      expect(correctedTrack.url).toBeDefined()

      // Verify correction happened
      expect(correctedTrack.name).toBe('Bohemian Rhapsody')
      expect(correctedTrack.artist.name).toBe('Queen')
    }

    // Validate against Zod schema
    const result = LastFmTrackCorrectionResponseSchema.safeParse(data)
    if (!result.success) {
      console.error('Schema validation errors:', JSON.stringify(result.error.format(), null, 2))
    }
    expect(result.success).toBe(true)

    await rateLimitPause()
  })

  // Test 6: Error handling - Invalid artist/track
  it.skipIf(!hasKey)('handles invalid artist/track gracefully', async () => {
    const url = buildLastFmUrl('track.getInfo', {
      artist: 'NONEXISTENT_ARTIST_12345',
      autocorrect: '0', // Disable autocorrect to force error
      track: 'NONEXISTENT_TRACK_67890',
    })

    const response = await fetch(url)
    expect(response.ok).toBe(true) // Last.fm returns 200 even for errors

    const data = await response.json()

    // Last.fm returns error in response body
    if (data.error) {
      expect(data.error).toBeDefined()
      expect(typeof data.error).toBe('number')
      expect(data.message).toBeDefined()
      expect(typeof data.message).toBe('string')
    } else {
      // If autocorrect found something, validate basic structure
      expect(data.track).toBeDefined()
    }

    await rateLimitPause()
  })

  // Test 7: Data type validation - Verify number/string types
  it.skipIf(!hasKey)('validates Last.fm data types (numbers vs strings)', async () => {
    const url = buildLastFmUrl('track.getInfo', {
      artist: 'The Beatles',
      autocorrect: '1',
      track: 'Let It Be',
    })

    const response = await fetch(url)
    expect(response.ok).toBe(true)

    const data = await response.json()

    // Last.fm returns numeric fields as actual numbers (not strings)
    expect(data.track.listeners).toBeDefined()
    expect(typeof data.track.listeners).toBe('number')
    expect(data.track.playcount).toBeDefined()
    expect(typeof data.track.playcount).toBe('number')

    // Duration is optional but should be number if present
    if (data.track.duration !== undefined) {
      expect(typeof data.track.duration).toBe('number')
    }

    await rateLimitPause()
  })

  // Test 8: Response wrapping - Verify Last.fm wraps responses
  it.skipIf(!hasKey)('validates Last.fm response wrapping pattern', async () => {
    // Test track.getInfo wrapping
    const trackUrl = buildLastFmUrl('track.getInfo', {
      artist: 'Radiohead',
      autocorrect: '1',
      track: 'Creep',
    })

    const trackResponse = await fetch(trackUrl)
    const trackData = await trackResponse.json()

    // Last.fm wraps track info in .track
    expect(trackData).toHaveProperty('track')
    expect(trackData.track).toHaveProperty('name')
    expect(trackData.track).toHaveProperty('artist')

    await rateLimitPause()

    // Test artist.getInfo wrapping
    const artistUrl = buildLastFmUrl('artist.getInfo', {
      artist: 'Radiohead',
      autocorrect: '1',
    })

    const artistResponse = await fetch(artistUrl)
    const artistData = await artistResponse.json()

    // Last.fm wraps artist info in .artist
    expect(artistData).toHaveProperty('artist')
    expect(artistData.artist).toHaveProperty('name')
    expect(artistData.artist).toHaveProperty('url')

    await rateLimitPause()

    // Test track.getSimilar wrapping
    const similarUrl = buildLastFmUrl('track.getSimilar', {
      artist: 'Radiohead',
      autocorrect: '1',
      limit: '5',
      track: 'Creep',
    })

    const similarResponse = await fetch(similarUrl)
    const similarData = await similarResponse.json()

    // Last.fm wraps similar tracks in .similartracks
    expect(similarData).toHaveProperty('similartracks')
    expect(similarData.similartracks).toHaveProperty('track')
    expect(Array.isArray(similarData.similartracks.track)).toBe(true)

    await rateLimitPause()
  })
})
