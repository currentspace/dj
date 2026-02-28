/**
 * Spotify Player API routes for playback control
 * Implements Phase 1 of DJ Live Mode
 */

import type {OpenAPIHono} from '@hono/zod-openapi'

import type {Env} from '../index'

import {isSuccessResponse} from '../lib/guards'
import {getLogger} from '../utils/LoggerContext'

/**
 * Register Player routes on the provided OpenAPI app
 */
export function registerPlayerRoutes(app: OpenAPIHono<{Bindings: Env}>) {
  // GET /api/player/state - Get current playback state
  app.get('/api/player/state', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        headers: {Authorization: `Bearer ${token}`},
      })

      // 204 = no active playback
      if (response.status === 204) {
        return c.json({device: null, is_playing: false, item: null}, 200)
      }

      if (!isSuccessResponse(response)) {
        const errorText = await response.text()
        getLogger()?.error(`[Player] Get state failed: ${response.status} - ${errorText}`)
        return c.json({error: 'Failed to get playback state'}, response.status as 400 | 401 | 404)
      }

      const data = await response.json()
      return c.json(data, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error getting state:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // GET /api/player/devices - Get available devices
  app.get('/api/player/devices', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (!isSuccessResponse(response)) {
        const errorText = await response.text()
        getLogger()?.error(`[Player] Get devices failed: ${response.status} - ${errorText}`)
        return c.json({error: 'Failed to get devices'}, response.status as 400 | 401 | 404)
      }

      const data = await response.json()
      return c.json(data, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error getting devices:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // GET /api/player/queue - Get current queue
  app.get('/api/player/queue', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (!isSuccessResponse(response)) {
        const errorText = await response.text()
        getLogger()?.error(`[Player] Get queue failed: ${response.status} - ${errorText}`)
        return c.json({error: 'Failed to get queue'}, response.status as 400 | 401 | 404)
      }

      const data = await response.json()
      return c.json(data, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error getting queue:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // POST /api/player/play - Start or resume playback
  app.post('/api/player/play', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      // Body can include context_uri, uris, offset, position_ms
      const body = await c.req.json().catch(() => ({}))

      const response = await fetch('https://api.spotify.com/v1/me/player/play', {
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      })

      // 204 = success (no content)
      if (response.status === 204) {
        return c.json({success: true}, 200)
      }

      if (!isSuccessResponse(response)) {
        const errorText = await response.text()
        getLogger()?.error(`[Player] Play failed: ${response.status} - ${errorText}`)
        return c.json({details: errorText, error: 'Failed to start playback'}, response.status as 400 | 401 | 404)
      }

      return c.json({success: true}, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error starting playback:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // POST /api/player/pause - Pause playback
  app.post('/api/player/pause', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/pause', {
        headers: {Authorization: `Bearer ${token}`},
        method: 'PUT',
      })

      if (response.status === 204) {
        return c.json({success: true}, 200)
      }

      if (!isSuccessResponse(response)) {
        const errorText = await response.text()
        getLogger()?.error(`[Player] Pause failed: ${response.status} - ${errorText}`)
        return c.json({details: errorText, error: 'Failed to pause playback'}, response.status as 400 | 401 | 404)
      }

      return c.json({success: true}, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error pausing playback:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // POST /api/player/next - Skip to next track
  app.post('/api/player/next', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/next', {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })

      if (response.status === 204) {
        return c.json({success: true}, 200)
      }

      if (!isSuccessResponse(response)) {
        const errorText = await response.text()
        getLogger()?.error(`[Player] Next failed: ${response.status} - ${errorText}`)
        return c.json({details: errorText, error: 'Failed to skip track'}, response.status as 400 | 401 | 404)
      }

      return c.json({success: true}, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error skipping track:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // POST /api/player/previous - Go to previous track
  app.post('/api/player/previous', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/previous', {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })

      if (response.status === 204) {
        return c.json({success: true}, 200)
      }

      if (!isSuccessResponse(response)) {
        const errorText = await response.text()
        getLogger()?.error(`[Player] Previous failed: ${response.status} - ${errorText}`)
        return c.json({details: errorText, error: 'Failed to go to previous track'}, response.status as 400 | 401 | 404)
      }

      return c.json({success: true}, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error going to previous track:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // POST /api/player/seek - Seek to position
  app.post('/api/player/seek', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      const body = await c.req.json()
      const positionMs = body.position_ms

      if (typeof positionMs !== 'number') {
        return c.json({error: 'position_ms is required'}, 400)
      }

      const response = await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}`, {
        headers: {Authorization: `Bearer ${token}`},
        method: 'PUT',
      })

      if (response.status === 204) {
        return c.json({success: true}, 200)
      }

      if (!isSuccessResponse(response)) {
        const errorText = await response.text()
        getLogger()?.error(`[Player] Seek failed: ${response.status} - ${errorText}`)
        return c.json({details: errorText, error: 'Failed to seek'}, response.status as 400 | 401 | 404)
      }

      return c.json({success: true}, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error seeking:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // PUT /api/player/device - Transfer playback to device
  app.put('/api/player/device', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      const body = await c.req.json()
      const deviceId = body.device_id
      const play = body.play ?? false

      if (!deviceId) {
        return c.json({error: 'device_id is required'}, 400)
      }

      const response = await fetch('https://api.spotify.com/v1/me/player', {
        body: JSON.stringify({
          device_ids: [deviceId],
          play,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      })

      if (response.status === 204) {
        return c.json({success: true}, 200)
      }

      if (!isSuccessResponse(response)) {
        const errorText = await response.text()
        getLogger()?.error(`[Player] Transfer failed: ${response.status} - ${errorText}`)
        return c.json({details: errorText, error: 'Failed to transfer playback'}, response.status as 400 | 401 | 404)
      }

      return c.json({success: true}, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error transferring playback:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // PUT /api/player/volume - Set playback volume
  app.put('/api/player/volume', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      const body = await c.req.json()
      const volumePercent = body.volume_percent

      if (typeof volumePercent !== 'number' || volumePercent < 0 || volumePercent > 100) {
        return c.json({error: 'volume_percent must be a number between 0 and 100'}, 400)
      }

      const response = await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round(volumePercent)}`, {
        headers: {Authorization: `Bearer ${token}`},
        method: 'PUT',
      })

      if (response.status === 204) {
        return c.json({success: true, volume_percent: volumePercent}, 200)
      }

      if (!isSuccessResponse(response)) {
        const errorText = await response.text()
        getLogger()?.error(`[Player] Volume failed: ${response.status} - ${errorText}`)
        return c.json({details: errorText, error: 'Failed to set volume'}, response.status as 400 | 401 | 404)
      }

      return c.json({success: true, volume_percent: volumePercent}, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error setting volume:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // POST /api/player/queue/add - Add track to queue
  app.post('/api/player/queue/add', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      const body = await c.req.json()
      const uri = body.uri

      if (!uri) {
        return c.json({error: 'uri is required'}, 400)
      }

      const response = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`, {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })

      if (response.status === 204) {
        return c.json({success: true, uri}, 200)
      }

      if (!isSuccessResponse(response)) {
        const errorText = await response.text()
        getLogger()?.error(`[Player] Add to queue failed: ${response.status} - ${errorText}`)
        return c.json({details: errorText, error: 'Failed to add to queue'}, response.status as 400 | 401 | 404)
      }

      return c.json({success: true, uri}, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error adding to queue:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })
}
