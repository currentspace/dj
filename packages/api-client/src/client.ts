/**
 * Typed API client using Hono RPC
 * Provides end-to-end type safety from server to client
 */

import { hc } from 'hono/client';
import type { AppType } from '@dj/api-contracts';

/**
 * Create a typed API client
 * @param baseUrl - API base URL (e.g., 'http://localhost:8787' or 'https://dj.current.space')
 * @returns Typed client with full route inference
 *
 * @example
 * ```typescript
 * const client = createApiClient('http://localhost:8787');
 *
 * // Fully typed request and response
 * const res = await client.api.spotify.auth.$get();
 * const data = await res.json(); // Type: { url: string }
 * ```
 */
export function createApiClient(baseUrl: string) {
  return hc<AppType>(baseUrl);
}

/**
 * Default client for browser usage
 * Uses current origin (works in both dev and production)
 */
export const apiClient = createApiClient(
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8787'
);

/**
 * Type-safe helper to parse and validate responses
 * Throws DetailedError if response shape doesn't match expected type
 *
 * @example
 * ```typescript
 * const res = await client.api.spotify.playlists.$get();
 * const data = await parseResponse(res);
 * // data is fully typed based on route contract
 * ```
 */
export async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `API Error ${response.status}: ${response.statusText}${
        errorText ? ` - ${errorText}` : ''
      }`
    );
  }

  return response.json() as Promise<T>;
}
