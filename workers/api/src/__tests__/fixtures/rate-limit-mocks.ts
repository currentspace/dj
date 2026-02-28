/**
 * Rate Limiting Mocks
 * Mock RateLimitedQueue and RequestOrchestrator for testing rate limit compliance
 */

import type {QueueOptions} from '../../utils/RateLimitedQueue'

/**
 * Mock RateLimitedQueue that tracks timing and rate compliance
 */
export class MockRateLimitedQueue<T> {
  readonly burst: number
  readonly concurrency: number
  readonly rate: number
  private processing = false
  private queue: (() => Promise<T>)[] = []
  private results: (null | T)[] = []
  private timestamps: number[] = []

  constructor(opts: QueueOptions = {}) {
    this.rate = opts.rate ?? 40
    this.burst = opts.burst ?? this.rate
    this.concurrency = opts.concurrency ?? 1
  }

  clear(): void {
    this.queue = []
    this.results = []
    this.timestamps = []
    this.processing = false
  }

  enqueue(task: () => Promise<T>): void {
    this.queue.push(task)
  }

  /**
   * Get the actual rate (tasks per second) based on timestamps
   */
  getActualRate(): number {
    if (this.timestamps.length < 2) return 0

    const first = this.timestamps[0]
    const last = this.timestamps[this.timestamps.length - 1]
    const durationMs = last - first

    if (durationMs === 0) return Infinity

    return (this.timestamps.length - 1) / (durationMs / 1000)
  }

  /**
   * Get intervals between consecutive tasks (for testing)
   */
  getIntervals(): number[] {
    const intervals: number[] = []
    for (let i = 1; i < this.timestamps.length; i++) {
      intervals.push(this.timestamps[i] - this.timestamps[i - 1])
    }
    return intervals
  }

  /**
   * Get timestamps of task executions (for testing)
   */
  getTimestamps(): number[] {
    return [...this.timestamps]
  }

  async processAll(
    onResult?: (result: null | T, index: number, total: number) => Promise<void> | void,
  ): Promise<(null | T)[]> {
    if (this.processing) throw new Error('Already processing')
    this.processing = true

    const total = this.queue.length
    this.results = []
    this.timestamps = []

    // Process with simulated rate limiting
    const minInterval = 1000 / this.rate // milliseconds between tasks

    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i]
      const timestamp = performance.now()
      this.timestamps.push(timestamp)

      try {
        const result = await task()
        this.results.push(result)

        if (onResult) {
          await onResult(result, i, total)
        }
      } catch {
        this.results.push(null)

        if (onResult) {
          await onResult(null, i, total)
        }
      }

      // Wait for minimum interval (except on last task)
      if (i < this.queue.length - 1) {
        await new Promise(resolve => setTimeout(resolve, minInterval))
      }
    }

    this.processing = false
    this.queue = []

    return this.results
  }

  /**
   * Verify that the rate limit was respected
   */
  verifyRateLimit(tolerance = 0.1): boolean {
    const actualRate = this.getActualRate()
    const maxAllowedRate = this.rate * (1 + tolerance)

    return actualRate <= maxAllowedRate
  }
}

/**
 * Mock RequestOrchestrator for testing
 */
export class MockRequestOrchestrator {
  readonly rate: number
  private requests: {timestamp: number; url: string;}[] = []

  constructor(rate = 40) {
    this.rate = rate
  }

  clear(): void {
    this.requests = []
  }

  async enqueue<T>(url: string, task: () => Promise<T>): Promise<T> {
    const timestamp = performance.now()
    this.requests.push({timestamp, url})

    // Simulate rate limiting
    const minInterval = 1000 / this.rate
    if (this.requests.length > 1) {
      const lastRequest = this.requests[this.requests.length - 2]
      const elapsed = timestamp - lastRequest.timestamp
      if (elapsed < minInterval) {
        await new Promise(resolve => setTimeout(resolve, minInterval - elapsed))
      }
    }

    return await task()
  }

  /**
   * Get the actual request rate (requests per second)
   */
  getActualRate(): number {
    if (this.requests.length < 2) return 0

    const first = this.requests[0].timestamp
    const last = this.requests[this.requests.length - 1].timestamp
    const durationMs = last - first

    if (durationMs === 0) return Infinity

    return (this.requests.length - 1) / (durationMs / 1000)
  }

  /**
   * Get request history (for testing)
   */
  getRequests(): {timestamp: number; url: string;}[] {
    return [...this.requests]
  }

  /**
   * Verify that the rate limit was respected
   */
  verifyRateLimit(tolerance = 0.1): boolean {
    const actualRate = this.getActualRate()
    const maxAllowedRate = this.rate * (1 + tolerance)

    return actualRate <= maxAllowedRate
  }
}

/**
 * Create a task that completes after a delay
 */
export function createDelayedTask<T>(value: T, delayMs = 10): () => Promise<T> {
  return async () => {
    await new Promise(resolve => setTimeout(resolve, delayMs))
    return value
  }
}

/**
 * Create a batch of delayed tasks
 */
export function createDelayedTaskBatch<T>(
  values: T[],
  delayMs = 10,
): (() => Promise<T>)[] {
  return values.map(value => createDelayedTask(value, delayMs))
}

/**
 * Create a mock RateLimitedQueue with preset options
 */
export function createMockRateLimitedQueue<T>(
  options?: QueueOptions,
): MockRateLimitedQueue<T> {
  return new MockRateLimitedQueue<T>(options)
}

/**
 * Create a mock RequestOrchestrator
 */
export function createMockRequestOrchestrator(rate = 40): MockRequestOrchestrator {
  return new MockRequestOrchestrator(rate)
}

/**
 * Helper to measure execution time of async function
 */
export async function measureExecutionTime<T>(fn: () => Promise<T>): Promise<{
  durationMs: number
  result: T
}> {
  const start = performance.now()
  const result = await fn()
  const end = performance.now()
  return {
    durationMs: end - start,
    result,
  }
}

/**
 * Verify burst behavior (initial tasks can execute quickly)
 */
export function verifyBurstBehavior(
  timestamps: number[],
  burstSize: number,
  burstWindowMs: number,
): {
  burstCompliant: boolean
  burstCount: number
  burstDuration: number
  details: string
} {
  if (timestamps.length < burstSize) {
    return {
      burstCompliant: true,
      burstCount: timestamps.length,
      burstDuration: 0,
      details: `Not enough tasks to verify burst (${timestamps.length} < ${burstSize})`,
    }
  }

  const burstTimestamps = timestamps.slice(0, burstSize)
  const burstDuration = burstTimestamps[burstTimestamps.length - 1] - burstTimestamps[0]
  const burstCompliant = burstDuration <= burstWindowMs

  return {
    burstCompliant,
    burstCount: burstSize,
    burstDuration,
    details: burstCompliant
      ? `Burst of ${burstSize} tasks completed in ${burstDuration.toFixed(2)}ms (within ${burstWindowMs}ms window)`
      : `Burst of ${burstSize} tasks took ${burstDuration.toFixed(2)}ms (exceeds ${burstWindowMs}ms window)`,
  }
}

/**
 * Helper to verify rate limit compliance from timestamps
 */
export function verifyRateLimitCompliance(
  timestamps: number[],
  maxRate: number,
  tolerance = 0.1,
): {
  actualRate: number
  compliant: boolean
  details: string
  maxAllowedRate: number
} {
  if (timestamps.length < 2) {
    return {
      actualRate: 0,
      compliant: true,
      details: 'Not enough timestamps to verify',
      maxAllowedRate: maxRate * (1 + tolerance),
    }
  }

  const first = timestamps[0]
  const last = timestamps[timestamps.length - 1]
  const durationMs = last - first
  const actualRate = (timestamps.length - 1) / (durationMs / 1000)
  const maxAllowedRate = maxRate * (1 + tolerance)
  const compliant = actualRate <= maxAllowedRate

  return {
    actualRate,
    compliant,
    details: compliant
      ? `Rate ${actualRate.toFixed(2)} TPS is within limit ${maxAllowedRate.toFixed(2)} TPS`
      : `Rate ${actualRate.toFixed(2)} TPS exceeds limit ${maxAllowedRate.toFixed(2)} TPS`,
    maxAllowedRate,
  }
}
