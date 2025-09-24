import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'browser', // V8 isolate (not Node.js)
  target: 'es2022',
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  skipNodeModulesBundle: true, // Don't bundle all node_modules
  minify: true,
  // Important: keep Node stdlib out of the bundle (stdio path)
  external: [
    // Node built-ins that trip Workers
    'child_process', 'node:child_process',
    'fs', 'node:fs',
    'net', 'node:net',
    'tls', 'node:tls',
    'module', 'node:module',
    'worker_threads', 'node:worker_threads',
    'os', 'node:os',
    'readline', 'node:readline',
    'tty', 'node:tty',
    'process', 'node:process',
    'buffer', 'node:buffer',
    'crypto', 'node:crypto',
    'stream', 'node:stream',
    'util', 'node:util',
    'events', 'node:events',
    'assert', 'node:assert',
    'path', 'node:path',
    'dns', 'node:dns',
    'http', 'node:http',
    'https', 'node:https',
    'timers', 'node:timers',
    // External packages that stdio transport imports
    'cross-spawn'
  ],
  esbuildOptions(options) {
    // Make sure ESBuild knows we target browser-ish runtime
    options.platform = 'browser';
    options.mainFields = ['module', 'browser', 'main'];
    // Trim dead code paths more aggressively
    options.treeShaking = true;
    // If the lib checks process.env, prevent inlining Node shims
    options.define = {
      ...(options.define || {}),
      'process.env.NODE_DEBUG': 'false',
      'process.env.DEBUG': 'false',
    };
  },
})