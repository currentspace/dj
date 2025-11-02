import {defineConfig} from 'tsup'

export default defineConfig({
  clean: true,
  dts: true, // Generate TypeScript declarations
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'], // Shared package supports both
  platform: 'neutral', // Library code
  sourcemap: true,
  splitting: false,
  target: 'es2022',
  treeshake: true,
})
