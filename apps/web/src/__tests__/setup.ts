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
  ;(window as {location: Location}).location = {
    ancestorOrigins: {} as DOMStringList,
    assign: vi.fn(),
    hash: '',
    host: 'localhost:3000',
    hostname: 'localhost',
    href: 'http://localhost:3000',
    origin: 'http://localhost:3000',
    pathname: '/',
    port: '3000',
    protocol: 'http:',
    reload: vi.fn(),
    replace: vi.fn(),
    search: '',
    toString: vi.fn(() => 'http://localhost:3000'),
  } as Location
})
