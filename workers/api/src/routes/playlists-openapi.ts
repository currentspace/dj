/**
 * Playlist API routes using OpenAPI contracts
 * Migrated to use @hono/zod-openapi
 */

import type { OpenAPIHono } from '@hono/zod-openapi'

import {
  createPlaylist,
  getPlaylistTracks,
  getUserPlaylists,
  modifyPlaylist,
} from '@dj/api-contracts'
import {
  SpotifyAddTracksResponseSchema,
  SpotifyPlaylistFullSchema,
  SpotifyPlaylistTracksResponseSchema,
  SpotifyUserPlaylistsResponseSchema,
  SpotifyUserSchema,
} from '@dj/shared-types'

import type { Env } from '../index'

import { isSuccessResponse } from '../lib/guards'

/**
 * Register playlist routes on the provided OpenAPI app
 */
export function registerPlaylistRoutes(app: OpenAPIHono<{ Bindings: Env }>) {
  // GET /api/spotify/playlists - Get user's playlists
  app.openapi(getUserPlaylists, async c => {
    try {
      // Headers automatically validated by contract
      const token = c.req.header('authorization')?.replace('Bearer ', '')

      if (!token) {
        return c.json({ error: 'No authorization token' }, 401)
      }

      // Query params automatically validated by contract
      const limit = c.req.query('limit') ?? '20'
      const offset = c.req.query('offset') ?? '0'

      const response = await fetch(
        `https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      )

      if (!isSuccessResponse(response)) {
        console.error(`Get playlists failed: ${response.status} ${response.statusText}`)
        return c.json({ error: 'Failed to get playlists' }, 401)
      }

      const rawData = await response.json()
      const parseResult = SpotifyUserPlaylistsResponseSchema.safeParse(rawData)

      if (!parseResult.success) {
        console.error('Invalid Spotify playlists response:', parseResult.error)
        return c.json({ error: 'Invalid response from Spotify API' }, 500)
      }

      // Response automatically validated against contract schema
      return c.json(parseResult.data)
    } catch (error) {
      console.error('Get playlists error:', error)
      const message = error instanceof Error ? error.message : 'Failed to get playlists'
      return c.json({ error: message }, 401)
    }
  })

  // GET /api/spotify/playlists/:id/tracks - Get playlist tracks
  app.openapi(getPlaylistTracks, async c => {
    try {
      // Headers and params automatically validated by contract
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      const playlistId = c.req.param('id')

      if (!token) {
        return c.json({ error: 'No authorization token' }, 401)
      }

      // Query params automatically validated by contract
      const limit = c.req.query('limit') ?? '50'
      const offset = c.req.query('offset') ?? '0'

      const response = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      )

      if (!isSuccessResponse(response)) {
        if (response.status === 404) {
          return c.json({ error: 'Playlist not found' }, 404)
        }
        console.error(`Get playlist tracks failed: ${response.status} ${response.statusText}`)
        return c.json({ error: 'Failed to get playlist tracks' }, 401)
      }

      const rawData = await response.json()
      const parseResult = SpotifyPlaylistTracksResponseSchema.safeParse(rawData)

      if (!parseResult.success) {
        console.error('Invalid Spotify playlist tracks response:', parseResult.error)
        return c.json({ error: 'Invalid response from Spotify API' }, 500)
      }

      // Response automatically validated against contract schema
      return c.json({ items: parseResult.data.items })
    } catch (error) {
      console.error('Get playlist tracks error:', error)
      const message = error instanceof Error ? error.message : 'Failed to get playlist tracks'
      return c.json({ error: message }, 401)
    }
  })

  // POST /api/spotify/playlists - Create a new playlist
  app.openapi(createPlaylist, async c => {
    const env = c.env as Env

    try {
      // Headers and body automatically validated by contract
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      const { name, description, public: isPublic } = await c.req.json()

      if (!token) {
        return c.json({ error: 'No authorization token' }, 401)
      }

      // First, get the user's Spotify ID
      const userResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!isSuccessResponse(userResponse)) {
        return c.json({ error: 'Failed to get user info' }, 400)
      }

      const rawUserData = await userResponse.json()
      const userParseResult = SpotifyUserSchema.safeParse(rawUserData)

      if (!userParseResult.success) {
        console.error('Invalid Spotify user response:', userParseResult.error)
        return c.json({ error: 'Invalid response from Spotify API' }, 500)
      }

      const userId = userParseResult.data.id

      // Create the playlist
      const createResponse = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
        body: JSON.stringify({
          description,
          name,
          public: isPublic,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })

      if (!isSuccessResponse(createResponse)) {
        console.error(
          `Create playlist failed: ${createResponse.status} ${createResponse.statusText}`,
        )
        return c.json({ error: 'Failed to create playlist' }, 400)
      }

      const rawPlaylist = await createResponse.json()
      const playlistParseResult = SpotifyPlaylistFullSchema.safeParse(rawPlaylist)

      if (!playlistParseResult.success) {
        console.error('Invalid Spotify create playlist response:', playlistParseResult.error)
        return c.json({ error: 'Invalid response from Spotify API' }, 500)
      }

      // Response automatically validated against contract schema
      return c.json(playlistParseResult.data, 201)
    } catch (error) {
      console.error('Create playlist error:', error)
      const message = error instanceof Error ? error.message : 'Failed to create playlist'
      return c.json({ error: message }, 400)
    }
  })

  // POST /api/spotify/playlists/modify - Add or remove tracks
  app.openapi(modifyPlaylist, async c => {
    try {
      // Headers and body automatically validated by contract
      const token = c.req.header('authorization')?.replace('Bearer ', '')
      const { action, playlistId, trackUris } = await c.req.json()

      if (!token) {
        return c.json({ error: 'No authorization token' }, 401)
      }

      if (action === 'add') {
        // Add tracks to playlist
        const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
          body: JSON.stringify({
            uris: trackUris,
          }),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })

        if (!isSuccessResponse(response)) {
          console.error(`Add tracks failed: ${response.status} ${response.statusText}`)
          return c.json({ error: 'Failed to add tracks' }, 400)
        }

        const rawResult = await response.json()
        const addParseResult = SpotifyAddTracksResponseSchema.safeParse(rawResult)

        if (!addParseResult.success) {
          console.error('Invalid Spotify add tracks response:', addParseResult.error)
          return c.json({ error: 'Invalid response from Spotify API' }, 500)
        }

        // Response automatically validated against contract schema
        return c.json({
          action: 'added',
          snapshot_id: addParseResult.data.snapshot_id,
          success: true,
        })
      } else if (action === 'remove') {
        // Remove tracks from playlist
        const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
          body: JSON.stringify({
            tracks: trackUris.map(uri => ({ uri })),
          }),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          method: 'DELETE',
        })

        if (!isSuccessResponse(response)) {
          console.error(`Remove tracks failed: ${response.status} ${response.statusText}`)
          return c.json({ error: 'Failed to remove tracks' }, 400)
        }

        const rawResult = await response.json()
        const removeParseResult = SpotifyAddTracksResponseSchema.safeParse(rawResult)

        if (!removeParseResult.success) {
          console.error('Invalid Spotify remove tracks response:', removeParseResult.error)
          return c.json({ error: 'Invalid response from Spotify API' }, 500)
        }

        // Response automatically validated against contract schema
        return c.json({
          action: 'removed',
          snapshot_id: removeParseResult.data.snapshot_id,
          success: true,
        })
      }

      return c.json({ error: 'Invalid action' }, 400)
    } catch (error) {
      console.error('Modify playlist error:', error)
      const message = error instanceof Error ? error.message : 'Failed to modify playlist'
      return c.json({ error: message }, 400)
    }
  })
}
