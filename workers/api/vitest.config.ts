import { defineConfig } from 'vitest/config'
import { sharedConfig } from '../../vitest.shared'

/**
 * Vitest configuration for @dj/api-worker (Cloudflare Workers)
 * Environment: node (with Cloudflare Workers types)
 */
export default defineConfig({
  test: {
    ...sharedConfig,
    name: 'api',
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],

    // API-specific include patterns
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],

    // API-specific coverage
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
