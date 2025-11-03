import type { UserConfig } from 'vitest/config'

/**
 * Shared Vitest configuration for all packages in the DJ monorepo
 * Following 2025 best practices with projects configuration
 *
 * Note: This file contains common settings that are inherited by package configs
 * Cannot use 'extends' with projects config, so packages import these settings directly
 */
export const sharedConfig: UserConfig['test'] = {
  // Test file patterns
  include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.{idea,git,cache,output,temp}/**'],

  // Coverage configuration (target 80%)
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html', 'lcov'],
    reportsDirectory: './coverage',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.config.{js,ts,mjs,mts}',
      '**/*.d.ts',
      '**/test-setup.ts',
      '**/__tests__/**',
      '**/__mocks__/**',
      '**/fixtures/**',
    ],
    thresholds: {
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
  },

  // Reporters
  reporters: ['verbose'],

  // Test timeout (30 seconds)
  testTimeout: 30000,
  hookTimeout: 30000,

  // Globals (for better DX)
  globals: true,

  // Test isolation
  isolate: true,

  // Pool options
  pool: 'threads',
  poolOptions: {
    threads: {
      singleThread: false,
    },
  },

  // Disable watch mode by default (CI friendly)
  watch: false,

  // Clear mocks between tests
  clearMocks: true,
  mockReset: true,
  restoreMocks: true,
}
