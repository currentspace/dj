/**
 * Cloudflare Workers Mocks
 * Mock KVNamespace, Env, and ExecutionContext for testing
 */

export class MockKVNamespace {
  private store: Map<string, { value: string; expiration: number | null }> = new Map()

  async get(key: string, type?: 'text'): Promise<string | null>
  async get(key: string, type: 'json'): Promise<unknown>
  async get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  async get(key: string, type: 'stream'): Promise<ReadableStream | null>
  async get(
    key: string,
    type: 'text' | 'json' | 'arrayBuffer' | 'stream' = 'text',
  ): Promise<ArrayBuffer | ReadableStream | string | unknown> {
    const entry = this.store.get(key)
    if (!entry) return null

    // Check expiration
    if (entry.expiration !== null && entry.expiration < Date.now()) {
      this.store.delete(key)
      return null
    }

    if (type === 'json') {
      try {
        return JSON.parse(entry.value)
      } catch {
        return null
      }
    }

    if (type === 'arrayBuffer') {
      return new TextEncoder().encode(entry.value).buffer
    }

    if (type === 'stream') {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(entry.value))
          controller.close()
        },
      })
    }

    return entry.value
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { expirationTtl?: number; expiration?: number },
  ): Promise<void> {
    let stringValue: string
    if (value instanceof ArrayBuffer) {
      stringValue = new TextDecoder().decode(value)
    } else if (value instanceof ReadableStream) {
      const reader = value.getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        chunks.push(chunk)
      }
      const concatenated = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0))
      let offset = 0
      for (const chunk of chunks) {
        concatenated.set(chunk, offset)
        offset += chunk.length
      }
      stringValue = new TextDecoder().decode(concatenated)
    } else {
      stringValue = value
    }

    let expiration: number | null = null
    if (options?.expirationTtl) {
      expiration = Date.now() + options.expirationTtl * 1000
    } else if (options?.expiration) {
      expiration = options.expiration * 1000
    }

    this.store.set(key, { value: stringValue, expiration })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: { name: string; expiration?: number; metadata?: unknown }[]
    list_complete: boolean
    cursor?: string
    cacheStatus: string | null
  }> {
    const keys = Array.from(this.store.keys())
      .filter(k => !options?.prefix || k.startsWith(options.prefix))
      .slice(0, options?.limit ?? 1000)
      .map(name => ({ name }))

    return {
      keys,
      list_complete: true,
      cacheStatus: null,
    }
  }

  // Clear all data (for test cleanup)
  clear(): void {
    this.store.clear()
  }

  // Get raw store (for test assertions)
  getStore(): Map<string, { value: string; expiration: number | null }> {
    return this.store
  }

  async getWithMetadata<Metadata = unknown>(
    key: string,
    type?: 'text' | 'json' | 'arrayBuffer' | 'stream',
  ): Promise<{
    value: string | ArrayBuffer | ReadableStream | unknown
    metadata: Metadata | null
  }> {
    const value = await this.get(key, type as 'text')
    return { value, metadata: null }
  }
}

/**
 * Build a mock KVNamespace with proper typing.
 * Uses `as KVNamespace` internally so test consumers don't need to.
 */
export function buildMockKV(): KVNamespace {
  return new MockKVNamespace() as unknown as KVNamespace
}

/**
 * Create a mock Cloudflare environment
 */
export function createMockEnv(overrides?: {
  ANTHROPIC_API_KEY?: string
  AUDIO_FEATURES_CACHE?: KVNamespace
  ENVIRONMENT?: string
  FRONTEND_URL?: string
  LASTFM_API_KEY?: string
  SESSIONS?: KVNamespace
  SPOTIFY_CLIENT_ID?: string
  SPOTIFY_CLIENT_SECRET?: string
  ASSETS?: Fetcher
}) {
  return {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    AUDIO_FEATURES_CACHE: new MockKVNamespace(),
    ENVIRONMENT: 'test',
    FRONTEND_URL: 'http://localhost:3000',
    LASTFM_API_KEY: 'test-lastfm-key',
    SESSIONS: new MockKVNamespace(),
    SPOTIFY_CLIENT_ID: 'test-spotify-id',
    SPOTIFY_CLIENT_SECRET: 'test-spotify-secret',
    ASSETS: {
      fetch: async () => new Response('Not found', {status: 404}),
      connect: () => {
        throw new Error('Socket connect not supported in tests')
      },
    },
    ...overrides,
  }
}

/**
 * Create a mock ExecutionContext
 */
export function createMockExecutionContext(): ExecutionContext {
  const promises: Promise<unknown>[] = []

  return {
    waitUntil: (promise: Promise<unknown>) => {
      promises.push(promise)
    },
    passThroughOnException: () => {},
    // For tests: await all promises
    async waitForAll(): Promise<void> {
      await Promise.all(promises)
    },
  } as ExecutionContext & { waitForAll: () => Promise<void> }
}

/**
 * Create a mock Hono-compatible Request
 */
export function createMockRequest(options: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
}): Request {
  const {url, method = 'GET', headers = {}, body} = options

  const requestInit: RequestInit = {
    method,
    headers: new Headers(headers),
  }

  if (body) {
    requestInit.body = JSON.stringify(body)
    if (!headers['content-type']) {
      ;(requestInit.headers as Headers).set('Content-Type', 'application/json')
    }
  }

  return new Request(url, requestInit)
}

/**
 * Create a mock Hono Context (c)
 * This is a minimal mock - extend as needed for specific tests
 */
export function createMockContext(options: {
  env?: unknown
  request?: Request
  executionCtx?: ExecutionContext
}): {
  env: unknown
  executionCtx: ExecutionContext
  req: {
    raw: Request
    url: string
    method: string
    header: (name: string) => string | undefined
    query: (name: string) => string | undefined
    json: () => Promise<unknown>
  }
  json: (data: unknown, status?: number) => Response
  text: (text: string, status?: number) => Response
  html: (html: string, status?: number) => Response
  status: (status: number) => void
  header: (name: string, value: string) => void
} {
  const env = options.env ?? createMockEnv()
  const req = options.request ?? createMockRequest({url: 'http://localhost:8787/test'})
  const executionCtx = options.executionCtx ?? createMockExecutionContext()

  return {
    env,
    executionCtx,
    req: {
      raw: req,
      url: req.url,
      method: req.method,
      header: (name: string) => req.headers.get(name) ?? undefined,
      query: () => undefined,
      json: async () => JSON.parse(await req.text()),
    },
    json: (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {'Content-Type': 'application/json'},
      }),
    text: (text: string, status = 200) =>
      new Response(text, {
        status,
        headers: {'Content-Type': 'text/plain'},
      }),
    html: (html: string, status = 200) =>
      new Response(html, {
        status,
        headers: {'Content-Type': 'text/html'},
      }),
    status: () => {},
    header: () => {},
  }
}
