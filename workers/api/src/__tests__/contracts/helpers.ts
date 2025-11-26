/**
 * Contract Test Helpers
 *
 * Utilities for writing contract tests that validate external APIs
 * match our schema expectations.
 */

import type { ZodSchema } from 'zod'
import { getCachedResponse, cacheResponse } from './setup'

/**
 * Last request timestamp for each API (used for rate limiting)
 */
const lastRequestTime = new Map<string, number>()

/**
 * Rate-limited fetch wrapper
 *
 * Ensures we respect API rate limits by enforcing a minimum delay
 * between requests to the same API.
 *
 * @param url - URL to fetch
 * @param delay - Minimum milliseconds between requests
 * @param options - Fetch options
 * @returns Promise<Response>
 *
 * @example
 * ```typescript
 * const response = await rateLimitedFetch(
 *   'https://api.spotify.com/v1/tracks/123',
 *   1000, // 1 second between Spotify requests
 *   { headers: { Authorization: `Bearer ${token}` } }
 * )
 * ```
 */
export async function rateLimitedFetch(
  url: string,
  delay: number,
  options?: RequestInit
): Promise<Response> {
  // Extract domain for rate limiting key
  const domain = new URL(url).hostname

  // Check last request time for this domain
  const lastTime = lastRequestTime.get(domain) || 0
  const timeSinceLastRequest = Date.now() - lastTime
  const timeToWait = Math.max(0, delay - timeSinceLastRequest)

  // Wait if needed
  if (timeToWait > 0) {
    await new Promise((resolve) => setTimeout(resolve, timeToWait))
  }

  // Update last request time
  lastRequestTime.set(domain, Date.now())

  // Make request
  return fetch(url, options)
}

/**
 * Get test credentials from environment
 *
 * Returns credentials needed for contract tests. If credentials are missing,
 * tests should use `skipIfMissingCredentials()` to skip gracefully.
 *
 * @returns Object with API credentials
 *
 * @example
 * ```typescript
 * const { spotifyToken, lastfmKey } = getTestCredentials()
 * if (!spotifyToken) {
 *   skipIfMissingCredentials('SPOTIFY_ACCESS_TOKEN')
 *   return
 * }
 * ```
 */
export function getTestCredentials() {
  return {
    spotifyToken: process.env.SPOTIFY_ACCESS_TOKEN,
    lastfmKey: process.env.LASTFM_API_KEY,
  }
}

/**
 * Skip test if required credentials are missing
 *
 * Call this at the beginning of a test to skip if API credentials
 * are not configured. This allows contract tests to pass in CI
 * without requiring all API credentials.
 *
 * @param envVar - Environment variable name
 *
 * @example
 * ```typescript
 * test('Spotify API contract', () => {
 *   skipIfMissingCredentials('SPOTIFY_ACCESS_TOKEN')
 *
 *   // Test code here...
 * })
 * ```
 */
export function skipIfMissingCredentials(envVar: string): void {
  if (!process.env[envVar]) {
    // Note: Use `it.skipIf(!process.env[envVar])` at test definition instead
    // This function only logs a warning - actual skip must be handled by test runner
    console.warn(`⏭️  Skipping test: ${envVar} not configured`)
    throw new Error(`Test skipped: ${envVar} not configured`)
  }
}

/**
 * Validate schema against data with helpful error messages
 *
 * This is a wrapper around Zod's safeParse that provides better error
 * messages for contract test failures. It shows:
 * - Which fields failed validation
 * - Expected vs actual types
 * - Sample of actual data
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validation result with success flag and errors
 *
 * @example
 * ```typescript
 * const result = validateSchema(SpotifyTrackSchema, trackData)
 *
 * if (!result.success) {
 *   console.error('Schema validation failed:')
 *   result.errors.forEach(err => console.error(`  - ${err}`))
 * }
 *
 * expect(result.success).toBe(true)
 * ```
 */
export function validateSchema<T>(
  schema: ZodSchema<T>,
  data: unknown
): {
  success: boolean
  data?: T
  errors: string[]
  details?: unknown
} {
  const result = schema.safeParse(data)

  if (result.success) {
    return {
      success: true,
      data: result.data,
      errors: [],
    }
  }

  // Format errors for better readability
  const errors: string[] = []
  const formatted = result.error.format()

  // Helper to flatten Zod error object into readable messages
  function flattenErrors(obj: unknown, path = ''): void {
    if (!obj || typeof obj !== 'object') return

    for (const [key, value] of Object.entries(obj)) {
      if (key === '_errors' && Array.isArray(value) && value.length > 0) {
        errors.push(`${path}: ${value.join(', ')}`)
      } else if (typeof value === 'object' && value !== null) {
        const newPath = path ? `${path}.${key}` : key
        flattenErrors(value, newPath)
      }
    }
  }

  flattenErrors(formatted)

  // If no formatted errors, show raw error
  if (errors.length === 0) {
    errors.push(result.error.message)
  }

  return {
    success: false,
    errors,
    details: formatted,
  }
}

/**
 * Fetch with caching support
 *
 * Caches API responses to minimize repeated API calls during test runs.
 * Useful when running multiple tests against the same endpoint.
 *
 * @param url - URL to fetch
 * @param delay - Rate limit delay
 * @param options - Fetch options
 * @returns Cached or fresh response data
 *
 * @example
 * ```typescript
 * const track = await cachedFetch(
 *   'https://api.spotify.com/v1/tracks/123',
 *   1000,
 *   { headers: { Authorization: `Bearer ${token}` } }
 * )
 * ```
 */
export async function cachedFetch(
  url: string,
  delay: number,
  options?: RequestInit
): Promise<unknown> {
  // Check cache first
  const cached = getCachedResponse(url)
  if (cached !== null) {
    console.log(`  📦 Cache hit: ${url}`)
    return cached
  }

  // Fetch fresh data
  console.log(`  🌐 Fetching: ${url}`)
  const response = await rateLimitedFetch(url, delay, options)

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const data = await response.json()

  // Cache response
  cacheResponse(url, data)

  return data
}

/**
 * Format schema validation errors for console output
 *
 * @param errors - Array of error messages
 * @returns Formatted error string
 */
export function formatValidationErrors(errors: string[]): string {
  if (errors.length === 0) return 'No errors'

  return errors.map((err, i) => `  ${i + 1}. ${err}`).join('\n')
}

/**
 * Log schema validation failure with detailed information
 *
 * @param schemaName - Name of the schema that failed
 * @param errors - Validation errors
 * @param sampleData - Optional sample of actual data
 */
export function logSchemaFailure(
  schemaName: string,
  errors: string[],
  sampleData?: unknown
): void {
  console.error(`\n❌ ${schemaName} validation failed:`)
  console.error(formatValidationErrors(errors))

  if (sampleData) {
    console.error('\n📋 Sample data (first 500 chars):')
    const sample = JSON.stringify(sampleData, null, 2)
    console.error(sample.length > 500 ? sample.slice(0, 500) + '...' : sample)
  }

  console.error('')
}

/**
 * Assert schema matches with helpful error messages
 *
 * Convenience function that validates schema and throws with detailed
 * error messages if validation fails.
 *
 * @param schema - Zod schema
 * @param data - Data to validate
 * @param schemaName - Name of schema for error messages
 *
 * @example
 * ```typescript
 * const track = await fetchTrack('123')
 * assertSchemaMatches(SpotifyTrackSchema, track, 'SpotifyTrackSchema')
 * // Throws with detailed error if validation fails
 * ```
 */
export function assertSchemaMatches<T>(
  schema: ZodSchema<T>,
  data: unknown,
  schemaName: string
): asserts data is T {
  const result = validateSchema(schema, data)

  if (!result.success) {
    logSchemaFailure(schemaName, result.errors, data)
    throw new Error(`${schemaName} validation failed`)
  }
}
