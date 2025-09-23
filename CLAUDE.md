# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DJ is an AI-powered playlist generator that combines Anthropic's Claude API with Spotify's Web API to create personalized playlists. The app runs on Cloudflare Workers with a React 19.1 frontend.

## Development Commands

**IMPORTANT: This project uses pnpm as the package manager. Always use pnpm instead of npm or yarn.**

```bash
# Install dependencies
pnpm install

# Development
pnpm run dev          # Start both React frontend (port 3000) and API worker (port 8787)
pnpm run dev:web      # Start only React frontend (port 3000)
pnpm run dev:api      # Start only API worker (port 8787)

# Build & Deploy
pnpm run build        # Build React app
pnpm run deploy       # Build and deploy to Cloudflare

# Code Quality
pnpm run typecheck    # Type checking
pnpm run lint         # ESLint
```

## Architecture

### Frontend (web/)
- **React 19.1** with TypeScript
- **Vite** for build tooling
- Located in `web/src/`
- Components in `web/src/components/`
- API client in `web/src/lib/api.ts`
- Spotify auth hook in `web/src/hooks/useSpotifyAuth.ts`

### Backend (workers/api/)
- **Cloudflare Worker** using Hono framework
- Routes organized in `workers/api/src/routes/`
  - `/api/anthropic` - AI playlist generation
  - `/api/spotify` - Spotify authentication and search
  - `/api/playlist` - Combined playlist generation and saving

### API Keys & Secrets
Production secrets set via Wrangler:
- `ANTHROPIC_API_KEY` - Claude API access
- `SPOTIFY_CLIENT_ID` - Spotify app ID
- `SPOTIFY_CLIENT_SECRET` - Spotify app secret

For local development, create `.dev.vars` files in worker directories:

**workers/api/.dev.vars:**
```
ANTHROPIC_API_KEY=your_anthropic_api_key_here
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
ENVIRONMENT=development
```

**workers/webhooks/.dev.vars:**
```
ENVIRONMENT=development
```

## Key Workflows

### Playlist Generation Flow (Chat-based)
1. User chats with AI DJ assistant → React ChatInterface
2. Frontend calls `/api/chat/message` with conversation history
3. Worker uses Langchain + Anthropic Claude to understand context and generate responses
4. When ready, Claude generates structured playlist JSON
5. Worker searches Spotify for matching tracks and enriches metadata
6. Returns conversational response + playlist data to frontend
7. User can save playlist to their Spotify account

### Spotify Authentication
- OAuth2 implicit flow
- Redirect URI: `https://dj.current.space/callback`
- Token stored in localStorage
- Scopes: playlist-modify-public/private, user-read-private

## Deployment

Deployed to `dj.current.space` via Cloudflare Workers.

Configuration in `wrangler.toml`:
- Worker serves API routes
- Static React build served from `dist/`
- Secrets managed via `wrangler secret put`