/**
 * LoggerContext - AsyncLocalStorage-based context for ServiceLogger
 *
 * Provides per-request logger context without explicit parameter passing.
 * Uses Cloudflare Workers' nodejs_compat AsyncLocalStorage support.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { ServiceLogger } from './ServiceLogger';

interface LoggerContext {
  logger: ServiceLogger;
}

// Create AsyncLocalStorage instance
const loggerStorage = new AsyncLocalStorage<LoggerContext>();

/**
 * Initialize logger context for a request scope
 * Must be called with async/await (not thenables) to ensure context preservation
 */
export async function runWithLogger<T>(
  logger: ServiceLogger,
  fn: () => Promise<T>
): Promise<T> {
  return await loggerStorage.run({ logger }, fn);
}

/**
 * Get the current request's logger
 * Returns null if called outside of a logger context
 */
export function getLogger(): ServiceLogger | null {
  const context = loggerStorage.getStore();
  return context?.logger ?? null;
}

/**
 * Get a child logger with additional context
 * Throws if called outside of a logger context
 */
export function getChildLogger(subContext: string): ServiceLogger {
  const logger = getLogger();
  if (!logger) {
    throw new Error('getChildLogger called outside of logger context');
  }
  return logger.child(subContext);
}
