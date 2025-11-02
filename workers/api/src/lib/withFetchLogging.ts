export async function withFetchLogging<T>(fn: () => Promise<T>): Promise<T> {
  const orig = fetch.bind(globalThis)
  // @ts-expect-error
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const isReq = input instanceof Request
      const isURL = input instanceof URL
      const url = isReq ? input.url : isURL ? input.toString() : input

      const method = (init?.method ?? (isReq ? input.method : 'GET') ?? 'GET').toUpperCase()
      const hdrs = new Headers(init?.headers ?? (isReq ? input.headers : undefined))
      const hObj = Object.fromEntries(hdrs.entries())
      if (hObj.authorization) hObj.authorization = '<redacted>'

      let preview = ''
      if (init?.body && typeof init.body === 'string') preview = init.body.slice(0, 300)

      const t0 = Date.now()
      const res = await orig(input as any, init)
      const t1 = Date.now()

      console.log(`[fetch] ${method} ${url} -> ${res.status} in ${t1 - t0}ms`)
      console.log(`[fetch] headers:`, hObj)
      if (preview) console.log(`[fetch] body: ${preview}`)

      if (!res.ok) {
        const copy = res.clone()
        const text = await copy.text().catch(() => '')
        console.log(`[fetch] resp (first 500): ${text.slice(0, 500)}`)
      }
      return res
    } catch (e) {
      console.error(`[fetch] threw:`, e)
      throw e
    }
  }
  try {
    return await fn()
  } finally {
    // @ts-expect-error
    globalThis.fetch = orig
  }
}
