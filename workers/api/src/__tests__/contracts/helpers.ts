/**
 * Contract Test Helpers
 *
 * Utilities for writing contract tests that validate external APIs
 * match our schema expectations.
 */

import type { ZodSchema } from 'zod'

import { config } from 'dotenv'
import { resolve } from 'path'

import { cacheResponse, getCachedResponse } from './setup'

// Load environment variables from .dev.vars (Cloudflare Workers format)
config({ path: resolve(__dirname, '../../../../.dev.vars') })
// Also try .env at project root
config({ path: resolve(__dirname, '../../../../../.env') })

/**
 * Type guard to narrow `unknown` from response.json() to Record<string, unknown>.
 * Use this instead of `as` assertions to satisfy the no-assertion lint rule.
 */
export function asRecord(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>
  }
  throw new Error(`Expected object, got ${typeof data}`)
}

/**
 * Cached Spotify access token (to avoid fetching on every test)
 */
let cachedSpotifyToken: null | string = null
let tokenExpiresAt = 0

/**
 * Fetch Spotify access token using Client Credentials flow
 *
 * Uses SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET from environment
 * to obtain an access token. Tokens are cached for their lifetime.
 *
 * @returns Promise<string | null> - Access token or null if credentials missing
 */
export async function getSpotifyAccessToken(): Promise<null | string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedSpotifyToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedSpotifyToken
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.warn('⚠️ SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set')
    return null
  }

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    })

    if (!response.ok) {
      console.error(`❌ Failed to get Spotify token: ${response.status}`)
      return null
    }

    const raw: unknown = await response.json()
    const data = asRecord(raw)
    cachedSpotifyToken = String(data.access_token)
    tokenExpiresAt = Date.now() + (Number(data.expires_in) * 1000)

    console.log('✅ Spotify access token obtained (expires in 1 hour)')
    return cachedSpotifyToken
  } catch (error) {
    console.error('❌ Error fetching Spotify token:', error)
    return null
  }
}

/**
 * Last request timestamp for each API (used for rate limiting)
 */
const lastRequestTime = new Map<string, number>()

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
    lastfmKey: process.env.LASTFM_API_KEY,
    spotifyToken: process.env.SPOTIFY_ACCESS_TOKEN,
  }
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
  const lastTime = lastRequestTime.get(domain) ?? 0
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
  data?: T
  details?: unknown
  errors: string[]
  success: boolean
} {
  const result = schema.safeParse(data)

  if (result.success) {
    return {
      data: result.data,
      errors: [],
      success: true,
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
    details: formatted,
    errors,
    success: false,
  }
}
