/**
 * Rate-Limited Queue (Cloudflare Workers friendly)
 * - Token bucket (rate + burst) with single scheduler tick
 * - Monotonic timing via performance.now()
 * - Bounded concurrency
 * - Optional tiny jitter to avoid herds
 * - In-memory only; no backpressure, no pause/resume/abort
 * - Guards onResult so callback errors don't poison the loop
 */

export interface QueueOptions {
  burst?: number;       // max tokens, default = rate
  concurrency?: number; // parallel tasks, default 1
  jitterMs?: number;    // 0..jitterMs added to wakeups, default 0
  minTickMs?: number;   // minimum tick delay (Workers timers coalesce at 0ms), default 1
  rate?: number;        // tokens per second, default 40
}

type Task<T> = () => Promise<T>;

export class RateLimitedQueue<T> {
  private readonly burst: number;
  private readonly concurrency: number;

  private readonly jitterMs: number;
  private kickFn: (() => void) | null = null; // For continuous processing
  private lastRefill: number; // performance.now()
  private readonly minTickMs: number;
  private processing = false;

  private queue: Task<T>[] = [];
  private readonly rate: number;

  private running = 0;
  // scheduling
  private timer: null | number = null;
  // token bucket
  private tokens: number;

  constructor(opts: QueueOptions = {}) {
    this.rate = opts.rate ?? 40;
    this.burst = opts.burst ?? this.rate;
    this.concurrency = Math.max(1, opts.concurrency ?? 1);
    this.jitterMs = Math.max(0, opts.jitterMs ?? 0);
    this.minTickMs = Math.max(0, opts.minTickMs ?? 1);

    this.tokens = this.burst;
    this.lastRefill = performance.now();
  }

  clear(): void {
    this.queue = [];
    this.processing = false;
    this.running = 0;
    this.clearTimer();
    this.tokens = this.burst;
    this.lastRefill = performance.now();
  }

  /**
   * Add a task to the queue.
   * (No backpressure: always accepts.)
   */
  enqueue(task: Task<T>): void {
    this.queue.push(task);
    // If continuous processing is active, kick it to wake up
    if (this.kickFn) {
      this.kickFn();
    }
  }

  /**
   * Process all tasks, returning results in enqueue order.
   * Optional onResult receives (resultOrNull, index, total). It is guarded.
   */
  async processAll(
    onResult?: (result: null | T, index: number, total: number) => Promise<void> | void
  ): Promise<(null | T)[]> {
    if (this.processing) throw new Error("Already processing");
    this.processing = true;

    const total = this.queue.length;
    const results: (null | T)[] = Array(total);
    let issued = 0;   // number of tasks taken from queue & assigned an index
    let finished = 0; // number of tasks completed

    // Internal: refill tokens from elapsed time
    const refill = () => {
      const now = performance.now();
      const elapsed = now - this.lastRefill;
      if (elapsed > 0) {
        this.tokens = Math.min(this.burst, this.tokens + (elapsed * this.rate) / 1000);
        this.lastRefill = now;
      }
    };

    const maybeResolve = (resolve: (v: (null | T)[]) => void) => {
      if (finished === total) {
        this.processing = false;
        this.clearTimer();
        resolve(results);
      }
    };

    const runOne = async (index: number, task: Task<T>) => {
      this.running++;
      try {
        const value = await task();
        results[index] = value;
        // Guard the callback
        if (onResult) {
          try { await onResult(value, index, total); } catch { /* swallow */ }
        }
      } catch (err) {
        // mirror your original: push null on failure
        results[index] = null as T;
        if (onResult) {
          try { await onResult(null, index, total); } catch { /* swallow */ }
        }
        // still log for observability (Workers console is fine)
        console.error("[RateLimitedQueue] task failed:", err);
      } finally {
        this.running--;
        finished++;
        // kick scheduler in case we were waiting for slots/tokens
        kick();
      }
    };

    const scheduleNext = () => {
      if (this.timer !== null) return;

      refill();

      // Calculate precise next wake time based on token availability
      const nextWakeMs = (): number => {
        if (this.tokens >= 1) return this.minTickMs;
        const deficit = 1 - this.tokens;              // tokens needed to reach a whole token
        const wait = (deficit * 1000) / this.rate;    // ms until then at current fill
        const jitter = this.jitterMs ? Math.random() * this.jitterMs : 0;
        return Math.max(this.minTickMs, wait + jitter);
      };

      this.timer = setTimeout(tick, nextWakeMs()) as unknown as number;
    };

    const clearIfSet = () => {
      if (this.timer !== null) {
        clearTimeout(this.timer as unknown as number);
        this.timer = null;
      }
    };
    this.clearTimer = clearIfSet;

    const tick = () => {
      this.timer = null;
      if (!this.processing) return;

      refill();

      // Launch as many as tokens & concurrency allow
      while (
        this.running < this.concurrency &&
        this.tokens >= 1 &&
        issued < total
      ) {
        this.tokens -= 1;

        // Pull next task and remember its enqueue order index
        const task = this.queue[issued]; // preserve order by index
        const index = issued;
        issued++;

        // fire without awaiting; runOne will decrement running & kick
        runOne(index, task);
      }

      // Done?
      if (finished === total) return; // resolve happens in maybeResolve below

      // Not done: if there are still tasks to issue, schedule next wakeup
      if (issued < total) {
        scheduleNext();
      }
    };

    const kick = () => {
      // If everything done, resolve and stop
      if (finished === total) {
        // ensure no stray timers
        this.clearTimer();
        resolveOuter?.(results);
        return;
      }
      // If there are still tasks to issue and we have capacity/tokens, tick with minTickMs
      if (this.running < this.concurrency && issued < total) {
        if (this.timer === null) {
          this.timer = setTimeout(tick, this.minTickMs) as unknown as number;
        }
      }
    };

    // Promise plumbing
    let resolveOuter!: (v: (null | T)[]) => void;
    const done = new Promise<(null | T)[]>((resolve) => (resolveOuter = resolve));

    // Start the scheduler
    // (We don't mutate this.queue during processing; we index into it for order.)
    scheduleNext();

    // When tasks finish, maybe resolve. We hook via a small watcher.
    // (Alternatively, we could resolve inside runOne, but we centralize here.)
    const watcher = async () => {
      while (this.processing) {
        if (finished === total) {
          maybeResolve(resolveOuter);
          break;
        }
        await new Promise(r => setTimeout(r, 2)); // very light spin; Workers can handle this tiny sleep
      }
    };
    // Fire and forget watcher
     
    watcher();

    return done;
  }

  /**
   * Legacy helper that mirrors your original API.
   * Uses processAll and forwards onResult, but keeps the old method name.
   */
  async processAllWithCallback(
    onResult: (result: null | T, index: number, total: number) => void
  ): Promise<(null | T)[]> {
    return this.processAll(onResult);
  }

  /**
   * Process tasks continuously - when new tasks are enqueued during processing,
   * they will be picked up automatically without waiting for the current batch to complete.
   *
   * IMPORTANT: This method never resolves - it runs until stopped.
   * Use for orchestrators that need to handle nested/recursive task enqueueing.
   */
  async processContinuously(
    onResult?: (result: null | T) => Promise<void> | void
  ): Promise<void> {
    console.log('[RateLimitedQueue] processContinuously() called');
    if (this.processing) throw new Error("Already processing");
    this.processing = true;
    console.log('[RateLimitedQueue] Continuous processing started');

    const globalIndex = 0;

    // Internal: refill tokens from elapsed time
    const refill = () => {
      const now = performance.now();
      const elapsed = now - this.lastRefill;
      if (elapsed > 0) {
        this.tokens = Math.min(this.burst, this.tokens + (elapsed * this.rate) / 1000);
        this.lastRefill = now;
      }
    };

    const runOne = async (task: Task<T>) => {
      this.running++;
      try {
        const value = await task();
        if (onResult) {
          try { await onResult(value); } catch { /* swallow */ }
        }
      } catch (err) {
        if (onResult) {
          try { await onResult(null); } catch { /* swallow */ }
        }
        console.error("[RateLimitedQueue] task failed:", err);
      } finally {
        this.running--;
        kick();
      }
    };

    const scheduleNext = () => {
      if (this.timer !== null) return;

      refill();

      const nextWakeMs = (): number => {
        if (this.tokens >= 1) return this.minTickMs;
        const deficit = 1 - this.tokens;
        const wait = (deficit * 1000) / this.rate;
        const jitter = this.jitterMs ? Math.random() * this.jitterMs : 0;
        return Math.max(this.minTickMs, wait + jitter);
      };

      this.timer = setTimeout(tick, nextWakeMs()) as unknown as number;
    };

    const clearIfSet = () => {
      if (this.timer !== null) {
        clearTimeout(this.timer as unknown as number);
        this.timer = null;
      }
    };
    this.clearTimer = clearIfSet;

    const tick = () => {
      this.timer = null;
      if (!this.processing) return;

      refill();

      console.log(`[RateLimitedQueue] tick() - queue.length: ${this.queue.length}, running: ${this.running}, tokens: ${this.tokens.toFixed(2)}`);

      // Launch as many as tokens & concurrency allow
      // IMPORTANT: Check this.queue.length dynamically (not a fixed 'total')
      while (
        this.running < this.concurrency &&
        this.tokens >= 1 &&
        this.queue.length > 0
      ) {
        this.tokens -= 1;
        const task = this.queue.shift()!; // Take from front
        console.log(`[RateLimitedQueue] Launching task - remaining queue: ${this.queue.length}, running: ${this.running + 1}`);
        runOne(task);
      }

      // If there are still tasks, schedule next wakeup
      if (this.queue.length > 0) {
        console.log(`[RateLimitedQueue] Scheduling next tick for ${this.queue.length} remaining tasks`);
        scheduleNext();
      }
    };

    const kick = () => {
      // If there are tasks and we have capacity, tick immediately
      if (this.running < this.concurrency && this.queue.length > 0) {
        if (this.timer === null) {
          this.timer = setTimeout(tick, this.minTickMs) as unknown as number;
        }
      }
    };

    // Store kick function so enqueue() can trigger it
    this.kickFn = kick;

    // Start the scheduler
    scheduleNext();

    // This promise never resolves - runs until processing is stopped externally
    return new Promise(() => {
      // Never resolves
    });
  }

  size(): number {
    return this.queue.length;
  }

  // replaced at runtime by constructor; defined to satisfy TS
   
  private clearTimer(): void {}
}
