/**
 * PromiseTracker - Tracks in-flight promises to prevent floating promises.
 *
 * Usage:
 *   const tracker = new PromiseTracker()
 *   tracker.track(someAsyncOp())
 *   await tracker.flush() // waits for all tracked promises to settle
 */
export class PromiseTracker {
  private pending = new Set<Promise<unknown>>()

  /** Number of currently tracked (unsettled) promises */
  get size(): number {
    return this.pending.size
  }

  /**
   * Track a promise. The promise is automatically removed from the set
   * when it settles (resolves or rejects).
   * Returns the same promise for chaining.
   */
  track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise)

    const cleanup = () => {
      this.pending.delete(promise)
    }
    promise.then(cleanup, cleanup)

    return promise
  }

  /**
   * Wait for all currently tracked promises to settle.
   * Uses Promise.allSettled so one rejection doesn't block others.
   */
  async flush(): Promise<void> {
    if (this.pending.size === 0) return
    await Promise.allSettled([...this.pending])
  }
}
