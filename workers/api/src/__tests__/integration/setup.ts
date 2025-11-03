/**
 * Integration Test Setup
 *
 * This file configures the environment for integration tests, which validate
 * that our services work together with REAL external APIs.
 *
 * Integration tests use:
 * - Real external APIs (Deezer, Last.fm, MusicBrainz)
 * - Mock KV namespace (in-memory for testing)
 * - Real rate limiting
 * - Real error handling
 *
 * Key Principle: Test real behavior, not mocks
 */

import { beforeAll, afterAll } from 'vitest'

/**
 * Global test timeout (60 seconds for API calls + rate limiting)
 */
export const INTEGRATION_TEST_TIMEOUT = 60000

/**
 * Rate limiting configuration (same as production)
 */
export const RATE_LIMITS = {
  DEEZER: 25, // 40 TPS = 25ms between calls
  LASTFM: 200, // 5 TPS = 200ms between calls
  MUSICBRAINZ: 1000, // 1 TPS = 1000ms between calls (be polite!)
}

/**
 * Mock KV Namespace (in-memory implementation for testing)
 *
 * This is a simplified KV implementation that stores data in memory.
 * It supports the core KV methods needed for testing caching behavior.
 *
 * IMPORTANT: This is NOT a mock in the traditional sense.
 * We mock KV because we don't want to depend on production KV namespaces,
 * but we still test real caching logic with a real in-memory store.
 */
export class MockKVNamespace {
  private store = new Map<string, { value: string; expirationTtl?: number; timestamp: number }>()

  // Overload signatures to match Cloudflare KV API
  async get(key: string): Promise<string | null>
  async get(key: string, type: 'text'): Promise<string | null>
  async get(key: string, type: 'json'): Promise<unknown | null>
  async get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null> {
    const entry = this.store.get(key)
    if (!entry) return null

    // Check if expired
    if (entry.expirationTtl) {
      const age = Date.now() - entry.timestamp
      if (age > entry.expirationTtl * 1000) {
        this.store.delete(key)
        return null
      }
    }

    // If type is 'json', parse the stored string as JSON
    if (type === 'json') {
      try {
        return JSON.parse(entry.value)
      } catch {
        return null
      }
    }

    // Default: return as text
    return entry.value
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, {
      expirationTtl: options?.expirationTtl,
      timestamp: Date.now(),
      value,
    })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string }> }> {
    const keys = Array.from(this.store.keys())
      .filter(key => !options?.prefix || key.startsWith(options.prefix))
      .slice(0, options?.limit)
      .map(name => ({ name }))

    return { keys }
  }

  // Method to clear all data (useful for test cleanup)
  clear(): void {
    this.store.clear()
  }

  // Method to get store size (useful for debugging)
  size(): number {
    return this.store.size
  }
}

/**
 * Create mock environment object for testing
 *
 * This provides a test Env object with:
 * - Mock KV namespaces (in-memory)
 * - Real API keys from environment
 * - Test-friendly configuration
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
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
    AUDIO_FEATURES_CACHE: new MockKVNamespace(),
    ENVIRONMENT: 'test',
    LASTFM_API_KEY: process.env.LASTFM_API_KEY, // Optional
    SESSIONS: new MockKVNamespace(),
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID || 'test-client-id',
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET || 'test-client-secret',
  }
}

/**
 * Validate environment variables
 *
 * Integration tests are designed to run without credentials, but will
 * skip Last.fm tests if LASTFM_API_KEY is not available.
 */
function validateEnvironment(): void {
  const warnings: string[] = []

  // Check optional credentials
  if (!process.env.LASTFM_API_KEY) {
    warnings.push('LASTFM_API_KEY not set - Last.fm integration tests will be skipped')
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Integration test warnings:')
    warnings.forEach(msg => console.warn(`  - ${msg}`))
    console.warn('\nMost integration tests will still run (Deezer/MusicBrainz are public APIs).\n')
  }
}

/**
 * Setup runs before all integration tests
 */
beforeAll(() => {
  // Set global test timeout
  console.log(`Integration test timeout: ${INTEGRATION_TEST_TIMEOUT}ms`)

  // Validate environment variables
  validateEnvironment()

  // Log rate limits
  console.log('Rate limits configured (same as production):')
  console.log(`  - Deezer: ${RATE_LIMITS.DEEZER}ms between requests (40 TPS)`)
  console.log(`  - Last.fm: ${RATE_LIMITS.LASTFM}ms between requests (5 TPS)`)
  console.log(`  - MusicBrainz: ${RATE_LIMITS.MUSICBRAINZ}ms between requests (1 TPS)\n`)

  // Log test approach
  console.log('Integration test approach:')
  console.log('  ✅ Real external APIs (Deezer, Last.fm, MusicBrainz)')
  console.log('  ✅ Mock KV namespace (in-memory cache)')
  console.log('  ✅ Real rate limiting')
  console.log('  ✅ Real error handling\n')
})

/**
 * Cleanup runs after all integration tests
 */
afterAll(() => {
  console.log('\nIntegration tests complete')
})
