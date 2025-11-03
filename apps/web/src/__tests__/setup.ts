import '@testing-library/jest-dom'
import {cleanup} from '@testing-library/react'
import {afterEach, beforeEach, vi} from 'vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

// Mock window.location for OAuth tests
beforeEach(() => {
  // Reset location mock
  delete (window as {location?: Location}).location
  window.location = {
    href: 'http://localhost:3000',
    pathname: '/',
    search: '',
    hash: '',
    origin: 'http://localhost:3000',
    host: 'localhost:3000',
    hostname: 'localhost',
    port: '3000',
    protocol: 'http:',
    assign: vi.fn(),
    reload: vi.fn(),
    replace: vi.fn(),
    toString: vi.fn(() => 'http://localhost:3000'),
    ancestorOrigins: {} as DOMStringList,
  } as Location
})
