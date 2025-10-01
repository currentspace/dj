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

interface Batch<T> {
  tasks: Array<{
    task: Task<T>;
    resolve: (value: T | null) => void;
    reject: (error: any) => void;
  }>;
  promise: Promise<(T | null)[]>;
}

export class RequestOrchestrator {
  private queue: RateLimitedQueue<any>;
  private batches = new Map<string, Batch<any>>();
  private singletonTasks: Array<{
    task: Task<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];
  private processingTimer: number | null = null;

  constructor(options?: {
    rate?: number;        // Requests per second (default: 40)
    concurrency?: number; // Parallel requests (default: 10)
    jitterMs?: number;    // Jitter in ms (default: 5)
  }) {
    this.queue = new RateLimitedQueue({
      rate: options?.rate ?? 40,
      concurrency: options?.concurrency ?? 10,
      jitterMs: options?.jitterMs ?? 5,
    });
  }

  /**
   * Execute a single task through the rate-limited queue
   * Returns a promise that resolves when the task completes
   */
  async execute<T>(task: Task<T>): Promise<T | null> {
    return new Promise((resolve, reject) => {
      this.singletonTasks.push({ task, resolve, reject });
      this.scheduleProcessing();
    });
  }

  /**
   * Enqueue a batch of tasks with a batch ID
   * All tasks will be rate-limited but can be awaited as a group
   */
  enqueueBatch<T>(batchId: string, tasks: Task<T>[]): void {
    if (this.batches.has(batchId)) {
      throw new Error(`Batch ${batchId} already exists`);
    }

    const batchTasks: Batch<T>['tasks'] = [];
    const promises: Promise<T | null>[] = [];

    for (const task of tasks) {
      const promise = new Promise<T | null>((resolve, reject) => {
        batchTasks.push({ task, resolve, reject });
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
   * Get the number of pending tasks across all batches and singletons
   */
  getPendingCount(): number {
    let count = this.singletonTasks.length;
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
   * Process all pending tasks through the rate-limited queue
   */
  private async processPendingTasks(): Promise<void> {
    // Collect all pending tasks (singletons + batches)
    const allTasks: Array<{
      task: Task<any>;
      resolve: (value: any) => void;
      reject: (error: any) => void;
    }> = [];

    // Add singleton tasks
    allTasks.push(...this.singletonTasks);
    this.singletonTasks = [];

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
