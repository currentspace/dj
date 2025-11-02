/**
 * Rate-Limited API Client Wrappers
 *
 * Architecture:
 * - Global rate limit: 40 RPS (Cloudflare Workers constraint)
 * - Per-lane concurrency: Prevent SDK/service overload
 * - anthropic: 2 concurrent (Anthropic SDK limitation in Workers)
 * - spotify: 5 concurrent
 * - lastfm: 10 concurrent
 * - deezer: 10 concurrent
 *
 * Usage:
 * ```typescript
 * // Single call
 * const result = await rateLimitedAnthropicCall(() => anthropic.invoke(...));
 *
 * // Batch of calls (all await together, respecting lane limits)
 * const results = await Promise.all([
 *   rateLimitedSpotifyCall(() => spotify.getTrack(id1)),
 *   rateLimitedSpotifyCall(() => spotify.getTrack(id2))
 * ]);
 * ```
 */

import {z} from 'zod'

import type {ServiceLogger} from './ServiceLogger'

import {globalOrchestrator} from './RequestOrchestrator'

// Error details schema for structured error logging
const ErrorDetailsSchema = z.object({
  code: z.number().optional(),
  context: z.string().optional(),
  message: z.string().optional(),
  name: z.string().optional(),
  status: z.number().optional(),
})

type ErrorDetails = z.infer<typeof ErrorDetailsSchema>

// Schema for errors that may have status/code properties
const ErrorWithStatusSchema = z.object({status: z.number()})
const ErrorWithCodeSchema = z.object({code: z.number()})

/**
 * Get the global orchestrator instance
 */
export function getGlobalOrchestrator() {
  return globalOrchestrator
}

/**
 * Wrap an Anthropic API call with rate limiting and concurrency control
 * Lane: anthropic (max 2 concurrent)
 */
export async function rateLimitedAnthropicCall<T>(
  call: () => Promise<T>,
  logger?: ServiceLogger,
  context?: string,
): Promise<T> {
  return globalOrchestrator.execute(async () => {
    const start = performance.now()
    try {
      logger?.debug(`Anthropic API call starting${context ? `: ${context}` : ''}`)
      const result = await call()
      const duration = performance.now() - start
      logger?.debug(`Anthropic API call completed in ${duration.toFixed(0)}ms${context ? `: ${context}` : ''}`)
      return result
    } catch (error) {
      const duration = performance.now() - start
      const errorDetails = buildErrorDetails(error, context)
      logger?.error(`Anthropic API call failed after ${duration.toFixed(0)}ms`, error, errorDetails)
      throw error
    }
  }, 'anthropic')
}

/**
 * Wrap a Deezer API call with rate limiting and concurrency control
 * Lane: deezer (max 10 concurrent)
 */
export async function rateLimitedDeezerCall<T>(
  call: () => Promise<T>,
  logger?: ServiceLogger,
  context?: string,
): Promise<T> {
  return globalOrchestrator.execute(async () => {
    const start = performance.now()
    try {
      logger?.debug(`Deezer API call starting${context ? `: ${context}` : ''}`)
      const result = await call()
      const duration = performance.now() - start
      logger?.debug(`Deezer API call completed in ${duration.toFixed(0)}ms${context ? `: ${context}` : ''}`)
      return result
    } catch (error) {
      const duration = performance.now() - start
      logger?.error(`Deezer API call failed after ${duration.toFixed(0)}ms`, error, {context})
      throw error
    }
  }, 'deezer')
}

/**
 * Wrap a Last.fm API call with rate limiting and concurrency control
 * Lane: lastfm (max 10 concurrent)
 */
export async function rateLimitedLastFmCall<T>(
  call: () => Promise<T>,
  logger?: ServiceLogger,
  context?: string,
): Promise<T> {
  return globalOrchestrator.execute(async () => {
    const start = performance.now()
    try {
      logger?.debug(`Last.fm API call starting${context ? `: ${context}` : ''}`)
      const result = await call()
      const duration = performance.now() - start
      logger?.debug(`Last.fm API call completed in ${duration.toFixed(0)}ms${context ? `: ${context}` : ''}`)
      return result
    } catch (error) {
      const duration = performance.now() - start
      logger?.error(`Last.fm API call failed after ${duration.toFixed(0)}ms`, error, {context})
      throw error
    }
  }, 'lastfm')
}

/**
 * Wrap a Spotify API call with rate limiting and concurrency control
 * Lane: spotify (max 5 concurrent)
 */
export async function rateLimitedSpotifyCall<T>(
  call: () => Promise<T>,
  logger?: ServiceLogger,
  context?: string,
): Promise<T> {
  return globalOrchestrator.execute(async () => {
    const start = performance.now()
    try {
      logger?.debug(`Spotify API call starting${context ? `: ${context}` : ''}`)
      const result = await call()
      const duration = performance.now() - start
      logger?.debug(`Spotify API call completed in ${duration.toFixed(0)}ms${context ? `: ${context}` : ''}`)
      return result
    } catch (error) {
      const duration = performance.now() - start
      logger?.error(`Spotify API call failed after ${duration.toFixed(0)}ms`, error, {context})
      throw error
    }
  }, 'spotify')
}

// Helper to build error details from an error
function buildErrorDetails(error: unknown, context?: string): ErrorDetails {
  const details: ErrorDetails = {context}

  if (error instanceof Error) {
    details.message = error.message
    details.name = error.name
  }

  if (hasStatus(error)) {
    details.status = error.status
  }

  if (hasCode(error)) {
    details.code = error.code
  }

  return ErrorDetailsSchema.parse(details)
}

// Type guard for errors with code property using Zod
function hasCode(error: unknown): error is {code: number} {
  return ErrorWithCodeSchema.safeParse(error).success
}

// Type guard for errors with status property using Zod
function hasStatus(error: unknown): error is {status: number} {
  return ErrorWithStatusSchema.safeParse(error).success
}
