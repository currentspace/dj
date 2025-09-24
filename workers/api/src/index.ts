import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { anthropicRouter } from './routes/anthropic'
import { spotifyRouter } from './routes/spotify'
import { playlistRouter } from './routes/playlist'
import { chatRouter } from './routes/chat'
import { testRouter } from './routes/test'
import { mcpRouter } from './routes/mcp'
import { mcpChatRouter } from './routes/chat-mcp-integrated'
import { langchainMcpChatRouter } from './routes/chat-langchain-mcp'

export interface Env {
  ANTHROPIC_API_KEY: string
  SPOTIFY_CLIENT_ID: string
  SPOTIFY_CLIENT_SECRET: string
  SESSIONS?: KVNamespace // KV namespace for session storage
  ENVIRONMENT: string
  ASSETS: Fetcher
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

// Health check
app.get('/health', (c) => c.json({ status: 'healthy' }))

// API routes
app.route('/api/anthropic', anthropicRouter)
app.route('/api/spotify', spotifyRouter)
app.route('/api/playlist', playlistRouter)
app.route('/api/chat', chatRouter)
app.route('/api/chat-mcp', mcpChatRouter) // NEW: Direct MCP integration
app.route('/api/chat-langchain-mcp', langchainMcpChatRouter) // NEW: LangChain-style MCP integration
app.route('/api/test', testRouter)
app.route('/api/mcp', mcpRouter)

// Serve static files for non-API routes
app.get('*', async (c) => {
  try {
    // Use the ASSETS binding to serve static files
    const response = await c.env.ASSETS.fetch(c.req.raw)

    // If the response is 404 and this is a navigation request,
    // serve index.html for client-side routing (SPA behavior)
    if (response.status === 404) {
      const acceptHeader = c.req.header('Accept') || ''
      if (acceptHeader.includes('text/html')) {
        // Try to serve index.html for SPA routing
        const indexResponse = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)))
        if (indexResponse.status === 200) {
          return new Response(indexResponse.body, {
            headers: {
              ...Object.fromEntries(indexResponse.headers),
              'Content-Type': 'text/html; charset=utf-8'
            }
          })
        }
      }
    }

    return response
  } catch (e) {
    // Fallback for development or if ASSETS is not available
    return c.text('Not found', 404)
  }
})

export default app