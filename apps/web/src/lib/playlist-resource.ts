// Playlist resource management using React 19 patterns
import { getUserPlaylists } from './api'

type PlaylistResource = {
  promise: Promise<any>
  status: 'pending' | 'fulfilled' | 'rejected'
  value?: any
  error?: any
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
      .then(data => {
        resource.status = 'fulfilled'
        resource.value = data
        return data
      })
      .catch(error => {
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