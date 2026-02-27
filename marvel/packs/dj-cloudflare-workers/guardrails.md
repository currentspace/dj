# DJ Cloudflare Workers

Cloudflare Workers patterns, Hono routing, SSE streaming, KV storage, and rate limiting for the DJ API worker.

## SSE Streaming (Critical)

- Always use `TransformStream` with `highWaterMark: 10` to prevent memory bloat during slow client consumption
- Set required headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`
- Return `new Response(readable, { headers })` immediately; process asynchronously via the writable side
- Send heartbeats every 15 seconds (`: heartbeat\n\n`) to keep connections alive through proxies
- Serialize SSE writes through a queue to prevent concurrent writes to the writable stream
- Handle client disconnect by checking the abort signal; clean up resources on disconnect

```typescript
// CORRECT - Immediate response with async processing
const { readable, writable } = new TransformStream(undefined, { highWaterMark: 10 })
const response = new Response(readable, { headers: sseHeaders })
ctx.executionCtx.waitUntil(processAsync(writable, request))
return response
```

## Hono Route Patterns

- Use `@hono/zod-openapi` for route definitions; Zod schemas are the single source of truth
- Register routes with `app.route('/api/prefix', router)` in the main index
- Validate request bodies with Zod schemas; max message length 2000 chars
- Extract Bearer tokens from `Authorization` header; return 401 for missing/invalid tokens
- Use `c.executionCtx.waitUntil()` for background work that should survive the response

## KV Storage

- Three KV namespaces: `SESSIONS` (4h TTL), `AUDIO_FEATURES_CACHE` (90d/5min TTL), `MIX_SESSIONS` (8h TTL)
- Always set `expirationTtl` on KV puts; never store data without expiration
- Cache even null/miss results with short TTL (5 minutes) to avoid hammering external APIs
- Key format conventions: `bpm:{track_id}`, `lastfm:{hash}`, `artist_{hash}`, `mix:{userId}`
- KV reads are eventually consistent; design for stale reads gracefully

## Rate Limiting

- Global limit: 40 requests per second across all external API calls
- Use `RateLimitedQueue` with token bucket algorithm (40 tokens/sec, burst 40)
- Per-lane concurrency limits: Anthropic 2, Spotify 5, Last.fm 10, Deezer 10
- Use `RequestOrchestrator` for coordinating global rate + per-lane concurrency
- Track subrequest budget per request (950 limit for paid tier, reserve 10 for overhead)

## Subrequest Budget

- Cloudflare paid tier allows 1000 subrequests per worker invocation
- Use `SubrequestTracker` to monitor budget; allocate 50% to Deezer, remainder to Last.fm
- Each Last.fm track enrichment costs 4 API calls (correction, info, tags, similar)
- Each Deezer enrichment costs 1 API call (ISRC lookup); mostly cached after first run
- Always check remaining budget before starting enrichment batches

## Error Handling

- All enrichment (Deezer, Last.fm) is best-effort and non-blocking; failures should not break the main response
- Log errors with `ServiceLogger` using structured JSON format with per-request IDs
- Use `AsyncLocalStorage` via `nodejs_compat` flag for per-request context (logger, subrequest tracker)
- Return SSE error events to the client for recoverable errors; close stream for fatal errors

## Worker Configuration

- Entry point: `workers/api/dist/index.js` built by tsup
- Platform: `browser` (V8 isolate, not Node.js); external Node stdlib modules
- Static assets served from `apps/web/dist` with SPA fallback
- `run_worker_first: ["/api/*"]` is critical — API routes must take precedence over static assets
- Never import Node-only modules (fs, child_process, net) in worker code
