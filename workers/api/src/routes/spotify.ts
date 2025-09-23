import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../index'
import { SpotifySearchResponseSchema } from '../lib/schemas'
import { safeParse, isSuccessResponse } from '../lib/guards'

const spotifyRouter = new Hono<{ Bindings: Env }>()

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const REDIRECT_URI = 'https://dj.current.space/callback'

// Request validation schemas
const SearchRequestSchema = z.object({
  query: z.string().min(1),
  type: z.enum(['track', 'album', 'artist']).default('track')
})

spotifyRouter.get('/auth-url', (c) => {
  const params = new URLSearchParams({
    client_id: c.env.SPOTIFY_CLIENT_ID,
    response_type: 'token',
    redirect_uri: REDIRECT_URI,
    scope: 'playlist-modify-public playlist-modify-private user-read-private',
    show_dialog: 'true'
  })

  return c.json({ url: `${SPOTIFY_AUTH_URL}?${params.toString()}` })
})

spotifyRouter.post('/search', async (c) => {
  try {
    const requestBody = await c.req.json()
    const searchRequest = safeParse(SearchRequestSchema, requestBody)

    if (!searchRequest) {
      return c.json({ error: 'Invalid search request' }, 400)
    }

    const token = c.req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return c.json({ error: 'No authorization token' }, 401)
    }

    const { query, type } = searchRequest

    const response = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    )

    if (!isSuccessResponse(response)) {
      console.error(`Spotify search failed: ${response.status} ${response.statusText}`)
      return c.json({ error: 'Spotify search failed' }, 500)
    }

    const responseData = await response.json()
    const spotifyData = safeParse(SpotifySearchResponseSchema, responseData)

    if (!spotifyData) {
      console.error('Invalid Spotify search response format')
      return c.json({ error: 'Invalid response from Spotify' }, 500)
    }

    return c.json(spotifyData)
  } catch (error) {
    console.error('Spotify search error:', error)
    const message = error instanceof Error ? error.message : 'Search failed'
    return c.json({ error: message }, 500)
  }
})

export { spotifyRouter }