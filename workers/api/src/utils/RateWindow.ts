/**
 * RateWindow - Lightweight RPS tracking utility
 *
 * Tracks request/event rate over a sliding time window to verify
 * rate limiting is working correctly without flooding logs.
 *
 * Usage:
 * ```typescript
 * const window = new RateWindow(1000); // 1-second window
 *
 * // Mark each event
 * window.mark();
 *
 * // Get current RPS
 * console.log(`Current RPS: ${window.rps().toFixed(1)}`);
 *
 * // Periodic logging (e.g., every 2-3 seconds)
 * setInterval(() => {
 *   console.log(`Launch rate: ${window.rps().toFixed(1)} req/s`);
 * }, 2000);
 * ```
 */

export class RateWindow {
  private hits: number[] = []; // timestamps in milliseconds
  private readonly windowMs: number;

  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
  }

  /**
   * Mark that an event occurred at this moment
   */
  mark(): void {
    const now = Date.now();
    this.hits.push(now);

    // Remove hits outside the window
    while (this.hits.length && now - this.hits[0] > this.windowMs) {
      this.hits.shift();
    }
  }

  /**
   * Calculate the current rate per second
   * Returns 0 if no hits, or accurate RPS based on actual time span
   */
  rps(): number {
    const n = this.hits.length;

    if (n === 0) return 0;
    if (n === 1) return 1;

    // Calculate actual span between first and last hit in the window
    const spanMs = this.hits[n - 1] - this.hits[0];
    const spanSec = spanMs / 1000;

    // Avoid division by zero for very close hits
    if (spanSec === 0) return n;

    // Rate = (number of intervals) / time span
    // We have (n-1) intervals between n hits
    return (n - 1) / spanSec;
  }

  /**
   * Get the count of hits in the current window
   */
  count(): number {
    const now = Date.now();

    // Clean up old hits
    while (this.hits.length && now - this.hits[0] > this.windowMs) {
      this.hits.shift();
    }

    return this.hits.length;
  }

  /**
   * Reset the window, clearing all hits
   */
  reset(): void {
    this.hits = [];
  }

  /**
   * Get a summary of the current window state
   */
  summary(): { count: number; rps: number; windowMs: number } {
    return {
      count: this.count(),
      rps: this.rps(),
      windowMs: this.windowMs,
    };
  }
}
