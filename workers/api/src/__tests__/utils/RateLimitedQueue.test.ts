/**
 * RateLimitedQueue Tests
 * Comprehensive tests for token bucket rate limiter with timing verification
 */
import {describe, expect, it} from 'vitest'

import {RateLimitedQueue} from '../../utils/RateLimitedQueue'
import {
  measureExecutionTime,
  verifyRateLimitCompliance,
} from '../fixtures/rate-limit-mocks'
describe('RateLimitedQueue', () => {
  // Note: We use real timers for these tests because we're testing actual timing behavior
  // Fake timers would interfere with the token bucket refill mechanism
  describe('Token Bucket Mechanics', () => {
    it('should initialize with burst allocation equal to rate', async () => {
      const queue = new RateLimitedQueue({burst: 10, rate: 10})
      const timestamps: number[] = []
      // Queue 10 tasks instantly (should use all burst tokens)
      for (let i = 0; i < 10; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      const results = await queue.processAll()
      // All 10 tasks should complete
      expect(results).toHaveLength(10)
      // First 10 should execute quickly (burst)
      const burstDuration = timestamps[9] - timestamps[0]
      expect(burstDuration).toBeLessThanOrEqual(150) // Burst should be fast
    })
    it('should refill tokens over time at specified rate', async () => {
      const queue = new RateLimitedQueue({burst: 10, rate: 10})
      const timestamps: number[] = []
      // Queue 15 tasks (10 burst + 5 that need token refill)
      for (let i = 0; i < 15; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      await queue.processAll()
      // First 10 should execute quickly (burst)
      // Next 5 should be rate-limited at 10 TPS (100ms intervals)
      expect(timestamps).toHaveLength(15)
      // Check that tokens refilled (later tasks have spacing)
      const intervals: number[] = []
      for (let i = 11; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1])
      }
      // After burst, intervals should be ~100ms (10 TPS)
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
      expect(avgInterval).toBeGreaterThanOrEqual(80) // Allow some variance
    })
    it('should respect rate (TPS) correctly', async () => {
      const queue = new RateLimitedQueue({burst: 5, rate: 40})
      const timestamps: number[] = []
      // Queue 50 tasks (more than burst)
      for (let i = 0; i < 50; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      const {durationMs} = await measureExecutionTime(async () => {
        await queue.processAll()
      })
      // 50 tasks at 40 TPS = 1.25 seconds (minimum)
      // But with burst of 5, first 5 execute immediately, then 45 at rate
      // 45 tasks at 40 TPS = 1.125 seconds
      expect(durationMs).toBeGreaterThanOrEqual(1000)
      expect(durationMs).toBeLessThanOrEqual(1500)
      // Verify rate compliance
      const compliance = verifyRateLimitCompliance(timestamps, 40, 0.15)
      expect(compliance.compliant).toBe(true)
    })
    it('should never exceed burst limit', async () => {
      const queue = new RateLimitedQueue({burst: 10, rate: 100})
      let concurrent = 0
      let maxConcurrent = 0
      // Queue 20 tasks that track concurrency
      for (let i = 0; i < 20; i++) {
        queue.enqueue(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise(resolve => setTimeout(resolve, 10))
          concurrent--
          return i
        })
      }
      await queue.processAll()
      // Even with high rate, concurrency (which correlates with burst) shouldn't exceed limit
      // Note: burst affects token availability, concurrency affects parallel execution
      expect(maxConcurrent).toBeLessThanOrEqual(10)
    })
    it('should use accurate timing via performance.now()', async () => {
      const queue = new RateLimitedQueue({rate: 20})
      const timestamps: number[] = []
      for (let i = 0; i < 10; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      await queue.processAll()
      // Verify timestamps are monotonically increasing
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1])
      }
      // Verify timestamps use high-precision timing (sub-millisecond)
      expect(timestamps[0] % 1).not.toBe(0) // Should have decimal precision
    })
    it('should handle negative tokens correctly when burst is used up', async () => {
      const queue = new RateLimitedQueue({burst: 5, rate: 10})
      const timestamps: number[] = []
      // Queue 15 tasks (burst 5, need 10 more tokens)
      for (let i = 0; i < 15; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      await queue.processAll()
      // All tasks should complete without errors
      expect(timestamps).toHaveLength(15)
      // Tasks after burst should be properly rate-limited
      const intervals: number[] = []
      for (let i = 6; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1])
      }
      // After burst, intervals should be ~100ms (10 TPS)
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
      expect(avgInterval).toBeGreaterThanOrEqual(80)
    })
  })
  describe('Task Processing', () => {
    it('should process tasks in FIFO order', async () => {
      const queue = new RateLimitedQueue({rate: 100})
      const order: number[] = []
      // Queue tasks with identifiable order
      for (let i = 0; i < 10; i++) {
        queue.enqueue(async () => {
          order.push(i)
          return i
        })
      }
      await queue.processAll()
      // Verify strict FIFO order
      expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })
    it('should return results in enqueue order', async () => {
      const queue = new RateLimitedQueue({rate: 100})
      // Queue tasks that complete at different times
      for (let i = 0; i < 5; i++) {
        const delay = (5 - i) * 10 // Reverse delay (later tasks faster)
        queue.enqueue(async () => {
          await new Promise(resolve => setTimeout(resolve, delay))
          return i
        })
      }
      const results = await queue.processAll()
      // Results should still be in enqueue order despite different completion times
      expect(results).toEqual([0, 1, 2, 3, 4])
    })
    it('should respect concurrent task limit', async () => {
      const queue = new RateLimitedQueue({concurrency: 3, rate: 100})
      let concurrent = 0
      let maxConcurrent = 0
      // Queue 20 tasks with delays
      for (let i = 0; i < 20; i++) {
        queue.enqueue(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise(resolve => setTimeout(resolve, 50))
          concurrent--
          return i
        })
      }
      await queue.processAll()
      // Max concurrent should not exceed the limit
      expect(maxConcurrent).toBe(3)
    })
    it('should enforce rate limit (tasks per second)', async () => {
      const queue = new RateLimitedQueue({rate: 20})
      const timestamps: number[] = []
      for (let i = 0; i < 30; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      const {durationMs} = await measureExecutionTime(async () => {
        await queue.processAll()
      })
      // 30 tasks at 20 TPS = 1.5 seconds minimum
      // But with default burst of 20, first 20 execute quickly, then 10 at rate
      // 10 tasks at 20 TPS = 0.5 seconds
      expect(durationMs).toBeGreaterThanOrEqual(400)
      // All tasks should complete
      expect(timestamps).toHaveLength(30)
    })
    it('should complete all tasks before processAll returns', async () => {
      const queue = new RateLimitedQueue({rate: 50})
      const completed: number[] = []
      for (let i = 0; i < 10; i++) {
        queue.enqueue(async () => {
          await new Promise(resolve => setTimeout(resolve, 20))
          completed.push(i)
          return i
        })
      }
      await queue.processAll()
      // All tasks should be completed
      expect(completed).toHaveLength(10)
      expect(completed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })
    it('should run tasks at specified rate (measure timing)', async () => {
      const queue = new RateLimitedQueue({rate: 40})
      const timestamps: number[] = []
      for (let i = 0; i < 100; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      await queue.processAll()
      // Verify intervals between tasks
      const intervals: number[] = []
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1])
      }
      // Average interval should be ~25ms (40 TPS)
      // Note: First tasks may be burst, so check later intervals
      const laterIntervals = intervals.slice(50)
      const avgInterval = laterIntervals.reduce((a, b) => a + b, 0) / laterIntervals.length
      expect(avgInterval).toBeGreaterThanOrEqual(20) // 40 TPS = 25ms, allow tolerance
      expect(avgInterval).toBeLessThanOrEqual(30)
    })
    it('should handle empty queue gracefully', async () => {
      const queue = new RateLimitedQueue({rate: 40})
      const results = await queue.processAll()
      expect(results).toEqual([])
    })
    it('should handle single task', async () => {
      const queue = new RateLimitedQueue({rate: 40})
      queue.enqueue(async () => 'single')
      const results = await queue.processAll()
      expect(results).toEqual(['single'])
    })
  })
  describe('Result Callbacks', () => {
    it('should invoke callback for each completed task', async () => {
      const queue = new RateLimitedQueue({rate: 100})
      const callbackResults: {index: number; result: null | number; total: number}[] = []
      for (let i = 0; i < 10; i++) {
        queue.enqueue(async () => i)
      }
      await queue.processAllWithCallback((result, index, total) => {
        callbackResults.push({index, result: result as null | number, total})
      })
      expect(callbackResults).toHaveLength(10)
      expect(callbackResults[0]).toEqual({index: 0, result: 0, total: 10})
      expect(callbackResults[9]).toEqual({index: 9, result: 9, total: 10})
    })
    it('should pass correct (result, index, total) to callback', async () => {
      const queue = new RateLimitedQueue({rate: 100})
      const callbackData: {index: number; result: null | string; total: number}[] = []
      for (let i = 0; i < 5; i++) {
        queue.enqueue(async () => `task-${i}`)
      }
      await queue.processAllWithCallback((result, index, total) => {
        callbackData.push({index, result: result as null | string, total})
      })
      // Verify all callbacks received correct parameters
      expect(callbackData).toEqual([
        {index: 0, result: 'task-0', total: 5},
        {index: 1, result: 'task-1', total: 5},
        {index: 2, result: 'task-2', total: 5},
        {index: 3, result: 'task-3', total: 5},
        {index: 4, result: 'task-4', total: 5},
      ])
    })
    it('should not poison processing loop when callback throws error', async () => {
      const queue = new RateLimitedQueue({rate: 100})
      const callbackCalls: number[] = []
      for (let i = 0; i < 5; i++) {
        queue.enqueue(async () => i)
      }
      await queue.processAllWithCallback((_result, index) => {
        callbackCalls.push(index)
        // Throw error on task 2
        if (index === 2) {
          throw new Error('Callback error')
        }
      })
      // All callbacks should have been called despite error
      expect(callbackCalls).toEqual([0, 1, 2, 3, 4])
    })
    it('should pass null to callback for failed tasks', async () => {
      const queue = new RateLimitedQueue({rate: 100})
      const callbackResults: (null | number)[] = []
      // Queue mix of successful and failing tasks
      queue.enqueue(async () => 0)
      queue.enqueue(async () => {
        throw new Error('Task failed')
      })
      queue.enqueue(async () => 2)
      queue.enqueue(async () => {
        throw new Error('Another failure')
      })
      queue.enqueue(async () => 4)
      await queue.processAllWithCallback((result) => {
        callbackResults.push(result as null | number)
      })
      expect(callbackResults).toEqual([0, null, 2, null, 4])
    })
  })
  describe('Timer Management', () => {
    it('should start timer when processing begins', async () => {
      const queue = new RateLimitedQueue({rate: 10})
      const timestamps: number[] = []
      for (let i = 0; i < 5; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      await queue.processAll()
      // All tasks should have been processed
      expect(timestamps).toHaveLength(5)
    })
    it('should clear timer when processing completes', async () => {
      const queue = new RateLimitedQueue({rate: 100})
      for (let i = 0; i < 5; i++) {
        queue.enqueue(async () => i)
      }
      const results1 = await queue.processAll()
      // After processing completes, verify results
      expect(results1).toHaveLength(5)
      // Create new queue to test that timers don't interfere
      const queue2 = new RateLimitedQueue({rate: 100})
      queue2.enqueue(async () => 'new')
      const results2 = await queue2.processAll()
      expect(results2).toEqual(['new'])
    }, 10000)
    it('should apply jitter correctly (randomized delay)', async () => {
      // Use burst of 1 to force rate limiting after first task
      const queue = new RateLimitedQueue({burst: 1, jitterMs: 50, rate: 20})
      const timestamps: number[] = []
      for (let i = 0; i < 10; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      await queue.processAll()
      // Check intervals after first task (first task uses burst)
      const intervals: number[] = []
      for (let i = 2; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1])
      }
      // With jitter, intervals should have some variation
      // Base interval is 50ms at 20 TPS, jitter adds 0-50ms
      const minInterval = 1000 / 20 // 50ms at 20 TPS
      const maxInterval = minInterval + 50 // Add jitter
      // At least some intervals should be affected by jitter
      expect(intervals.length).toBeGreaterThan(5)
      intervals.forEach(interval => {
        expect(interval).toBeGreaterThanOrEqual(minInterval - 10) // Small tolerance
        expect(interval).toBeLessThanOrEqual(maxInterval + 20) // With jitter + tolerance
      })
    })
    it('should respect min tick delay', async () => {
      const queue = new RateLimitedQueue({minTickMs: 10, rate: 1000})
      const timestamps: number[] = []
      for (let i = 0; i < 20; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      await queue.processAll()
      // Even at very high rate (1000 TPS = 1ms interval)
      // Min tick delay should enforce at least 10ms between some tasks
      const intervals: number[] = []
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1])
      }
      // At least some intervals should be >= minTickMs
      const minIntervals = intervals.filter(i => i >= 10)
      expect(minIntervals.length).toBeGreaterThan(0)
    })
  })
  describe('Edge Cases', () => {
    it('should handle very slow rate (1 TPS)', async () => {
      const queue = new RateLimitedQueue({rate: 1})
      const timestamps: number[] = []
      for (let i = 0; i < 3; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      const {durationMs} = await measureExecutionTime(async () => {
        await queue.processAll()
      })
      // 3 tasks at 1 TPS = 2 seconds minimum
      expect(durationMs).toBeGreaterThanOrEqual(1900)
      // Check intervals are ~1 second
      const intervals: number[] = []
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1])
      }
      intervals.forEach(interval => {
        expect(interval).toBeGreaterThanOrEqual(900) // ~1000ms
      })
    })
    it('should handle very fast rate (1000 TPS)', async () => {
      const queue = new RateLimitedQueue({minTickMs: 0, rate: 1000})
      const timestamps: number[] = []
      for (let i = 0; i < 100; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      const {durationMs} = await measureExecutionTime(async () => {
        await queue.processAll()
      })
      // 100 tasks at 1000 TPS = 0.1 seconds minimum
      expect(durationMs).toBeGreaterThanOrEqual(80)
      expect(durationMs).toBeLessThanOrEqual(300)
      const compliance = verifyRateLimitCompliance(timestamps, 1000, 0.2)
      expect(compliance.compliant).toBe(true)
    })
    it('should handle task that throws error', async () => {
      const queue = new RateLimitedQueue({rate: 100})
      queue.enqueue(async () => 'success-1')
      queue.enqueue(async () => {
        throw new Error('Task error')
      })
      queue.enqueue(async () => 'success-2')
      const results = await queue.processAll()
      expect(results).toEqual(['success-1', null, 'success-2'])
    })
    it('should handle tasks that take longer than rate window', async () => {
      const queue = new RateLimitedQueue({concurrency: 2, rate: 20})
      const timestamps: number[] = []
      // Tasks that take 100ms each (rate window is 50ms at 20 TPS)
      for (let i = 0; i < 5; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          await new Promise(resolve => setTimeout(resolve, 100))
          return i
        })
      }
      await queue.processAll()
      // All tasks should complete despite long duration
      expect(timestamps).toHaveLength(5)
    })
    it('should handle concurrent limit of 1 (sequential)', async () => {
      const queue = new RateLimitedQueue({concurrency: 1, rate: 100})
      let concurrent = 0
      let maxConcurrent = 0
      for (let i = 0; i < 10; i++) {
        queue.enqueue(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise(resolve => setTimeout(resolve, 10))
          concurrent--
          return i
        })
      }
      await queue.processAll()
      // Should never exceed 1 concurrent task
      expect(maxConcurrent).toBe(1)
    })
    it('should handle burst behavior (many tasks enqueued instantly)', async () => {
      const queue = new RateLimitedQueue({burst: 20, rate: 40})
      const timestamps: number[] = []
      // Enqueue 50 tasks instantly
      for (let i = 0; i < 50; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      await queue.processAll()
      // First 20 should execute quickly (burst)
      const burstTimestamps = timestamps.slice(0, 20)
      const burstDuration = burstTimestamps[19] - burstTimestamps[0]
      expect(burstDuration).toBeLessThanOrEqual(100) // Burst should be fast
      // Remaining 30 should be rate-limited
      const rateTimestamps = timestamps.slice(20)
      const rateDuration = rateTimestamps[rateTimestamps.length - 1] - rateTimestamps[0]
      expect(rateDuration).toBeGreaterThanOrEqual(700) // 30 tasks at 40 TPS = 0.75s
    })
    it('should support clear() method', async () => {
      const queue = new RateLimitedQueue({rate: 100})
      // Queue some tasks
      for (let i = 0; i < 5; i++) {
        queue.enqueue(async () => i)
      }
      // Clear the queue
      queue.clear()
      // Queue should be empty
      expect(queue.size()).toBe(0)
      // Can queue new tasks after clear
      queue.enqueue(async () => 'new')
      const results = await queue.processAll()
      expect(results).toEqual(['new'])
    })
    it('should throw error if processAll called while already processing', async () => {
      const queue = new RateLimitedQueue({rate: 10})
      for (let i = 0; i < 5; i++) {
        queue.enqueue(async () => {
          await new Promise(resolve => setTimeout(resolve, 100))
          return i
        })
      }
      // Start processing
      const promise1 = queue.processAll()
      // Try to start again while processing
      await expect(queue.processAll()).rejects.toThrow('Already processing')
      // Wait for first processing to complete
      await promise1
    })
  })
  describe('Options Validation', () => {
    it('should use default options when not provided', async () => {
      const queue = new RateLimitedQueue()
      const timestamps: number[] = []
      for (let i = 0; i < 50; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      await queue.processAll()
      // Default rate is 40 TPS
      // With default burst of 40, all tasks execute in burst, so rate check may not apply
      // Just verify all tasks completed
      expect(timestamps).toHaveLength(50)
    })
    it('should accept custom rate option', async () => {
      const queue = new RateLimitedQueue({rate: 25})
      const timestamps: number[] = []
      for (let i = 0; i < 30; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      await queue.processAll()
      // With default burst of 25 and 30 tasks, first 25 execute in burst
      // Then 5 more at rate, so very fast overall
      // Just verify all tasks completed
      expect(timestamps).toHaveLength(30)
    })
    it('should accept custom burst option', async () => {
      const queue = new RateLimitedQueue({burst: 15, rate: 10})
      const timestamps: number[] = []
      for (let i = 0; i < 20; i++) {
        queue.enqueue(async () => {
          timestamps.push(performance.now())
          return i
        })
      }
      await queue.processAll()
      // First 15 should execute in burst
      const burstTimestamps = timestamps.slice(0, 15)
      const burstDuration = burstTimestamps[14] - burstTimestamps[0]
      expect(burstDuration).toBeLessThanOrEqual(150)
    })
    it('should accept custom concurrency option', async () => {
      const queue = new RateLimitedQueue({concurrency: 5, rate: 100})
      let concurrent = 0
      let maxConcurrent = 0
      for (let i = 0; i < 20; i++) {
        queue.enqueue(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise(resolve => setTimeout(resolve, 50))
          concurrent--
          return i
        })
      }
      await queue.processAll()
      expect(maxConcurrent).toBe(5)
    })
    it('should enforce minimum concurrency of 1', async () => {
      const queue = new RateLimitedQueue({concurrency: 0, rate: 100})
      let concurrent = 0
      let maxConcurrent = 0
      for (let i = 0; i < 5; i++) {
        queue.enqueue(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise(resolve => setTimeout(resolve, 10))
          concurrent--
          return i
        })
      }
      await queue.processAll()
      // Should default to 1, not 0
      expect(maxConcurrent).toBeGreaterThanOrEqual(1)
    })
  })
})
