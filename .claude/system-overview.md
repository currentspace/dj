# DJ System Overview (November 2025)

This document provides a high-level architecture overview for Claude Code to reference when working on this codebase.

## Quick Reference

| Layer | Technology | Key Files |
|-------|------------|-----------|
| **Frontend** | React 19.2 + Vite 7.1 | `apps/web/src/` |
| **Backend** | Cloudflare Workers + Hono | `workers/api/src/` |
| **AI** | Claude Sonnet 4.5 + Haiku 4.5 | `chat-stream.ts` |
| **Data** | Spotify + Deezer + Last.fm | `services/*.ts` |
| **State** | KV + AsyncLocalStorage | `utils/*.ts` |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                   │
│  React 19.2 + TypeScript + Vite                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ ChatInterface│  │UserPlaylists│  │  AuthHook   │                 │
│  │  (SSE client)│  │ (selection) │  │ (OAuth)     │                 │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │
│         │                │                │                          │
│         └────────────────┼────────────────┘                          │
│                          │                                           │
│                    SSE Stream                                        │
└──────────────────────────┼──────────────────────────────────────────┘
                           │
                    Cloudflare Edge
                           │
┌──────────────────────────┼──────────────────────────────────────────┐
│                          ▼                                           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                  CLOUDFLARE WORKER                             │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │              chat-stream.ts (3817 lines)                 │  │  │
│  │  │  • SSEWriter (queued streaming)                         │  │  │
│  │  │  • Tool definitions (12 tools)                          │  │  │
│  │  │  • Agentic loop (max 5 turns)                           │  │  │
│  │  │  • Rate limiting (40 RPS)                               │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                           │                                    │  │
│  │        ┌──────────────────┼──────────────────┐                │  │
│  │        ▼                  ▼                  ▼                │  │
│  │  ┌──────────┐      ┌──────────┐      ┌──────────┐            │  │
│  │  │ Anthropic│      │ Spotify  │      │Enrichment│            │  │
│  │  │   API    │      │   API    │      │ Services │            │  │
│  │  │(Claude)  │      │          │      │          │            │  │
│  │  └──────────┘      └──────────┘      └────┬─────┘            │  │
│  │                                           │                   │  │
│  │                              ┌────────────┼────────────┐      │  │
│  │                              ▼            ▼            ▼      │  │
│  │                        ┌────────┐   ┌────────┐   ┌────────┐  │  │
│  │                        │ Deezer │   │Last.fm │   │MusicBrz│  │  │
│  │                        │  API   │   │  API   │   │  API   │  │  │
│  │                        └────────┘   └────────┘   └────────┘  │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │                    KV STORAGE                            │  │  │
│  │  │  • SESSIONS (4h TTL) - OAuth tokens                     │  │  │
│  │  │  • AUDIO_FEATURES_CACHE (90d/5m TTL) - Enrichment       │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Patterns Summary

### React 19.2 Patterns

| Pattern | Description | Reference |
|---------|-------------|-----------|
| **Direct State Sync** | No useEffect for prop-to-state | `ChatInterface.tsx:37-41` |
| **useSyncExternalStore** | Auth state management | `useSpotifyAuth.ts` |
| **useTransition** | Non-blocking mode changes | `ChatInterface.tsx:32` |
| **Map for Per-Entity State** | Conversations per playlist | `ChatInterface.tsx:29-30` |
| **flushSync** | Immediate DOM for scroll | `ChatInterface.tsx:88-96` |

See: [React 19 Guidelines](guidelines/react-19.md)

### LLM/Claude Patterns

| Pattern | Description | Reference |
|---------|-------------|-----------|
| **Extended Thinking** | 5000 token budget (initial call) | `chat-stream.ts:2913-2916` |
| **Tool-Bound Streaming** | Tools emit SSE progress | `chat-stream.ts:270-520` |
| **Three-Tier Data** | Summary → Compact → Full | `chat-stream.ts:436-520` |
| **Agentic Loop** | Max 5 turns with loop detection | `chat-stream.ts:3079-3112` |
| **Prompt Caching** | System prompt cached | `chat-stream.ts:2906-2908` |

See: [LLM Prompts Guidelines](guidelines/llm-prompts.md)

### Cloudflare Workers Patterns

| Pattern | Description | Reference |
|---------|-------------|-----------|
| **TransformStream SSE** | Immediate response + async | `chat-stream.ts:2537-2548` |
| **SSEWriter Queue** | Serialized writes | `chat-stream.ts:151-226` |
| **Three-Layer Rate Limiting** | RPS + Lane + Budget | `RequestOrchestrator.ts` |
| **AsyncLocalStorage** | Per-request context | `LoggerContext.ts` |
| **Differential TTL** | 90d hits, 5m misses | `AudioEnrichmentService.ts` |

See: [Cloudflare Workers Guidelines](guidelines/cloudflare-workers.md)

### Tool/MCP Patterns

| Pattern | Description | Reference |
|---------|-------------|-----------|
| **Native Tool Interface** | Lightweight, no Langchain | `chat-stream.ts:15-21` |
| **Zod + zodToJsonSchema** | Type-safe tool schemas | `chat-stream.ts:231-251` |
| **Auto-Injection** | Context-aware parameters | `chat-stream.ts:355-370` |
| **Vibe-Driven Discovery** | 5-phase AI workflow | `chat-stream.ts` |
| **Compact Results** | 96% size reduction | `chat-stream.ts:436-520` |

See: [Tools/MCP Guidelines](guidelines/tools-mcp.md)

## File Structure

```
dj/
├── .claude/
│   ├── system-overview.md       # This file
│   └── guidelines/
│       ├── react-19.md          # React 19.2 patterns
│       ├── llm-prompts.md       # LLM/Claude patterns
│       ├── cloudflare-workers.md # Workers patterns
│       └── tools-mcp.md         # Tool architecture
│
├── apps/
│   └── web/                     # React frontend
│       └── src/
│           ├── features/
│           │   ├── chat/        # ChatInterface, streaming
│           │   ├── auth/        # Login components
│           │   └── playlist/    # UserPlaylists, TrackList
│           ├── hooks/           # useSpotifyAuth
│           └── lib/             # ChatStreamClient
│
├── workers/
│   └── api/                     # Cloudflare Worker
│       └── src/
│           ├── routes/
│           │   └── chat-stream.ts  # Main handler (3817 lines)
│           ├── services/
│           │   ├── AudioEnrichmentService.ts
│           │   └── LastFmService.ts
│           ├── utils/
│           │   ├── RequestOrchestrator.ts
│           │   ├── RateLimitedQueue.ts
│           │   └── SubrequestTracker.ts
│           └── lib/
│               └── progress-narrator.ts
│
└── packages/
    ├── shared-types/            # TypeScript interfaces
    └── api-client/              # Shared API client
```

## Critical Implementation Details

### Rate Limiting (40 RPS Cloudflare Limit)

```typescript
// Layer 1: Global token bucket
const rateLimiter = new RateLimitedQueue(40)  // 40 RPS

// Layer 2: Per-service concurrency
const LANE_LIMITS = {
  anthropic: 2,   // SDK limitation
  spotify: 5,
  deezer: 10,
  lastfm: 10,
}

// Layer 3: Subrequest budget
const tracker = new SubrequestTracker({ maxSubrequests: 950 })
```

### SSE Event Types

```typescript
type StreamEvent =
  | { type: 'content', data: string }      // Text from Claude
  | { type: 'thinking', data: string }     // Progress messages
  | { type: 'tool_start', data: ToolData } // Tool execution start
  | { type: 'tool_end', data: ToolResult } // Tool completion
  | { type: 'log', data: LogData }         // Debug logs
  | { type: 'error', data: string }        // Error messages
  | { type: 'done', data: null }           // Stream complete
```

### Tool Result Size Strategy

```
BEFORE: analyze_playlist → 55KB (full track objects)
AFTER:  analyze_playlist → 2.5KB (aggregated summary)

Tier 1: Summary (2-5KB) - analyze_playlist
Tier 2: Compact (100 bytes/track) - get_playlist_tracks
Tier 3: Full (2.5KB/track) - get_track_details
```

### Vibe-Driven Discovery Flow

```
1. analyze_playlist    → Enriched metadata
2. extract_playlist_vibe (AI) → Vibe profile
3. plan_discovery_strategy (AI) → Search plan
4. [parallel execution] → Candidate tracks
5. curate_recommendations (AI) → Top N picks
```

## Quick Commands

```bash
# Development
pnpm dev              # Both frontend + API
pnpm dev:web          # Frontend only (port 3000)
pnpm dev:api          # API only (port 8787)

# Testing
pnpm test             # All tests
pnpm typecheck        # TypeScript check
pnpm lint             # ESLint

# Deployment (automatic via git push)
git add -A && git commit -m "message" && git push
```

## Environment Variables

### Required

- `ANTHROPIC_API_KEY` - Claude API key
- `SPOTIFY_CLIENT_ID` - Spotify app ID
- `SPOTIFY_CLIENT_SECRET` - Spotify app secret

### Optional

- `LASTFM_API_KEY` - Last.fm API key (for crowd-sourced tags)
- `ENVIRONMENT` - "development" or "production"
- `FRONTEND_URL` - Production URL for CORS

## Key Constraints

| Constraint | Value | Source |
|------------|-------|--------|
| Cloudflare subrequests | 1000/request | Platform |
| Rate limit | 40 RPS | Cloudflare Workers |
| Anthropic concurrency | 2 | SDK limitation in Workers |
| Max conversation history | 20 messages | Context management |
| Max agentic turns | 5 | Cost control |
| Tool result size | <5KB | Context optimization |
| SSE heartbeat | 15 seconds | Keep-alive |
| Session TTL | 4 hours | OAuth tokens |
| BPM cache TTL | 90 days (hit) / 5 min (miss) | Data freshness |

## Debugging Resources

- **SSE Testing**: `/api/sse-test/simple`
- **Health Check**: `/health`
- **Anthropic Status**: `/api/anthropic/status`
- **OpenAPI Docs**: `/api/docs`
- **Worker Logs**: `pnpm wrangler tail` (in workers/api)

See: `SSE_DEBUGGING_GUIDE.md` for comprehensive SSE troubleshooting.

## What NOT to Do

1. **Never use useEffect for state sync** - Use direct synchronization
2. **Never return full API responses from tools** - Compact first
3. **Never run unlimited agentic loops** - Cap at 5 turns
4. **Never block on cache writes** - Fire and forget
5. **Never run manual deployment** - Git push triggers CI/CD
6. **Never exceed 40 RPS** - Use rate limiter
7. **Never use npm/yarn** - Use pnpm only

## Guidelines Index

- [React 19.2 Guidelines](guidelines/react-19.md) - Frontend patterns
- [LLM/Prompts Guidelines](guidelines/llm-prompts.md) - Claude integration
- [Cloudflare Workers Guidelines](guidelines/cloudflare-workers.md) - Backend patterns
- [Tools/MCP Guidelines](guidelines/tools-mcp.md) - Tool architecture
- [Testing Guidelines](guidelines/testing.md) - Vitest 4.x patterns, contract tests, integration tests

## Testing Commands

```bash
# Unit tests (fast, mocked - default)
pnpm --filter @dj/api-worker test --run

# Contract tests (real API schema validation)
pnpm test:contracts --run

# Integration tests (real API service behavior)
pnpm test:integration --run
```

## Last Updated

November 2025 - Synthesized from comprehensive codebase analysis.
