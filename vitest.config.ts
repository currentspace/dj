import { defineConfig } from 'vitest/config'
import { sharedConfig } from './vitest.shared'

/**
 * Root Vitest configuration for DJ monorepo
 * Uses projects configuration (2025 best practice)
 *
 * This allows running all tests with `pnpm test` or targeting specific packages
 * with `pnpm test --project web` or `pnpm test --project api`
 */
export default defineConfig({
  test: {
    ...sharedConfig,

    // Projects configuration for monorepo
    projects: [
      {
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'jsdom',
          setupFiles: ['./src/test-setup.ts'],
        },
      },
      {
        test: {
          name: 'api',
          root: './workers/api',
          environment: 'node',
          setupFiles: ['./src/test-setup.ts'],
        },
      },
      {
        test: {
          name: 'shared-types',
          root: './packages/shared-types',
          environment: 'node',
        },
      },
      {
        test: {
          name: 'api-client',
          root: './packages/api-client',
          environment: 'node',
        },
      },
    ],
  },
})
