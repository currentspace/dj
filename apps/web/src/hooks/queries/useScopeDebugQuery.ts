import {useQuery} from '@tanstack/react-query'

import {storage, STORAGE_KEYS} from '../useLocalStorage'
import {queryKeys} from './queryKeys'

interface ScopeDebugData {
  required_scopes: string[]
  scope_tests: {
    'playlist-read-private': boolean
    'user-read-private': boolean
  }
  token_info: {
    country: string
    display_name: string
    email: string
    product: string
    user_id: string
  }
}

export function useScopeDebugQuery() {
  return useQuery({
    enabled: !!getToken(),
    queryFn: async (): Promise<ScopeDebugData> => {
      const token = getToken()
      if (!token) throw new Error('No Spotify token found')

      const response = await fetch('/api/spotify/debug/scopes', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch scope debug info: ${response.status} ${response.statusText}`)
      }

      return (await response.json()) as ScopeDebugData
    },
    queryKey: queryKeys.spotify.scopes(),
    staleTime: Infinity,
  })
}

function getToken(): null | string {
  const tokenData = storage.get<null | {expiresAt: null | number; token: string}>(
    STORAGE_KEYS.SPOTIFY_TOKEN_DATA,
    null,
  )
  return tokenData?.token ?? null
}
