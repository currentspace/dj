import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'], // Shared package supports both
  platform: 'neutral', // Library code
  target: 'es2022',
  dts: true, // Generate TypeScript declarations
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
})