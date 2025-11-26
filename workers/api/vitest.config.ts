import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for @dj/api-worker
 * Uses Vitest 4.x with node environment for unit tests
 */
export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],

    // API-specific include patterns
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],

    // API-specific coverage
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.{test,spec}.ts',
        'src/**/__tests__/**',
        'src/index.ts',
        'src/test-setup.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
