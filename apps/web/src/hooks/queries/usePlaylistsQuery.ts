import type {SpotifyPlaylist} from '@dj/shared-types'

import {useQuery} from '@tanstack/react-query'

import {queryKeys} from './queryKeys'

interface AuthError extends Error {
  isAuthError: boolean
}

export function usePlaylistsQuery(token: null | string) {
  return useQuery({
    enabled: !!token,
    queryFn: async (): Promise<SpotifyPlaylist[]> => {
      const response = await fetch('/api/spotify/playlists', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (response.status === 401) {
        const error = new Error('Session expired. Please log in again.')
        ;(error as AuthError).isAuthError = true
        throw error
      }

      if (!response.ok) throw new Error('Failed to load playlists')
      const data = (await response.json()) as {items?: SpotifyPlaylist[]}
      return data.items ?? []
    },
    queryKey: queryKeys.spotify.playlists(token),
    staleTime: 5 * 60_000,
  })
}
