/**
 * React Testing Helpers
 * Provides utilities for rendering components with context, mocking APIs, and waiting for events
 */

import type {SpotifyPlaylist} from '@dj/shared-types'

import {render, type RenderOptions} from '@testing-library/react'
import {type ReactElement, type ReactNode} from 'react'
import {type Mock, vi} from 'vitest'

import {buildPlaylist, mockUserProfile} from './spotify-mocks'
import {
  createMockSSEResponse,
  mockContentEvent,
  mockDoneEvent,
  mockThinkingEvent,
} from './sse-events'
import {clearAllStorage, setupMockStorage} from './storage-mocks'

// ============================================================================
// TYPES
// ============================================================================

export interface MockFetchOptions {
  /** Response delay in ms (default: 0) */
  delay?: number
  /** Response headers */
  headers?: HeadersInit
  /** Status code (default: 200) */
  status?: number
}

export interface RenderWithAuthOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial token to seed in localStorage */
  initialToken?: string
  /** Whether to automatically validate token (default: true) */
  validateToken?: boolean
}

export interface RenderWithPlaylistOptions extends RenderWithAuthOptions {
  /** Playlist to select (defaults to mock playlist) */
  playlist?: SpotifyPlaylist
}

interface TestWrapperProps {
  children: ReactNode
}

// ============================================================================
// TEST SETUP/TEARDOWN
// ============================================================================

/**
 * Cleanup after each test
 */
export function cleanupTestEnvironment(): void {
  clearAllStorage()
  vi.clearAllMocks()
  vi.restoreAllMocks()
}

/**
 * Clear OAuth callback from URL
 */
export function clearOAuthCallback(): void {
  window.location.hash = ''
}

// ============================================================================
// RENDER HELPERS
// ============================================================================

/**
 * Simulate clicking an element
 */
export async function clickElement(element: HTMLElement): Promise<void> {
  element.click()
  await waitForNextTick()
}

/**
 * Create abort error for testing
 */
export function createAbortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

/**
 * Create mock fetch response
 */
export function createMockFetchResponse(
  body: unknown,
  options?: {
    ok?: boolean
    status?: number
    statusText?: string
  },
): Response {
  return {
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    body: null,
    bodyUsed: false,
    clone: function () {
      return this
    },
    formData: async () => new FormData(),
    headers: new Headers(),
    json: async () => body,
    ok: options?.ok ?? true,
    redirected: false,
    status: options?.status ?? 200,
    statusText: options?.statusText ?? 'OK',
    text: async () => JSON.stringify(body),
    type: 'basic',
    url: '',
  } as Response
}

// ============================================================================
// FETCH MOCKING
// ============================================================================

/**
 * Wait for async operations to complete
 */
export function flushPromises(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

/**
 * Log all fetch calls made during test
 */
export function logFetchCalls(): void {
  const fetchMock = global.fetch as Mock
  if (fetchMock?.mock) {
    console.log('[Fetch Calls]', fetchMock.mock.calls)
  } else {
    console.log('[Fetch Calls] No fetch mock installed')
  }
}

/**
 * Log current storage state (useful for debugging)
 */
export function logStorageState(): void {
  console.log('[Storage State]')
  console.log('localStorage:', {
    keys: Array.from({length: localStorage.length}, (_, i) => localStorage.key(i)),
    length: localStorage.length,
  })
  console.log('sessionStorage:', {
    keys: Array.from({length: sessionStorage.length}, (_, i) => sessionStorage.key(i)),
    length: sessionStorage.length,
  })
}

/**
 * Mock full auth flow (token validation and user fetch)
 */
export function mockAuthFlow(token = 'test_token'): void {
  const tokenData = {createdAt: Date.now(), expiresAt: Date.now() + 3600000, token}
  localStorage.setItem('spotify_token_data', JSON.stringify(tokenData))
  setupSpotifyMocks()
}

// ============================================================================
// SPOTIFY API MOCKING
// ============================================================================

/**
 * Mock chat stream endpoint with SSE events
 *
 * @example
 * mockChatStream([mockThinkingEvent('...'), mockContentEvent('Hi'), mockDoneEvent()])
 */
export function mockChatStream(events: Parameters<typeof createMockSSEResponse>[0], delayMs?: number): Mock {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const urlString = typeof url === 'string' ? url : url.toString()

    if (urlString.includes('/api/chat-stream/message')) {
      return createMockSSEResponse(events, delayMs)
    }

    return new Response(null, {status: 404})
  }) as Mock

  global.fetch = fetchMock
  return fetchMock
}

/**
 * Mock global fetch with a JSON response
 *
 * @example
 * mockFetch({data: 'test'})
 * const response = await fetch('/api/test')
 * expect(await response.json()).toEqual({data: 'test'})
 */
export function mockFetch<T>(data: T, options?: MockFetchOptions): Mock {
  const {delay = 0, headers = {'Content-Type': 'application/json'}, status = 200} = options ?? {}

  const fetchMock = vi.fn(async () => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    return new Response(JSON.stringify(data), {
      headers,
      status,
    })
  }) as Mock

  global.fetch = fetchMock
  return fetchMock
}

// ============================================================================
// SSE STREAM MOCKING
// ============================================================================

/**
 * Mock fetch to return an error
 */
export function mockFetchError(status = 500, message = 'Internal Server Error'): Mock {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify({error: message}), {
      headers: {'Content-Type': 'application/json'},
      status,
    })
  }) as Mock

  global.fetch = fetchMock
  return fetchMock
}

/**
 * Mock fetch to reject (network error)
 */
export function mockFetchReject(error: Error | string = 'Network error'): Mock {
  const fetchMock = vi.fn(async () => {
    throw typeof error === 'string' ? new Error(error) : error
  }) as Mock

  global.fetch = fetchMock
  return fetchMock
}

// ============================================================================
// WAIT HELPERS
// ============================================================================

/**
 * Mock simple chat response (thinking → content → done)
 */
export function mockSimpleChatResponse(message: string): Mock {
  return mockChatStream([mockThinkingEvent('Processing...'), mockContentEvent(message), mockDoneEvent()])
}

/**
 * Mock Spotify API endpoint
 *
 * @example
 * mockSpotifyAPI('/me', mockUserProfile())
 * mockSpotifyAPI('/playlists/123', mockPlaylist())
 */
export function mockSpotifyAPI<T>(endpoint: string, data: T, options?: MockFetchOptions): Mock {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const urlString = typeof url === 'string' ? url : url.toString()

    // Match Spotify API calls
    if (urlString.includes('api.spotify.com') && urlString.includes(endpoint)) {
      const {delay = 0, headers = {'Content-Type': 'application/json'}, status = 200} = options ?? {}

      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      return new Response(JSON.stringify(data), {
        headers,
        status,
      })
    }

    // Fallback to original fetch
    return fetch(url)
  }) as Mock

  global.fetch = fetchMock
  return fetchMock
}

/**
 * Render component with authentication context
 * Automatically seeds a valid Spotify token and mocks the /me endpoint
 *
 * @example
 * const {user} = renderWithAuth(<MyComponent />)
 * await user.click(screen.getByRole('button'))
 */
export function renderWithAuth(ui: ReactElement, options?: RenderWithAuthOptions) {
  const {initialToken = 'test_token', validateToken = true, ...renderOptions} = options ?? {}

  // Seed token (seedSpotifyToken expects token string, not the full object)
  const tokenData = {createdAt: Date.now(), expiresAt: Date.now() + 3600000, token: initialToken}
  localStorage.setItem('spotify_token_data', JSON.stringify(tokenData))

  // Mock Spotify /me endpoint if validation is enabled
  if (validateToken) {
    mockSpotifyAPI('/me', mockUserProfile())
  }

  // Create wrapper (can be extended with providers)
  function Wrapper({children}: TestWrapperProps) {
    return <>{children}</>
  }

  return render(ui, {wrapper: Wrapper, ...renderOptions})
}

/**
 * Render component with a selected playlist
 * Provides both auth context and a playlist selection
 *
 * @example
 * const {playlist} = renderWithPlaylist(<ChatInterface />, {
 *   playlist: buildPlaylist({name: 'Test Playlist'})
 * })
 */
export function renderWithPlaylist(ui: ReactElement, options?: RenderWithPlaylistOptions) {
  const {playlist = buildPlaylist(), ...authOptions} = options ?? {}

  // Mock playlist endpoint
  mockSpotifyAPI(`/playlists/${playlist.id}`, playlist)

  return {
    ...renderWithAuth(ui, authOptions),
    playlist,
  }
}

// ============================================================================
// USER EVENT HELPERS
// ============================================================================

/**
 * Custom render function for React components (basic wrapper)
 */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  function Wrapper({children}: TestWrapperProps) {
    return <>{children}</>
  }

  return render(ui, {wrapper: Wrapper, ...options})
}

/**
 * Setup OAuth callback mock (simulates Spotify redirect)
 *
 * @example
 * setupOAuthCallback('mock_token')
 * // Now window.location.hash contains OAuth response
 */
export function setupOAuthCallback(accessToken: string, expiresIn = 3600): void {
  // Simulate Spotify OAuth redirect
  window.location.hash = `#access_token=${accessToken}&token_type=Bearer&expires_in=${expiresIn}`
}

/**
 * Setup comprehensive Spotify API mocks (common endpoints)
 */
export function setupSpotifyMocks(): {
  mockMe: Mock
  mockPlaylists: Mock
} {
  const mockMe = mockSpotifyAPI('/me', mockUserProfile())
  const mockPlaylists = mockSpotifyAPI('/me/playlists', {
    items: [buildPlaylist()],
    limit: 50,
    next: null,
    offset: 0,
    total: 1,
  })

  return {mockMe, mockPlaylists}
}

// ============================================================================
// AUTH FLOW HELPERS
// ============================================================================

/**
 * Setup test environment before each test
 * - Installs mock storage
 * - Clears all mocks
 * - Resets global state
 */
export function setupTestEnvironment(): void {
  // Install mock storage
  setupMockStorage()

  // Clear storage
  clearAllStorage()

  // Clear all mocks
  vi.clearAllMocks()

  // Reset fetch mock
  global.fetch = vi.fn()
}

/**
 * Simulate form submission
 */
export async function submitForm(form: HTMLElement): Promise<void> {
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('Element must be a form')
  }

  form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
  await waitForNextTick()
}

/**
 * Simulate typing in an input
 *
 * @example
 * await typeInInput(screen.getByRole('textbox'), 'Hello world')
 */
export async function typeInInput(input: HTMLElement, text: string): Promise<void> {
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
    throw new Error('Element must be an input or textarea')
  }

  input.focus()
  input.value = text

  // Trigger input event
  input.dispatchEvent(new Event('input', {bubbles: true}))

  // Trigger change event
  input.dispatchEvent(new Event('change', {bubbles: true}))

  await waitForNextTick()
}

// ============================================================================
// ERROR HELPERS
// ============================================================================

/**
 * Wait for specific number of milliseconds
 */
export async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// DEBUGGING HELPERS
// ============================================================================

/**
 * Wait for a condition to be true
 */
export function waitForCondition(condition: () => boolean, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval)
        resolve()
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval)
        reject(new Error('Timeout waiting for condition'))
      }
    }, 10)
  })
}

/**
 * Wait for next tick (useful for async state updates)
 */
export async function waitForNextTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
