# DJ - AI Playlist Generator

An AI-powered DJ app that creates Spotify playlists using Anthropic's Claude API.

## Features

- **Conversational AI DJ**: Chat with Claude to create personalized playlists
- **Real-time Streaming**: Server-Sent Events (SSE) for live responses
- **Spotify Integration**: Direct playlist creation, search, and audio analysis
- **MCP Protocol**: Advanced tool calling for iterative playlist curation
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
ENVIRONMENT=development
```

**Important**: Never commit `.dev.vars` to git.

3. Run development servers:
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
- **Storage**: Cloudflare KV (session management)
- **Build**: pnpm monorepo with workspace dependencies
- **Deployment**: Cloudflare Workers with static assets