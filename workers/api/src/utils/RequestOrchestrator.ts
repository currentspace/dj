/**
 * RequestOrchestrator - Unified rate-limited orchestrator for all external API calls
 *
 * Key features:
 * - Single global rate limit (40 RPS) across ALL external calls
 * - Bounded concurrency with configurable parallelism
 * - Batch management - can await specific batches while respecting global limits
 * - Token bucket algorithm prevents bursting beyond limits
 * - Jitter prevents thundering herd effects
 *
 * Usage patterns:
 * 1. Single task: await orchestrator.execute(() => apiCall())
 * 2. Batch: orchestrator.enqueueBatch('id', tasks); await orchestrator.awaitBatch('id')
 * 3. Fire-and-forget: orchestrator.execute(task).catch(handleError)
 */

import { RateLimitedQueue } from './RateLimitedQueue';

type Task<T> = () => Promise<T>;
type LaneKey = string;

interface PendingEntry<T> {
  task: Task<T>;
  resolve: (value: T | null) => void;
  reject: (error: any) => void;
  lane: LaneKey;
}

interface Batch<T> {
  tasks: Array<PendingEntry<T>>;
  promise: Promise<(T | null)[]>;
}

export class RequestOrchestrator {
  private queue: RateLimitedQueue<any>;
  private batches = new Map<string, Batch<any>>();
  private pendingByLane = new Map<LaneKey, PendingEntry<any>[]>();
  private processingTimer: number | null = null;

  constructor(options?: {
    rate?: number;        // Requests per second (default: 40)
    concurrency?: number; // Parallel requests (default: 10)
    jitterMs?: number;    // Jitter in ms (default: 5)
    minTickMs?: number;   // Minimum tick delay (default: 1-2ms)
  }) {
    this.queue = new RateLimitedQueue({
      rate: options?.rate ?? 40,
      concurrency: options?.concurrency ?? 10,
      jitterMs: options?.jitterMs ?? 5,
      minTickMs: options?.minTickMs ?? 2,
    });
  }

  /**
   * Execute a single task through the rate-limited queue
   * Returns a promise that resolves when the task completes
   *
   * @param task - The async task to execute
   * @param lane - Optional lane identifier for fairness (e.g., 'anthropic', 'spotify', 'lastfm')
   */
  async execute<T>(task: Task<T>, lane: LaneKey = 'default'): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const arr = this.pendingByLane.get(lane) ?? [];
      arr.push({ task, resolve, reject, lane });
      this.pendingByLane.set(lane, arr);
      this.scheduleProcessing();
    });
  }

  /**
   * Enqueue a batch of tasks with a batch ID
   * All tasks will be rate-limited but can be awaited as a group
   *
   * @param batchId - Unique identifier for this batch
   * @param tasks - Array of tasks to execute
   * @param lane - Optional lane identifier for fairness
   */
  enqueueBatch<T>(batchId: string, tasks: Task<T>[], lane: LaneKey = 'default'): void {
    if (this.batches.has(batchId)) {
      throw new Error(`Batch ${batchId} already exists`);
    }

    const batchTasks: PendingEntry<T>[] = [];
    const promises: Promise<T | null>[] = [];

    for (const task of tasks) {
      const promise = new Promise<T | null>((resolve, reject) => {
        batchTasks.push({ task, resolve, reject, lane });
      });
      promises.push(promise);
    }

    const batch: Batch<T> = {
      tasks: batchTasks,
      promise: Promise.all(promises),
    };

    this.batches.set(batchId, batch);
    this.scheduleProcessing();
  }

  /**
   * Wait for a specific batch to complete
   * Returns results in the same order tasks were enqueued
   */
  async awaitBatch<T>(batchId: string): Promise<(T | null)[]> {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    const results = await batch.promise;
    this.batches.delete(batchId);
    return results;
  }

  /**
   * Get the number of pending tasks across all lanes and batches
   */
  getPendingCount(): number {
    let count = 0;
    for (const arr of this.pendingByLane.values()) {
      count += arr.length;
    }
    for (const batch of this.batches.values()) {
      count += batch.tasks.length;
    }
    return count;
  }

  /**
   * Schedule processing of pending tasks
   * Uses micro-batching to collect multiple enqueues before processing
   */
  private scheduleProcessing(): void {
    if (this.processingTimer !== null) return;

    // Use a small delay to allow multiple enqueues to accumulate
    // This creates natural micro-batches for better efficiency
    this.processingTimer = setTimeout(() => {
      this.processingTimer = null;
      this.processPendingTasks().catch(err => {
        console.error('[RequestOrchestrator] Processing error:', err);
      });
    }, 0) as unknown as number;
  }

  /**
   * Take tasks using round-robin fairness across lanes
   * This prevents any single source (e.g., Spotify) from monopolizing the queue
   */
  private takeRoundRobin(): PendingEntry<any>[] {
    const lanes = Array.from(this.pendingByLane.keys());
    if (lanes.length === 0) return [];

    const out: PendingEntry<any>[] = [];
    let remaining = lanes.reduce((sum, key) => sum + (this.pendingByLane.get(key)?.length ?? 0), 0);
    let i = 0;

    while (remaining > 0) {
      const lane = lanes[i % lanes.length];
      const queue = this.pendingByLane.get(lane);

      if (queue && queue.length > 0) {
        out.push(queue.shift()!);
        remaining--;
      }

      i++;
    }

    // Drop empty lanes
    for (const lane of lanes) {
      if (this.pendingByLane.get(lane)?.length === 0) {
        this.pendingByLane.delete(lane);
      }
    }

    return out;
  }

  /**
   * Process all pending tasks through the rate-limited queue
   * Uses round-robin fairness to prevent lane starvation
   */
  private async processPendingTasks(): Promise<void> {
    // Collect all pending tasks from lanes (round-robin)
    const allTasks: PendingEntry<any>[] = this.takeRoundRobin();

    // Add batch tasks
    for (const batch of this.batches.values()) {
      allTasks.push(...batch.tasks);
      batch.tasks = []; // Clear processed tasks
    }

    if (allTasks.length === 0) return;

    // Clear queue from any previous use
    this.queue.clear();

    // Enqueue all tasks into the rate-limited queue
    for (const { task, resolve, reject } of allTasks) {
      this.queue.enqueue(async () => {
        try {
          const result = await task();
          resolve(result);
          return result;
        } catch (error) {
          // Reject the promise but return null to queue
          reject(error);
          return null;
        }
      });
    }

    // Process all tasks through token bucket rate limiter
    await this.queue.processAll();
  }
}

/**
 * Create a global orchestrator instance
 * All API calls in the worker should go through this
 */
export const globalOrchestrator = new RequestOrchestrator({
  rate: 40,        // 40 RPS to stay under Cloudflare Workers limit
  concurrency: 10, // Allow 10 parallel requests
  jitterMs: 5,     // 0-5ms jitter to prevent thundering herd
});
