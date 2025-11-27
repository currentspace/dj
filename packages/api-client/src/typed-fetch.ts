/**
 * Type-safe API client builder
 * Derives paths, methods, and types from @hono/zod-openapi route definitions
 *
 * This ensures compile-time errors if:
 * - Path doesn't match the route definition
 * - HTTP method doesn't match the route definition
 * - Request body doesn't match the schema
 * - Response type doesn't match the schema
 */

import type {z} from 'zod'

/**
 * Extract the path from a route config
 */
type ExtractPath<R> = R extends {path: infer P} ? P : never

/**
 * Extract the method from a route config (uppercase for fetch)
 */
type ExtractMethod<R> = R extends {method: infer M extends string} ? Uppercase<M> : never

/**
 * Extract request body schema type
 */
type ExtractRequestBody<R> = R extends {
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.ZodType<infer T>
        }
      }
    }
  }
}
  ? T
  : undefined

/**
 * Extract success response schema type (200 status)
 */
type ExtractResponseBody<R> = R extends {
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.ZodType<infer T>
        }
      }
    }
  }
}
  ? T
  : unknown

/**
 * Route metadata extracted from a route config
 */
export interface RouteInfo<R> {
  path: ExtractPath<R>
  method: ExtractMethod<R>
  requestBody: ExtractRequestBody<R>
  responseBody: ExtractResponseBody<R>
}

/**
 * Options for making a typed API request
 */
interface TypedFetchOptions<TBody> {
  body?: TBody
  headers?: Record<string, string>
  pathParams?: Record<string, string | number>
}

/**
 * Replace path parameters in a URL
 * e.g., '/api/mix/queue/{position}' with {position: 5} -> '/api/mix/queue/5'
 */
function replacePathParams(path: string, params?: Record<string, string | number>): string {
  if (!params) return path
  return Object.entries(params).reduce(
    (p, [key, value]) => p.replace(`{${key}}`, String(value)),
    path,
  )
}

/**
 * Create a type-safe fetch function for a route
 *
 * @example
 * ```ts
 * import { startMix } from '@dj/api-contracts'
 *
 * const startSession = createTypedFetch(startMix)
 * // Now startSession is typed:
 * // - Uses POST method
 * // - Calls /api/mix/start
 * // - Body must match StartMixRequestSchema
 * // - Returns StartMixResponseSchema
 *
 * const response = await startSession({
 *   body: { preferences: {...} },
 *   headers: { Authorization: 'Bearer token' }
 * })
 * ```
 */
export function createTypedFetch<R extends {path: string; method: string}>(
  route: R,
): (
  options?: TypedFetchOptions<ExtractRequestBody<R>>,
) => Promise<ExtractResponseBody<R>> {
  const {path, method} = route

  return async (options?: TypedFetchOptions<ExtractRequestBody<R>>) => {
    const url = replacePathParams(path, options?.pathParams)

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: {
        ...options?.headers,
      },
    }

    if (options?.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body)
      ;(fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, fetchOptions)

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.slice(0, 300)}` : ''}`,
      )
    }

    return response.json() as Promise<ExtractResponseBody<R>>
  }
}

/**
 * API client configuration
 */
export interface ApiClientConfig {
  baseUrl?: string
  getAuthToken?: () => string | null
  onUnauthorized?: () => void
}

/**
 * Create a configured API client with common defaults
 */
export function createApiClient(config: ApiClientConfig = {}) {
  const {baseUrl = '', getAuthToken, onUnauthorized} = config

  return function typedFetch<R extends {path: string; method: string}>(
    route: R,
  ): (
    options?: TypedFetchOptions<ExtractRequestBody<R>>,
  ) => Promise<ExtractResponseBody<R>> {
    const {path, method} = route

    return async (options?: TypedFetchOptions<ExtractRequestBody<R>>) => {
      const url = baseUrl + replacePathParams(path, options?.pathParams)

      const headers: Record<string, string> = {...options?.headers}

      // Add auth token if available
      if (getAuthToken) {
        const token = getAuthToken()
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
      }

      const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers,
      }

      if (options?.body !== undefined) {
        fetchOptions.body = JSON.stringify(options.body)
        headers['Content-Type'] = 'application/json'
      }

      const response = await fetch(url, fetchOptions)

      if (!response.ok) {
        if (response.status === 401 && onUnauthorized) {
          onUnauthorized()
        }
        const errorText = await response.text().catch(() => '')
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.slice(0, 300)}` : ''}`,
        )
      }

      return response.json() as Promise<ExtractResponseBody<R>>
    }
  }
}
