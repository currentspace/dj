import {defineConfig} from 'tsup'

export default defineConfig({
  bundle: true,
  clean: true,
  entry: ['src/index.ts'],
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
    'timers',
  ],
  format: ['esm'], // Workers use ESM only
  minify: true, // Recommended for production
  noExternal: [/.*/], // Bundle ALL dependencies for Workers
  platform: 'node', // Can use 'node' with nodejs_compat
  skipNodeModulesBundle: false, // Important: bundle node_modules
  sourcemap: true, // Helpful for debugging
  splitting: false, // Workers don't support code splitting
  target: 'es2022', // Workers runtime supports modern JS
  // Workers-specific optimizations
  treeshake: true,
})
