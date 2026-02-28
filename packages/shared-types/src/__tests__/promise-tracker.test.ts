import {describe, expect, it} from 'vitest'
import {PromiseTracker} from '../promise-tracker'

describe('PromiseTracker', () => {
  it('starts with size 0', () => {
    const tracker = new PromiseTracker()
    expect(tracker.size).toBe(0)
  })

  it('tracks a single promise', async () => {
    const tracker = new PromiseTracker()
    let resolve!: () => void
    const p = new Promise<void>((r) => {
      resolve = r
    })

    tracker.track(p)
    expect(tracker.size).toBe(1)

    resolve()
    await tracker.flush()
    expect(tracker.size).toBe(0)
  })

  it('tracks multiple promises', async () => {
    const tracker = new PromiseTracker()
    const resolvers: Array<() => void> = []

    for (let i = 0; i < 3; i++) {
      const p = new Promise<void>((r) => {
        resolvers.push(r)
      })
      tracker.track(p)
    }

    expect(tracker.size).toBe(3)

    resolvers[0]()
    await Promise.resolve() // let microtask run
    expect(tracker.size).toBe(2)

    resolvers[1]()
    resolvers[2]()
    await tracker.flush()
    expect(tracker.size).toBe(0)
  })

  it('removes rejected promises', async () => {
    const tracker = new PromiseTracker()
    let reject!: (err: Error) => void
    const p = new Promise<void>((_resolve, r) => {
      reject = r
    })

    tracker.track(p).catch(() => {
      /* swallow */
    })
    expect(tracker.size).toBe(1)

    reject(new Error('test'))
    await tracker.flush()
    expect(tracker.size).toBe(0)
  })

  it('flush resolves immediately when empty', async () => {
    const tracker = new PromiseTracker()
    await tracker.flush()
    expect(tracker.size).toBe(0)
  })

  it('returns the same promise from track()', async () => {
    const tracker = new PromiseTracker()
    const original = Promise.resolve(42)
    const returned = tracker.track(original)

    expect(returned).toBe(original)
    expect(await returned).toBe(42)
  })

  it('flush waits for all even if some reject', async () => {
    const tracker = new PromiseTracker()
    const results: string[] = []

    tracker.track(
      Promise.resolve().then(() => {
        results.push('a')
      }),
    )
    tracker
      .track(
        Promise.reject(new Error('fail')).catch(() => {
          results.push('b')
        }),
      )
      .catch(() => {
        /* swallow */
      })
    tracker.track(
      Promise.resolve().then(() => {
        results.push('c')
      }),
    )

    await tracker.flush()
    expect(results).toContain('a')
    expect(results).toContain('b')
    expect(results).toContain('c')
    expect(tracker.size).toBe(0)
  })
})
