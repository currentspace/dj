/**
 * LoggerContext - AsyncLocalStorage-based context for ServiceLogger
 *
 * Provides per-request logger context without explicit parameter passing.
 * Uses Cloudflare Workers' nodejs_compat AsyncLocalStorage support.
 */

import {AsyncLocalStorage} from 'node:async_hooks'
import {z} from 'zod'

import {ServiceLogger} from './ServiceLogger'

interface LoggerContext {
  logger: ServiceLogger
}

// Schema for LoggerContext validation
const LoggerContextSchema = z.object({
  logger: z.custom<ServiceLogger>(val => val !== null && typeof val === 'object'),
})

/**
 * Get a child logger with additional context
 * Throws if called outside of a logger context
 */
export function getChildLogger(subContext: string): ServiceLogger {
  const logger = getLogger()
  if (!logger) {
    throw new Error('getChildLogger called outside of logger context')
  }
  return logger.child(subContext)
}

// Create AsyncLocalStorage instance with validation
// Note: AsyncLocalStorage is provided by nodejs_compat in Cloudflare Workers
const loggerStorageRaw = new AsyncLocalStorage<LoggerContext>()

// Validate the storage instance structure
if (
  typeof loggerStorageRaw !== 'object' ||
  loggerStorageRaw === null ||
  typeof (loggerStorageRaw as {getStore?: unknown}).getStore !== 'function' ||
  typeof (loggerStorageRaw as {run?: unknown}).run !== 'function'
) {
  throw new Error('AsyncLocalStorage instance is invalid')
}

/**
 * Get the current request's logger
 * Returns undefined if called outside of a logger context
 */
export function getLogger(): undefined | ServiceLogger {
  // Type guard ensures loggerStorageRaw has getStore method
  if (typeof (loggerStorageRaw as {getStore?: unknown}).getStore !== 'function') {
    return undefined
  }

  const contextRaw = loggerStorageRaw.getStore()

  // Validate context using Zod schema (handles null/undefined automatically)
  const validation = LoggerContextSchema.safeParse(contextRaw)
  if (!validation.success) {
    return undefined
  }

  return validation.data.logger
}

/**
 * Initialize logger context for a request scope
 * Must be called with async/await (not thenables) to ensure context preservation
 */
export async function runWithLogger<T>(logger: ServiceLogger, fn: () => Promise<T>): Promise<T> {
  const context: LoggerContext = {logger}

  // Validate context before using it
  const validation = LoggerContextSchema.safeParse(context)
  if (!validation.success) {
    throw new Error('Invalid logger context')
  }

  // Type guard ensures loggerStorageRaw has run method
  if (typeof (loggerStorageRaw as {run?: unknown}).run !== 'function') {
    throw new Error('AsyncLocalStorage.run is not available')
  }

  // Type guard validates the storage object structure
  const storageWithRun = loggerStorageRaw as {
    run?: (context: LoggerContext, fn: () => Promise<T>) => Promise<T>
  }
  if (typeof storageWithRun.run === 'function') {
    return await storageWithRun.run(context, fn)
  }

  throw new Error('AsyncLocalStorage.run is not available')
}
