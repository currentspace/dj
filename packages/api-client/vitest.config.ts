import { defineConfig } from 'vitest/config'
import { sharedConfig } from '../../vitest.shared'

/**
 * Vitest configuration for @dj/api-client
 * Environment: node (API client testing)
 */
export default defineConfig({
  test: {
    ...sharedConfig,
    name: 'api-client',
    environment: 'node',

    // API client-specific include patterns
    include: ['src/**/*.{test,spec}.{ts}'],

    // API client-specific coverage
    coverage: {
      ...sharedConfig.coverage,
      include: ['src/**/*.{ts}'],
      exclude: [
        ...(sharedConfig.coverage?.exclude || []),
        'src/**/*.{test,spec}.{ts}',
        'src/**/__tests__/**',
        'src/index.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
