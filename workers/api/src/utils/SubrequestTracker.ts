/**
 * Subrequest Tracker
 *
 * Tracks fetch() calls to stay within Cloudflare Workers subrequest limits:
 * - Free tier: 50 subrequests per request
 * - Paid tier: 1000 subrequests per request
 *
 * This is separate from rate limiting (requests per second) and addresses
 * the platform constraint of total fetch() calls per worker invocation.
 *
 * Uses AsyncLocalStorage for per-request context (similar to LoggerContext).
 */

import {AsyncLocalStorage} from 'node:async_hooks'
import {z} from 'zod'

import {getLogger} from './LoggerContext'

export interface SubrequestTrackerOptions {
  /**
   * Maximum subrequests allowed per request
   * Default: 45 (safety margin below free tier limit of 50)
   */
  maxSubrequests?: number

  /**
   * Warning threshold (percentage of max)
   * Default: 0.8 (80%)
   */
  warningThreshold?: number

  /**
   * Enable detailed logging
   * Default: false
   */
  enableLogging?: boolean
}

export class SubrequestTracker {
  private count = 0
  private readonly maxSubrequests: number
  private readonly warningThreshold: number
  private readonly enableLogging: boolean
  private hasWarned = false

  constructor(options: SubrequestTrackerOptions = {}) {
    this.maxSubrequests = options.maxSubrequests ?? 45 // Safety margin
    this.warningThreshold = options.warningThreshold ?? 0.8
    this.enableLogging = options.enableLogging ?? false
  }

  /**
   * Record one or more subrequests
   * Returns true if still under limit, false if limit would be exceeded
   */
  record(count = 1): boolean {
    this.count += count

    if (this.enableLogging) {
      getLogger()?.info(`[SubrequestTracker] Recorded ${count} subrequest(s), total: ${this.count}/${this.maxSubrequests}`)
    }

    // Check warning threshold
    const percentage = this.count / this.maxSubrequests
    if (!this.hasWarned && percentage >= this.warningThreshold) {
      this.hasWarned = true
      getLogger()?.warn(
        `[SubrequestTracker] Approaching subrequest limit: ${this.count}/${this.maxSubrequests} (${Math.round(percentage * 100)}%)`,
      )
    }

    return this.count <= this.maxSubrequests
  }

  /**
   * Check if we can make N more subrequests
   */
  canMake(count: number): boolean {
    return this.count + count <= this.maxSubrequests
  }

  /**
   * Get remaining subrequest budget
   */
  remaining(): number {
    return Math.max(0, this.maxSubrequests - this.count)
  }

  /**
   * Get current count
   */
  getCount(): number {
    return this.count
  }

  /**
   * Get max limit
   */
  getMax(): number {
    return this.maxSubrequests
  }

  /**
   * Get percentage used
   */
  getPercentage(): number {
    return (this.count / this.maxSubrequests) * 100
  }

  /**
   * Reset counter (for testing)
   */
  reset(): void {
    this.count = 0
    this.hasWarned = false
  }

  /**
   * Get summary for logging
   */
  getSummary(): {
    count: number
    max: number
    remaining: number
    percentage: number
  } {
    return {
      count: this.count,
      max: this.maxSubrequests,
      remaining: this.remaining(),
      percentage: this.getPercentage(),
    }
  }
}

/**
 * Calculate safe batch sizes for different enrichment sources
 */
export function calculateBatchSizes(
  tracker: SubrequestTracker,
  totalTracks: number,
): {
  lastfm: number // Number of tracks to enrich with Last.fm (4 calls each)
  deezer: number // Number of tracks to enrich with Deezer (1 call each, but most cached)
  estimatedCalls: number
} {
  const remaining = tracker.remaining()

  // Reserve some budget for other calls (Spotify, etc.)
  const availableBudget = Math.max(0, remaining - 5)

  // Last.fm makes 4 API calls per track (correction, info, tags, similar)
  // Reserve 30% of budget for Last.fm (expensive)
  const lastfmBudget = Math.floor(availableBudget * 0.3)
  const lastfmTracks = Math.min(totalTracks, Math.floor(lastfmBudget / 4))

  // Deezer makes 1 call per track (but most are cached after first run)
  // Use remaining budget, assuming 50% cache hit rate
  const deezerBudget = Math.floor(availableBudget * 0.7)
  const deezerTracks = Math.min(totalTracks, Math.floor(deezerBudget * 2))

  const estimatedCalls = lastfmTracks * 4 + Math.floor(deezerTracks * 0.5)

  return {
    lastfm: lastfmTracks,
    deezer: deezerTracks,
    estimatedCalls,
  }
}

// AsyncLocalStorage for per-request SubrequestTracker context
interface SubrequestTrackerContext {
  tracker: SubrequestTracker
}

const SubrequestTrackerContextSchema = z.object({
  tracker: z.custom<SubrequestTracker>(val => val !== null && typeof val === 'object'),
})

const trackerStorageRaw = new AsyncLocalStorage<SubrequestTrackerContext>()

// Validate the storage instance structure
if (
  typeof trackerStorageRaw !== 'object' ||
  trackerStorageRaw === null ||
  typeof (trackerStorageRaw as {getStore?: unknown}).getStore !== 'function' ||
  typeof (trackerStorageRaw as {run?: unknown}).run !== 'function'
) {
  throw new Error('AsyncLocalStorage instance is invalid for SubrequestTracker')
}

/**
 * Get the current request's subrequest tracker
 * Returns undefined if called outside of a tracker context
 */
export function getSubrequestTracker(): SubrequestTracker | undefined {
  // Type guard ensures trackerStorageRaw has getStore method
  if (typeof (trackerStorageRaw as {getStore?: unknown}).getStore !== 'function') {
    return undefined
  }

  const contextRaw = trackerStorageRaw.getStore()

  // Validate context using Zod schema (handles null/undefined automatically)
  const validation = SubrequestTrackerContextSchema.safeParse(contextRaw)
  if (!validation.success) {
    return undefined
  }

  return validation.data.tracker
}

/**
 * Initialize subrequest tracker context for a request scope
 * Must be called with async/await (not thenables) to ensure context preservation
 */
export async function runWithSubrequestTracker<T>(
  tracker: SubrequestTracker,
  fn: () => Promise<T>,
): Promise<T> {
  const context: SubrequestTrackerContext = {tracker}

  // Validate context before using it
  const validation = SubrequestTrackerContextSchema.safeParse(context)
  if (!validation.success) {
    throw new Error('Invalid subrequest tracker context')
  }

  // Type guard ensures trackerStorageRaw has run method
  if (typeof (trackerStorageRaw as {run?: unknown}).run !== 'function') {
    throw new Error('AsyncLocalStorage.run is not available for SubrequestTracker')
  }

  // Type guard validates the storage object structure
  const storageWithRun = trackerStorageRaw as {
    run?: (context: SubrequestTrackerContext, fn: () => Promise<T>) => Promise<T>
  }
  if (typeof storageWithRun.run === 'function') {
    return await storageWithRun.run(context, fn)
  }

  throw new Error('AsyncLocalStorage.run is not available for SubrequestTracker')
}
