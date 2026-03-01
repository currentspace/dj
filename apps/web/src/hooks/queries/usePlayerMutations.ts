import {useMutation, useQuery} from '@tanstack/react-query'

import {playerApiClient} from '../../lib/player-api-client'
import {queryKeys} from './queryKeys'

interface QueueTrack {
  albumArt: null | string
  artistName: string
  duration: number
  name: string
  uri: string
}

interface SpotifyQueue {
  currently_playing: null | QueueTrack
  queue: QueueTrack[]
}

export function useNextMutation() {
  return useMutation({
    mutationFn: () => playerApiClient.next(),
  })
}

export function usePlayerQueue(token: null | string, enabled: boolean) {
  return useQuery({
    enabled: !!token && enabled,
    queryFn: async (): Promise<SpotifyQueue> => {
      const response = await fetch('/api/player/queue', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (!response.ok) throw new Error('Failed to fetch queue')

      const data = (await response.json()) as {
        currently_playing?: null | {
          album?: {images?: {url: string}[]}
          artists?: {name: string}[]
          duration_ms?: number
          name?: string
          uri?: string
        }
        queue?: {
          album?: {images?: {url: string}[]}
          artists?: {name: string}[]
          duration_ms?: number
          name?: string
          uri?: string
        }[]
      }

      return {
        currently_playing: data.currently_playing
          ? {
              albumArt: data.currently_playing.album?.images?.[0]?.url ?? null,
              artistName: data.currently_playing.artists?.map(a => a.name).join(', ') ?? '',
              duration: data.currently_playing.duration_ms ?? 0,
              name: data.currently_playing.name ?? 'Unknown',
              uri: data.currently_playing.uri ?? '',
            }
          : null,
        queue: (data.queue ?? []).slice(0, 10).map(track => ({
          albumArt: track.album?.images?.[0]?.url ?? null,
          artistName: track.artists?.map(a => a.name).join(', ') ?? '',
          duration: track.duration_ms ?? 0,
          name: track.name ?? 'Unknown',
          uri: track.uri ?? '',
        })),
      }
    },
    queryKey: queryKeys.player.queue(token),
    refetchInterval: enabled ? 10_000 : false,
    staleTime: 0,
  })
}

export function usePlayPauseMutation() {
  return useMutation({
    mutationFn: async (isPlaying: boolean) => {
      if (isPlaying) {
        return playerApiClient.pause()
      }
      return playerApiClient.play()
    },
  })
}

export function usePreviousMutation() {
  return useMutation({
    mutationFn: () => playerApiClient.previous(),
  })
}

export function useSeekMutation() {
  return useMutation({
    mutationFn: (positionMs: number) => playerApiClient.seek(positionMs),
  })
}
