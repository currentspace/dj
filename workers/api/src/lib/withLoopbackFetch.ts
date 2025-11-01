import app from "../index"; // your Hono app default export

export async function withLoopbackFetch<T>(
  c: any,
  fn: () => Promise<T>,
  {
    pathPrefix = "/api/mcp",
    sentinelHeader = "x-internal-dispatch",
  }: { pathPrefix?: string; sentinelHeader?: string } = {}
): Promise<T> {
  const origFetch = fetch.bind(globalThis);
  const selfOrigin = new URL(c.req.url).origin;

  function toURL(input: RequestInfo | URL): URL {
    if (input instanceof URL) return input;
    if (typeof input === "string") return new URL(input, selfOrigin);
    return new URL((input).url);
  }

  function isLoopbackTarget(u: URL, r?: Request) {
    if (u.origin !== selfOrigin) return false;
    if (!u.pathname.startsWith(pathPrefix)) return false;
    if (r?.headers?.get(sentinelHeader)) return false; // already dispatched
    return true;
  }

  // @ts-ignore – we're temporarily replacing global fetch
  globalThis.fetch = async (input: any, init?: RequestInit) => {
    const url = toURL(input);
    if (input instanceof Request) {
      if (isLoopbackTarget(url, input)) {
        console.log(`[LoopbackFetch] Intercepting self-request to ${url.pathname}`);
        const headers = new Headers(input.headers);
        headers.set(sentinelHeader, "1");
        const req = new Request(input, { headers });
        const res = await app.fetch(req, c.env, c.executionCtx);
        console.log(`[LoopbackFetch] Internal dispatch returned ${res.status}`);
        return res;
      }
      return origFetch(input, init);
    } else {
      if (isLoopbackTarget(url)) {
        console.log(`[LoopbackFetch] Intercepting self-request to ${url.pathname}`);
        const method = (init?.method ?? "GET").toUpperCase();
        const headers = new Headers(init?.headers);
        headers.set(sentinelHeader, "1");
        // Forward Authorization if caller forgot it (handy in dev)
        if (!headers.get("authorization")) {
          const auth = c.req.header("authorization");
          if (auth) headers.set("authorization", auth);
        }
        const req = new Request(url.toString(), { ...init, headers, method });
        const res = await app.fetch(req, c.env, c.executionCtx);
        console.log(`[LoopbackFetch] Internal dispatch returned ${res.status}`);
        return res;
      }
      return origFetch(input, init);
    }
  };

  try {
    return await fn();
  } finally {
    // @ts-ignore
    globalThis.fetch = origFetch;
  }
}