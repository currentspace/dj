import { Hono } from 'hono'
import type { Env } from '../index'

const spotifyRouter = new Hono<{ Bindings: Env }>()

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const REDIRECT_URI = 'https://dj.current.space/callback'

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
  const { query, type = 'track' } = await c.req.json()
  const token = c.req.header('Authorization')?.replace('Bearer ', '')

  if (!token) {
    return c.json({ error: 'No authorization token' }, 401)
  }

  const response = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=10`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  )

  if (!response.ok) {
    return c.json({ error: 'Spotify search failed' }, response.status)
  }

  const data = await response.json()
  return c.json(data)
})

export { spotifyRouter }