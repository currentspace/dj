/**
 * Cloudflare Workers Mocks
 * Mock KVNamespace, Env, and ExecutionContext for testing
 */

export class MockKVNamespace {
  private store = new Map<string, { expiration: null | number; value: string; }>()

  // Clear all data (for test cleanup)
  clear(): void {
    this.store.clear()
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
  async get(key: string, type?: 'text'): Promise<null | string>
  async get(key: string, type: 'json'): Promise<unknown>
  async get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  async get(key: string, type: 'stream'): Promise<null | ReadableStream>
  async get(
    key: string,
    type: 'arrayBuffer' | 'json' | 'stream' | 'text' = 'text',
  ): Promise<unknown> {
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

  // Get raw store (for test assertions)
  getStore(): Map<string, { expiration: null | number; value: string; }> {
    return this.store
  }

  async getWithMetadata<Metadata = unknown>(
    key: string,
    type?: 'arrayBuffer' | 'json' | 'stream' | 'text',
  ): Promise<{
    metadata: Metadata | null
    value: unknown
  }> {
    const value = await this.get(key, type as 'text')
    return { metadata: null, value }
  }

  async list(options?: { limit?: number; prefix?: string; }): Promise<{
    cacheStatus: null | string
    cursor?: string
    keys: { expiration?: number; metadata?: unknown; name: string; }[]
    list_complete: boolean
  }> {
    const keys = Array.from(this.store.keys())
      .filter(k => !options?.prefix || k.startsWith(options.prefix))
      .slice(0, options?.limit ?? 1000)
      .map(name => ({ name }))

    return {
      cacheStatus: null,
      keys,
      list_complete: true,
    }
  }

  async put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: { expiration?: number; expirationTtl?: number; },
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

    let expiration: null | number = null
    if (options?.expirationTtl) {
      expiration = Date.now() + options.expirationTtl * 1000
    } else if (options?.expiration) {
      expiration = options.expiration * 1000
    }

    this.store.set(key, { expiration, value: stringValue })
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
 * Create a mock Hono Context (c)
 * This is a minimal mock - extend as needed for specific tests
 */
export function createMockContext(options: {
  env?: unknown
  executionCtx?: ExecutionContext
  request?: Request
}): {
  env: unknown
  executionCtx: ExecutionContext
  header: (name: string, value: string) => void
  html: (html: string, status?: number) => Response
  json: (data: unknown, status?: number) => Response
  req: {
    header: (name: string) => string | undefined
    json: () => Promise<unknown>
    method: string
    query: (name: string) => string | undefined
    raw: Request
    url: string
  }
  status: (status: number) => void
  text: (text: string, status?: number) => Response
} {
  const env = options.env ?? createMockEnv()
  const req = options.request ?? createMockRequest({url: 'http://localhost:8787/test'})
  const executionCtx = options.executionCtx ?? createMockExecutionContext()

  return {
    env,
    executionCtx,
    header: () => { /* noop */ },
    html: (html: string, status = 200) =>
      new Response(html, {
        headers: {'Content-Type': 'text/html'},
        status,
      }),
    json: (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        headers: {'Content-Type': 'application/json'},
        status,
      }),
    req: {
      header: (name: string) => req.headers.get(name) ?? undefined,
      json: async () => JSON.parse(await req.text()),
      method: req.method,
      query: () => undefined,
      raw: req,
      url: req.url,
    },
    status: () => { /* noop */ },
    text: (text: string, status = 200) =>
      new Response(text, {
        headers: {'Content-Type': 'text/plain'},
        status,
      }),
  }
}

/**
 * Create a mock Cloudflare environment
 */
export function createMockEnv(overrides?: {
  ANTHROPIC_API_KEY?: string
  ASSETS?: Fetcher
  AUDIO_FEATURES_CACHE?: KVNamespace
  ENVIRONMENT?: string
  FRONTEND_URL?: string
  LASTFM_API_KEY?: string
  SESSIONS?: KVNamespace
  SPOTIFY_CLIENT_ID?: string
  SPOTIFY_CLIENT_SECRET?: string
}) {
  return {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    ASSETS: {
      connect: () => {
        throw new Error('Socket connect not supported in tests')
      },
      fetch: async () => new Response('Not found', {status: 404}),
    },
    AUDIO_FEATURES_CACHE: new MockKVNamespace(),
    ENVIRONMENT: 'test',
    FRONTEND_URL: 'http://localhost:3000',
    LASTFM_API_KEY: 'test-lastfm-key',
    SESSIONS: new MockKVNamespace(),
    SPOTIFY_CLIENT_ID: 'test-spotify-id',
    SPOTIFY_CLIENT_SECRET: 'test-spotify-secret',
    ...overrides,
  }
}

/**
 * Create a mock ExecutionContext
 */
export function createMockExecutionContext(): ExecutionContext {
  const promises: Promise<unknown>[] = []

  return {
    passThroughOnException: () => { /* noop */ },
    // For tests: await all promises
    async waitForAll(): Promise<void> {
      await Promise.all(promises)
    },
    waitUntil: (promise: Promise<unknown>) => {
      promises.push(promise)
    },
  } as ExecutionContext & { waitForAll: () => Promise<void> }
}

/**
 * Create a mock Hono-compatible Request
 */
export function createMockRequest(options: {
  body?: unknown
  headers?: Record<string, string>
  method?: string
  url: string
}): Request {
  const {body, headers = {}, method = 'GET', url} = options

  const requestInit: RequestInit = {
    headers: new Headers(headers),
    method,
  }

  if (body) {
    requestInit.body = JSON.stringify(body)
    if (!headers['content-type']) {
      ;(requestInit.headers as Headers).set('Content-Type', 'application/json')
    }
  }

  return new Request(url, requestInit)
}
