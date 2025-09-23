import { Hono } from 'hono'
import type { Env } from '../index'

const anthropicRouter = new Hono<{ Bindings: Env }>()

anthropicRouter.post('/generate', async (c) => {
  const { prompt } = await c.req.json()

  if (!prompt) {
    return c.json({ error: 'Prompt is required' }, 400)
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `You are a music expert DJ. Based on the following request, generate a playlist with 10-15 songs.
            Return the response as a JSON object with this structure:
            {
              "name": "playlist name",
              "description": "brief description",
              "tracks": [
                {"name": "song name", "artist": "artist name", "query": "search query for spotify"}
              ]
            }

            Request: ${prompt}`
          }
        ]
      })
    })

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.content[0].text

    // Parse the JSON from Claude's response
    const playlistData = JSON.parse(content)

    return c.json(playlistData)
  } catch (error) {
    console.error('Anthropic API error:', error)
    return c.json({ error: 'Failed to generate playlist' }, 500)
  }
})

export { anthropicRouter }