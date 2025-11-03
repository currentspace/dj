import { defineConfig } from 'vitest/config'
import { sharedConfig } from '../../vitest.shared'

/**
 * Vitest configuration for @dj/shared-types
 * Environment: node (type validation and schema testing)
 */
export default defineConfig({
  test: {
    ...sharedConfig,
    name: 'shared-types',
    environment: 'node',

    // Types-specific include patterns
    include: ['src/**/*.{test,spec}.{ts}'],

    // Types-specific coverage (target 90% for type utilities)
    coverage: {
      ...sharedConfig.coverage,
      include: ['src/**/*.{ts}'],
      exclude: [
        ...(sharedConfig.coverage?.exclude || []),
        'src/**/*.{test,spec}.{ts}',
        'src/**/__tests__/**',
        'src/index.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
