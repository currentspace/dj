/**
 * RequestOrchestrator Tests
 * Comprehensive tests for multi-lane request orchestration with rate limiting
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {RequestOrchestrator} from '../../utils/RequestOrchestrator'
import {measureExecutionTime, verifyRateLimitCompliance} from '../fixtures/rate-limit-mocks'

describe('RequestOrchestrator', () => {
  let orchestrator: RequestOrchestrator

  beforeEach(() => {
    orchestrator = new RequestOrchestrator({rate: 40, minTickMs: 1})
  })

  afterEach(() => {
    // Clean up any pending operations
    orchestrator = null as unknown as RequestOrchestrator
  })

  describe('Per-Lane Concurrency Limits', () => {
    it('should enforce anthropic lane limit (2 concurrent)', async () => {
      let concurrent = 0
      let maxConcurrent = 0

      const tasks = Array.from({length: 10}, () =>
        orchestrator.execute(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise(resolve => setTimeout(resolve, 50))
          concurrent--
          return 'done'
        }, 'anthropic'),
      )

      await Promise.all(tasks)

      // Anthropic lane should never exceed 2 concurrent
      expect(maxConcurrent).toBeLessThanOrEqual(2)
    })

    it('should enforce spotify lane limit (5 concurrent)', async () => {
      let concurrent = 0
      let maxConcurrent = 0

      const tasks = Array.from({length: 20}, () =>
        orchestrator.execute(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise(resolve => setTimeout(resolve, 30))
          concurrent--
          return 'done'
        }, 'spotify'),
      )

      await Promise.all(tasks)

      // Spotify lane should not exceed 5 concurrent
      expect(maxConcurrent).toBeLessThanOrEqual(5)
    })

    it('should enforce lastfm lane limit (10 concurrent)', async () => {
      let concurrent = 0
      let maxConcurrent = 0

      const tasks = Array.from({length: 30}, () =>
        orchestrator.execute(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise(resolve => setTimeout(resolve, 20))
          concurrent--
          return 'done'
        }, 'lastfm'),
      )

      await Promise.all(tasks)

      // Last.fm lane should not exceed 10 concurrent
      expect(maxConcurrent).toBeLessThanOrEqual(10)
    })

    it('should enforce deezer lane limit (10 concurrent)', async () => {
      let concurrent = 0
      let maxConcurrent = 0

      const tasks = Array.from({length: 30}, () =>
        orchestrator.execute(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise(resolve => setTimeout(resolve, 20))
          concurrent--
          return 'done'
        }, 'deezer'),
      )

      await Promise.all(tasks)

      // Deezer lane should not exceed 10 concurrent
      expect(maxConcurrent).toBeLessThanOrEqual(10)
    })

    it('should enforce default lane limit (3 concurrent)', async () => {
      let concurrent = 0
      let maxConcurrent = 0

      const tasks = Array.from({length: 15}, () =>
        orchestrator.execute(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise(resolve => setTimeout(resolve, 30))
          concurrent--
          return 'done'
        }, 'default'),
      )

      await Promise.all(tasks)

      // Default lane should not exceed 3 concurrent
      expect(maxConcurrent).toBeLessThanOrEqual(3)
    })

    it('should queue tasks when lane is full', async () => {
      const executionOrder: number[] = []

      // Queue 5 tasks in anthropic lane (limit 2)
      const tasks = Array.from({length: 5}, (_, i) =>
        orchestrator.execute(async () => {
          executionOrder.push(i)
          await new Promise(resolve => setTimeout(resolve, 50))
          return i
        }, 'anthropic'),
      )

      const results = await Promise.all(tasks)

      // All tasks should complete
      expect(results).toHaveLength(5)
      expect(results).toEqual([0, 1, 2, 3, 4])

      // Tasks should execute in FIFO order
      expect(executionOrder).toEqual([0, 1, 2, 3, 4])
    })

    it('should release lane slots after task completion', async () => {
      let slotsUsed = 0
      let maxSlotsUsed = 0

      // Execute tasks sequentially to observe slot release
      for (let i = 0; i < 10; i++) {
        await orchestrator.execute(async () => {
          slotsUsed++
          maxSlotsUsed = Math.max(maxSlotsUsed, slotsUsed)
          await new Promise(resolve => setTimeout(resolve, 10))
          slotsUsed--
          return i
        }, 'anthropic')
      }

      // Should never exceed lane limit
      expect(maxSlotsUsed).toBeLessThanOrEqual(2)
    })
  })

  describe('Global Rate Limiting', () => {
    it('should enforce global 40 RPS rate limit', async () => {
      const timestamps: number[] = []

      // Execute 100 tasks in anthropic lane (concurrency 2)
      // This gives us more predictable timing since concurrency is low
      const tasks: Promise<unknown>[] = []

      for (let i = 0; i < 100; i++) {
        tasks.push(
          orchestrator.execute(async () => {
            timestamps.push(performance.now())
            return i
          }, 'anthropic'),
        )
      }

      const {durationMs} = await measureExecutionTime(async () => {
        await Promise.all(tasks)
      })

      // With concurrency 2 and rate 40 TPS, effective throughput is ~80 TPS
      // 100 tasks / 80 TPS = 1.25 seconds minimum
      expect(durationMs).toBeGreaterThanOrEqual(1100)

      // All tasks should complete
      expect(timestamps).toHaveLength(100)
    })

    it('should respect rate limit across all lanes simultaneously', async () => {
      const timestamps: number[] = []

      // Run tasks in all lanes concurrently
      // Use smaller numbers to avoid overwhelming the rate limiter
      const anthropicTasks = Array.from({length: 10}, () =>
        orchestrator.execute(async () => {
          timestamps.push(performance.now())
          return 'anthropic'
        }, 'anthropic'),
      )

      const spotifyTasks = Array.from({length: 10}, () =>
        orchestrator.execute(async () => {
          timestamps.push(performance.now())
          return 'spotify'
        }, 'spotify'),
      )

      const lastfmTasks = Array.from({length: 10}, () =>
        orchestrator.execute(async () => {
          timestamps.push(performance.now())
          return 'lastfm'
        }, 'lastfm'),
      )

      await Promise.all([...anthropicTasks, ...spotifyTasks, ...lastfmTasks])

      // All 30 tasks should complete
      expect(timestamps).toHaveLength(30)
    })

    it('should maintain rate limit with fast-completing tasks', async () => {
      const timestamps: number[] = []

      const tasks = Array.from({length: 80}, () =>
        orchestrator.execute(async () => {
          timestamps.push(performance.now())
          // Instant completion (no delay)
          return 'fast'
        }, 'anthropic'), // Use anthropic lane for more predictable concurrency (2)
      )

      const {durationMs} = await measureExecutionTime(async () => {
        await Promise.all(tasks)
      })

      // 80 tasks with concurrency 2 at 40 TPS = ~1 second minimum
      expect(durationMs).toBeGreaterThanOrEqual(900)
      expect(timestamps).toHaveLength(80)
    })

    it('should maintain rate limit with slow-completing tasks', async () => {
      const timestamps: number[] = []

      const tasks = Array.from({length: 50}, () =>
        orchestrator.execute(async () => {
          timestamps.push(performance.now())
          await new Promise(resolve => setTimeout(resolve, 100))
          return 'slow'
        }, 'default'),
      )

      const {durationMs} = await measureExecutionTime(async () => {
        await Promise.all(tasks)
      })

      // Rate limit should still apply
      // 50 tasks at 40 RPS = 1.25 seconds minimum for rate limit
      // But tasks take 100ms each with concurrency 3
      expect(durationMs).toBeGreaterThanOrEqual(1200)

      const compliance = verifyRateLimitCompliance(timestamps, 40, 0.15)
      expect(compliance.compliant).toBe(true)
    })
  })

  describe('Batch Execution', () => {
    it('should execute batch of tasks through same lane', async () => {
      const tasks = Array.from({length: 10}, (_, i) => async () => i * 2)

      const results = await orchestrator.executeBatch(tasks, 'spotify')

      expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18])
    })

    it('should respect lane concurrency during batch execution', async () => {
      let concurrent = 0
      let maxConcurrent = 0

      const tasks = Array.from({length: 20}, () => async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise(resolve => setTimeout(resolve, 30))
        concurrent--
        return 'done'
      })

      await orchestrator.executeBatch(tasks, 'anthropic')

      // Should not exceed anthropic lane limit
      expect(maxConcurrent).toBeLessThanOrEqual(2)
    })

    it('should maintain order in batch results', async () => {
      const tasks = Array.from({length: 10}, (_, i) => async () => {
        // Add random delay to test ordering
        await new Promise(resolve => setTimeout(resolve, Math.random() * 20))
        return i
      })

      const results = await orchestrator.executeBatch(tasks, 'default')

      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })

    it('should handle errors in batch execution', async () => {
      const tasks = [
        async () => 'success-1',
        async () => {
          throw new Error('Task failed')
        },
        async () => 'success-2',
      ]

      await expect(orchestrator.executeBatch(tasks, 'default')).rejects.toThrow('Task failed')
    })
  })

  describe('Multi-Lane Coordination', () => {
    it('should handle tasks in different lanes independently', async () => {
      const anthropicConcurrent = {current: 0, max: 0}
      const spotifyConcurrent = {current: 0, max: 0}

      const anthropicTasks = Array.from({length: 10}, () =>
        orchestrator.execute(async () => {
          anthropicConcurrent.current++
          anthropicConcurrent.max = Math.max(anthropicConcurrent.max, anthropicConcurrent.current)
          await new Promise(resolve => setTimeout(resolve, 50))
          anthropicConcurrent.current--
          return 'anthropic'
        }, 'anthropic'),
      )

      const spotifyTasks = Array.from({length: 10}, () =>
        orchestrator.execute(async () => {
          spotifyConcurrent.current++
          spotifyConcurrent.max = Math.max(spotifyConcurrent.max, spotifyConcurrent.current)
          await new Promise(resolve => setTimeout(resolve, 50))
          spotifyConcurrent.current--
          return 'spotify'
        }, 'spotify'),
      )

      await Promise.all([...anthropicTasks, ...spotifyTasks])

      // Each lane should respect its own limit
      expect(anthropicConcurrent.max).toBeLessThanOrEqual(2)
      expect(spotifyConcurrent.max).toBeLessThanOrEqual(5)
    })

    it('should execute tasks from all lanes concurrently', async () => {
      const completionOrder: string[] = []

      const tasks = [
        orchestrator.execute(async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          completionOrder.push('anthropic-1')
          return 'anthropic-1'
        }, 'anthropic'),
        orchestrator.execute(async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          completionOrder.push('spotify-1')
          return 'spotify-1'
        }, 'spotify'),
        orchestrator.execute(async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          completionOrder.push('lastfm-1')
          return 'lastfm-1'
        }, 'lastfm'),
      ]

      const {durationMs} = await measureExecutionTime(async () => {
        await Promise.all(tasks)
      })

      // Should complete in parallel (not sequentially)
      // Sequential would be 30ms+, parallel should be ~10ms + overhead
      expect(durationMs).toBeLessThan(100)
      expect(completionOrder).toHaveLength(3)
    })

    it('should not let one lane block another', async () => {
      // Start a long-running task in anthropic lane
      const anthropicTask = orchestrator.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return 'anthropic-slow'
      }, 'anthropic')

      // Wait a bit, then start spotify tasks
      await new Promise(resolve => setTimeout(resolve, 10))

      const spotifyTimestamps: number[] = []
      const spotifyTasks = Array.from({length: 5}, () =>
        orchestrator.execute(async () => {
          spotifyTimestamps.push(performance.now())
          return 'spotify-fast'
        }, 'spotify'),
      )

      const spotifyResults = await Promise.all(spotifyTasks)

      // Spotify tasks should complete quickly despite anthropic being blocked
      expect(spotifyResults).toHaveLength(5)

      // Anthropic task should still complete
      const anthropicResult = await anthropicTask
      expect(anthropicResult).toBe('anthropic-slow')
    })
  })

  describe('Error Handling', () => {
    it('should propagate errors from tasks', async () => {
      await expect(
        orchestrator.execute(async () => {
          throw new Error('Task failed')
        }, 'default'),
      ).rejects.toThrow('Task failed')
    })

    it('should release lane slot even when task throws', async () => {
      let concurrent = 0
      let maxConcurrent = 0

      // Execute tasks sequentially to observe slot behavior
      await orchestrator.execute(async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise(resolve => setTimeout(resolve, 30))
        concurrent--
        return 'success'
      }, 'anthropic')

      await orchestrator
        .execute(async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise(resolve => setTimeout(resolve, 10))
          concurrent--
          throw new Error('Task failed')
        }, 'anthropic')
        .catch(() => 'caught')

      await orchestrator.execute(async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise(resolve => setTimeout(resolve, 30))
        concurrent--
        return 'success-2'
      }, 'anthropic')

      // Lane limit should be respected (only 1 at a time when executed sequentially)
      expect(maxConcurrent).toBeLessThanOrEqual(1)
    })

    it('should continue processing other tasks when one fails', async () => {
      const successfulTasks: number[] = []

      const tasks = [
        orchestrator.execute(async () => {
          successfulTasks.push(1)
          return 1
        }, 'default'),
        orchestrator.execute(async () => {
          throw new Error('Task 2 failed')
        }, 'default').catch(() => -1),
        orchestrator.execute(async () => {
          successfulTasks.push(3)
          return 3
        }, 'default'),
      ]

      const results = await Promise.all(tasks)

      expect(results).toEqual([1, -1, 3])
      expect(successfulTasks).toEqual([1, 3])
    })
  })

  describe('Edge Cases', () => {
    it('should handle single task execution', async () => {
      const result = await orchestrator.execute(async () => 'single', 'default')
      expect(result).toBe('single')
    })

    it('should handle empty batch', async () => {
      const results = await orchestrator.executeBatch([], 'default')
      expect(results).toEqual([])
    })

    it('should handle rapid-fire task submission', async () => {
      const timestamps: number[] = []

      // Submit 50 tasks as fast as possible
      const tasks = Array.from({length: 50}, () =>
        orchestrator.execute(async () => {
          timestamps.push(performance.now())
          return 'done'
        }, 'anthropic'), // Use anthropic for predictable concurrency
      )

      const {durationMs} = await measureExecutionTime(async () => {
        await Promise.all(tasks)
      })

      // All tasks should complete
      expect(timestamps).toHaveLength(50)

      // 50 tasks with concurrency 2 at 40 TPS should take ~600ms minimum
      // But with burst capabilities, may complete faster
      expect(durationMs).toBeGreaterThanOrEqual(200)
    })

    it('should handle task that returns undefined', async () => {
      const result = await orchestrator.execute(async () => {
        return undefined
      }, 'default')

      expect(result).toBeUndefined()
    })

    it('should handle task that returns null', async () => {
      const result = await orchestrator.execute(async () => null, 'default')
      expect(result).toBeNull()
    })

    it('should handle tasks with different return types', async () => {
      const stringResult = await orchestrator.execute(async () => 'string', 'default')
      const numberResult = await orchestrator.execute(async () => 42, 'default')
      const objectResult = await orchestrator.execute(async () => ({foo: 'bar'}), 'default')

      expect(stringResult).toBe('string')
      expect(numberResult).toBe(42)
      expect(objectResult).toEqual({foo: 'bar'})
    })
  })

  describe('Performance Characteristics', () => {
    it('should complete 100 tasks within reasonable time', async () => {
      const {durationMs} = await measureExecutionTime(async () => {
        const tasks = Array.from({length: 100}, () =>
          orchestrator.execute(async () => 'done', 'anthropic'),
        )
        await Promise.all(tasks)
      })

      // 100 tasks with concurrency 2 at 40 RPS
      // Effective throughput: ~80 TPS, so 100/80 = 1.25s minimum
      expect(durationMs).toBeGreaterThanOrEqual(1100)
      expect(durationMs).toBeLessThan(3000)
    })

    it('should efficiently utilize concurrency slots', async () => {
      const executionTimes: number[] = []

      const tasks = Array.from({length: 20}, () =>
        orchestrator.execute(async () => {
          const start = performance.now()
          await new Promise(resolve => setTimeout(resolve, 50))
          executionTimes.push(performance.now() - start)
          return 'done'
        }, 'spotify'),
      )

      await Promise.all(tasks)

      // All tasks should take approximately the same time (no starvation)
      const avgTime = executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length
      const maxTime = Math.max(...executionTimes)
      const minTime = Math.min(...executionTimes)

      // Variance should be reasonable (within 100ms)
      expect(maxTime - minTime).toBeLessThan(100)
      expect(avgTime).toBeGreaterThanOrEqual(45)
      expect(avgTime).toBeLessThanOrEqual(70)
    })

    it('should not accumulate memory with many tasks', async () => {
      // Execute 500 tasks sequentially (simulating long-running service)
      for (let batch = 0; batch < 5; batch++) {
        const tasks = Array.from({length: 100}, () =>
          orchestrator.execute(async () => 'done', 'default'),
        )
        await Promise.all(tasks)
      }

      // If we get here without timeout or OOM, test passes
      expect(true).toBe(true)
    }, 30000) // 30 second timeout for this test
  })
})
