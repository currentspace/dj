/**
 * Contract Test Setup
 *
 * This file configures the environment for contract tests, which validate
 * that external APIs match our schema expectations.
 *
 * Contract tests run against REAL APIs (no mocks) and require:
 * - Valid API credentials
 * - Rate limiting to respect API quotas
 * - Response caching to minimize API calls
 */

import { afterAll, beforeAll } from 'vitest'

// Get native globals that were stored before mocking in test-setup.ts
 
const nativeFetch = (global as any).__nativeFetch as typeof fetch
 
const nativeSetTimeout = (global as any).__nativeSetTimeout as typeof setTimeout
 
const nativeClearTimeout = (global as any).__nativeClearTimeout as typeof clearTimeout

// Restore native globals for contract tests (they need real network access and timers)
if (nativeFetch) {
  global.fetch = nativeFetch
} else {
  console.warn('⚠️ Native fetch not available - contract tests may fail')
}

// Restore native timers (needed by undici's internal timeout handling)
if (nativeSetTimeout) {
  global.setTimeout = nativeSetTimeout
}
if (nativeClearTimeout) {
  global.clearTimeout = nativeClearTimeout
}

/**
 * Required environment variables for contract tests
 */
const REQUIRED_ENV_VARS = {
  // Last.fm API (API key)
  LASTFM_API_KEY: 'Get from last.fm/api/account/create',

  // Spotify API (OAuth)
  SPOTIFY_ACCESS_TOKEN: 'Get from developer.spotify.com after OAuth flow',
}

/**
 * Optional environment variables (for reference)
 * TEST_PLAYLIST_ID: 'Spotify playlist ID for testing (default: "Today\'s Top Hits")',
 * TEST_TRACK_ID: 'Spotify track ID for testing (default: "Bohemian Rhapsody")',
 */

/**
 * Global test timeout (30 seconds for API calls)
 */
export const CONTRACT_TEST_TIMEOUT = 30000

/**
 * Rate limiting configuration (respect API quotas)
 */
export const RATE_LIMITS = {
  DEEZER: 1000, // Self-limit to 1 request per second
  LASTFM: 200, // 5 requests per second (200ms between calls)
  MUSICBRAINZ: 1000, // 1 request per second (be nice!)
  SPOTIFY: 1000, // 1 request per second
}

/**
 * In-memory cache for API responses (minimize repeated API calls)
 */
const responseCache = new Map<string, { data: unknown; timestamp: number }>()

/**
 * Cache TTL (5 minutes - contract tests should run quickly)
 */
const CACHE_TTL = 5 * 60 * 1000

/**
 * Cache API response
 */
export function cacheResponse(key: string, data: unknown): void {
  responseCache.set(key, {
    data,
    timestamp: Date.now(),
  })
}

/**
 * Get cached response if available and not expired
 */
export function getCachedResponse(key: string): unknown {
  const cached = responseCache.get(key)
  if (!cached) return null

  const isExpired = Date.now() - cached.timestamp > CACHE_TTL
  if (isExpired) {
    responseCache.delete(key)
    return null
  }

  return cached.data
}

/**
 * Validate required environment variables
 *
 * Contract tests require real API credentials. If credentials are missing,
 * individual tests should skip gracefully using `skipIfMissingCredentials()`.
 */
function validateEnvironment(): void {
  const missing: string[] = []

  for (const [key, description] of Object.entries(REQUIRED_ENV_VARS)) {
    if (!process.env[key]) {
      missing.push(`${key}: ${description}`)
    }
  }

  if (missing.length > 0) {
    console.warn('\n⚠️  Contract tests require API credentials:')
    console.warn('Missing environment variables:')
    missing.forEach((msg) => console.warn(`  - ${msg}`))
    console.warn('\nTests will skip if credentials are not available.\n')
  }
}

/**
 * Setup runs before all contract tests
 */
beforeAll(() => {
  // Set global test timeout
  // Note: This is also set in vitest.contracts.config.ts, but we set it here
  // as a reminder and for clarity in test logs
  console.log(`Contract test timeout: ${CONTRACT_TEST_TIMEOUT}ms`)

  // Validate environment variables
  validateEnvironment()

  // Log cache status
  console.log('Response cache initialized (TTL: 5 minutes)')

  // Log rate limits
  console.log('Rate limits configured:')
  console.log(`  - Spotify: ${RATE_LIMITS.SPOTIFY}ms between requests`)
  console.log(`  - Deezer: ${RATE_LIMITS.DEEZER}ms between requests`)
  console.log(`  - Last.fm: ${RATE_LIMITS.LASTFM}ms between requests`)
  console.log(`  - MusicBrainz: ${RATE_LIMITS.MUSICBRAINZ}ms between requests\n`)
})

/**
 * Cleanup runs after all contract tests
 */
afterAll(() => {
  // Clear cache
  responseCache.clear()
  console.log('\nResponse cache cleared')
})

/**
 * Export default environment variables for convenience
 */
export const TEST_DEFAULTS = {
  // Known artist/track for Last.fm testing
  ARTIST_NAME: 'Queen',

  // Spotify's official "Today's Top Hits" playlist (public, always available)
  PLAYLIST_ID: process.env.TEST_PLAYLIST_ID ?? '37i9dQZF1DXcBWIGoYBM5M',

  // Queen - Bohemian Rhapsody (well-known track with complete metadata)
  TRACK_ID: process.env.TEST_TRACK_ID ?? '6rqhFgbbKwnb9MLmUQDhG6',

  // Known ISRC for testing Deezer enrichment
  TRACK_ISRC: 'GBUM71029604', // Bohemian Rhapsody
  TRACK_NAME: 'Bohemian Rhapsody',
}
