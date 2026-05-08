import '@testing-library/jest-dom/vitest'
import {cleanup} from '@testing-library/react'
import {afterEach, beforeEach, vi} from 'vitest'

// Node 25's experimental localStorage shadows jsdom's in worker threads
// and lacks `clear()`. Force jsdom's localStorage to win.
function makeStorage(): Storage {
  let store: Record<string, string> = {}
  return {
    clear() {
      store = {}
    },
    getItem(key) {
      return key in store ? store[key] : null
    },
    key(i) {
      return Object.keys(store)[i] ?? null
    },
    get length() {
      return Object.keys(store).length
    },
    removeItem(key) {
      delete store[key]
    },
    setItem(key, value) {
      store[key] = String(value)
    },
  }
}
Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: makeStorage(), writable: true})
Object.defineProperty(globalThis, 'sessionStorage', {configurable: true, value: makeStorage(), writable: true})

// Cleanup after each test
afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  vi.clearAllTimers()
})

// Mock window.location for OAuth tests
beforeEach(() => {
  // Clear storage FIRST
  localStorage.clear()
  sessionStorage.clear()

  // Reset location properties
  window.location.href = 'http://localhost:3000'
  window.location.pathname = '/'
  window.location.search = ''
  window.location.hash = ''

  // Mock history.replaceState
  window.history.replaceState = vi.fn()
})

// Global fetch mock setup
globalThis.fetch = vi.fn(() =>
  Promise.resolve({
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    body: null,
    bodyUsed: false,
    clone: function () {
      return this
    },
    formData: async () => new FormData(),
    headers: new Headers(),
    json: async () => ({id: 'user123'}),
    ok: true,
    redirected: false,
    status: 200,
    text: async () => JSON.stringify({id: 'user123'}),
    type: 'basic',
    url: '',
  } as Response),
)
