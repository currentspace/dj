/**
 * Mix Steer Store - Zustand 5 (client-only SSE streaming state)
 *
 * Server state (session, queue, suggestions, vibe) is managed by react-query.
 * This store only handles the SSE streaming steer progress UI state.
 */

import type {MixSession} from '@dj/shared-types'

import {create} from 'zustand'

import {queryKeys} from '../hooks/queries/queryKeys'
import {mixApiClient, type SteerStreamEvent} from '../lib/mix-api-client'
import {queryClient} from '../lib/query-client'
import {emitDebug} from './debugStore'

// =============================================================================
// TYPES
// =============================================================================

interface MixSteerStoreState {
  clearSteerProgress: () => void
  steerDirection: null | string
  steerEvents: SteerStreamEvent[]
  steerInProgress: boolean
  steerVibeStream: (direction: string) => Promise<void>
  vibeError: null | string
  vibeUpdating: boolean
}

// =============================================================================
// STORE
// =============================================================================

export const useMixSteerStore = create<MixSteerStoreState>()((set) => ({
  clearSteerProgress: () => {
    set({
      steerDirection: null,
      steerEvents: [],
      steerInProgress: false,
    })
  },

  steerDirection: null,
  steerEvents: [],
  steerInProgress: false,

  steerVibeStream: async (direction) => {
    const session = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())
    if (!session) {
      set({vibeError: 'No active session'})
      return
    }

    // Start streaming state
    set({
      steerDirection: direction,
      steerEvents: [],
      steerInProgress: true,
      vibeError: null,
      vibeUpdating: true,
    })

    try {
      await mixApiClient.steerVibeStream(direction, (event) => {
        // Emit steer events to debug
        emitDebug('steer', event.type, `Steer ${event.type}: ${event.data.message ?? event.data.stage ?? direction}`, event.data)

        // Accumulate events
        set((state) => ({
          steerEvents: [...state.steerEvents, event],
        }))

        // Handle specific event types
        if (event.type === 'vibe_update' && event.data.vibe) {
          const currentSession = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())
          if (currentSession) {
            queryClient.setQueryData(queryKeys.mix.session(), {
              ...currentSession,
              vibe: event.data.vibe,
            })
          }
        }

        if (event.type === 'done') {
          const currentSession = queryClient.getQueryData<MixSession | null>(queryKeys.mix.session())
          if (currentSession && event.data.queue) {
            queryClient.setQueryData(queryKeys.mix.session(), {
              ...currentSession,
              queue: event.data.queue,
            })
          }
          set({vibeUpdating: false})
          queryClient.invalidateQueries({queryKey: queryKeys.mix.suggestions()})
        }

        if (event.type === 'error') {
          set({
            vibeError: event.data.message ?? 'Failed to steer vibe',
            vibeUpdating: false,
          })
        }
      })
    } catch (err) {
      set({
        steerInProgress: false,
        vibeError: err instanceof Error ? err.message : 'Failed to steer vibe',
        vibeUpdating: false,
      })
    }
  },

  vibeError: null,
  vibeUpdating: false,
}))
