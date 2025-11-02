# DJ - AI Playlist Generator

An AI-powered DJ app that creates Spotify playlists using Anthropic's Claude API.

## Features

- **Conversational AI DJ**: Chat with Claude to create personalized playlists
- **Real-time Streaming**: Server-Sent Events (SSE) for live responses
- **Spotify Integration**: Direct playlist creation, search, and audio analysis
- **Advanced Playlist Analysis**:
  - BPM detection via Deezer API
  - Crowd-sourced genre tags and popularity via Last.fm
  - Artist biographies and similar artists
  - Smart caching with 90-day TTL (Deezer) and 7-day TTL (Last.fm)
  - Rate-limited at 40 requests/second
- **Vibe-Driven Intelligent Recommendations**:
  - Deep vibe analysis extracts subtle signals (emotional arc, production aesthetic, vocal style)
  - AI creates strategic discovery plan before searching
  - Multi-source discovery (Last.fm community, creative queries, tag blends, Spotify algorithm)
  - Claude Sonnet 4.5-powered intelligent curation with vibe awareness
  - Avoids generic algorithm trap through strategic planning
  - Context-aware ranking (vibe alignment, diversity, user intent)
- **MCP Protocol**: Advanced tool calling for iterative playlist curation
- **Playlist-Scoped Conversations**: Maintains separate conversation history per playlist
- **Edge Deployment**: Cloudflare Workers for global low-latency performance

## Setup

### Prerequisites

- Node.js 18+
- Spotify Developer Account
- Anthropic API Key
- Cloudflare Account
- GitHub repository (for automatic deployment)

### Development

1. Install dependencies:

```bash
pnpm install
```

2. Create `.dev.vars` file in `workers/api/` directory:

```
ANTHROPIC_API_KEY=sk-ant-your_key_here
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
LASTFM_API_KEY=your_lastfm_api_key_optional
ENVIRONMENT=development
```

**Important**: Never commit `.dev.vars` to git.

**Optional**: To enable Last.fm enrichment (crowd-sourced tags, popularity, artist info):

1. Get API key from [Last.fm API Account](https://www.last.fm/api/account/create)
2. Add `LASTFM_API_KEY` to `.dev.vars`
3. Note: Deezer and MusicBrainz require no API keys

4. Run development servers:

```bash
# Terminal 1: Start Cloudflare Worker API
pnpm run dev:api

# Terminal 2: Start React frontend
pnpm run dev:web

# Or run both in parallel
pnpm run dev
```

### Deployment

#### Automatic Deployment (GitHub Actions)

1. Push code to GitHub:

```bash
git push origin main
```

2. Configure GitHub secrets (see `docs/DEPLOYMENT.md` for details):
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `ANTHROPIC_API_KEY`
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`

3. GitHub Actions will automatically deploy on push to `main`

#### Manual Deployment

1. Set production secrets:

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put SPOTIFY_CLIENT_ID
wrangler secret put SPOTIFY_CLIENT_SECRET
```

2. Deploy to Cloudflare:

```bash
pnpm run deploy
```

## Project Structure

```
/
├── apps/
│   └── web/          # React frontend application
│       └── src/
│           ├── components/
│           ├── features/
│           ├── hooks/
│           └── lib/
├── packages/
│   ├── api-client/   # Shared API client
│   └── shared-types/ # Shared TypeScript types
├── workers/
│   ├── api/          # Main Cloudflare Worker backend
│   │   └── src/routes/   # API endpoints
│   └── webhooks/     # Webhook handler worker
└── scripts/          # Build and utility scripts
```

## Tech Stack

- **Frontend**: React 19.1, Vite, TypeScript, Ark UI
- **Backend**: Cloudflare Workers, Hono, Langchain
- **AI**: Anthropic Claude API with streaming
- **APIs**: Spotify Web API, Model Context Protocol (MCP)
- **Data Enrichment**: Deezer API (BPM), Last.fm API (tags, popularity), MusicBrainz (ISRC fallback)
- **Rate Limiting**: Custom RateLimitedQueue (40 TPS)
- **Storage**: Cloudflare KV (session management + enrichment cache)
- **Build**: pnpm monorepo with workspace dependencies
- **Deployment**: Cloudflare Workers with static assets
