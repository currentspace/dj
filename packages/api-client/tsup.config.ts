import { defineConfig } from 'tsup'

export default defineConfig({
  clean: true,
  dts: true, // Generate TypeScript declarations
  entry: ['src/index.ts'],
  external: ['@dj/shared-types'], // Keep workspace deps external
  format: ['esm', 'cjs'], // Client library supports both
  platform: 'neutral', // Library code for browser/node
  sourcemap: true,
  splitting: false,
  target: 'es2022',
  treeshake: true,
})
