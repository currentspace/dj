import type { SpotifyPlaylist } from '@dj/shared-types'

// Playlist resource management using React 19 patterns
import { getUserPlaylists } from './api-client'

interface PlaylistResource {
  error?: Error
  promise: Promise<PlaylistsResponse>
  status: 'fulfilled' | 'pending' | 'rejected'
  value?: PlaylistsResponse
}

interface PlaylistsResponse {
  items: SpotifyPlaylist[]
}

const cache = new Map<string, PlaylistResource>()

export function clearPlaylistCache(key?: string) {
  if (key) {
    cache.delete(key)
  } else {
    cache.clear()
  }
}

export function createPlaylistResource(key = 'default'): PlaylistResource {
  // Check if we already have this resource
  const existing = cache.get(key)
  if (existing) {
    return existing
  }

  // Create new resource
  const resource: PlaylistResource = {
    promise: getUserPlaylists()
      .then((data: PlaylistsResponse) => {
        resource.status = 'fulfilled'
        resource.value = data
        return data
      })
      .catch((error: Error) => {
        resource.status = 'rejected'
        resource.error = error
        throw error
      }),
    status: 'pending'
  }

  cache.set(key, resource)
  return resource
}

// Helper to preload playlists
export function preloadPlaylists() {
  createPlaylistResource()
}