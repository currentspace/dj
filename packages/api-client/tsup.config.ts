import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'], // Client library supports both
  platform: 'neutral', // Library code for browser/node
  target: 'es2022',
  dts: true, // Generate TypeScript declarations
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  external: ['@dj/shared-types'], // Keep workspace deps external
})