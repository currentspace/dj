import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { sharedConfig } from '../../vitest.shared'

/**
 * Vitest configuration for @dj/web (React frontend)
 * Environment: jsdom for React component testing
 */
export default defineConfig({
  plugins: [react()],
  test: {
    ...sharedConfig,
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],

    // Web-specific include patterns
    include: ['src/**/*.{test,spec}.{ts,tsx}'],

    // Web-specific coverage
    coverage: {
      ...sharedConfig.coverage,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        ...(sharedConfig.coverage?.exclude || []),
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/__tests__/**',
        'src/main.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
