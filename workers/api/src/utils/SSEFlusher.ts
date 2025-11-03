/**
 * SSE Pipeline Flusher
 *
 * Helper utility to manage SSE stream flushing during long-running operations.
 * Automatically flushes after N messages or M milliseconds to keep streams lively.
 *
 * Usage:
 * ```typescript
 * const maybeFlush = makeSSEFlusher(sse.writeAsync, sse.flush, {
 *   everyN: 15,    // flush every 15 messages
 *   everyMs: 400   // or after 400ms
 * });
 *
 * // In your processing loop:
 * await sse.writeAsync({ type: 'progress', data: result });
 * await maybeFlush();
 * ```
 */

export interface SSEFlusherOptions {
  everyMs?: number // Flush after this time window in ms (default: 500)
  everyN?: number // Flush every N messages (default: 20)
}

export interface SSEWriter {
  flush: () => Promise<void>
  writeAsync: (data: unknown) => Promise<void>
}

/**
 * Create a flusher with explicit control over when to count messages
 */
export function makeControlledSSEFlusher(
  flush: () => Promise<void>,
  options: SSEFlusherOptions = {},
): {
  forceFlush: () => Promise<void>
  mark: () => void
  maybeFlush: () => Promise<void>
} {
  const {everyMs = 500, everyN = 20} = options

  let sinceLastFlush = 0
  let lastFlushTime = Date.now()

  return {
    /**
     * Force an immediate flush regardless of counters
     */
    forceFlush: async () => {
      await flush()
      sinceLastFlush = 0
      lastFlushTime = Date.now()
    },

    /**
     * Mark that a message was written (increments counter)
     */
    mark: () => {
      sinceLastFlush++
    },

    /**
     * Check if flush is needed and flush if so
     */
    maybeFlush: async () => {
      const now = Date.now()
      const elapsed = now - lastFlushTime

      if (sinceLastFlush >= everyN || elapsed >= everyMs) {
        await flush()
        sinceLastFlush = 0
        lastFlushTime = now
      }
    },
  }
}

/**
 * Create a smart flusher that triggers based on message count or elapsed time
 */
export function makeSSEFlusher(
  _writeAsync: (data: unknown) => Promise<void>,
  flush: () => Promise<void>,
  options: SSEFlusherOptions = {},
): () => Promise<void> {
  const {everyMs = 500, everyN = 20} = options

  let sinceLastFlush = 0
  let lastFlushTime = Date.now()

  return async function maybeFlush(): Promise<void> {
    sinceLastFlush++
    const now = Date.now()
    const elapsed = now - lastFlushTime

    if (sinceLastFlush >= everyN || elapsed >= everyMs) {
      await flush()
      sinceLastFlush = 0
      lastFlushTime = now
    }
  }
}
