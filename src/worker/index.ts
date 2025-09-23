import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { anthropicRouter } from './routes/anthropic'
import { spotifyRouter } from './routes/spotify'
import { playlistRouter } from './routes/playlist'

export interface Env {
  ANTHROPIC_API_KEY: string
  SPOTIFY_CLIENT_ID: string
  SPOTIFY_CLIENT_SECRET: string
  ENVIRONMENT: string
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

// Health check
app.get('/health', (c) => c.json({ status: 'healthy' }))

// API routes
app.route('/api/anthropic', anthropicRouter)
app.route('/api/spotify', spotifyRouter)
app.route('/api/playlist', playlistRouter)

// Serve static files in production
app.get('*', async (c) => {
  // In production, serve the built React app
  // This would be handled by Cloudflare Pages or your static hosting
  return c.text('Not found', 404)
})

export default app