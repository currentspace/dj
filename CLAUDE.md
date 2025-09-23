# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DJ is an AI-powered playlist generator that combines Anthropic's Claude API with Spotify's Web API to create personalized playlists. The app runs on Cloudflare Workers with a React 19.1 frontend.

## Development Commands

```bash
# Install dependencies
npm install

# Development
npm run dev          # Start React frontend (port 3000)
npm run worker:dev   # Start Cloudflare Worker (port 8787)

# Build & Deploy
npm run build        # Build React app
npm run deploy       # Build and deploy to Cloudflare

# Code Quality
npm run typecheck    # Type checking
npm run lint         # ESLint
```

## Architecture

### Frontend (web/)
- **React 19.1** with TypeScript
- **Vite** for build tooling
- Located in `web/src/`
- Components in `web/src/components/`
- API client in `web/src/lib/api.ts`
- Spotify auth hook in `web/src/hooks/useSpotifyAuth.ts`

### Backend (src/worker/)
- **Cloudflare Worker** using Hono framework
- Routes organized in `src/worker/routes/`
  - `/api/anthropic` - AI playlist generation
  - `/api/spotify` - Spotify authentication and search
  - `/api/playlist` - Combined playlist generation and saving

### API Keys & Secrets
Production secrets set via Wrangler:
- `ANTHROPIC_API_KEY` - Claude API access
- `SPOTIFY_CLIENT_ID` - Spotify app ID
- `SPOTIFY_CLIENT_SECRET` - Spotify app secret

For local development, create `.dev.vars` file with these keys.

## Key Workflows

### Playlist Generation Flow
1. User describes desired playlist → Frontend
2. Frontend calls `/api/playlist/generate`
3. Worker queries Claude for song recommendations
4. Worker searches Spotify for matching tracks
5. Returns enriched playlist data to frontend
6. User can save playlist to their Spotify account

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