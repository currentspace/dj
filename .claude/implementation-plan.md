# DJ Live Mode Implementation Plan

> Comprehensive technical implementation guide for transforming DJ into a live music curation assistant.

---

## Executive Summary

This document provides step-by-step implementation details for building the "Live DJ" experience, organized by implementation phase and area of code. Each section includes exact file paths, line numbers, code patterns to follow, and expected deliverables.

**Total Scope**: 6 phases, ~15-20 implementation tasks

---

## Phase 1: OAuth & Authentication Updates

### 1.1 Add Playback Control Scopes

**File**: `/workers/api/src/routes/spotify-openapi.ts`
**Line**: 51-52

**Current**:
```typescript
scope:
  'playlist-modify-public playlist-modify-private user-read-private user-read-playback-state user-read-currently-playing user-read-recently-played user-top-read playlist-read-private playlist-read-collaborative',
```

**Change To**:
```typescript
scope:
  'playlist-modify-public playlist-modify-private user-read-private user-read-playback-state user-read-currently-playing user-read-recently-played user-top-read playlist-read-private playlist-read-collaborative user-modify-playback-state streaming',
```

**New Scopes Added**:
- `user-modify-playback-state` - Control playback (play/pause/skip/seek)
- `streaming` - Web Playback SDK access (Premium users only)

**Impact**: Existing users must re-authenticate to get new permissions.

### 1.2 Update Documentation

**File**: `/CLAUDE.md`
**Section**: OAuth Scopes (around line 282)

Add to Required Scopes list:
```markdown
- `user-modify-playback-state` - Control playback (play, pause, skip, seek)
- `streaming` - Access streaming API (Premium only)
```

**File**: `.claude/product-capabilities.md`
**Section**: OAuth Scopes

Update to show new scopes as "Requested and Used".

---

## Phase 2: Player API Routes

### 2.1 Create Player Route File

**New File**: `/workers/api/src/routes/player-openapi.ts`

**Pattern to Follow**: `/workers/api/src/routes/playlists-openapi.ts`

**Endpoints to Implement**:

| Endpoint | Method | Spotify API | Purpose |
|----------|--------|-------------|---------|
| `/api/player/state` | GET | `GET /v1/me/player` | Current playback state |
| `/api/player/devices` | GET | `GET /v1/me/player/devices` | Available devices |
| `/api/player/queue` | GET | `GET /v1/me/player/queue` | Current queue |
| `/api/player/play` | POST | `PUT /v1/me/player/play` | Start/resume playback |
| `/api/player/pause` | POST | `PUT /v1/me/player/pause` | Pause playback |
| `/api/player/next` | POST | `POST /v1/me/player/next` | Skip to next |
| `/api/player/previous` | POST | `POST /v1/me/player/previous` | Previous track |
| `/api/player/seek` | POST | `PUT /v1/me/player/seek` | Seek to position |
| `/api/player/device` | PUT | `PUT /v1/me/player` | Transfer playback |
| `/api/player/queue/add` | POST | `POST /v1/me/player/queue` | Add to queue |

**Code Pattern** (from playlists-openapi.ts):
```typescript
import {Hono} from 'hono'
import {getLogger} from '../utils/LoggerContext'
import {isSuccessResponse} from '../lib/guards'

type Env = {
  AUDIO_FEATURES_CACHE?: KVNamespace
}

export function registerPlayerRoutes(app: Hono<{Bindings: Env}>) {
  // GET /api/player/state
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
        return c.json({is_playing: false, device: null, item: null}, 200)
      }

      if (!isSuccessResponse(response)) {
        return c.json({error: 'Failed to get playback state'}, response.status)
      }

      const data = await response.json()
      return c.json(data, 200)
    } catch (error) {
      getLogger()?.error('[Player] Error getting state:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // POST /api/player/play
  app.post('/api/player/play', async c => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return c.json({error: 'No authorization token'}, 401)
    }

    try {
      const body = await c.req.json().catch(() => ({}))
      const response = await fetch('https://api.spotify.com/v1/me/player/play', {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      })

      if (response.status === 204 || isSuccessResponse(response)) {
        return c.json({success: true}, 200)
      }

      const errorText = await response.text()
      getLogger()?.error(`[Player] Play failed: ${response.status} - ${errorText}`)
      return c.json({error: 'Failed to start playback'}, response.status)
    } catch (error) {
      getLogger()?.error('[Player] Error starting playback:', error)
      return c.json({error: 'Internal server error'}, 500)
    }
  })

  // ... similar patterns for other endpoints
}
```

### 2.2 Register Routes in Index

**File**: `/workers/api/src/index.ts`

**Add Import**:
```typescript
import {registerPlayerRoutes} from './routes/player-openapi'
```

**Add Registration** (after other route registrations):
```typescript
registerPlayerRoutes(app)
```

### 2.3 Add Type Schemas

**File**: `/packages/shared-types/src/schemas/spotify-schemas.ts`

**Add New Schemas**:
```typescript
export const SpotifyDeviceSchema = z.object({
  id: z.string().nullable(),
  is_active: z.boolean(),
  is_private_session: z.boolean(),
  is_restricted: z.boolean(),
  name: z.string(),
  supports_volume: z.boolean(),
  type: z.string(),
  volume_percent: z.number().nullable(),
})

export const SpotifyPlaybackStateSchema = z.object({
  device: SpotifyDeviceSchema.nullable(),
  is_playing: z.boolean(),
  item: SpotifyTrackFullSchema.nullable(),
  progress_ms: z.number().nullable(),
  repeat_state: z.enum(['off', 'track', 'context']),
  shuffle_state: z.boolean(),
  timestamp: z.number(),
})

export const SpotifyQueueSchema = z.object({
  currently_playing: SpotifyTrackFullSchema.nullable(),
  queue: z.array(SpotifyTrackFullSchema),
})
```

---

## Phase 3: NowPlaying Frontend Component

### 3.1 Create Component Structure

**New Directory**: `/apps/web/src/features/playback/`

**New Files**:
- `NowPlaying.tsx` - Main component
- `PlayerControls.tsx` - Play/pause/skip buttons
- `ProgressBar.tsx` - Track progress with seeking
- `DeviceSelector.tsx` - Device dropdown
- `QueuePreview.tsx` - Upcoming tracks list

### 3.2 NowPlaying Component

**File**: `/apps/web/src/features/playback/NowPlaying.tsx`

**Pattern to Follow**: `/apps/web/src/features/chat/ChatInterface.tsx`

```typescript
import {memo, useCallback, useEffect, useRef, useState} from 'react'
import '../../styles/now-playing.css'

interface PlaybackState {
  albumArt: string | null
  artistName: string
  deviceName: string
  duration: number
  isPlaying: boolean
  progress: number
  trackName: string
}

interface NowPlayingProps {
  token: string | null
}

export const NowPlaying = memo(function NowPlaying({token}: NowPlayingProps) {
  const [playback, setPlayback] = useState<PlaybackState | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchPlaybackState = useCallback(async () => {
    if (!token) return

    try {
      const response = await fetch('/api/player/state', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (response.status === 401) {
        setError('Session expired')
        return
      }

      if (!response.ok) {
        throw new Error('Failed to fetch playback')
      }

      const data = await response.json()

      if (!data.item) {
        setPlayback(null)
        return
      }

      setPlayback({
        albumArt: data.item?.album?.images?.[0]?.url ?? null,
        artistName: data.item?.artists?.map((a: {name: string}) => a.name).join(', ') ?? '',
        deviceName: data.device?.name ?? 'Unknown',
        duration: data.item?.duration_ms ?? 0,
        isPlaying: data.is_playing ?? false,
        progress: data.progress_ms ?? 0,
        trackName: data.item?.name ?? 'Unknown',
      })
      setError(null)
    } catch (err) {
      console.error('[NowPlaying] Fetch error:', err)
      // Don't set error on network issues during polling
    }
  }, [token])

  // Polling effect - only place useEffect is acceptable
  useEffect(() => {
    if (!token) return

    // Initial fetch
    fetchPlaybackState()

    // Set up polling (every 1 second)
    pollIntervalRef.current = setInterval(fetchPlaybackState, 1000)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [token, fetchPlaybackState])

  const handlePlayPause = useCallback(async () => {
    if (!token) return

    const endpoint = playback?.isPlaying ? '/api/player/pause' : '/api/player/play'

    try {
      await fetch(endpoint, {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })
      // Immediately update UI optimistically
      setPlayback(prev => prev ? {...prev, isPlaying: !prev.isPlaying} : null)
    } catch (err) {
      console.error('[NowPlaying] Play/pause error:', err)
    }
  }, [token, playback?.isPlaying])

  const handleNext = useCallback(async () => {
    if (!token) return

    try {
      await fetch('/api/player/next', {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })
      // Fetch new state after skip
      setTimeout(fetchPlaybackState, 300)
    } catch (err) {
      console.error('[NowPlaying] Next error:', err)
    }
  }, [token, fetchPlaybackState])

  const handlePrevious = useCallback(async () => {
    if (!token) return

    try {
      await fetch('/api/player/previous', {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      })
      setTimeout(fetchPlaybackState, 300)
    } catch (err) {
      console.error('[NowPlaying] Previous error:', err)
    }
  }, [token, fetchPlaybackState])

  if (!token) {
    return null
  }

  if (error) {
    return (
      <div className="now-playing now-playing--error">
        <span className="now-playing__error-text">{error}</span>
      </div>
    )
  }

  if (!playback) {
    return (
      <div className="now-playing now-playing--inactive">
        <span className="now-playing__inactive-text">
          No active playback - Start playing on Spotify
        </span>
      </div>
    )
  }

  const progressPercent = (playback.progress / playback.duration) * 100

  return (
    <div className="now-playing">
      <div className="now-playing__track">
        {playback.albumArt && (
          <img
            alt="Album art"
            className="now-playing__album-art"
            src={playback.albumArt}
          />
        )}
        <div className="now-playing__info">
          <span className="now-playing__track-name">{playback.trackName}</span>
          <span className="now-playing__artist-name">{playback.artistName}</span>
        </div>
      </div>

      <div className="now-playing__progress">
        <div
          className="now-playing__progress-bar"
          style={{width: `${progressPercent}%`}}
        />
      </div>

      <div className="now-playing__controls">
        <button
          className="now-playing__control-btn"
          onClick={handlePrevious}
          type="button"
        >
          ⏮
        </button>
        <button
          className="now-playing__control-btn now-playing__control-btn--play"
          onClick={handlePlayPause}
          type="button"
        >
          {playback.isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className="now-playing__control-btn"
          onClick={handleNext}
          type="button"
        >
          ⏭
        </button>
      </div>

      <div className="now-playing__device">
        <span className="now-playing__device-icon">🔊</span>
        <span className="now-playing__device-name">{playback.deviceName}</span>
      </div>
    </div>
  )
})
```

### 3.3 Create Styles

**New File**: `/apps/web/src/styles/now-playing.css`

```css
/* NowPlaying Component Styles */

.now-playing {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: linear-gradient(180deg, #1a1a1a 0%, #121212 100%);
  border-top: 1px solid #333;
  min-height: 72px;
}

.now-playing--inactive,
.now-playing--error {
  justify-content: center;
}

.now-playing__inactive-text,
.now-playing__error-text {
  color: #888;
  font-size: 0.875rem;
}

.now-playing__error-text {
  color: #e74c3c;
}

/* Track Info */
.now-playing__track {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 0 0 250px;
  min-width: 0;
}

.now-playing__album-art {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  object-fit: cover;
}

.now-playing__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.now-playing__track-name {
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.now-playing__artist-name {
  color: #888;
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Progress Bar */
.now-playing__progress {
  flex: 1;
  height: 4px;
  background: #404040;
  border-radius: 2px;
  overflow: hidden;
  cursor: pointer;
}

.now-playing__progress-bar {
  height: 100%;
  background: #1db954;
  border-radius: 2px;
  transition: width 0.1s linear;
}

.now-playing__progress:hover .now-playing__progress-bar {
  background: #1ed760;
}

/* Controls */
.now-playing__controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.now-playing__control-btn {
  background: none;
  border: none;
  color: #b3b3b3;
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 50%;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.now-playing__control-btn:hover {
  color: white;
  transform: scale(1.1);
}

.now-playing__control-btn--play {
  background: white;
  color: black;
  width: 32px;
  height: 32px;
  font-size: 1rem;
}

.now-playing__control-btn--play:hover {
  transform: scale(1.1);
  background: #1db954;
  color: white;
}

/* Device */
.now-playing__device {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 0 0 150px;
  justify-content: flex-end;
}

.now-playing__device-icon {
  font-size: 1rem;
}

.now-playing__device-name {
  color: #1db954;
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Responsive */
@media (max-width: 768px) {
  .now-playing {
    flex-wrap: wrap;
    padding: 0.75rem;
  }

  .now-playing__track {
    flex: 1 1 100%;
    order: 1;
  }

  .now-playing__progress {
    flex: 1 1 100%;
    order: 3;
    margin-top: 0.5rem;
  }

  .now-playing__controls {
    order: 2;
    flex: 0 0 auto;
  }

  .now-playing__device {
    display: none;
  }
}
```

### 3.4 Integrate into App Layout

**File**: `/apps/web/src/App.tsx`

**Add Import**:
```typescript
import {NowPlaying} from './features/playback/NowPlaying'
```

**Update Layout** (add at bottom of main-content):
```tsx
<main className="main-content">
  {/* existing content */}
</main>
<NowPlaying token={token} />
```

**Update CSS**: `/apps/web/src/styles/app-layout.css`

Add to support fixed bottom player:
```css
.app-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.main-content {
  flex: 1;
  /* existing styles */
}
```

---

## Phase 4: Claude Queue Management Tools

### 4.1 Add Tool Schemas

**File**: `/workers/api/src/lib/spotify-tools.ts`

**Add After Line 75** (after existing schemas):
```typescript
// Queue Management Schemas
export const AddToQueueSchema = z.object({
  uri: z.string().describe('Spotify track URI (spotify:track:xxx)'),
})

export const GetNowPlayingSchema = z.object({})

export const GetQueueSchema = z.object({})

export const ControlPlaybackSchema = z.object({
  action: z.enum(['play', 'pause', 'next', 'previous']).describe('Playback action'),
})
```

### 4.2 Add Tool Definitions

**File**: `/workers/api/src/lib/spotify-tools.ts`

**Add to spotifyTools Array** (after line 214):
```typescript
// Queue & Playback Tools
{
  description: 'Add a track to the user\'s playback queue. Use this when the user asks to queue a song or add something to play next.',
  input_schema: {
    properties: {
      uri: {
        description: 'Spotify track URI (format: spotify:track:xxx)',
        type: 'string',
      },
    },
    required: ['uri'],
    type: 'object',
  },
  name: 'add_to_queue',
},
{
  description: 'Get what is currently playing on the user\'s Spotify. Returns track name, artist, progress, and whether it\'s playing.',
  input_schema: {
    properties: {},
    required: [],
    type: 'object',
  },
  name: 'get_now_playing',
},
{
  description: 'Get the user\'s current playback queue - shows what\'s playing now and what\'s coming up next.',
  input_schema: {
    properties: {},
    required: [],
    type: 'object',
  },
  name: 'get_queue',
},
{
  description: 'Control playback: play, pause, skip to next track, or go to previous track.',
  input_schema: {
    properties: {
      action: {
        description: 'The playback action to perform',
        enum: ['play', 'pause', 'next', 'previous'],
        type: 'string',
      },
    },
    required: ['action'],
    type: 'object',
  },
  name: 'control_playback',
},
```

### 4.3 Implement Tool Functions

**File**: `/workers/api/src/lib/spotify-tools.ts`

**Add to executeSpotifyTool Switch** (after line 281):
```typescript
case 'add_to_queue':
  result = await addToQueue(args, token)
  break

case 'get_now_playing':
  result = await getNowPlaying(args, token)
  break

case 'get_queue':
  result = await getQueue(args, token)
  break

case 'control_playback':
  result = await controlPlayback(args, token)
  break
```

**Add Implementation Functions** (at bottom of file):
```typescript
async function addToQueue(args: Record<string, unknown>, token: string) {
  const uri = isString(args.uri) ? args.uri : null
  if (!uri) {
    throw new Error('Track URI is required')
  }

  getLogger()?.info(`[Tool:addToQueue] Adding ${uri} to queue`)

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`, {
        headers: {Authorization: `Bearer ${token}`},
        method: 'POST',
      }),
    undefined,
    'player:queue'
  )

  if (response.status === 204) {
    return {message: 'Track added to queue', success: true, uri}
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to add to queue: ${response.status} - ${errorText}`)
  }

  return {message: 'Track added to queue', success: true, uri}
}

async function getNowPlaying(_args: Record<string, unknown>, token: string) {
  getLogger()?.info('[Tool:getNowPlaying] Fetching current playback')

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'player:current'
  )

  if (response.status === 204) {
    return {is_playing: false, message: 'Nothing currently playing'}
  }

  if (!response.ok) {
    throw new Error(`Failed to get now playing: ${response.status}`)
  }

  const data = (await response.json()) as {
    is_playing: boolean
    item: {
      album?: {name: string}
      artists?: Array<{name: string}>
      duration_ms: number
      name: string
      uri: string
    }
    progress_ms: number
  }

  return {
    album: data.item?.album?.name,
    artists: data.item?.artists?.map(a => a.name).join(', '),
    duration_ms: data.item?.duration_ms,
    is_playing: data.is_playing,
    progress_ms: data.progress_ms,
    track_name: data.item?.name,
    uri: data.item?.uri,
  }
}

async function getQueue(_args: Record<string, unknown>, token: string) {
  getLogger()?.info('[Tool:getQueue] Fetching queue')

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: {Authorization: `Bearer ${token}`},
      }),
    undefined,
    'player:queue'
  )

  if (!response.ok) {
    throw new Error(`Failed to get queue: ${response.status}`)
  }

  const data = (await response.json()) as {
    currently_playing: {
      artists?: Array<{name: string}>
      name: string
      uri: string
    } | null
    queue: Array<{
      artists?: Array<{name: string}>
      name: string
      uri: string
    }>
  }

  return {
    currently_playing: data.currently_playing
      ? {
          artists: data.currently_playing.artists?.map(a => a.name).join(', '),
          name: data.currently_playing.name,
          uri: data.currently_playing.uri,
        }
      : null,
    queue: data.queue.slice(0, 10).map(track => ({
      artists: track.artists?.map(a => a.name).join(', '),
      name: track.name,
      uri: track.uri,
    })),
    queue_length: data.queue.length,
  }
}

async function controlPlayback(args: Record<string, unknown>, token: string) {
  const action = isString(args.action) ? args.action : null
  if (!action || !['play', 'pause', 'next', 'previous'].includes(action)) {
    throw new Error('Valid action is required: play, pause, next, or previous')
  }

  getLogger()?.info(`[Tool:controlPlayback] Executing ${action}`)

  const endpoints: Record<string, {method: string; url: string}> = {
    next: {method: 'POST', url: 'https://api.spotify.com/v1/me/player/next'},
    pause: {method: 'PUT', url: 'https://api.spotify.com/v1/me/player/pause'},
    play: {method: 'PUT', url: 'https://api.spotify.com/v1/me/player/play'},
    previous: {method: 'POST', url: 'https://api.spotify.com/v1/me/player/previous'},
  }

  const {method, url} = endpoints[action]

  const response = await rateLimitedSpotifyCall(
    () =>
      fetch(url, {
        headers: {Authorization: `Bearer ${token}`},
        method,
      }),
    undefined,
    `player:${action}`
  )

  if (response.status === 204 || response.ok) {
    return {action, message: `Playback ${action} successful`, success: true}
  }

  const errorText = await response.text()
  throw new Error(`Failed to ${action}: ${response.status} - ${errorText}`)
}
```

### 4.4 Add Native Tool Wrappers

**File**: `/workers/api/src/routes/chat-stream.ts`

**Add to createStreamingSpotifyTools Function** (after line 652):
```typescript
// Queue & Playback Tools
{
  description: 'Add a track to the user\'s playback queue',
  func: async args => {
    if (abortSignal?.aborted) throw new Error('Request aborted')

    await sseWriter.write({
      data: {args, tool: 'add_to_queue'},
      type: 'tool_start',
    })

    const result = await executeSpotifyTool('add_to_queue', args, spotifyToken, env?.AUDIO_FEATURES_CACHE)

    await sseWriter.write({
      data: {result: 'Track added to queue', tool: 'add_to_queue'},
      type: 'tool_end',
    })

    return result
  },
  name: 'add_to_queue',
  schema: z.object({
    uri: z.string(),
  }),
},
{
  description: 'Get currently playing track',
  func: async args => {
    if (abortSignal?.aborted) throw new Error('Request aborted')

    await sseWriter.write({
      data: {args, tool: 'get_now_playing'},
      type: 'tool_start',
    })

    const result = await executeSpotifyTool('get_now_playing', args, spotifyToken, env?.AUDIO_FEATURES_CACHE)

    await sseWriter.write({
      data: {result: 'Got current playback', tool: 'get_now_playing'},
      type: 'tool_end',
    })

    return result
  },
  name: 'get_now_playing',
  schema: z.object({}),
},
{
  description: 'Get playback queue',
  func: async args => {
    if (abortSignal?.aborted) throw new Error('Request aborted')

    await sseWriter.write({
      data: {args, tool: 'get_queue'},
      type: 'tool_start',
    })

    const result = await executeSpotifyTool('get_queue', args, spotifyToken, env?.AUDIO_FEATURES_CACHE)
    const queueResult = result as {queue_length: number}

    await sseWriter.write({
      data: {result: `Queue has ${queueResult.queue_length} tracks`, tool: 'get_queue'},
      type: 'tool_end',
    })

    return result
  },
  name: 'get_queue',
  schema: z.object({}),
},
{
  description: 'Control playback (play/pause/next/previous)',
  func: async args => {
    if (abortSignal?.aborted) throw new Error('Request aborted')

    await sseWriter.write({
      data: {args, tool: 'control_playback'},
      type: 'tool_start',
    })

    const result = await executeSpotifyTool('control_playback', args, spotifyToken, env?.AUDIO_FEATURES_CACHE)

    await sseWriter.write({
      data: {result: `Playback ${args.action} executed`, tool: 'control_playback'},
      type: 'tool_end',
    })

    return result
  },
  name: 'control_playback',
  schema: z.object({
    action: z.enum(['play', 'pause', 'next', 'previous']),
  }),
},
```

---

## Phase 5: DJ Mode System Prompt

### 5.1 Add DJ Mode to Conversation Modes

**File**: `/workers/api/src/routes/chat-stream.ts`

**Update Mode Type** (around line 58):
```typescript
mode: z.enum(['analyze', 'create', 'edit', 'dj']),
```

### 5.2 Create DJ Mode System Prompt

**File**: `/workers/api/src/routes/chat-stream.ts`

**Add DJ Mode Prompt Generation** (in getSystemPrompt function):
```typescript
function getDJModePrompt(nowPlaying?: {
  artist: string
  progress_ms: number
  total_ms: number
  track: string
}, queueDepth?: number): string {
  const trackInfo = nowPlaying
    ? `Now Playing: "${nowPlaying.track}" by ${nowPlaying.artist} (${Math.floor(nowPlaying.progress_ms / 1000)}s / ${Math.floor(nowPlaying.total_ms / 1000)}s)`
    : 'Nothing currently playing'

  const queueInfo = queueDepth !== undefined
    ? `Queue Depth: ${queueDepth} tracks`
    : 'Queue: Unknown'

  return `<role>
You are a live DJ assistant. Music is playing RIGHT NOW. Your job is to:
1. Keep the vibe going by maintaining queue depth (aim for 5-10 tracks ahead)
2. React to user requests ("more chill", "add some 90s hip hop", "skip this")
3. Notice when queue is getting low and proactively suggest additions
4. Learn from skips - if the user skips a track, note the style for future avoidance
</role>

<current_state>
${trackInfo}
${queueInfo}
</current_state>

<behaviors>
- When the user says "skip" or "next", use control_playback to skip, then acknowledge what was skipped
- When asked "what's playing", use get_now_playing and describe the current track naturally
- When asked to queue something, search for it first, then use add_to_queue with the track URI
- When queue drops below 5 tracks, suggest additions based on the current vibe
- For vibe changes, add 3-5 tracks that transition gradually - don't hard pivot
- Always check the queue before adding to avoid duplicates
</behaviors>

<tool_usage>
- get_now_playing: Check what's currently playing
- get_queue: See upcoming tracks
- add_to_queue: Add a track (requires spotify:track:xxx URI)
- control_playback: Play, pause, skip, or go back
- search_spotify_tracks: Find tracks to queue
- get_recommendations: Get algorithmic suggestions based on seed tracks
</tool_usage>

<response_style>
Keep responses brief and conversational - you're a DJ, not writing an essay.
When you queue tracks, just confirm naturally: "Added 'Song' by Artist to your queue"
When skipping: "Skipping this one - what kind of vibe are you feeling?"
</response_style>`
}
```

### 5.3 Integrate DJ Mode into Chat Stream

**File**: `/workers/api/src/routes/chat-stream.ts`

**In the message handler**, add DJ mode handling:
```typescript
// If DJ mode, fetch current playback state for context
let djContext: {nowPlaying?: {...}; queueDepth?: number} | undefined
if (request.mode === 'dj') {
  try {
    const [nowPlayingRes, queueRes] = await Promise.all([
      fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: {Authorization: `Bearer ${spotifyToken}`},
      }),
      fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: {Authorization: `Bearer ${spotifyToken}`},
      }),
    ])

    if (nowPlayingRes.ok) {
      const npData = await nowPlayingRes.json()
      djContext = {
        nowPlaying: {
          artist: npData.item?.artists?.[0]?.name,
          progress_ms: npData.progress_ms,
          total_ms: npData.item?.duration_ms,
          track: npData.item?.name,
        },
      }
    }

    if (queueRes.ok) {
      const qData = await queueRes.json()
      djContext = {...djContext, queueDepth: qData.queue?.length ?? 0}
    }
  } catch (e) {
    getLogger()?.warn('[Stream] Failed to fetch DJ context:', e)
  }
}

// Use DJ mode prompt if in DJ mode
const systemPrompt = request.mode === 'dj'
  ? getDJModePrompt(djContext?.nowPlaying, djContext?.queueDepth)
  : getSystemPrompt(request.mode, playlistId)
```

---

## Phase 6: Frontend DJ Mode Integration

### 6.1 Add DJ Mode to Mode Selector

**File**: `/apps/web/src/features/chat/ChatInterface.tsx`

**Update Mode Type**:
```typescript
type ConversationMode = 'analyze' | 'create' | 'dj' | 'edit'
```

**Add DJ Mode Button** (in mode selector JSX):
```tsx
<button
  className={`mode-button ${mode === 'dj' ? 'active' : ''}`}
  onClick={() => handleModeChange('dj')}
  type="button"
>
  🎧 DJ
</button>
```

### 6.2 Update Mode-Specific UI

**File**: `/apps/web/src/features/chat/ChatInterface.tsx`

**Add DJ Mode Welcome Message**:
```typescript
const getWelcomeMessage = (mode: ConversationMode): string => {
  switch (mode) {
    case 'dj':
      return "I'm your live DJ assistant! I can see what's playing and help shape your mix. Try:\n• \"What's playing?\"\n• \"Add some chill jazz\"\n• \"Skip this and play something more upbeat\"\n• \"Queue up some 90s hip hop\""
    // ... existing cases
  }
}
```

### 6.3 Add DJ Mode Styles

**File**: `/apps/web/src/styles/chat-interface.css`

**Add**:
```css
.mode-button[data-mode="dj"] {
  background: linear-gradient(135deg, #667eea, #764ba2);
}

.mode-button[data-mode="dj"].active {
  box-shadow: 0 0 12px rgba(102, 126, 234, 0.5);
}
```

---

## Implementation Checklist

### Phase 1: OAuth & Auth
- [ ] Add `user-modify-playback-state` scope to spotify-openapi.ts
- [ ] Add `streaming` scope to spotify-openapi.ts
- [ ] Update CLAUDE.md documentation
- [ ] Update product-capabilities.md

### Phase 2: Player API Routes
- [ ] Create player-openapi.ts with all endpoints
- [ ] Register routes in index.ts
- [ ] Add Zod schemas to shared-types
- [ ] Test all endpoints manually

### Phase 3: NowPlaying Component
- [ ] Create NowPlaying.tsx component
- [ ] Create now-playing.css styles
- [ ] Integrate into App.tsx layout
- [ ] Test polling and controls

### Phase 4: Claude Tools
- [ ] Add tool schemas to spotify-tools.ts
- [ ] Add tool definitions to spotifyTools array
- [ ] Implement tool functions
- [ ] Add Native Tool wrappers in chat-stream.ts
- [ ] Test tools via chat

### Phase 5: DJ Mode Prompt
- [ ] Add 'dj' to mode enum
- [ ] Create getDJModePrompt function
- [ ] Add DJ context fetching
- [ ] Integrate into chat stream handler

### Phase 6: Frontend DJ Mode
- [ ] Add DJ mode to mode selector
- [ ] Update welcome messages
- [ ] Add DJ mode styles
- [ ] End-to-end testing

---

## Testing Strategy

### Unit Tests
- Player route error handling
- Tool function edge cases
- Schema validation

### Integration Tests
- OAuth flow with new scopes
- Player API → Spotify API
- Tool execution in chat stream

### E2E Tests
- Full DJ mode flow
- Queue management
- Playback controls

---

## Rollout Plan

1. **Deploy OAuth changes first** - Users can re-auth at their leisure
2. **Deploy backend routes** - No visible changes yet
3. **Deploy Claude tools** - Test in existing modes
4. **Deploy NowPlaying component** - Visible but non-blocking
5. **Deploy DJ mode** - Full feature launch

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Existing users lose access | Graceful degradation - features work if scopes present |
| Rate limiting | Use rateLimitedSpotifyCall for all new endpoints |
| Premium-only features | Detect free tier and show appropriate message |
| Polling performance | 1s interval with cleanup, pause when tab hidden |
| Token expiration mid-DJ | Handle 401 and prompt re-auth |
