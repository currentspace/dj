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
  private queueRunning = false;

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

    // Start the continuous queue processor
    this.startQueueProcessor();
  }

  /**
   * Execute a single task through the rate-limited queue
   * Returns a promise that resolves when the task completes
   *
   * @param task - The async task to execute
   * @param lane - Optional lane identifier for fairness (e.g., 'anthropic', 'spotify', 'lastfm')
   */
  async execute<T>(task: Task<T>, lane: LaneKey = 'default'): Promise<T | null> {
    console.log(`[RequestOrchestrator] execute() called with lane: ${lane}, queue size: ${this.queue.size()}, running: ${this.queueRunning}`);

    return new Promise((resolve, reject) => {
      // Directly enqueue the wrapped task
      this.queue.enqueue(async () => {
        console.log(`[RequestOrchestrator] Task starting for lane: ${lane}`);
        try {
          const result = await task();
          console.log(`[RequestOrchestrator] Task completed for lane: ${lane}`);
          resolve(result);
          return result;
        } catch (error) {
          console.error(`[RequestOrchestrator] Task failed for lane: ${lane}`, error);
          reject(error);
          return null;
        }
      });
      console.log(`[RequestOrchestrator] Task enqueued for lane: ${lane}, new queue size: ${this.queue.size()}`);
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
   * Get the number of pending tasks in queue and batches
   */
  getPendingCount(): number {
    let count = this.queue.size();
    for (const batch of this.batches.values()) {
      count += batch.tasks.length;
    }
    return count;
  }

  /**
   * Start the continuous queue processor
   * Uses RateLimitedQueue.processContinuously() which handles nested enqueueing automatically
   */
  private startQueueProcessor(): void {
    if (this.queueRunning) {
      console.log('[RequestOrchestrator] Queue processor already running');
      return;
    }

    console.log('[RequestOrchestrator] Starting continuous queue processor...');
    this.queueRunning = true;

    // Use the continuous processor - it will automatically pick up new tasks
    // even if they're enqueued while processing is happening
    this.queue.processContinuously().catch(err => {
      console.error('[RequestOrchestrator] Fatal error in continuous processor:', err);
      this.queueRunning = false;
    });

    console.log('[RequestOrchestrator] Continuous queue processor started');
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
