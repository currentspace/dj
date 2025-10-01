/**
 * RequestOrchestrator - Unified rate-limited orchestrator for all external API calls
 *
 * Architecture:
 * - Global rate limit: 40 RPS (Cloudflare Workers constraint)
 * - Per-lane concurrency limits: Prevent SDK/service overload
 * - Batch dependencies: Chain operations (enrichment → narrator)
 * - No fire-and-forget: All calls orchestrated
 *
 * Lane Configuration:
 * - anthropic: 2 concurrent (Anthropic SDK limitation in Workers)
 * - spotify: 5 concurrent
 * - lastfm: 10 concurrent
 * - deezer: 10 concurrent
 * - default: 3 concurrent
 *
 * Usage:
 * 1. Single: await orchestrator.execute(() => apiCall(), 'anthropic')
 * 2. Batch: await orchestrator.executeBatch('id', tasks, 'spotify')
 */

import { RateLimitedQueue } from './RateLimitedQueue';

type Task<T> = () => Promise<T>;
type LaneKey = 'anthropic' | 'spotify' | 'lastfm' | 'deezer' | 'default';

interface LaneConfig {
  maxConcurrency: number;
  running: number;
  queue: Array<() => void>; // Callbacks to run when slot available
}

const LANE_LIMITS: Record<LaneKey, number> = {
  anthropic: 2,   // Critical: Anthropic SDK can't handle >2 concurrent in Workers
  spotify: 5,
  lastfm: 10,
  deezer: 10,
  default: 3
};

export class RequestOrchestrator {
  private rateLimiter: RateLimitedQueue<any>;
  private lanes: Map<LaneKey, LaneConfig> = new Map();

  constructor(options?: {
    rate?: number;        // Requests per second (default: 40)
    jitterMs?: number;    // Jitter in ms (default: 5)
    minTickMs?: number;   // Minimum tick delay (default: 1-2ms)
  }) {
    // Initialize rate limiter (40 RPS global, no global concurrency limit)
    this.rateLimiter = new RateLimitedQueue({
      rate: options?.rate ?? 40,
      concurrency: 999, // No global concurrency limit, per-lane only
      jitterMs: options?.jitterMs ?? 5,
      minTickMs: options?.minTickMs ?? 2,
    });

    // Initialize lane configurations
    for (const [lane, maxConcurrency] of Object.entries(LANE_LIMITS)) {
      this.lanes.set(lane as LaneKey, {
        maxConcurrency,
        running: 0,
        queue: []
      });
    }

    // Start continuous processing
    this.rateLimiter.processContinuously().catch(err => {
      console.error('[RequestOrchestrator] Fatal error:', err);
    });
  }

  /**
   * Execute a single task with per-lane concurrency control
   *
   * Flow:
   * 1. Wait for lane slot (if lane is full)
   * 2. Acquire lane slot
   * 3. Enqueue in global rate limiter (40 RPS)
   * 4. Execute task
   * 5. Release lane slot
   */
  async execute<T>(task: Task<T>, lane: LaneKey = 'default'): Promise<T> {
    const laneConfig = this.lanes.get(lane)!;

    // Wait for lane slot if needed
    await this.acquireLaneSlot(lane);

    try {
      // Enqueue in rate limiter and execute
      const result = await new Promise<T>((resolve, reject) => {
        this.rateLimiter.enqueue(async () => {
          try {
            const value = await task();
            resolve(value);
            return value;
          } catch (error) {
            reject(error);
            return null;
          }
        });
      });

      return result;
    } finally {
      // Always release lane slot
      this.releaseLaneSlot(lane);
    }
  }

  /**
   * Wait for a slot in the specified lane to become available
   */
  private async acquireLaneSlot(lane: LaneKey): Promise<void> {
    const config = this.lanes.get(lane)!;

    if (config.running < config.maxConcurrency) {
      // Slot available immediately
      config.running++;
      return;
    }

    // Wait for slot
    return new Promise<void>((resolve) => {
      config.queue.push(resolve);
    });
  }

  /**
   * Release a slot in the specified lane
   */
  private releaseLaneSlot(lane: LaneKey): void {
    const config = this.lanes.get(lane)!;
    config.running--;

    // Wake up next waiting task
    const next = config.queue.shift();
    if (next) {
      config.running++;
      next();
    }
  }

  /**
   * Execute a batch of tasks and wait for all to complete
   *
   * All tasks go through the same lane and respect its concurrency limit
   * Returns results in same order as input tasks
   */
  async executeBatch<T>(tasks: Task<T>[], lane: LaneKey = 'default'): Promise<T[]> {
    const promises = tasks.map(task => this.execute(task, lane));
    return Promise.all(promises);
  }
}

/**
 * Global orchestrator instance
 * All API calls in the worker go through this
 */
export const globalOrchestrator = new RequestOrchestrator({
  rate: 40,     // 40 RPS (Cloudflare Workers limit)
  jitterMs: 5,  // 0-5ms jitter
});
