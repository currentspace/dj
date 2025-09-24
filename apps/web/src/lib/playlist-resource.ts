// Playlist resource management using React 19 patterns
import { getUserPlaylists } from './api-client'
import type { SpotifyPlaylist } from '@dj/shared-types'

interface PlaylistsResponse {
  items: SpotifyPlaylist[]
}

type PlaylistResource = {
  promise: Promise<PlaylistsResponse>
  status: 'pending' | 'fulfilled' | 'rejected'
  value?: PlaylistsResponse
  error?: Error
}

const cache = new Map<string, PlaylistResource>()

export function createPlaylistResource(key: string = 'default'): PlaylistResource {
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

export function clearPlaylistCache(key?: string) {
  if (key) {
    cache.delete(key)
  } else {
    cache.clear()
  }
}

// Helper to preload playlists
export function preloadPlaylists() {
  createPlaylistResource()
}