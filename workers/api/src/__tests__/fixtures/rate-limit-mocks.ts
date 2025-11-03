/**
 * Rate Limiting Mocks
 * Mock RateLimitedQueue and RequestOrchestrator for testing rate limit compliance
 */

import type {QueueOptions} from '../../utils/RateLimitedQueue'

/**
 * Mock RateLimitedQueue that tracks timing and rate compliance
 */
export class MockRateLimitedQueue<T> {
  private queue: (() => Promise<T>)[] = []
  private results: (null | T)[] = []
  private timestamps: number[] = []
  private processing = false
  readonly rate: number
  readonly burst: number
  readonly concurrency: number

  constructor(opts: QueueOptions = {}) {
    this.rate = opts.rate ?? 40
    this.burst = opts.burst ?? this.rate
    this.concurrency = opts.concurrency ?? 1
  }

  enqueue(task: () => Promise<T>): void {
    this.queue.push(task)
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
      } catch (error) {
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

  clear(): void {
    this.queue = []
    this.results = []
    this.timestamps = []
    this.processing = false
  }

  /**
   * Get timestamps of task executions (for testing)
   */
  getTimestamps(): number[] {
    return [...this.timestamps]
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
   * Verify that the rate limit was respected
   */
  verifyRateLimit(tolerance = 0.1): boolean {
    const actualRate = this.getActualRate()
    const maxAllowedRate = this.rate * (1 + tolerance)

    return actualRate <= maxAllowedRate
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
}

/**
 * Mock RequestOrchestrator for testing
 */
export class MockRequestOrchestrator {
  private requests: {url: string; timestamp: number}[] = []
  readonly rate: number

  constructor(rate = 40) {
    this.rate = rate
  }

  async enqueue<T>(url: string, task: () => Promise<T>): Promise<T> {
    const timestamp = performance.now()
    this.requests.push({url, timestamp})

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
   * Get request history (for testing)
   */
  getRequests(): {url: string; timestamp: number}[] {
    return [...this.requests]
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
   * Verify that the rate limit was respected
   */
  verifyRateLimit(tolerance = 0.1): boolean {
    const actualRate = this.getActualRate()
    const maxAllowedRate = this.rate * (1 + tolerance)

    return actualRate <= maxAllowedRate
  }

  clear(): void {
    this.requests = []
  }
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
 * Helper to verify rate limit compliance from timestamps
 */
export function verifyRateLimitCompliance(
  timestamps: number[],
  maxRate: number,
  tolerance = 0.1,
): {
  compliant: boolean
  actualRate: number
  maxAllowedRate: number
  details: string
} {
  if (timestamps.length < 2) {
    return {
      compliant: true,
      actualRate: 0,
      maxAllowedRate: maxRate * (1 + tolerance),
      details: 'Not enough timestamps to verify',
    }
  }

  const first = timestamps[0]
  const last = timestamps[timestamps.length - 1]
  const durationMs = last - first
  const actualRate = (timestamps.length - 1) / (durationMs / 1000)
  const maxAllowedRate = maxRate * (1 + tolerance)
  const compliant = actualRate <= maxAllowedRate

  return {
    compliant,
    actualRate,
    maxAllowedRate,
    details: compliant
      ? `Rate ${actualRate.toFixed(2)} TPS is within limit ${maxAllowedRate.toFixed(2)} TPS`
      : `Rate ${actualRate.toFixed(2)} TPS exceeds limit ${maxAllowedRate.toFixed(2)} TPS`,
  }
}

/**
 * Helper to measure execution time of async function
 */
export async function measureExecutionTime<T>(fn: () => Promise<T>): Promise<{
  result: T
  durationMs: number
}> {
  const start = performance.now()
  const result = await fn()
  const end = performance.now()
  return {
    result,
    durationMs: end - start,
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
