import {swaggerUI} from '@hono/swagger-ui'
import {OpenAPIHono} from '@hono/zod-openapi'
import {cors} from 'hono/cors'
import {secureHeaders} from 'hono/secure-headers'

import {chatStreamRouter} from './routes/chat-stream'
import {registerMixRoutes} from './routes/mix-openapi'
import {registerPlayerRoutes} from './routes/player-openapi'
import {registerPlayerStreamRoute} from './routes/player-stream'
import {registerPlaylistRoutes} from './routes/playlists-openapi'
import {registerSpotifyAuthRoutes} from './routes/spotify-openapi'

export interface Env {
  ANTHROPIC_API_KEY: string
  ASSETS: Fetcher
  AUDIO_FEATURES_CACHE?: KVNamespace // KV namespace for BPM cache (Deezer + MusicBrainz)
  ENVIRONMENT: string
  FRONTEND_URL?: string // Frontend URL for OAuth redirects
  LASTFM_API_KEY?: string // For Last.fm tags, popularity, and similarity
  MIX_SESSIONS?: KVNamespace // KV namespace for mix session storage
  SESSIONS?: KVNamespace // KV namespace for session storage
  SPOTIFY_CLIENT_ID: string
  SPOTIFY_CLIENT_SECRET: string
}

const app = new OpenAPIHono<{Bindings: Env}>()

// Security headers middleware
app.use(
  '*',
  secureHeaders({
    permissionsPolicy: {
      camera: [],
      geolocation: [],
      microphone: [],
    },
    referrerPolicy: 'strict-origin-when-cross-origin',
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    xXssProtection: '1; mode=block',
  })
)

// CORS middleware with environment-based origin
app.use(
  '*',
  cors({
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    origin: (_, c) => c.env.FRONTEND_URL ?? 'https://dj.current.space',
  })
)

// Health check
app.get('/health', c => c.json({status: 'healthy'}))

// Register OpenAPI routes
registerSpotifyAuthRoutes(app)
registerPlaylistRoutes(app)
registerPlayerRoutes(app)
registerPlayerStreamRoute(app)
registerMixRoutes(app)

// Configure OpenAPI documentation
app.doc('/api/openapi.json', {
  info: {
    description: 'AI-powered Spotify playlist generator',
    title: 'DJ API',
    version: '1.0.0',
  },
  openapi: '3.0.0',
  servers: [
    {
      description: 'Production',
      url: 'https://dj.current.space',
    },
    {
      description: 'Local development',
      url: 'http://localhost:8787',
    },
  ],
})

// Serve Swagger UI at /api/docs
app.get('/api/docs', swaggerUI({url: '/api/openapi.json'}))

// SSE streaming chat endpoint (production)
app.route('/api/chat-stream', chatStreamRouter)

// Serve static files for non-API routes
app.get('*', async c => {
  try {
    // Use the ASSETS binding to serve static files
    const response = await c.env.ASSETS.fetch(c.req.raw)

    // If the response is 404 and this is a navigation request,
    // serve index.html for client-side routing (SPA behavior)
    if (response.status === 404) {
      const acceptHeader = c.req.header('Accept') ?? ''
      if (acceptHeader.includes('text/html')) {
        // Try to serve index.html for SPA routing
        const indexResponse = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)))
        if (indexResponse.status === 200) {
          return new Response(indexResponse.body, {
            headers: {
              ...Object.fromEntries(indexResponse.headers),
              'Content-Type': 'text/html; charset=utf-8',
            },
          })
        }
      }
    }

    return response
  } catch {
    // Fallback for development or if ASSETS is not available
    return c.text('Not found', 404)
  }
})

export default app
