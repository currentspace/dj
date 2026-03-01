/**
 * useMixSession Hook
 *
 * Facade over react-query hooks. Preserves the same interface
 * that consumers (DJPage, MixPage) already use.
 */

import type {MixSession, SessionPreferences} from '@dj/shared-types'

import {useQueryClient} from '@tanstack/react-query'
import {useCallback} from 'react'

import {mixApiClient} from '../lib/mix-api-client'
import {
  queryKeys,
  useAddToQueueMutation,
  useEndSessionMutation,
  useMixSessionQuery,
  useRemoveFromQueueMutation,
  useReorderQueueMutation,
  useStartSessionMutation,
} from './queries'

interface UseMixSessionReturn {
  // Queue actions
  addToQueue: (trackUri: string, position?: number) => Promise<void>
  // Utility
  clearError: () => void
  // Session actions
  endSession: () => Promise<void>

  // State
  error: null | string
  isLoading: boolean
  refreshSession: () => Promise<MixSession | null>

  removeFromQueue: (position: number) => Promise<void>
  reorderQueue: (from: number, to: number) => Promise<void>
  session: MixSession | null

  setSession: (session: MixSession | null) => void
  startSession: (preferences?: SessionPreferences, seedPlaylistId?: string) => Promise<void>
}

export function useMixSession(): UseMixSessionReturn {
  const queryClient = useQueryClient()
  const {data: session = null} = useMixSessionQuery()

  const startMutation = useStartSessionMutation()
  const endMutation = useEndSessionMutation()
  const addMutation = useAddToQueueMutation()
  const removeMutation = useRemoveFromQueueMutation()
  const reorderMutation = useReorderQueueMutation()

  const startSession = useCallback(
    async (preferences?: SessionPreferences, seedPlaylistId?: string) => {
      await startMutation.mutateAsync({preferences, seedPlaylistId})
    },
    [startMutation],
  )

  const endSession = useCallback(async () => {
    await endMutation.mutateAsync()
  }, [endMutation])

  const addToQueue = useCallback(
    async (trackUri: string, position?: number) => {
      await addMutation.mutateAsync({position, trackUri})
    },
    [addMutation],
  )

  const removeFromQueue = useCallback(
    async (position: number) => {
      await removeMutation.mutateAsync(position)
    },
    [removeMutation],
  )

  const reorderQueue = useCallback(
    async (from: number, to: number) => {
      await reorderMutation.mutateAsync({from, to})
    },
    [reorderMutation],
  )

  const refreshSession = useCallback(async () => {
    const result = await queryClient.fetchQuery({
      queryFn: async () => {
        try {
          return await mixApiClient.getCurrentSession()
        } catch {
          return null
        }
      },
      queryKey: queryKeys.mix.session(),
    })
    return result
  }, [queryClient])

  const setSession = useCallback(
    (newSession: MixSession | null) => {
      queryClient.setQueryData(queryKeys.mix.session(), newSession)
    },
    [queryClient],
  )

  const clearError = useCallback(() => {
    startMutation.reset()
    endMutation.reset()
    addMutation.reset()
    removeMutation.reset()
    reorderMutation.reset()
  }, [startMutation, endMutation, addMutation, removeMutation, reorderMutation])

  // Aggregate loading from session query and start/end mutations
  const isLoading = startMutation.isPending || endMutation.isPending

  // Aggregate error from all mutations
  const error =
    startMutation.error?.message ??
    endMutation.error?.message ??
    addMutation.error?.message ??
    removeMutation.error?.message ??
    reorderMutation.error?.message ??
    null

  return {
    addToQueue,
    clearError,
    endSession,
    error,
    isLoading,
    refreshSession,
    removeFromQueue,
    reorderQueue,
    session,
    setSession,
    startSession,
  }
}
