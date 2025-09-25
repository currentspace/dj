import type { ChatMessage } from '@dj/shared-types'
import { z } from 'zod'
import { chatStreamClient } from './streaming-client'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787/api' : '/api'

// Zod schemas for runtime validation
// The Spotify API can return nulls, but we transform them to defaults
const SpotifyPlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().transform(val => val || ''),
  external_urls: z.object({ spotify: z.string() }),
  images: z.array(z.object({
    url: z.string(),
    height: z.number().nullable().transform(val => val || 0),
    width: z.number().nullable().transform(val => val || 0)
  })),
  tracks: z.object({ total: z.number() }),
  public: z.boolean().nullable().transform(val => val !== null ? val : true),
  owner: z.object({ display_name: z.string() })
})

const PlaylistsResponseSchema = z.object({
  items: z.array(SpotifyPlaylistSchema)
})

type PlaylistsResponse = z.infer<typeof PlaylistsResponseSchema>

// Custom error class with additional details
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public url?: string,
    public body?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Main API client class
export class ApiClient {
  private baseUrl: string
  private defaultTimeout = 30000 // 30 seconds

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl
  }

  // SSR-safe token getter
  private getToken(): string | null {
    if (typeof window === 'undefined' || !('localStorage' in window)) {
      return null
    }
    return localStorage.getItem('spotify_token')
  }

  // Clear token on auth failure
  private clearToken(): void {
    if (typeof window === 'undefined' || !('localStorage' in window)) {
      return
    }
    localStorage.removeItem('spotify_token')
  }

  // Core request method with all improvements
  private async request<T>(
    endpoint: string,
    options: RequestInit & { timeout?: number } = {}
  ): Promise<T> {
    // Proper URL joining
    const url = new URL(endpoint, this.baseUrl).toString()

    // Normalize headers
    const headers = new Headers(options.headers || {})

    // Only set Content-Type for requests with JSON bodies
    const hasBody = options.body !== undefined && options.body !== null
    if (hasBody && !headers.has('Content-Type') && typeof options.body === 'string') {
      try {
        JSON.parse(options.body as string)
        headers.set('Content-Type', 'application/json')
      } catch {
        // Body is not JSON, don't set Content-Type
      }
    }

    // Add auth token if available
    const token = this.getToken()
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    // Set Accept header if not present
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json')
    }

    // Create abort controller with timeout
    const abortController = new AbortController()
    const timeout = options.timeout || this.defaultTimeout
    const timeoutId = setTimeout(() => abortController.abort(), timeout)

    // Merge abort signals if one was provided
    let signal = abortController.signal
    if (options.signal) {
      const originalSignal = options.signal
      signal = new AbortController().signal

      const onAbort = () => abortController.abort()
      originalSignal.addEventListener('abort', onAbort)
      abortController.signal.addEventListener('abort', () => {
        originalSignal.removeEventListener('abort', onAbort)
      })
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal
      })

      // Read response text once
      const contentType = response.headers.get('content-type') || ''
      const text = await response.text()

      // Handle errors
      if (!response.ok) {
        let body: unknown = text

        // Try to parse JSON error if content-type indicates JSON
        if (contentType.includes('application/json') && text) {
          try {
            body = JSON.parse(text)
          } catch {
            // Keep as text if JSON parsing fails
          }
        }

        // Build error message
        const errorMessage =
          (typeof body === 'object' && body && 'error' in body &&
           typeof (body as any).error === 'string')
            ? (body as any).error
            : `${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 300)}` : ''}`

        const error = new ApiError(errorMessage, response.status, url, body)

        // Auto-logout on 401
        if (response.status === 401) {
          this.clearToken()
        }

        throw error
      }

      // Handle successful responses

      // Handle 204 No Content or empty responses
      if (!text || response.status === 204) {
        return undefined as unknown as T
      }

      // Parse JSON if content-type indicates JSON
      if (contentType.includes('application/json')) {
        try {
          return JSON.parse(text) as T
        } catch (error) {
          throw new ApiError(
            `Invalid JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`,
            response.status,
            url,
            text
          )
        }
      }

      // Return text for non-JSON responses
      return text as unknown as T

    } catch (error) {
      // Handle abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError(
          `Request timeout after ${timeout}ms`,
          undefined,
          url
        )
      }

      // Re-throw ApiErrors
      if (error instanceof ApiError) {
        throw error
      }

      // Wrap other errors
      throw new ApiError(
        error instanceof Error ? error.message : 'Request failed',
        undefined,
        url
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // Public API methods

  async sendChatMessage(
    message: string,
    history: ChatMessage[],
    mode: 'analyze' | 'create' | 'edit',
    options?: { signal?: AbortSignal; timeout?: number }
  ) {
    return this.request('/chat/message', {
      method: 'POST',
      body: JSON.stringify({
        message,
        mode,
        conversationHistory: history  // Fixed: use correct field name
      }),
      ...options
    })
  }

  async getUserPlaylists(
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<PlaylistsResponse> {
    const token = this.getToken()
    if (!token) {
      throw new ApiError('Not authenticated with Spotify', 401)
    }

    const data = await this.request<PlaylistsResponse>('/spotify/playlists', options)

    // Validate response shape
    try {
      return PlaylistsResponseSchema.parse(data)
    } catch (error) {
      throw new ApiError(
        `Invalid playlist response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        undefined,
        data
      )
    }
  }
}

// Create singleton instance
export const apiClient = new ApiClient()

// Export convenience functions that use the singleton
export async function sendChatMessage(
  message: string,
  history: ChatMessage[],
  mode: 'analyze' | 'create' | 'edit'
) {
  return apiClient.sendChatMessage(message, history, mode)
}

export async function getUserPlaylists(): Promise<PlaylistsResponse> {
  return apiClient.getUserPlaylists()
}

// Re-export streaming function using the streaming client
export async function streamChatMessage(
  message: string,
  history: ChatMessage[],
  mode: 'analyze' | 'create' | 'edit',
  callbacks: Parameters<typeof chatStreamClient.streamMessage>[3],
  options?: Parameters<typeof chatStreamClient.streamMessage>[4]
) {
  return chatStreamClient.streamMessage(message, history, mode, callbacks, options)
}