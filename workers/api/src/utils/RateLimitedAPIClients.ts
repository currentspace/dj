/**
 * Rate-Limited API Client Wrappers
 *
 * All external API calls should go through these wrappers to ensure:
 * 1. Unified rate limiting (40 RPS across ALL calls)
 * 2. Proper error handling and logging
 * 3. Batching support for bulk operations
 * 4. Respect for Cloudflare Workers RPC limits
 *
 * Usage:
 * ```typescript
 * // Single call
 * const result = await rateLimitedAnthropicCall(() => anthropic.messages.create(...));
 *
 * // Batch of calls
 * const orchestrator = getGlobalOrchestrator();
 * orchestrator.enqueueBatch('spotify-searches', searches.map(q => () => spotify.search(q)));
 * const results = await orchestrator.awaitBatch('spotify-searches');
 * ```
 */

import { globalOrchestrator } from './RequestOrchestrator';
import type { ServiceLogger } from './ServiceLogger';

/**
 * Wrap an Anthropic API call with rate limiting
 * Use for both main Claude calls and Haiku narrator calls
 */
export async function rateLimitedAnthropicCall<T>(
  call: () => Promise<T>,
  logger?: ServiceLogger,
  context?: string
): Promise<T | null> {
  return globalOrchestrator.execute(async () => {
    const start = performance.now();
    try {
      logger?.debug(`Anthropic API call starting${context ? `: ${context}` : ''}`);
      const result = await call();
      const duration = performance.now() - start;
      logger?.debug(`Anthropic API call completed in ${duration.toFixed(0)}ms${context ? `: ${context}` : ''}`);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      logger?.error(`Anthropic API call failed after ${duration.toFixed(0)}ms`, error, { context });
      throw error;
    }
  });
}

/**
 * Wrap a Spotify API call with rate limiting
 */
export async function rateLimitedSpotifyCall<T>(
  call: () => Promise<T>,
  logger?: ServiceLogger,
  context?: string
): Promise<T | null> {
  return globalOrchestrator.execute(async () => {
    const start = performance.now();
    try {
      logger?.debug(`Spotify API call starting${context ? `: ${context}` : ''}`);
      const result = await call();
      const duration = performance.now() - start;
      logger?.debug(`Spotify API call completed in ${duration.toFixed(0)}ms${context ? `: ${context}` : ''}`);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      logger?.error(`Spotify API call failed after ${duration.toFixed(0)}ms`, error, { context });
      throw error;
    }
  });
}

/**
 * Wrap a Last.fm API call with rate limiting
 */
export async function rateLimitedLastFmCall<T>(
  call: () => Promise<T>,
  logger?: ServiceLogger,
  context?: string
): Promise<T | null> {
  return globalOrchestrator.execute(async () => {
    const start = performance.now();
    try {
      logger?.debug(`Last.fm API call starting${context ? `: ${context}` : ''}`);
      const result = await call();
      const duration = performance.now() - start;
      logger?.debug(`Last.fm API call completed in ${duration.toFixed(0)}ms${context ? `: ${context}` : ''}`);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      logger?.error(`Last.fm API call failed after ${duration.toFixed(0)}ms`, error, { context });
      throw error;
    }
  });
}

/**
 * Get the global orchestrator for advanced batch management
 */
export function getGlobalOrchestrator() {
  return globalOrchestrator;
}

/**
 * Batch helper: Execute multiple tasks in parallel with rate limiting
 */
export async function executeBatch<T>(
  tasks: Array<() => Promise<T>>,
  batchId?: string
): Promise<(T | null)[]> {
  const id = batchId || `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  globalOrchestrator.enqueueBatch(id, tasks);
  return globalOrchestrator.awaitBatch(id);
}
