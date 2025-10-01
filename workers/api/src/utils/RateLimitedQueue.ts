/**
 * Rate-Limited Queue
 * Processes async tasks at a controlled rate (e.g., 40 tasks per second)
 * Uses an in-memory queue with precise timing instead of sleep()
 */

export class RateLimitedQueue<T> {
  private queue: Array<() => Promise<T>> = [];
  private results: T[] = [];
  private processing: boolean = false;
  private tasksPerSecond: number;
  private intervalMs: number;
  private lastExecutionTime: number = 0;

  constructor(tasksPerSecond: number = 40) {
    this.tasksPerSecond = tasksPerSecond;
    this.intervalMs = 1000 / tasksPerSecond; // 25ms for 40 TPS
  }

  /**
   * Add a task to the queue
   */
  enqueue(task: () => Promise<T>): void {
    this.queue.push(task);
  }

  /**
   * Process all queued tasks at the specified rate
   */
  async processAll(): Promise<T[]> {
    this.results = [];
    this.processing = true;
    this.lastExecutionTime = Date.now();

    while (this.queue.length > 0 && this.processing) {
      const task = this.queue.shift();
      if (!task) break;

      // Calculate how long to wait before executing next task
      const now = Date.now();
      const timeSinceLastExecution = now - this.lastExecutionTime;
      const waitTime = Math.max(0, this.intervalMs - timeSinceLastExecution);

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Execute the task
      try {
        const result = await task();
        this.results.push(result);
      } catch (error) {
        console.error('[RateLimitedQueue] Task failed:', error);
        // Push null or error placeholder if needed
        this.results.push(null as T);
      }

      this.lastExecutionTime = Date.now();
    }

    this.processing = false;
    return this.results;
  }

  /**
   * Process tasks with a callback for each result (for progress reporting)
   */
  async processAllWithCallback(
    onResult: (result: T, index: number, total: number) => void
  ): Promise<T[]> {
    this.results = [];
    this.processing = true;
    this.lastExecutionTime = Date.now();
    const total = this.queue.length;
    let index = 0;

    while (this.queue.length > 0 && this.processing) {
      const task = this.queue.shift();
      if (!task) break;

      // Calculate wait time
      const now = Date.now();
      const timeSinceLastExecution = now - this.lastExecutionTime;
      const waitTime = Math.max(0, this.intervalMs - timeSinceLastExecution);

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Execute the task
      try {
        const result = await task();
        this.results.push(result);
        onResult(result, index, total);
      } catch (error) {
        console.error('[RateLimitedQueue] Task failed:', error);
        this.results.push(null as T);
        onResult(null as T, index, total);
      }

      this.lastExecutionTime = Date.now();
      index++;
    }

    this.processing = false;
    return this.results;
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = [];
    this.results = [];
    this.processing = false;
  }
}
