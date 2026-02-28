/**
 * Test setup for @dj/api-worker (Cloudflare Workers)
 * Configures node environment with Cloudflare Workers polyfills
 */

import { beforeEach, vi } from 'vitest'

// Store native globals BEFORE mocking (for contract tests that need real network access)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(global as any).__nativeFetch = global.fetch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(global as any).__nativeSetTimeout = global.setTimeout
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(global as any).__nativeClearTimeout = global.clearTimeout

// Mock global fetch for external API calls (unit tests don't need real network)
global.fetch = vi.fn()

// Mock console methods to reduce noise in tests (can be enabled per-test)
beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks()

  // Mock console.log, console.warn, console.error if needed
  // Uncomment to suppress console output in tests:
  // vi.spyOn(console, 'log').mockImplementation(() => {})
  // vi.spyOn(console, 'warn').mockImplementation(() => {})
  // vi.spyOn(console, 'error').mockImplementation(() => {})
})

// Mock environment variables (if needed globally)
// Individual tests should override these as needed
process.env.ENVIRONMENT = 'test'

// Add any Cloudflare Workers-specific global polyfills here
// Note: Most Cloudflare-specific functionality should be mocked in individual tests
// or in fixtures/cloudflare-mocks.ts

// Polyfill setTimeout/clearTimeout to match Cloudflare Workers behavior (returns number, not Timeout object)
// This is needed for RateLimitedQueue which expects numeric timer IDs
const originalSetTimeout = global.setTimeout
const originalClearTimeout = global.clearTimeout
let timerIdCounter = 1
const timerMap = new Map<number, NodeJS.Timeout>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.setTimeout = function (callback: (...args: any[]) => void, ms?: number, ...args: any[]): number {
  const id = timerIdCounter++
  const timeout = originalSetTimeout(() => {
    timerMap.delete(id)
    callback(...args)
  }, ms)
  timerMap.set(id, timeout)
  return id
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

global.clearTimeout = function (id: null | number | undefined): void {
  if (id == null) return
  const timeout = timerMap.get(id)
  if (timeout) {
    originalClearTimeout(timeout)
    timerMap.delete(id)
  }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
