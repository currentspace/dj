# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

DJ is an AI-powered playlist generator that creates personalized Spotify playlists through conversational chat. The app combines Anthropic's Claude API with Spotify's Web API, deployed on Cloudflare Workers with a React 19.1 frontend.

**Key Features:**
- Conversational AI DJ assistant using Langchain + Claude
- Real-time streaming responses via Server-Sent Events (SSE)
- Direct Spotify API integration for playlist creation and analysis
- Model Context Protocol (MCP) server for advanced tool calling
- Global edge deployment on Cloudflare Workers

## Architecture

This is a **pnpm monorepo** organized by architectural layers:

```
dj/
├── apps/
│   └── web/                 # React 19.1 frontend (@dj/web)
│       ├── src/
│       │   ├── app/        # App-level components
│       │   ├── components/ # Shared UI components
│       │   ├── features/   # Feature modules (auth, chat, playlist)
│       │   ├── hooks/      # Custom React hooks
│       │   ├── lib/        # API clients and utilities
│       │   ├── pages/      # Page components
│       │   └── styles/     # Global styles
│       └── vite.config.ts
│
├── packages/
│   ├── api-client/         # Shared API client (@dj/api-client)
│   └── shared-types/       # Shared TypeScript types (@dj/shared-types)
│
├── workers/
│   ├── api/                # Main API worker (@dj/api-worker)
│   │   ├── src/
│   │   │   ├── routes/    # API endpoints
│   │   │   └── lib/       # Utilities
│   │   └── wrangler.jsonc
│   └── webhooks/           # Webhook handler (@dj/webhook-worker)
│
└── scripts/                # Build utilities
```

## Development Commands

**CRITICAL: This project uses pnpm. Always use pnpm, never npm or yarn.**

```bash
# Install dependencies
pnpm install

# Development (all services in parallel)
pnpm dev                    # Both frontend (port 3000) and API (port 8787)
pnpm dev:web               # Only frontend (port 3000)
pnpm dev:api               # Only API worker (port 8787)

# Build & Deploy
pnpm build                 # Build all packages
pnpm build:worker          # Build worker with dependencies
pnpm deploy                # Build and deploy to Cloudflare

# Code Quality
pnpm typecheck             # Type check all packages
pnpm lint                  # ESLint
pnpm test                  # Run tests
```

## Key Technology Stack

### Frontend
- **Framework**: React 19.1 with TypeScript
- **Build Tool**: Vite 7.1
- **UI Components**: Ark UI React
- **Styling**: CSS Modules + Global CSS
- **State**: React hooks + localStorage
- **API Client**: Custom client with SSE support

### Backend
- **Runtime**: Cloudflare Workers
- **Framework**: Hono 4.9
- **AI**: Langchain + Anthropic Claude (via @langchain/anthropic)
- **MCP**: @langchain/mcp-adapters for tool integration
- **Storage**: Cloudflare KV (session management)
- **Build**: tsup

### APIs & Protocols
- **Anthropic Claude API**: AI conversation and tool calling
- **Spotify Web API**: Music search, playlist management, audio features
- **MCP (Model Context Protocol)**: Enables Claude to call Spotify tools directly
- **SSE (Server-Sent Events)**: Real-time streaming responses

## API Routes

### Core Chat Endpoints
- **POST /api/chat-stream/message** - Main SSE streaming chat endpoint (production)
- **POST /api/chat/message** - Non-streaming chat endpoint

### Spotify Tools (via Claude)

**Iterative Data Fetching:**
1. **analyze_playlist** - Returns summary only (avg metrics + track IDs)
2. **get_playlist_tracks** - Paginated track fetching (20-50 at a time)
3. **get_track_details** - Full metadata for specific tracks (album art, etc.)
4. **get_audio_features** - Audio characteristics (tempo, energy, danceability)
5. **search_spotify_tracks** - Search Spotify catalog
6. **get_recommendations** - AI-powered recommendations
7. **create_playlist** - Create new playlist

This iterative approach allows Claude to fetch only what's needed, avoiding payload bloat.

### MCP Server (Model Context Protocol)
- **POST /api/mcp/session/create** - Create session after Spotify auth
- **POST /api/mcp/session/destroy** - Destroy session
- **POST /api/mcp/initialize** - Initialize MCP connection
- **POST /api/mcp/tools/list** - List available tools
- **POST /api/mcp/tools/call** - Execute a tool
- **POST /api/mcp/resources/list** - List playlists
- **POST /api/mcp/resources/read** - Read playlist details

### Testing & Status
- **GET /api/sse-test/simple** - Basic SSE test (no auth)
- **POST /api/sse-test/post-stream** - POST SSE test
- **GET /api/chat-test/*** - Chat testing endpoints
- **GET /api/anthropic/status** - Check Anthropic API status
- **GET /health** - Health check

## Environment Variables & Secrets

### Production (Cloudflare Workers)
Set via `wrangler secret put` or GitHub Actions:
- `ANTHROPIC_API_KEY` - Claude API key (get from console.anthropic.com)
- `SPOTIFY_CLIENT_ID` - Spotify app ID
- `SPOTIFY_CLIENT_SECRET` - Spotify app secret
- `ENVIRONMENT` - Set to "production" (in wrangler.jsonc vars)
- `FRONTEND_URL` - "https://dj.current.space" (in wrangler.jsonc vars)

### Development (Local)
Create `.dev.vars` in `workers/api/`:

```
ANTHROPIC_API_KEY=sk-ant-...
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
ENVIRONMENT=development
```

**NEVER commit `.dev.vars` to git.**

## Cloudflare Infrastructure

### KV Namespaces (Session Storage)
- **Production**: `c81455430c6d4aa2a5da4bf2c1fcd3a2`
- **Preview**: `859d29ec06564975a30d67be3a960b89`
- **TTL**: 4 hours for session tokens
- **Purpose**: Store Spotify token → session token mappings for MCP security

### Worker Configuration (wrangler.jsonc)
- **Entry Point**: `workers/api/dist/index.js`
- **Static Assets**: `apps/web/dist` (React build)
- **Compatibility**: nodejs_compat flag enabled
- **SPA Routing**: `not_found_handling: "single-page-application"`
- **API Priority**: `run_worker_first: ["/api/*"]` (critical for routing)

## Spotify Integration

### OAuth Configuration
- **Flow**: OAuth2 implicit grant flow
- **Redirect URI**: `https://dj.current.space/callback`
- **Token Storage**: localStorage (client-side)
- **Required Scopes**:
  - `playlist-modify-public` - Create public playlists
  - `playlist-modify-private` - Create private playlists
  - `user-read-private` - Read user profile
  - `user-read-email` - Read user email
  - `playlist-read-private` - Read user's private playlists
  - `playlist-read-collaborative` - Read collaborative playlists
  - `user-read-playback-state` - Read playback state
  - `user-read-currently-playing` - Read currently playing
  - `user-read-recently-played` - Read recently played
  - `user-top-read` - Read top artists and tracks

### Iterative Data Fetching Strategy
**IMPORTANT**: Instead of sending all data at once, use a 3-tier approach:

**Tier 1: Summary (analyze_playlist)**
- Returns: playlist name, description, total tracks, average audio metrics, track IDs only
- Size: ~500 bytes regardless of playlist size
- Use when: User asks for high-level info (tempo, energy, vibe)

**Tier 2: Compact Tracks (get_playlist_tracks)**
- Returns: name, artists, duration, popularity, album name per track
- Size: ~100 bytes per track (paginated batches of 20-50)
- Use when: User wants to see track names, artists, basic info

**Tier 3: Full Details (get_track_details)**
- Returns: Complete track metadata including album art, release dates, external URLs
- Size: ~2.5KB per track (fetch selectively)
- Use when: User asks for specific details about particular tracks

This prevents the 55KB payload issue while giving Claude flexibility to fetch what's actually needed.

## Conversation Flow

### Chat Streaming Flow (SSE)
1. User sends message → `ChatInterface.tsx`
2. Frontend calls `POST /api/chat-stream/message` with conversation history
3. Worker creates TransformStream and returns Response(readable) immediately
4. Async processing:
   - Initialize Langchain with Claude
   - Stream responses as SSE events
   - Execute Spotify tool calls when needed
   - Send compact tool results to Claude
5. Frontend parses SSE events and updates UI in real-time

### SSE Event Types
- `thinking` - Claude is processing
- `content` - Text response chunks
- `tool_start` - Tool execution started
- `tool_end` - Tool execution completed
- `done` - Stream finished
- Heartbeats: `: heartbeat\n\n`

### MCP Integration Flow
1. User logs in with Spotify → get access token
2. Backend creates session token → stores in KV
3. Session token + MCP server URL sent to frontend
4. Claude configured with MCP server
5. Claude can call Spotify tools directly during conversation
6. Session expires after 4 hours

## Deployment

### Automatic Deployment (GitHub Actions)
Push to `main` branch triggers automatic deployment.

**Required GitHub Secrets** (Settings → Secrets and variables → Actions):
- `CLOUDFLARE_API_TOKEN` - From dash.cloudflare.com/profile/api-tokens
- `CLOUDFLARE_ACCOUNT_ID` - 32-char ID from dashboard
- `ANTHROPIC_API_KEY` - From console.anthropic.com
- `SPOTIFY_CLIENT_ID` - From developer.spotify.com
- `SPOTIFY_CLIENT_SECRET` - From developer.spotify.com

### Manual Deployment
```bash
# Set secrets (one-time)
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put SPOTIFY_CLIENT_ID
wrangler secret put SPOTIFY_CLIENT_SECRET

# Deploy
pnpm run deploy
```

### Production URL
https://dj.current.space

## Monorepo Best Practices

### Dependency Management
- Use `workspace:*` protocol for internal packages
- Shared types go in `@dj/shared-types`
- Shared utilities go in `@dj/api-client`
- Run `pnpm install` from root only

### Feature Organization
Organize by feature, not file type:
```
features/
├── chat/
│   ├── ChatInterface.tsx
│   ├── ChatStreaming.tsx
│   └── chat.types.ts
```

### Build Order
The build process must follow dependency order:
1. `@dj/shared-types` (no dependencies)
2. `@dj/api-client` (depends on shared-types)
3. `@dj/web` (depends on both)
4. `@dj/api-worker` (depends on shared-types)

The `build:worker` script handles this automatically.

## Common Development Tasks

### Adding a New Route
1. Create route file in `workers/api/src/routes/`
2. Define router with Hono
3. Register in `workers/api/src/index.ts`:
   ```typescript
   import { myRouter } from './routes/my-route'
   app.route('/api/my-route', myRouter)
   ```

### Adding a New Spotify Tool
1. Define tool in `workers/api/src/routes/mcp.ts`
2. Add to MCP tools list
3. Implement handler with Spotify API call
4. Return compact data (strip unnecessary fields)

### Debugging SSE Streams
1. Check browser console for `[ChatStream]` logs
2. Check worker logs for `[Stream:{id}]` logs
3. Use test endpoints: `/api/sse-test/simple`
4. See `SSE_DEBUGGING_GUIDE.md` for comprehensive guide

### Testing Locally
```bash
# Terminal 1: Start API worker
pnpm dev:api

# Terminal 2: Start React frontend
pnpm dev:web

# Open http://localhost:3000
```

## Important Notes

### DO
- Use pnpm for all package operations
- Follow feature-based organization in apps/web
- Strip verbose Spotify data before sending to Claude
- Use SSE for real-time streaming responses
- Store sensitive tokens in KV with TTL
- Use `workspace:*` for internal dependencies
- Test SSE endpoints independently
- Keep conversation history in frontend state

### DON'T
- Don't use npm or yarn
- Don't commit `.dev.vars` files
- Don't send full Spotify track objects to Claude
- Don't expose Spotify tokens to client
- Don't create duplicate directory structures
- Don't bypass workspace protocol for internal deps
- Don't skip error handling in SSE streams
- Don't forget to clean up sessions on logout

## Troubleshooting

### SSE Not Working
1. Verify headers: `Content-Type: text/event-stream`
2. Check TransformStream creation
3. Test with `/api/sse-test/simple`
4. See `SSE_DEBUGGING_GUIDE.md`

### 401 Unauthorized
1. Check Spotify token in localStorage
2. Verify token hasn't expired
3. Check Authorization header format: `Bearer {token}`

### Claude Responses Too Large
1. Check tool result sizes in logs
2. Strip unnecessary fields from API responses
3. Send summaries instead of raw data
4. See `SPOTIFY_TRACK_ANALYSIS.md`

### Build Failures
1. Ensure correct build order (shared-types → api-client → web → api-worker)
2. Run `pnpm install` from root
3. Clear `node_modules` and reinstall if needed
4. Check TypeScript errors with `pnpm typecheck`

## Additional Documentation

- **ARCHITECTURE.md** - Detailed monorepo structure and best practices
- **README.md** - User-facing setup and deployment guide
- **DEPLOYMENT.md** - GitHub Actions and manual deployment
- **MCP_SETUP.md** - Model Context Protocol implementation
- **SSE_DEBUGGING_GUIDE.md** - Comprehensive SSE troubleshooting
- **SPOTIFY_TRACK_ANALYSIS.md** - Spotify API data optimization