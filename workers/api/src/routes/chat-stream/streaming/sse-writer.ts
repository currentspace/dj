import {getLogger} from '../../../utils/LoggerContext'
import type {StreamEvent} from '../types'

/**
 * SSE Writer with queue to prevent concurrent writes
 */
export class SSEWriter {
  private closed = false
  private encoder: TextEncoder
  private writeQueue: Promise<void> = Promise.resolve()
  private writer: WritableStreamDefaultWriter

  constructor(writer: WritableStreamDefaultWriter) {
    this.writer = writer
    this.encoder = new TextEncoder()
  }

  async close(): Promise<void> {
    this.closed = true
    await this.writeQueue
    await this.writer.close()
  }

  /**
   * Wait for all queued writes to complete
   */
  async flush(): Promise<void> {
    await this.writeQueue
  }

  async write(event: StreamEvent): Promise<void> {
    if (this.closed) return

    this.writeQueue = this.writeQueue.then(async () => {
      if (this.closed) return
      try {
        const message = `data: ${JSON.stringify(event)}\n\n`
        await this.writer.write(this.encoder.encode(message))
      } catch (error) {
        getLogger()?.error('SSE write error:', error)
        this.closed = true
      }
    })

    return this.writeQueue
  }

  /**
   * Queue a write without awaiting (fire-and-forget)
   * Use this for non-critical messages to avoid blocking
   */
  writeAsync(event: StreamEvent): void {
    if (this.closed) return

    this.writeQueue = this.writeQueue.then(async () => {
      if (this.closed) return
      try {
        const message = `data: ${JSON.stringify(event)}\n\n`
        await this.writer.write(this.encoder.encode(message))
      } catch (error) {
        getLogger()?.error('SSE write error:', error)
        this.closed = true
      }
    })
  }

  async writeHeartbeat(): Promise<void> {
    if (this.closed) return

    this.writeQueue = this.writeQueue.then(async () => {
      if (this.closed) return
      try {
        await this.writer.write(this.encoder.encode(': heartbeat\n\n'))
      } catch (error) {
        getLogger()?.error('Heartbeat write error:', error)
        this.closed = true
      }
    })

    return this.writeQueue
  }
}
