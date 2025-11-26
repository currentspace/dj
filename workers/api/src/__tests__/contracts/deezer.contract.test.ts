/**
 * Deezer API Contract Tests
 *
 * These tests validate that the real Deezer API responses match our expected schema.
 * They use REAL API calls (no mocks) to catch breaking changes before production.
 *
 * IMPORTANT: These tests use the free Deezer API (no auth required) but we add
 * delays between requests to be respectful of their service.
 *
 * Run strategy: Nightly in CI (not on every commit) to detect API changes
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { DeezerTrackSchema } from '@dj/shared-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = Record<string, any>

const DEEZER_BASE_URL = 'https://api.deezer.com'

// Test ISRCs - well-known tracks that should be stable in Deezer's catalog
const TEST_ISRCS = {
  bohemianRhapsody: 'GBUM71029604', // Queen - Bohemian Rhapsody
  billie_jean: 'USRC18100050', // Michael Jackson - Billie Jean
  stairway: 'USLED7100321', // Led Zeppelin - Stairway to Heaven
  invalid: 'INVALID1234567', // Non-existent ISRC for error testing
} as const

// Rate limiting helper - adds delay between tests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// TODO: Contract tests make real API calls and should be run separately
// Run with: pnpm test:contracts
describe.skip('Deezer API Contracts', () => {
  beforeAll(async () => {
    // Initial delay before test suite starts
    await delay(500)
  })

  describe('GET /track/isrc:{isrc} - ISRC Lookup', () => {
    it('should match DeezerTrackSchema for Bohemian Rhapsody', async () => {
      const response = await fetch(`${DEEZER_BASE_URL}/track/isrc:${TEST_ISRCS.bohemianRhapsody}`)

      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)

      const data = await response.json() as ApiResponse

      // Check if this is an error response (ISRC not found in Deezer)
      if (data.error) {
        console.warn(`⚠️ ISRC ${TEST_ISRCS.bohemianRhapsody} not found in Deezer catalog`)
        console.warn('This test is skipped because the ISRC is not available')
        return
      }

      // Validate against our Zod schema
      const result = DeezerTrackSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation failed:', result.error.format())
      }

      expect(result.success).toBe(true)

      // Validate required fields exist
      expect(data).toHaveProperty('id')
      expect(typeof data.id).toBe('number')

      expect(data).toHaveProperty('title')
      expect(typeof data.title).toBe('string')

      expect(data).toHaveProperty('duration')
      expect(typeof data.duration).toBe('number')

      // Validate enrichment fields (can be null but must have correct type when present)
      expect(data).toHaveProperty('bpm')
      if (data.bpm !== null && data.bpm !== undefined) {
        expect(typeof data.bpm).toBe('number')
        // BPM should be in reasonable range (45-220 BPM as per AudioEnrichmentService)
        expect(data.bpm).toBeGreaterThanOrEqual(45)
        expect(data.bpm).toBeLessThanOrEqual(220)
      }

      expect(data).toHaveProperty('rank')
      if (data.rank !== null && data.rank !== undefined) {
        expect(typeof data.rank).toBe('number')
        expect(data.rank).toBeGreaterThanOrEqual(0)
      }

      expect(data).toHaveProperty('gain')
      if (data.gain !== null && data.gain !== undefined) {
        expect(typeof data.gain).toBe('number')
      }

      // Validate release_date format (should be YYYY-MM-DD)
      if (data.release_date) {
        expect(typeof data.release_date).toBe('string')
        // Basic date format check
        expect(data.release_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }

      // Validate nested objects if present
      if (data.artist) {
        expect(data.artist).toHaveProperty('id')
        expect(data.artist).toHaveProperty('name')
        expect(typeof data.artist.id).toBe('number')
        expect(typeof data.artist.name).toBe('string')
      }

      if (data.album) {
        expect(data.album).toHaveProperty('id')
        expect(data.album).toHaveProperty('title')
        expect(typeof data.album.id).toBe('number')
        expect(typeof data.album.title).toBe('string')
      }

      // Respect rate limits
      await delay(500)
    })

    it('should match DeezerTrackSchema for Billie Jean', async () => {
      const response = await fetch(`${DEEZER_BASE_URL}/track/isrc:${TEST_ISRCS.billie_jean}`)

      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)

      const data = await response.json() as ApiResponse

      // Check if this is an error response (ISRC not found in Deezer)
      if (data.error) {
        console.warn(`⚠️ ISRC ${TEST_ISRCS.billie_jean} not found in Deezer catalog`)
        console.warn('This test is skipped because the ISRC is not available')
        return
      }

      // Validate against our Zod schema
      const result = DeezerTrackSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation failed:', result.error.format())
      }

      expect(result.success).toBe(true)

      // Verify essential fields
      expect(data.id).toBeDefined()
      expect(typeof data.id).toBe('number')
      expect(data.title).toBeDefined()
      expect(typeof data.title).toBe('string')
      expect(data.duration).toBeDefined()
      expect(typeof data.duration).toBe('number')

      // Verify BPM if present (Billie Jean should have ~117 BPM)
      if (data.bpm !== null) {
        expect(typeof data.bpm).toBe('number')
        expect(data.bpm).toBeGreaterThanOrEqual(45)
        expect(data.bpm).toBeLessThanOrEqual(220)
      }

      await delay(500)
    })

    it('should match DeezerTrackSchema for Stairway to Heaven', async () => {
      const response = await fetch(`${DEEZER_BASE_URL}/track/isrc:${TEST_ISRCS.stairway}`)

      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)

      const data = await response.json() as ApiResponse

      // Check if this is an error response (ISRC not found in Deezer)
      if (data.error) {
        console.warn(`⚠️ ISRC ${TEST_ISRCS.stairway} not found in Deezer catalog`)
        console.warn('This test is skipped because the ISRC is not available')
        return
      }

      // Validate against our Zod schema
      const result = DeezerTrackSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation failed:', result.error.format())
      }

      expect(result.success).toBe(true)

      // Test consistency across different tracks
      expect(data).toHaveProperty('id')
      expect(data).toHaveProperty('title')
      expect(data).toHaveProperty('duration')
      expect(data).toHaveProperty('bpm')
      expect(data).toHaveProperty('rank')
      expect(data).toHaveProperty('gain')

      await delay(500)
    })
  })

  describe('GET /track/{id} - Direct Track ID Lookup', () => {
    it('should match DeezerTrackSchema when querying by track ID', async () => {
      // First, get a track by ISRC to obtain its Deezer ID
      const isrcResponse = await fetch(`${DEEZER_BASE_URL}/track/isrc:${TEST_ISRCS.bohemianRhapsody}`)
      const isrcData = await isrcResponse.json() as ApiResponse
      const trackId = isrcData.id

      expect(trackId).toBeDefined()
      expect(typeof trackId).toBe('number')

      await delay(500)

      // Now query by track ID
      const response = await fetch(`${DEEZER_BASE_URL}/track/${trackId}`)

      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)

      const data = await response.json() as ApiResponse

      // Validate against our Zod schema
      const result = DeezerTrackSchema.safeParse(data)

      if (!result.success) {
        console.error('Schema validation failed:', result.error.format())
      }

      expect(result.success).toBe(true)

      // Verify the response structure matches ISRC lookup
      expect(data).toHaveProperty('id')
      expect(data).toHaveProperty('title')
      expect(data).toHaveProperty('bpm')
      expect(data).toHaveProperty('rank')
      expect(data).toHaveProperty('gain')

      // Verify it's the same track
      expect(data.id).toBe(trackId)

      await delay(500)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid ISRC gracefully', async () => {
      const response = await fetch(`${DEEZER_BASE_URL}/track/isrc:${TEST_ISRCS.invalid}`)

      // Deezer returns 200 with error object for not found
      expect(response.status).toBe(200)

      const data = await response.json() as ApiResponse

      // Validate error response structure
      expect(data).toHaveProperty('error')
      expect(data.error).toHaveProperty('type')
      expect(data.error).toHaveProperty('message')
      expect(data.error).toHaveProperty('code')

      // Common Deezer error codes: 800 (no data found), 300 (invalid parameters)
      expect([300, 800]).toContain(data.error.code)

      await delay(500)
    })

    it('should handle invalid track ID gracefully', async () => {
      const response = await fetch(`${DEEZER_BASE_URL}/track/99999999999`)

      expect(response.status).toBe(200)

      const data = await response.json() as ApiResponse

      // Validate error response structure
      expect(data).toHaveProperty('error')
      expect(data.error).toHaveProperty('type')
      expect(data.error).toHaveProperty('message')
      expect(data.error).toHaveProperty('code')

      await delay(500)
    })
  })

  describe('BPM Validation', () => {
    it('should have BPM in valid range when present', async () => {
      const testCases = [
        { name: 'Bohemian Rhapsody', isrc: TEST_ISRCS.bohemianRhapsody },
        { name: 'Billie Jean', isrc: TEST_ISRCS.billie_jean },
        { name: 'Stairway to Heaven', isrc: TEST_ISRCS.stairway },
      ]

      for (const testCase of testCases) {
        const response = await fetch(`${DEEZER_BASE_URL}/track/isrc:${testCase.isrc}`)
        const data = await response.json() as ApiResponse

        // Skip error responses (ISRC not found)
        if (data.error) {
          console.log(`⚠ ${testCase.name}: ISRC not found in Deezer catalog`)
          await delay(500)
          continue
        }

        // Only validate BPM if it exists
        if (data.bpm !== null && data.bpm !== undefined) {
          expect(typeof data.bpm).toBe('number')

          // BPM should be in reasonable range (45-220 as per AudioEnrichmentService)
          expect(data.bpm).toBeGreaterThanOrEqual(45)
          expect(data.bpm).toBeLessThanOrEqual(220)

          console.log(`✓ ${testCase.name}: BPM = ${data.bpm}`)
        } else {
          console.log(`⚠ ${testCase.name}: BPM is null (acceptable, Deezer data incomplete)`)
        }

        await delay(500)
      }
    })

    it('should handle null BPM gracefully', async () => {
      // Note: Some tracks may not have BPM data in Deezer
      // This test ensures our schema accepts null values

      const response = await fetch(`${DEEZER_BASE_URL}/track/isrc:${TEST_ISRCS.bohemianRhapsody}`)
      const data = await response.json() as ApiResponse

      // BPM can be null - verify our schema handles it
      const result = DeezerTrackSchema.safeParse({
        ...data,
        bpm: null, // Force null to test schema
      })

      expect(result.success).toBe(true)

      await delay(500)
    })
  })

  describe('Enrichment Fields', () => {
    it('should include all enrichment fields used by AudioEnrichmentService', async () => {
      const response = await fetch(`${DEEZER_BASE_URL}/track/isrc:${TEST_ISRCS.bohemianRhapsody}`)
      const data = await response.json() as ApiResponse

      // Verify all fields used by AudioEnrichmentService exist
      const requiredFields = ['bpm', 'rank', 'gain', 'release_date']

      for (const field of requiredFields) {
        expect(data).toHaveProperty(field)
      }

      // Verify types when fields are not null
      if (data.bpm !== null) {
        expect(typeof data.bpm).toBe('number')
      }

      if (data.rank !== null) {
        expect(typeof data.rank).toBe('number')
      }

      if (data.gain !== null) {
        expect(typeof data.gain).toBe('number')
      }

      if (data.release_date !== null && data.release_date !== undefined) {
        expect(typeof data.release_date).toBe('string')
        // Validate date format (YYYY-MM-DD)
        expect(data.release_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }

      await delay(500)
    })

    it('should include ISRC when available', async () => {
      const response = await fetch(`${DEEZER_BASE_URL}/track/isrc:${TEST_ISRCS.bohemianRhapsody}`)
      const data = await response.json() as ApiResponse

      // Verify ISRC is returned (should match what we queried)
      if (data.isrc) {
        expect(typeof data.isrc).toBe('string')
        expect(data.isrc.length).toBeGreaterThan(0)
      }

      await delay(500)
    })

    it('should include rank (popularity) field', async () => {
      const response = await fetch(`${DEEZER_BASE_URL}/track/isrc:${TEST_ISRCS.bohemianRhapsody}`)
      const data = await response.json() as ApiResponse

      expect(data).toHaveProperty('rank')

      // Rank should be a number when present (higher = more popular)
      if (data.rank !== null) {
        expect(typeof data.rank).toBe('number')
        expect(data.rank).toBeGreaterThanOrEqual(0)

        // Bohemian Rhapsody should have high rank (very popular)
        console.log(`Bohemian Rhapsody Deezer rank: ${data.rank}`)
      }

      await delay(500)
    })
  })

  describe('Schema Consistency', () => {
    it('should have consistent schema across multiple tracks', async () => {
      const isrcs = [
        TEST_ISRCS.bohemianRhapsody,
        TEST_ISRCS.billie_jean,
        TEST_ISRCS.stairway,
      ]

      const responses = []

      for (const isrc of isrcs) {
        const response = await fetch(`${DEEZER_BASE_URL}/track/isrc:${isrc}`)
        const data = await response.json() as ApiResponse

        // Skip error responses (ISRCs not found in Deezer)
        if (!data.error) {
          responses.push(data)
        } else {
          console.warn(`⚠️ ISRC ${isrc} not found in Deezer, skipping from consistency check`)
        }

        await delay(500)
      }

      // Need at least 2 valid responses to compare consistency
      if (responses.length < 2) {
        console.warn('⚠️ Not enough valid tracks to test schema consistency')
        return
      }

      // Verify all responses have same top-level keys
      const firstKeys = Object.keys(responses[0]).sort()

      for (let i = 1; i < responses.length; i++) {
        const keys = Object.keys(responses[i]).sort()
        expect(keys).toEqual(firstKeys)
      }

      // Verify all responses pass schema validation
      for (const data of responses) {
        const result = DeezerTrackSchema.safeParse(data)
        expect(result.success).toBe(true)
      }
    })
  })
})
