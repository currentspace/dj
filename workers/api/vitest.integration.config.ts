import { defineConfig } from 'vitest/config'
import { sharedConfig } from '../../vitest.shared'

/**
 * Vitest configuration for integration tests
 *
 * Integration tests validate that our services work together with REAL external APIs.
 * These tests run against real APIs (Deezer, Last.fm, MusicBrainz) with no mocking.
 *
 * Key differences from contract tests:
 * - Contract tests: Validate API schemas (what shape is the data?)
 * - Integration tests: Validate service behavior (does caching work? rate limiting? error handling?)
 *
 * These tests should be run:
 * - On merge to main (CI)
 * - When changing service logic (AudioEnrichmentService, LastFmService)
 * - Manually via `pnpm test:integration`
 *
 * Environment: node (no browser/jsdom needed)
 * Timeout: 60s (API calls + rate limiting can be slow)
 * Execution: Sequential (respect rate limits)
 */
export default defineConfig({
  test: {
    ...sharedConfig,
    name: 'integration',
    environment: 'node',
    setupFiles: ['./src/__tests__/integration/setup.ts'],

    // Only match integration test files
    include: ['src/**/*.integration.test.{ts,js}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],

    // Integration tests can be slow (real API calls + rate limiting)
    testTimeout: 60000, // 60 seconds
    hookTimeout: 60000,

    // Coverage disabled for integration tests
    // Integration tests validate behavior, not code coverage
    coverage: {
      ...sharedConfig.coverage,
      enabled: false,
    },

    // Run sequentially to respect API rate limits
    // This is CRITICAL - running in parallel will hit rate limits
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Force sequential execution
      },
    },

    // Disable watch mode (integration tests should be run on-demand)
    watch: false,

    // Clear mocks between tests (though we don't mock in integration tests)
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
