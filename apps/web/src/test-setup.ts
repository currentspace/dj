import '@testing-library/jest-dom/vitest'
import {cleanup} from '@testing-library/react'
import {afterEach, beforeEach, vi} from 'vitest'

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
global.fetch = vi.fn(() =>
  Promise.resolve({
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    body: null,
    bodyUsed: false,
    clone: function() { return this },
    formData: async () => new FormData(),
    headers: new Headers(),
    json: async () => ({id: 'user123'}),
    ok: true,
    redirected: false,
    status: 200,
    text: async () => JSON.stringify({id: 'user123'}),
    type: 'basic',
    url: '',
  } as Response)
)
