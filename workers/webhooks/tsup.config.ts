import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],  // Workers use ESM only
  platform: 'node', // Can use 'node' with nodejs_compat
  target: 'es2022', // Workers runtime supports modern JS
  noExternal: [/.*/], // Bundle ALL dependencies for Workers
  external: [
    // Keep Node.js built-ins external - Workers provides these
    'node:*',
    'buffer',
    'crypto',
    'stream',
    'util',
    'events',
    'assert',
    'path',
    'fs',
    'net',
    'dns',
    'http',
    'https',
    'process',
    'timers'
  ],
  minify: true, // Recommended for production
  splitting: false, // Workers don't support code splitting
  sourcemap: true, // Helpful for debugging
  clean: true,
  // Workers-specific optimizations
  treeshake: true,
  bundle: true,
  skipNodeModulesBundle: false, // Important: bundle node_modules
})