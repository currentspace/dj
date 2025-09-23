import { Hono } from 'hono'
import type { Env } from '../index'
import {
  AnthropicMessageSchema,
  GeneratedPlaylistSchema,
  GeneratePlaylistRequestSchema,
  SavePlaylistRequestSchema,
  SpotifySearchResponseSchema,
  SpotifyUserSchema,
  SpotifyPlaylistSchema,
  PlaylistTrackSchema,
  type PlaylistTrack
} from '../lib/schemas'
import { safeParse, isSuccessResponse } from '../lib/guards'

const playlistRouter = new Hono<{ Bindings: Env }>()

playlistRouter.post('/generate', async (c) => {
  try {
    const requestBody = await c.req.json()
    const request = safeParse(GeneratePlaylistRequestSchema, requestBody)

    if (!request) {
      return c.json({ error: 'Valid prompt is required' }, 400)
    }

    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    const { prompt } = request

    // Step 1: Generate playlist ideas with Anthropic
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
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

    if (!isSuccessResponse(anthropicResponse)) {
      throw new Error(`Anthropic API error: ${anthropicResponse.status}`)
    }

    const responseData = await anthropicResponse.json()
    const anthropicMessage = safeParse(AnthropicMessageSchema, responseData)

    if (!anthropicMessage) {
      throw new Error('Invalid response format from Anthropic API')
    }

    const content = anthropicMessage.content[0].text

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

    // Step 2: If user is authenticated, search for tracks on Spotify
    if (token) {
      const tracksWithSpotifyIds = await Promise.all(
        playlistData.tracks.map(async (track): Promise<PlaylistTrack> => {
          try {
            const searchResponse = await fetch(
              `https://api.spotify.com/v1/search?q=${encodeURIComponent(track.query)}&type=track&limit=1`,
              {
                headers: {
                  'Authorization': `Bearer ${token}`
                }
              }
            )

            if (isSuccessResponse(searchResponse)) {
              const responseData = await searchResponse.json()
              const searchData = safeParse(SpotifySearchResponseSchema, responseData)

              if (searchData && searchData.tracks?.items && searchData.tracks.items.length > 0) {
                const spotifyTrack = searchData.tracks.items[0]
                const enhancedTrack: PlaylistTrack = {
                  ...track,
                  spotifyId: spotifyTrack.id,
                  spotifyUri: spotifyTrack.uri,
                  preview_url: spotifyTrack.preview_url,
                  external_url: spotifyTrack.external_urls?.spotify
                }

                // Validate the enhanced track
                const validatedTrack = safeParse(PlaylistTrackSchema, enhancedTrack)
                return validatedTrack || track
              }
            }
          } catch (err) {
            console.error(`Failed to search for track: ${track.query}`, err)
          }
          return track
        })
      )

      playlistData.tracks = tracksWithSpotifyIds
    }

    return c.json(playlistData)
  } catch (error) {
    console.error('Playlist generation error:', error)
    return c.json({ error: 'Failed to generate playlist' }, 500)
  }
})

playlistRouter.post('/save', async (c) => {
  try {
    const requestBody = await c.req.json()
    const request = safeParse(SavePlaylistRequestSchema, requestBody)

    if (!request) {
      return c.json({ error: 'Invalid playlist data' }, 400)
    }

    const token = c.req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return c.json({ error: 'Not authenticated' }, 401)
    }

    const { playlist } = request

    // Get user ID
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!isSuccessResponse(userResponse)) {
      throw new Error('Failed to get user profile')
    }

    const responseData = await userResponse.json()
    const userData = safeParse(SpotifyUserSchema, responseData)

    if (!userData) {
      throw new Error('Invalid user data from Spotify')
    }

    const userId = userData.id

    // Create playlist
    const createResponse = await fetch(
      `https://api.spotify.com/v1/users/${userId}/playlists`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: playlist.name,
          description: playlist.description,
          public: false
        })
      }
    )

    if (!isSuccessResponse(createResponse)) {
      throw new Error('Failed to create playlist')
    }

    const createResponseData = await createResponse.json()
    const createdPlaylist = safeParse(SpotifyPlaylistSchema, createResponseData)

    if (!createdPlaylist) {
      throw new Error('Invalid playlist creation response from Spotify')
    }

    // Add tracks to playlist
    const trackUris = playlist.tracks
      .filter((track: PlaylistTrack): track is PlaylistTrack & { spotifyUri: string } =>
        Boolean(track.spotifyUri)
      )
      .map((track: PlaylistTrack & { spotifyUri: string }) => track.spotifyUri)

    if (trackUris.length > 0) {
      const addTracksResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${createdPlaylist.id}/tracks`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            uris: trackUris
          })
        }
      )

      if (!addTracksResponse.ok) {
        throw new Error('Failed to add tracks to playlist')
      }
    }

    return c.json({
      success: true,
      playlistId: createdPlaylist.id,
      playlistUrl: createdPlaylist.external_urls?.spotify
    })
  } catch (error) {
    console.error('Save playlist error:', error)
    return c.json({ error: 'Failed to save playlist to Spotify' }, 500)
  }
})

export { playlistRouter }