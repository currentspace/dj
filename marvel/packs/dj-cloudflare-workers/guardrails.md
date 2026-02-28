# DJ Cloudflare Workers (February 2026)

Hono routes, SSE streaming, KV storage, rate limiting, and strict promise tracking.

## Promise Tracking in Workers (Critical)

- **EVERY async operation must be tracked** — no floating promises, even in `waitUntil()`
- Use a `PromiseTracker` instance per request for all background work
- `ctx.waitUntil()` AND `tracker.track()` — both required for every background promise
- Log tracker status on request completion for debugging

```typescript
const tracker = new PromiseTracker()

// WRONG — fire-and-forget
ctx.waitUntil(doBackgroundWork())

// CORRECT — tracked AND registered with runtime
ctx.waitUntil(tracker.track(doBackgroundWork()))

// At end of request handler
ctx.waitUntil(tracker.flush())  // ensure all background work completes
```

- Spotify queue add: `tracker.track(queueToSpotify(token, uri))` — not bare `fetch()`
- KV writes in background: `tracker.track(kv.put(...))` — not fire-and-forget

## SSE Streaming (Critical)

- Use `TransformStream` with `highWaterMark: 10` to prevent memory bloat
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`
- Return `new Response(readable, { headers })` immediately; process via writable side
- Heartbeats every 15 seconds (`: heartbeat\n\n`)
- Serialize SSE writes through a queue — prevent concurrent writes to writable stream
- Handle client disconnect via abort signal; clean up resources

## Hono Route Patterns

- Use `@hono/zod-openapi` for all route definitions — Zod schemas are the single source of truth
- Validate ALL request bodies with Zod schemas — never trust raw input
- Extract Bearer tokens from `Authorization` header; return 401 for missing/invalid
- Use `c.executionCtx.waitUntil()` for background work — always with `PromiseTracker`
- All API responses validated against response schemas before sending

## KV Storage

- Three KV namespaces: `SESSIONS` (4h TTL), `AUDIO_FEATURES_CACHE` (90d/5min TTL), `MIX_SESSIONS` (8h TTL)
- ALWAYS set `expirationTtl` on KV puts; never store without expiration
- Cache null/miss results with 5-minute TTL to avoid hammering external APIs
- Validate KV reads with Zod `.safeParse()` — never trust stored data shape
- KV reads are eventually consistent; design for stale reads

## Rate Limiting

- Global limit: 40 RPS across all external APIs
- Per-lane concurrency: Anthropic 2, Spotify 5, Last.fm 10, Deezer 10
- Use `RequestOrchestrator` for coordinating global rate + per-lane concurrency
- Track subrequest budget (950 limit, reserve 10 for overhead)

## Error Handling

- All enrichment is best-effort and non-blocking
- Log with structured JSON via `ServiceLogger` with per-request IDs
- Return SSE error events for recoverable errors; close stream for fatal
- Never expose internal error details to clients

## Worker Configuration

- Entry point: `workers/api/dist/index.js` built by tsup
- Platform: `browser` (V8 isolate); external Node stdlib modules
- Target: `es2024`
- Static assets from `apps/web/dist` with SPA fallback
- `run_worker_first: ["/api/*"]` — API routes take precedence
