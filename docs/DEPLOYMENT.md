# Deployment Guide

## GitHub Secrets Required

To enable automatic deployment via GitHub Actions, you need to configure the following secrets in
your GitHub repository settings:

### Required Secrets

Go to **Settings → Secrets and variables → Actions** in your GitHub repository and add:

1. **`CLOUDFLARE_API_TOKEN`**
   - Get from: [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
   - Create a custom token with permissions:
     - Account: Cloudflare Workers Scripts:Edit
     - Zone: Zone:Read, Cache Purge:Purge

2. **`CLOUDFLARE_ACCOUNT_ID`**
   - Find in: [Cloudflare Dashboard](https://dash.cloudflare.com) → Right sidebar
   - 32-character string

3. **`ANTHROPIC_API_KEY`**
   - Get from: [Anthropic Console](https://console.anthropic.com/settings/keys)
   - Format: `sk-ant-...`

4. **`SPOTIFY_CLIENT_ID`**
   - Get from: [Spotify App Dashboard](https://developer.spotify.com/dashboard)
   - Create an app if you haven't already

5. **`SPOTIFY_CLIENT_SECRET`**
   - Get from: Same Spotify app dashboard
   - Click "Show Client Secret"

### Spotify App Configuration

In your Spotify app settings, add the redirect URI:

```
https://dj.current.space/callback
```

## Manual Deployment

If you prefer to deploy manually:

```bash
# Set secrets locally (one time)
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put SPOTIFY_CLIENT_ID
wrangler secret put SPOTIFY_CLIENT_SECRET

# Deploy
pnpm run deploy
```

## Deployment Workflow

The GitHub Action will automatically:

1. Run on every push to `main`
2. Install dependencies
3. Run type checking
4. Build the React app
5. Deploy Worker with secrets to Cloudflare
6. Make the app available at https://dj.current.space

## Troubleshooting

If deployment fails:

1. Check GitHub Actions logs for specific errors
2. Verify all secrets are correctly set
3. Ensure Cloudflare API token has correct permissions
4. Verify `wrangler.toml` configuration matches your Cloudflare setup

## Environment Variables

- **Production**: Secrets are injected by GitHub Actions
- **Development**: Use `.dev.vars` file in `workers/api/` directory (never commit this)

### Development .dev.vars

Create `workers/api/.dev.vars`:

```
ANTHROPIC_API_KEY=sk-ant-...
SPOTIFY_CLIENT_ID=your_id
SPOTIFY_CLIENT_SECRET=your_secret
ENVIRONMENT=development
```

## Deployment Configuration

The project uses the root `wrangler.jsonc` file for production deployment:

- **Main entry**: `workers/api/dist/index.js`
- **Static assets**: `apps/web/dist` (React build)
- **KV namespace**: `SESSIONS` binding for session storage
- **Build command**: `pnpm run build:worker`
- **Worker-first routing**: API routes (`/api/*`) handled by worker before static assets

### Important Routing Configuration

The `run_worker_first: ["/api/*"]` setting is critical - it ensures API routes are handled by the
worker before attempting to serve static files.
