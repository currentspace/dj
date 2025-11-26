# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

DJ is an AI-powered playlist generator that creates personalized Spotify playlists through
conversational chat. The app combines Anthropic's Claude API with Spotify's Web API, deployed on
Cloudflare Workers with a React 19.2 frontend.

**Key Features:**

- Conversational AI DJ assistant using Langchain + Claude
- Real-time streaming responses via Server-Sent Events (SSE)
- Direct Spotify API integration for playlist creation and analysis
- Model Context Protocol (MCP) server for advanced tool calling
- Global edge deployment on Cloudflare Workers

## Modern Guidelines (November 2025)

**IMPORTANT**: Before making changes, consult the detailed guidelines in `.claude/`:

- **[System Overview](.claude/system-overview.md)** - High-level architecture and quick reference
- **[React 19.2 Guidelines](.claude/guidelines/react-19.md)** - Frontend patterns (NO useEffect for state sync)
- **[LLM/Prompts Guidelines](.claude/guidelines/llm-prompts.md)** - Claude Sonnet 4.5/Opus 4.5 patterns
- **[Cloudflare Workers Guidelines](.claude/guidelines/cloudflare-workers.md)** - Async streaming patterns
- **[Tools/MCP Guidelines](.claude/guidelines/tools-mcp.md)** - Tool architecture and size optimization

### Key Constraints

| Constraint | Value | Why |
|------------|-------|-----|
| **No useEffect for state sync** | Direct sync in component body | React 19.2 compiler-friendly |
| **Tool result size** | <5KB | Context window optimization |
| **Rate limit** | 40 RPS global | Cloudflare Workers constraint |
| **Max agentic turns** | 5 | Cost control |
| **Anthropic concurrency** | 2 | SDK limitation in Workers |

## Architecture

This is a **pnpm monorepo** organized by architectural layers:

```
dj/
├── apps/
│   └── web/                 # React 19.2 frontend (@dj/web)
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
│   │   │   ├── services/  # Business logic (Last.fm, Deezer enrichment)
│   │   │   ├── lib/       # Utilities (Spotify tools, progress narrator)
│   │   │   └── utils/     # Shared utilities (RateLimitedQueue)
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

- **Framework**: React 19.2 with TypeScript
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
- **Storage**: Cloudflare KV (session management + enrichment cache)
- **Data Enrichment**: Deezer API (BPM, rank, gain), Last.fm API (tags, popularity), MusicBrainz
  (ISRC fallback)
- **Rate Limiting**: Custom RateLimitedQueue (40 TPS)
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

**Core Tools:**

1. **analyze_playlist** - Comprehensive playlist analysis with Deezer + Last.fm enrichment
   - Parameters: `playlist_id` (optional, auto-injected from conversation context)
   - Returns: metadata_analysis, deezer_analysis, lastfm_analysis, track_ids
   - Enriches up to 100 tracks with BPM/rank/gain from Deezer
   - Enriches up to 50 tracks with tags/popularity from Last.fm
   - Automatically fetches unique artist info separately
   - Size: ~2-5KB depending on playlist size

2. **get_playlist_tracks** - Paginated track fetching (20-50 at a time)
   - Parameters: `playlist_id` (optional, auto-injected), `offset` (default 0), `limit` (1-50,
     default 20)
   - Returns: Compact track info (name, artists, duration, popularity, uri, album)
   - Use after analyze_playlist to get actual track names/artists

3. **get_track_details** - Full metadata for specific tracks
   - Parameters: `track_ids` (array of 1-50 track IDs)
   - Returns: Full track objects with album art, release dates, external URLs, preview URLs
   - Use when user asks for specific track details

4. **get_audio_features** - Audio characteristics (tempo, energy, danceability)
5. **search_spotify_tracks** - Search Spotify catalog
6. **get_recommendations** - Spotify's algorithmic recommendations
7. **create_playlist** - Create new playlist

**Vibe-Driven Discovery Tools** (Intelligent recommendation system):

8. **extract_playlist_vibe** - Deep AI vibe analysis
   - Parameters: `analysis_data` (from analyze_playlist), `sample_tracks` (optional 10-20 track
     names)
   - Uses Sonnet 4.5 to extract subtle signals beyond genre tags
   - Analyzes: emotional arc, production aesthetic, vocal style, instrumentation, era feel, mixing
     philosophy
   - Returns: Natural language vibe profile + discovery hints (genre blends, Spotify params, what to
     avoid)
   - Use FIRST to understand playlist essence before discovery

9. **plan_discovery_strategy** - AI-powered discovery planning
   - Parameters: `vibe_profile` (from extract_playlist_vibe), `user_request`,
     `similar_tracks_available` (optional)
   - Uses Sonnet 4.5 to create strategic multi-pronged discovery plan
   - Returns: Prioritized Last.fm tracks, creative Spotify queries, tag combinations, tuned
     recommendation parameters, avoid list
   - Use SECOND to get intelligent search strategy based on vibe

10. **recommend_from_similar** - Convert Last.fm similar tracks to Spotify IDs
    - Parameters: `similar_tracks` (array of "Artist - Track" strings), `limit_per_track` (1-5,
      default 1)
    - Use with strategy.lastfm_similar_priority from plan_discovery_strategy
    - Returns Spotify track objects with IDs

11. **recommend_from_tags** - Genre/tag-based discovery
    - Parameters: `tags` (array of 1-5 tags), `limit` (1-50, default 20)
    - Use with strategy.tag_searches from plan_discovery_strategy
    - Smart query building (genre: prefix for recognized genres)

12. **curate_recommendations** - AI-powered intelligent curation
    - Parameters: `candidate_tracks`, `playlist_context`, `user_request`, `top_n` (default 10)
    - Uses Claude Sonnet 4.5 to rank tracks with vibe awareness
    - Considers vibe alignment, strategic fit, diversity, user intent
    - Returns top N curated picks with detailed reasoning
    - Use LAST after executing discovery strategy

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
- **GET /api/chat-test/\*** - Chat testing endpoints
- **GET /api/anthropic/status** - Check Anthropic API status
- **GET /health** - Health check

## Environment Variables & Secrets

### Production (Cloudflare Workers)

Set via `wrangler secret put` or GitHub Actions:

- `ANTHROPIC_API_KEY` - Claude API key (get from console.anthropic.com)
- `SPOTIFY_CLIENT_ID` - Spotify app ID
- `SPOTIFY_CLIENT_SECRET` - Spotify app secret
- `LASTFM_API_KEY` - (Optional) Last.fm API key for crowd-sourced tags and popularity
- `ENVIRONMENT` - Set to "production" (in wrangler.jsonc vars)
- `FRONTEND_URL` - "https://dj.current.space" (in wrangler.jsonc vars)

### Development (Local)

Create `.dev.vars` in `workers/api/`:

```
ANTHROPIC_API_KEY=sk-ant-...
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
LASTFM_API_KEY=your_lastfm_key_optional
ENVIRONMENT=development
```

**NEVER commit `.dev.vars` to git.**

## Cloudflare Infrastructure

### KV Namespaces

**1. SESSIONS** - OAuth session storage

- **Production**: `c81455430c6d4aa2a5da4bf2c1fcd3a2`
- **Preview**: `859d29ec06564975a30d67be3a960b89`
- **TTL**: 4 hours for session tokens
- **Purpose**: Store Spotify token → session token mappings for MCP security

**2. AUDIO_FEATURES_CACHE** - Enrichment data cache

- **Production**: `eb3657a3d4f045edb31efba6567eca0f`
- **Preview**: `96833dd43ab34769be127f648d29e116`
- **TTL**: 90 days (Deezer BPM/rank/gain), 7 days (Last.fm tags/popularity)
- **Purpose**: Cache BPM data from Deezer, crowd-sourced tags from Last.fm, artist info
- **Keys**: `bpm:{track_id}`, `lastfm:{hash}`, `artist_{hash}`

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

This prevents the 55KB payload issue while giving Claude flexibility to fetch what's actually
needed.

## Data Enrichment Services

### AudioEnrichmentService (Deezer + MusicBrainz)

**File**: `workers/api/src/services/AudioEnrichmentService.ts`

**Purpose**: Enrich tracks with BPM, rank, and gain data from Deezer's free API

**Strategy**:

1. Extract ISRC from Spotify track (`track.external_ids.isrc`)
2. Query Deezer by ISRC: `GET https://api.deezer.com/track/isrc:{isrc}`
3. Fallback: If no ISRC in Spotify, use MusicBrainz to find ISRC by artist+track+duration
4. Cache results in KV with 90-day TTL (even null results to avoid repeat lookups)

**Data Returned**:

- `bpm`: Beats per minute (often null, Deezer data incomplete but available for some tracks)
- `gain`: Audio normalization level in dB
- `rank`: Deezer popularity rank (higher = more popular)
- `release_date`: Full release date from Deezer catalog
- `source`: 'deezer' or 'deezer-via-musicbrainz'

**Rate Limiting**: 40 tracks/second (25ms delay between requests)

**Validation**: BPM must be 45-220 to be considered valid

### LastFmService (Crowd-sourced Data)

**File**: `workers/api/src/services/LastFmService.ts`

**Purpose**: Fetch crowd-sourced tags, popularity, and similarity data

**Strategy**:

1. Get canonical track/artist names via `track.getCorrection`
2. Fetch track info: listeners, playcounts, MBID, album, wiki, duration
3. Fetch top tags: genre/mood/era labels from community
4. Fetch similar tracks: recommendations for transitions
5. Separately batch-fetch unique artist info (bio, tags, similar artists, images)
6. Cache all results with 7-day TTL

**Data Returned per Track**:

- `topTags`: Array of crowd-applied genre/mood tags
- `listeners`: Last.fm listener count
- `playcount`: Total play count
- `similar`: Array of similar tracks with match scores
- `album`: Album title, artist, MBID, URL, image
- `wiki`: Track description, summary, published date
- `artistInfo`: Bio, tags, similar artists, images (fetched separately)

**Optimization**:

- Uses RateLimitedQueue at 40 TPS
- Fetches unique artists separately to avoid N+1 queries (e.g., 50 tracks with 20 unique artists =
  20 API calls instead of 50)
- Updates cache with complete artist info after attachment

**Aggregation Methods**:

- `aggregateTags()`: Combines tags from multiple tracks with counts
- `calculateAveragePopularity()`: Averages listeners/playcounts across playlist

### RateLimitedQueue

**File**: `workers/api/src/utils/RateLimitedQueue.ts`

**Purpose**: Process async tasks at controlled rate to respect API limits

**Configuration**: 40 tasks per second (25ms interval between tasks)

**Implementation**: In-memory queue with precise timing (not sleep-based)

- Tracks exact time since last execution
- Waits only the remaining interval needed
- Supports progress callbacks for streaming updates

**Usage**:

```typescript
const queue = new RateLimitedQueue<T>(40) // 40 TPS
queue.enqueue(async () => {
  /* task */
})
await queue.processAllWithCallback((result, index, total) => {
  // Stream progress to user
})
```

### analyze_playlist Enhanced Return Format

```json
{
  "playlist_name": "string",
  "playlist_description": "string",
  "total_tracks": "number",

  "metadata_analysis": {
    "avg_popularity": "number (0-100)",
    "avg_duration_ms": "number",
    "avg_duration_minutes": "number",
    "explicit_tracks": "number",
    "explicit_percentage": "number",
    "top_genres": ["string"],
    "release_year_range": {
      "oldest": "number",
      "newest": "number",
      "average": "number"
    },
    "total_artists": "number"
  },

  "deezer_analysis": {
    "total_checked": "number",
    "tracks_found": "number",
    "bpm": {
      "avg": "number",
      "range": {"min": "number", "max": "number"},
      "sample_size": "number"
    },
    "rank": {
      /* same structure */
    },
    "gain": {
      /* same structure */
    },
    "source": "deezer"
  },

  "lastfm_analysis": {
    "crowd_tags": [{"tag": "string", "count": "number"}],
    "avg_listeners": "number",
    "avg_playcount": "number",
    "similar_tracks": ["Artist - Track"],
    "sample_size": "number",
    "artists_enriched": "number",
    "source": "lastfm"
  },

  "track_ids": ["spotify:track:..."],
  "message": "string"
}
```

### Integration Flow in chat-stream.ts

1. Fetch playlist metadata (name, description, track count)
2. Fetch tracks from Spotify (up to 100)
3. Calculate metadata analysis (popularity, genres, release years, duration, explicit %)
4. **Deezer enrichment** (if `AUDIO_FEATURES_CACHE` KV available):
   - Process up to 100 tracks at 40 TPS
   - Collect BPM, rank, gain statistics
   - Stream progress every 5 tracks
5. **Last.fm enrichment** (if `LASTFM_API_KEY` configured):
   - Fetch track signals for up to 50 tracks (4 API calls each, no artist info)
   - Deduplicate artists and batch-fetch unique artist info (1 API call each)
   - Attach artist info to track signals and update cache
   - Aggregate tags and calculate average popularity
   - Stream progress every 2 tracks
6. Return comprehensive analysis object

**Error Handling**: All enrichment is best-effort and non-blocking. If Deezer or Last.fm fail,
analysis continues without that data.

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

- `thinking` - Claude is processing (includes progress updates during enrichment)
- `content` - Text response chunks
- `tool_start` - Tool execution started
- `tool_end` - Tool execution completed
- `log` - Development logging (debug mode)
- `debug` - Debug information (debug mode)
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

**CRITICAL: This project uses automatic deployment. DO NOT run manual deployment commands.**

Deployment process:

1. Commit your changes: `git add -A && git commit -m "message"`
2. Push to main: `git push`
3. GitHub Actions automatically deploys to Cloudflare Workers
4. Deployment completes in ~2-3 minutes

**Required GitHub Secrets** (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` - From dash.cloudflare.com/profile/api-tokens
- `CLOUDFLARE_ACCOUNT_ID` - 32-char ID from dashboard
- `ANTHROPIC_API_KEY` - From console.anthropic.com
- `SPOTIFY_CLIENT_ID` - From developer.spotify.com
- `SPOTIFY_CLIENT_SECRET` - From developer.spotify.com

### Production URL

https://dj.current.space

### Setting Secrets (One-time Setup)

For secrets not in GitHub Actions (like optional `LASTFM_API_KEY`):

```bash
wrangler secret put LASTFM_API_KEY
```

**Do not run `pnpm run deploy` - deployment is automatic via git push.**

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
   import {myRouter} from './routes/my-route'
   app.route('/api/my-route', myRouter)
   ```
4. Commit and push to deploy

### Adding a New Spotify Tool

1. Define tool in `workers/api/src/lib/spotify-tools.ts`
2. Add to tools array in `chat-stream.ts`
3. Implement handler with Spotify API call
4. Return compact data (strip unnecessary fields)
5. Commit and push to deploy

### Making React Component Changes

1. **Never use `useEffect`** - Use direct state checks in component body
2. Example pattern:

   ```typescript
   // ✅ CORRECT - Direct state check
   const playlistId = selectedPlaylist?.id || null
   if (playlistId !== currentPlaylistId) {
     setCurrentPlaylistId(playlistId)
   }

   // ❌ WRONG - Never use useEffect
   useEffect(() => {
     setCurrentPlaylistId(selectedPlaylist?.id)
   }, [selectedPlaylist?.id])
   ```

3. Commit and push to deploy

### Debugging SSE Streams

1. Check browser console for `[ChatStream]` logs
2. Check worker logs via `pnpm wrangler tail` in workers/api directory
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

### Deploying Changes

```bash
# Commit changes
git add -A
git commit -m "description"

# Deploy (automatic via GitHub Actions)
git push

# DO NOT run: pnpm run deploy (deployment is automatic)
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
- Use direct state checks in React components (check props/state in component body)
- Commit changes and push to deploy (automatic via GitHub Actions)

### DON'T

- **NEVER use `useEffect` in React components** - Use direct state synchronization in component body
  instead
- **NEVER run `pnpm run deploy` or manual deployment commands** - Deployment happens automatically
  via git push to main branch (Wrangler watches the repo)
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

### Modern Guidelines (.claude/)

- **[System Overview](.claude/system-overview.md)** - Architecture diagram and quick reference
- **[React 19.2 Guidelines](.claude/guidelines/react-19.md)** - Modern React patterns
- **[LLM/Prompts Guidelines](.claude/guidelines/llm-prompts.md)** - Claude integration patterns
- **[Cloudflare Workers Guidelines](.claude/guidelines/cloudflare-workers.md)** - Async streaming patterns
- **[Tools/MCP Guidelines](.claude/guidelines/tools-mcp.md)** - Tool architecture

### Project Documentation

- **ARCHITECTURE.md** - Detailed monorepo structure and best practices
- **README.md** - User-facing setup and deployment guide
- **DEPLOYMENT.md** - GitHub Actions and manual deployment
- **MCP_SETUP.md** - Model Context Protocol implementation
- **SSE_DEBUGGING_GUIDE.md** - Comprehensive SSE troubleshooting
- **SPOTIFY_TRACK_ANALYSIS.md** - Spotify API data optimization
