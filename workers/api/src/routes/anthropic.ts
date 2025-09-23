import { Hono } from 'hono'
import type { Env } from '../index'
import { AnthropicMessageSchema, GeneratedPlaylistSchema } from '../lib/schemas'
import { safeParse, isSuccessResponse } from '../lib/guards'

const anthropicRouter = new Hono<{ Bindings: Env }>()

anthropicRouter.post('/generate', async (c) => {
  const { prompt } = await c.req.json()

  if (!prompt || typeof prompt !== 'string') {
    return c.json({ error: 'Valid prompt is required' }, 400)
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
            Return ONLY a valid JSON object with this exact structure (no other text):
            {
              "name": "playlist name",
              "description": "brief description",
              "tracks": [
                {"name": "song name", "artist": "artist name", "query": "artist song name"}
              ]
            }

            Request: ${prompt}`
          }
        ]
      })
    })

    if (!isSuccessResponse(response)) {
      throw new Error(`Anthropic API error: ${response.status}`)
    }

    const responseData = await response.json()
    const anthropicMessage = safeParse(AnthropicMessageSchema, responseData)

    if (!anthropicMessage) {
      throw new Error('Invalid response format from Anthropic API')
    }

    const content = anthropicMessage.content[0].text

    // Parse and validate the JSON from Claude's response
    let jsonContent: unknown
    try {
      jsonContent = JSON.parse(content)
    } catch {
      throw new Error('Invalid JSON response from Anthropic API')
    }

    const playlistData = safeParse(GeneratedPlaylistSchema, jsonContent)

    if (!playlistData) {
      throw new Error('Generated playlist does not match expected format')
    }

    return c.json(playlistData)
  } catch (error) {
    console.error('Anthropic API error:', error)
    const message = error instanceof Error ? error.message : 'Failed to generate playlist'
    return c.json({ error: message }, 500)
  }
})

export { anthropicRouter }