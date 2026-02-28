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

import { asRecord } from './helpers'

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

    const data = asRecord(await response.json())
    const track = asRecord(data.track)

    // Validate response structure
    expect(track).toBeDefined()
    expect(track.name).toBe('Bohemian Rhapsody')
    const trackArtist = asRecord(track.artist)
    expect(trackArtist).toBeDefined()
    expect(trackArtist.name).toBe('Queen')

    // Validate popularity fields exist (Last.fm returns strings)
    expect(track.listeners).toBeDefined()
    expect(typeof track.listeners).toBe('string')
    expect(track.playcount).toBeDefined()
    expect(typeof track.playcount).toBe('string')

    // Validate top tags structure
    if (track.toptags) {
      const toptags = asRecord(track.toptags)
      if (toptags.tag) {
        const tags = toptags.tag
        expect(Array.isArray(tags)).toBe(true)
        if (Array.isArray(tags) && tags.length > 0) {
          const firstTag = asRecord(tags[0])
          expect(firstTag.name).toBeDefined()
          expect(typeof firstTag.name).toBe('string')
          expect(firstTag.url).toBeDefined()
        }
      }
    }

    // Validate album structure if present
    if (track.album) {
      const album = asRecord(track.album)
      expect(album.title).toBeDefined()
      expect(album.artist).toBeDefined()
      expect(album.url).toBeDefined()
    }

    // Validate wiki if present
    if (track.wiki) {
      const wiki = asRecord(track.wiki)
      expect(wiki.summary).toBeDefined()
      expect(typeof wiki.summary).toBe('string')
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

    const data = asRecord(await response.json())
    const similartracks = asRecord(data.similartracks)

    // Validate response structure
    expect(similartracks).toBeDefined()
    expect(similartracks.track).toBeDefined()
    const tracks = similartracks.track
    expect(Array.isArray(tracks)).toBe(true)

    // Validate first similar track structure
    if (Array.isArray(tracks) && tracks.length > 0) {
      const firstTrack = asRecord(tracks[0])
      expect(firstTrack.name).toBeDefined()
      expect(firstTrack.artist).toBeDefined()
      const firstTrackArtist = asRecord(firstTrack.artist)
      expect(firstTrackArtist.name).toBeDefined()
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

    const data = asRecord(await response.json())
    const artist = asRecord(data.artist)

    // Validate response structure
    expect(artist).toBeDefined()
    expect(artist.name).toBe('Queen')
    expect(artist.url).toBeDefined()

    // Validate bio structure
    if (artist.bio) {
      const bio = asRecord(artist.bio)
      expect(bio.summary).toBeDefined()
      expect(typeof bio.summary).toBe('string')
      if (bio.content) {
        expect(typeof bio.content).toBe('string')
      }
    }

    // Validate stats
    if (artist.stats) {
      const stats = asRecord(artist.stats)
      expect(stats.listeners).toBeDefined()
      expect(typeof stats.listeners).toBe('string')
      expect(stats.playcount).toBeDefined()
      expect(typeof stats.playcount).toBe('string')
    }

    // Validate tags structure
    if (artist.tags) {
      const tags = asRecord(artist.tags)
      if (tags.tag) {
        expect(Array.isArray(tags.tag)).toBe(true)
        if (Array.isArray(tags.tag) && tags.tag.length > 0) {
          const firstTag = asRecord(tags.tag[0])
          expect(firstTag.name).toBeDefined()
          expect(firstTag.url).toBeDefined()
        }
      }
    }

    // Validate similar artists
    if (artist.similar) {
      const similar = asRecord(artist.similar)
      if (similar.artist) {
        expect(Array.isArray(similar.artist)).toBe(true)
        if (Array.isArray(similar.artist) && similar.artist.length > 0) {
          const firstSimilar = asRecord(similar.artist[0])
          expect(firstSimilar.name).toBeDefined()
          expect(firstSimilar.url).toBeDefined()
        }
      }
    }

    // Validate images
    if (artist.image) {
      expect(Array.isArray(artist.image)).toBe(true)
      if (Array.isArray(artist.image) && artist.image.length > 0) {
        const firstImage = asRecord(artist.image[0])
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

    const data = asRecord(await response.json())
    const toptags = asRecord(data.toptags)

    // Validate response structure
    expect(toptags).toBeDefined()
    expect(toptags.tag).toBeDefined()
    const tags = toptags.tag
    expect(Array.isArray(tags)).toBe(true)

    // Validate tag structure
    if (Array.isArray(tags) && tags.length > 0) {
      const firstTag = asRecord(tags[0])
      expect(firstTag.name).toBeDefined()
      expect(typeof firstTag.name).toBe('string')
      expect(firstTag.url).toBeDefined()
      expect(typeof firstTag.url).toBe('string')
    }

    // Validate attributes if present
    if (toptags['@attr']) {
      const attr = asRecord(toptags['@attr'])
      expect(attr.artist).toBeDefined()
      expect(attr.track).toBeDefined()
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

    const data = asRecord(await response.json())
    const corrections = asRecord(data.corrections)

    // Validate response structure
    expect(corrections).toBeDefined()
    expect(corrections.correction).toBeDefined()

    // Validate correction structure
    const correction = asRecord(corrections.correction)
    if (correction.track) {
      const correctedTrack = asRecord(correction.track)
      expect(correctedTrack.name).toBeDefined()
      expect(typeof correctedTrack.name).toBe('string')
      expect(correctedTrack.artist).toBeDefined()
      const correctedArtist = asRecord(correctedTrack.artist)
      expect(correctedArtist.name).toBeDefined()
      expect(correctedTrack.url).toBeDefined()

      // Verify correction happened
      expect(correctedTrack.name).toBe('Bohemian Rhapsody')
      expect(correctedArtist.name).toBe('Queen')
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

    const data = asRecord(await response.json())

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

    const data = asRecord(await response.json())
    const track = asRecord(data.track)

    // Last.fm returns numeric fields as strings
    expect(track.listeners).toBeDefined()
    expect(typeof track.listeners).toBe('string')
    expect(track.playcount).toBeDefined()
    expect(typeof track.playcount).toBe('string')

    // Duration is optional but should be string if present (Last.fm returns strings)
    if (track.duration !== undefined) {
      expect(typeof track.duration).toBe('string')
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
    const trackData = asRecord(await trackResponse.json())

    // Last.fm wraps track info in .track
    expect(trackData).toHaveProperty('track')
    const trackObj = asRecord(trackData.track)
    expect(trackObj).toHaveProperty('name')
    expect(trackObj).toHaveProperty('artist')

    await rateLimitPause()

    // Test artist.getInfo wrapping
    const artistUrl = buildLastFmUrl('artist.getInfo', {
      artist: 'Radiohead',
      autocorrect: '1',
    })

    const artistResponse = await fetch(artistUrl)
    const artistData = asRecord(await artistResponse.json())

    // Last.fm wraps artist info in .artist
    expect(artistData).toHaveProperty('artist')
    const artistObj = asRecord(artistData.artist)
    expect(artistObj).toHaveProperty('name')
    expect(artistObj).toHaveProperty('url')

    await rateLimitPause()

    // Test track.getSimilar wrapping
    const similarUrl = buildLastFmUrl('track.getSimilar', {
      artist: 'Radiohead',
      autocorrect: '1',
      limit: '5',
      track: 'Creep',
    })

    const similarResponse = await fetch(similarUrl)
    const similarData = asRecord(await similarResponse.json())

    // Last.fm wraps similar tracks in .similartracks
    expect(similarData).toHaveProperty('similartracks')
    const similarObj = asRecord(similarData.similartracks)
    expect(similarObj).toHaveProperty('track')
    expect(Array.isArray(similarObj.track)).toBe(true)

    await rateLimitPause()
  })
})
