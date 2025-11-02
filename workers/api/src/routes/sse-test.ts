import {Hono} from 'hono'

import type {Env} from '../index'

const sseTestRouter = new Hono<{Bindings: Env}>()

// Simple SSE test endpoint
sseTestRouter.get('/simple', async () => {
  console.log('[SSE-Test] Simple SSE test endpoint hit')

  const {readable, writable} = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  // Process in background
  const processStream = async () => {
    try {
      // Send initial message
      await writer.write(encoder.encode('data: {"type": "start", "data": "Starting test"}\n\n'))

      // Send a few test messages
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        await writer.write(encoder.encode(`data: {"type": "message", "data": "Message ${i + 1}"}\n\n`))
      }

      // Send done
      await writer.write(encoder.encode('data: {"type": "done", "data": null}\n\n'))
    } catch (error) {
      console.error('[SSE-Test] Error:', error)
    } finally {
      await writer.close()
    }
  }

  processStream().catch(console.error)

  return new Response(readable, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-transform',
      'Content-Encoding': 'identity',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    },
  })
})

// POST SSE test endpoint (like chat)
sseTestRouter.post('/post-stream', async c => {
  console.log('[SSE-Test] POST SSE test endpoint hit')

  const body = await c.req.json().catch(() => ({}))
  console.log('[SSE-Test] Request body:', body)

  const {readable, writable} = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  // Process in background
  const processStream = async () => {
    try {
      // Echo the request
      await writer.write(encoder.encode(`data: {"type": "echo", "data": ${JSON.stringify(body)}}\n\n`))

      // Send heartbeat
      await writer.write(encoder.encode(': heartbeat\n\n'))

      // Send done
      await writer.write(encoder.encode('data: {"type": "done", "data": null}\n\n'))
    } catch (error) {
      console.error('[SSE-Test] Error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await writer.write(encoder.encode(`data: {"type": "error", "data": "${errorMessage}"}\n\n`))
    } finally {
      await writer.close()
    }
  }

  processStream().catch(console.error)

  return new Response(readable, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-transform',
      'Content-Encoding': 'identity',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    },
  })
})

export {sseTestRouter}
