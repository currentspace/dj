import type {MixSession, QueuedTrack, SessionPreferences, SteerVibeResponse, UpdateVibeResponse} from '@dj/shared-types'

import {useMutation, useQueryClient} from '@tanstack/react-query'

import {mixApiClient} from '../../lib/mix-api-client'
import {emitDebug} from '../../stores/debugStore'
import {queryKeys} from './queryKeys'

export function useAddToQueueMutation() {
  const queryClient = useQueryClient()

  return useMutation<QueuedTrack[], Error, {position?: number; trackUri: string}, {previousSession: MixSession | null | undefined}>({
    mutationFn: async ({position, trackUri}) => {
      emitDebug('api', 'addToQueue', `Adding track to queue: ${trackUri}`)
      return mixApiClient.addToQueue(trackUri, position)
    },
    onError: (_err, _vars, context) => {
      // Rollback optimistic update
      if (context?.previousSession) {
        queryClient.setQueryData(queryKeys.mix.session(), context.previousSession)
      }
    },
    onMutate: async ({position, trackUri}) => {
      await queryClient.cancelQueries({queryKey: queryKeys.mix.session()})
      const previousSession = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())

      if (previousSession) {
        const optimisticTrack: QueuedTrack = {
          addedBy: 'user',
          albumArt: undefined,
          artist: 'Loading...',
          name: 'Loading...',
          position: position ?? previousSession.queue.length,
          trackId: trackUri,
          trackUri,
          vibeScore: 0,
        }
        const newQueue = position !== undefined
          ? [...previousSession.queue.slice(0, position), optimisticTrack, ...previousSession.queue.slice(position)]
          : [...previousSession.queue, optimisticTrack]

        queryClient.setQueryData(queryKeys.mix.session(), {...previousSession, queue: newQueue})
      }

      return {previousSession}
    },
    onSuccess: (updatedQueue) => {
      const session = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())
      if (session) {
        queryClient.setQueryData(queryKeys.mix.session(), {...session, queue: updatedQueue})
      }
    },
  })
}

export function useEndSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      emitDebug('api', 'endSession', 'Ending session')
      await mixApiClient.endSession()
      emitDebug('api', 'endSession', 'Session ended')
    },
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.mix.session(), null)
      queryClient.setQueryData(queryKeys.mix.suggestions(), [])
    },
  })
}

export function useRemoveFromQueueMutation() {
  const queryClient = useQueryClient()

  return useMutation<QueuedTrack[], Error, number, {previousSession: MixSession | null | undefined}>({
    mutationFn: async (position) => {
      return mixApiClient.removeFromQueue(position)
    },
    onError: (_err, _pos, context) => {
      if (context?.previousSession) {
        queryClient.setQueryData(queryKeys.mix.session(), context.previousSession)
      }
    },
    onMutate: async (position) => {
      await queryClient.cancelQueries({queryKey: queryKeys.mix.session()})
      const previousSession = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())

      if (previousSession) {
        const newQueue = previousSession.queue.filter((track) => track.position !== position)
        queryClient.setQueryData(queryKeys.mix.session(), {...previousSession, queue: newQueue})
      }

      return {previousSession}
    },
    onSuccess: (updatedQueue) => {
      const session = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())
      if (session) {
        queryClient.setQueryData(queryKeys.mix.session(), {...session, queue: updatedQueue})
      }
    },
  })
}

export function useReorderQueueMutation() {
  const queryClient = useQueryClient()

  return useMutation<QueuedTrack[], Error, {from: number; to: number}, {previousSession: MixSession | null | undefined}>({
    mutationFn: async ({from, to}) => {
      return mixApiClient.reorderQueue(from, to)
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSession) {
        queryClient.setQueryData(queryKeys.mix.session(), context.previousSession)
      }
    },
    onMutate: async ({from, to}) => {
      await queryClient.cancelQueries({queryKey: queryKeys.mix.session()})
      const previousSession = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())

      if (previousSession) {
        const newQueue = [...previousSession.queue]
        const [movedTrack] = newQueue.splice(from, 1)
        newQueue.splice(to, 0, movedTrack)
        queryClient.setQueryData(queryKeys.mix.session(), {...previousSession, queue: newQueue})
      }

      return {previousSession}
    },
    onSuccess: (updatedQueue) => {
      const session = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())
      if (session) {
        queryClient.setQueryData(queryKeys.mix.session(), {...session, queue: updatedQueue})
      }
    },
  })
}

export function useSetBpmRangeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({max, min}: {max: number; min: number}): Promise<UpdateVibeResponse> => {
      return mixApiClient.updateVibe({bpmRange: {max, min}})
    },
    onSuccess: (response) => {
      const session = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())
      if (session) {
        queryClient.setQueryData(queryKeys.mix.session(), {
          ...session,
          queue: response.queue ?? session.queue,
          vibe: response.vibe,
        })
      }
      queryClient.invalidateQueries({queryKey: queryKeys.mix.suggestions()})
    },
  })
}

export function useSetEnergyDirectionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (direction: 'building' | 'steady' | 'winding_down'): Promise<UpdateVibeResponse> => {
      return mixApiClient.updateVibe({energyDirection: direction})
    },
    onSuccess: (response) => {
      const session = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())
      if (session) {
        queryClient.setQueryData(queryKeys.mix.session(), {
          ...session,
          queue: response.queue ?? session.queue,
          vibe: response.vibe,
        })
      }
      queryClient.invalidateQueries({queryKey: queryKeys.mix.suggestions()})
    },
  })
}

export function useSetEnergyLevelMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (level: number): Promise<UpdateVibeResponse> => {
      return mixApiClient.updateVibe({energyLevel: level})
    },
    onSuccess: (response) => {
      const session = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())
      if (session) {
        queryClient.setQueryData(queryKeys.mix.session(), {
          ...session,
          queue: response.queue ?? session.queue,
          vibe: response.vibe,
        })
      }
      queryClient.invalidateQueries({queryKey: queryKeys.mix.suggestions()})
    },
  })
}

export function useStartSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({preferences, seedPlaylistId}: {preferences?: SessionPreferences; seedPlaylistId?: string}) => {
      emitDebug('api', 'startSession', `Starting session${seedPlaylistId ? ` (seed: ${seedPlaylistId})` : ''}`)
      const t0 = Date.now()
      const session = await mixApiClient.startSession(preferences, seedPlaylistId)
      emitDebug('api', 'startSession', `Session started: ${session.queue.length} tracks in queue`, undefined, {durationMs: Date.now() - t0})
      return session
    },
    onSuccess: (session) => {
      queryClient.setQueryData(queryKeys.mix.session(), session)
      queryClient.invalidateQueries({queryKey: queryKeys.mix.suggestions()})
    },
  })
}

export function useSteerVibeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({direction, intensity}: {direction: string; intensity?: number}): Promise<SteerVibeResponse> => {
      return mixApiClient.steerVibe(direction, intensity)
    },
    onSuccess: (response) => {
      const session = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())
      if (session) {
        queryClient.setQueryData(queryKeys.mix.session(), {
          ...session,
          queue: response.queue ?? session.queue,
          vibe: response.vibe,
        })
      }
      queryClient.invalidateQueries({queryKey: queryKeys.mix.suggestions()})
    },
  })
}
