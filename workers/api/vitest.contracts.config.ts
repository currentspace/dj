import { defineConfig } from 'vitest/config'
import { sharedConfig } from '../../vitest.shared'

/**
 * Vitest configuration for contract tests
 *
 * Contract tests validate that external APIs match our schema expectations.
 * These tests run against REAL APIs (not mocks) and should be run:
 * - Nightly in CI (to catch API changes)
 * - On schema changes (packages/shared-types/src/schemas/*)
 * - Manually via `pnpm test:contracts`
 *
 * Environment: node (no browser/jsdom needed)
 * Timeout: 30s (APIs can be slow)
 */
export default defineConfig({
  test: {
    ...sharedConfig,
    name: 'contracts',
    environment: 'node',
    setupFiles: ['./src/__tests__/contracts/setup.ts'],

    // Only match contract test files
    include: ['src/**/*.contract.test.{ts,js}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],

    // Contract tests can be slow (real API calls)
    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage settings for contract tests
    coverage: {
      ...sharedConfig.coverage,
      include: ['src/**/*.{ts}'],
      exclude: [
        ...(sharedConfig.coverage?.exclude || []),
        'src/**/*.{test,spec}.{ts}',
        'src/**/__tests__/**',
        'src/index.ts',
      ],
      // Contract tests primarily validate schemas, not code coverage
      enabled: false,
    },

    // Run sequentially to respect rate limits
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Force sequential execution
      },
    },

    // Disable watch mode (contracts should be run on-demand)
    watch: false,

    // Clear mocks between tests
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
