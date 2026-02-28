/**
 * Progress Message Throttler
 *
 * Ensures user-facing progress messages are spaced at least N seconds apart
 * to prevent message spam and improve UX.
 *
 * Features:
 * - Minimum interval enforcement (default 5 seconds)
 * - Context-aware message tracking
 * - Reset capability for new operations
 */

export interface ProgressMessageThrottlerOptions {
  /**
   * Minimum interval between messages in milliseconds
   * Default: 5000 (5 seconds)
   */
  minInterval?: number
}

export class ProgressMessageThrottler {
  private lastMessageTime = 0
  private messageCount = 0
  private readonly minInterval: number

  constructor(options: ProgressMessageThrottlerOptions = {}) {
    this.minInterval = options.minInterval ?? 5000 // 5 seconds default
  }

  /**
   * Force send next message regardless of timing
   * Use sparingly for critical messages
   */
  forceSend(): void {
    this.lastMessageTime = Date.now()
    this.messageCount++
  }

  /**
   * Get total messages sent
   */
  getMessageCount(): number {
    return this.messageCount
  }

  /**
   * Get summary for debugging
   */
  getSummary(): {
    canSendNow: boolean
    messageCount: number
    timeSinceLastMessage: number
    timeUntilNextMessage: number
  } {
    return {
      canSendNow: this.shouldSend(),
      messageCount: this.messageCount,
      timeSinceLastMessage: this.getTimeSinceLastMessage(),
      timeUntilNextMessage: this.getTimeUntilNextMessage(),
    }
  }

  /**
   * Get time since last message (ms)
   */
  getTimeSinceLastMessage(): number {
    if (this.lastMessageTime === 0) return Infinity
    return Date.now() - this.lastMessageTime
  }

  /**
   * Get time until next message can be sent (ms)
   */
  getTimeUntilNextMessage(): number {
    if (this.lastMessageTime === 0) return 0
    const elapsed = Date.now() - this.lastMessageTime
    return Math.max(0, this.minInterval - elapsed)
  }

  /**
   * Reset throttler for new operation
   */
  reset(): void {
    this.lastMessageTime = 0
    this.messageCount = 0
  }

  /**
   * Check if enough time has passed to send another message
   * Returns true if message should be sent
   */
  shouldSend(): boolean {
    const now = Date.now()
    const elapsed = now - this.lastMessageTime

    if (this.lastMessageTime === 0 || elapsed >= this.minInterval) {
      this.lastMessageTime = now
      this.messageCount++
      return true
    }

    return false
  }
}
