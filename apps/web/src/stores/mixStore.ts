/**
 * Mix Store - Zustand 5 + subscribeWithSelector
 * Manages mix session, queue, suggestions, and vibe controls
 */

import type {MixSession, QueuedTrack, SessionPreferences, SteerVibeResponse, Suggestion} from '@dj/shared-types'
import {create} from 'zustand'
import {subscribeWithSelector} from 'zustand/middleware'

import {mixApiClient} from '../lib/mix-api-client'

// =============================================================================
// TYPES
// =============================================================================

interface MixStoreState {
  // Session state
  error: string | null
  isLoading: boolean
  session: MixSession | null

  // Suggestions state (preview of what server will add)
  suggestions: Suggestion[]
  suggestionsLoading: boolean
  suggestionsError: string | null

  // Vibe state
  vibeUpdating: boolean
  vibeError: string | null

  // Session actions
  clearError: () => void
  endSession: () => Promise<void>
  refreshSession: () => Promise<MixSession | null>
  setSession: (session: MixSession | null) => void
  startSession: (preferences?: SessionPreferences, seedPlaylistId?: string) => Promise<void>

  // Queue actions (server handles auto-fill)
  addToQueue: (trackUri: string, position?: number) => Promise<void>
  removeFromQueue: (position: number) => Promise<void>
  reorderQueue: (from: number, to: number) => Promise<void>

  // Suggestions actions
  clearSuggestionsError: () => void
  refreshSuggestions: () => Promise<void>

  // Vibe actions
  clearVibeError: () => void
  setBpmRange: (min: number, max: number) => Promise<void>
  setEnergyDirection: (direction: 'building' | 'steady' | 'winding_down') => Promise<void>
  setEnergyLevel: (level: number) => void
  steerVibe: (direction: string, intensity?: number) => Promise<SteerVibeResponse | undefined>
}

// =============================================================================
// STORE
// =============================================================================

// Private state for debouncing
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let initialFetchDone = false

export const useMixStore = create<MixStoreState>()(
  subscribeWithSelector((set, get) => {
    // ==========================================================================
    // ACTIONS
    // ==========================================================================

    return {
      // Initial state
      error: null,
      isLoading: false,
      session: null,
      suggestions: [],
      suggestionsError: null,
      suggestionsLoading: false,
      vibeError: null,
      vibeUpdating: false,

      // Session actions
      clearError: () => set({error: null}),

      endSession: async () => {
        set({isLoading: true, error: null})

        try {
          await mixApiClient.endSession()
          set({session: null, suggestions: [], isLoading: false})
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Failed to end session',
            isLoading: false,
          })
        }
      },

      refreshSession: async () => {
        try {
          const fetchedSession = await mixApiClient.getCurrentSession()
          set({session: fetchedSession, error: null})
          return fetchedSession
        } catch (err) {
          set({error: err instanceof Error ? err.message : 'Failed to fetch session'})
          return null
        }
      },

      startSession: async (preferences, seedPlaylistId) => {
        set({isLoading: true, error: null})

        try {
          const newSession = await mixApiClient.startSession(preferences, seedPlaylistId)
          set({session: newSession, isLoading: false})

          // Fetch initial suggestions
          get().refreshSuggestions()
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Failed to start session',
            isLoading: false,
          })
        }
      },

      // Direct session update (for use when API responses include updated session)
      setSession: (session) => {
        set({session, error: null})
      },

      // Queue actions
      addToQueue: async (trackUri, position) => {
        const {session} = get()
        if (!session) {
          set({error: 'No active session'})
          return
        }

        // Optimistic update
        const optimisticTrack: QueuedTrack = {
          addedBy: 'user',
          albumArt: undefined,
          artist: 'Loading...',
          name: 'Loading...',
          position: position ?? session.queue.length,
          trackId: trackUri,
          trackUri,
          vibeScore: 0,
        }

        const previousQueue = session.queue
        const newQueue =
          position !== undefined
            ? [...session.queue.slice(0, position), optimisticTrack, ...session.queue.slice(position)]
            : [...session.queue, optimisticTrack]

        set({session: {...session, queue: newQueue}, error: null})

        try {
          const updatedQueue = await mixApiClient.addToQueue(trackUri, position)
          const currentSession = get().session
          if (currentSession) {
            set({session: {...currentSession, queue: updatedQueue}})
          }
        } catch (err) {
          // Revert on error
          const currentSession = get().session
          if (currentSession) {
            set({
              session: {...currentSession, queue: previousQueue},
              error: err instanceof Error ? err.message : 'Failed to add to queue',
            })
          }
        }
      },

      removeFromQueue: async (position) => {
        const {session} = get()
        if (!session) {
          set({error: 'No active session'})
          return
        }

        const previousQueue = session.queue
        const newQueue = session.queue.filter((track) => track.position !== position)

        set({session: {...session, queue: newQueue}, error: null})

        try {
          const updatedQueue = await mixApiClient.removeFromQueue(position)
          const currentSession = get().session
          if (currentSession) {
            set({session: {...currentSession, queue: updatedQueue}})
          }
        } catch (err) {
          const currentSession = get().session
          if (currentSession) {
            set({
              session: {...currentSession, queue: previousQueue},
              error: err instanceof Error ? err.message : 'Failed to remove from queue',
            })
          }
        }
      },

      reorderQueue: async (from, to) => {
        const {session} = get()
        if (!session) {
          set({error: 'No active session'})
          return
        }

        const previousQueue = session.queue
        const newQueue = [...session.queue]
        const [movedTrack] = newQueue.splice(from, 1)
        newQueue.splice(to, 0, movedTrack)

        set({session: {...session, queue: newQueue}, error: null})

        try {
          const updatedQueue = await mixApiClient.reorderQueue(from, to)
          const currentSession = get().session
          if (currentSession) {
            set({session: {...currentSession, queue: updatedQueue}})
          }
        } catch (err) {
          const currentSession = get().session
          if (currentSession) {
            set({
              session: {...currentSession, queue: previousQueue},
              error: err instanceof Error ? err.message : 'Failed to reorder queue',
            })
          }
        }
      },

      // Suggestions actions
      clearSuggestionsError: () => set({suggestionsError: null}),

      refreshSuggestions: async () => {
        const {session} = get()
        if (!session) {
          set({suggestions: []})
          return
        }

        set({suggestionsLoading: true, suggestionsError: null})

        try {
          const fetched = await mixApiClient.getSuggestions()
          set({suggestions: fetched, suggestionsLoading: false})
        } catch (err) {
          set({
            suggestionsError: err instanceof Error ? err.message : 'Failed to fetch suggestions',
            suggestionsLoading: false,
          })
        }
      },

      // Vibe actions
      clearVibeError: () => set({vibeError: null}),

      setBpmRange: async (min, max) => {
        const {session} = get()
        if (!session) {
          set({vibeError: 'No active session'})
          return
        }

        set({vibeUpdating: true, vibeError: null})

        try {
          const updatedVibe = await mixApiClient.updateVibe({bpmRange: {max, min}})
          const currentSession = get().session
          if (currentSession) {
            set({session: {...currentSession, vibe: updatedVibe}, vibeUpdating: false})
          }
        } catch (err) {
          set({
            vibeError: err instanceof Error ? err.message : 'Failed to update BPM range',
            vibeUpdating: false,
          })
        }
      },

      setEnergyDirection: async (direction) => {
        const {session} = get()
        if (!session) {
          set({vibeError: 'No active session'})
          return
        }

        set({vibeUpdating: true, vibeError: null})

        try {
          const updatedVibe = await mixApiClient.updateVibe({energyDirection: direction})
          const currentSession = get().session
          if (currentSession) {
            set({session: {...currentSession, vibe: updatedVibe}, vibeUpdating: false})
          }
        } catch (err) {
          set({
            vibeError: err instanceof Error ? err.message : 'Failed to update energy direction',
            vibeUpdating: false,
          })
        }
      },

      setEnergyLevel: (level) => {
        const {session} = get()
        if (!session) {
          set({vibeError: 'No active session'})
          return
        }

        // Debounce
        if (debounceTimer) clearTimeout(debounceTimer)

        debounceTimer = setTimeout(async () => {
          set({vibeUpdating: true, vibeError: null})

          try {
            const updatedVibe = await mixApiClient.updateVibe({energyLevel: level})
            const currentSession = get().session
            if (currentSession) {
              set({session: {...currentSession, vibe: updatedVibe}, vibeUpdating: false})
            }
          } catch (err) {
            set({
              vibeError: err instanceof Error ? err.message : 'Failed to update energy level',
              vibeUpdating: false,
            })
          }
        }, 300) // debounce energy level changes
      },

      steerVibe: async (direction, intensity) => {
        const {session} = get()
        if (!session) {
          set({vibeError: 'No active session'})
          return undefined
        }

        set({vibeUpdating: true, vibeError: null})

        try {
          const response = await mixApiClient.steerVibe(direction, intensity)
          const currentSession = get().session
          if (currentSession) {
            set({session: {...currentSession, vibe: response.vibe}, vibeUpdating: false})
          }
          return response
        } catch (err) {
          set({
            vibeError: err instanceof Error ? err.message : 'Failed to steer vibe',
            vibeUpdating: false,
          })
          return undefined
        }
      },
    }
  })
)

// =============================================================================
// INITIALIZATION - Fetch session on first access
// =============================================================================

export function initializeMixStore(): void {
  if (initialFetchDone) return
  initialFetchDone = true
  useMixStore.getState().refreshSession()
}

// =============================================================================
// SUBSCRIPTIONS - Refresh suggestions on vibe change (server handles queue auto-fill)
// =============================================================================

let previousVibeHash: string | null = null

// Vibe change → Refresh suggestions (server rebuilds queue automatically)
useMixStore.subscribe(
  (s) => s.session?.vibe,
  (vibe) => {
    if (!vibe) {
      previousVibeHash = null
      return
    }

    const vibeHash = JSON.stringify({
      bpmRange: vibe.bpmRange,
      energyDirection: vibe.energyDirection,
      energyLevel: vibe.energyLevel,
      era: vibe.era,
      genres: vibe.genres,
      mood: vibe.mood,
    })

    if (previousVibeHash !== null && previousVibeHash !== vibeHash) {
      console.log('[mixStore] Vibe changed, refreshing suggestions...')
      useMixStore.getState().refreshSuggestions()
    }

    previousVibeHash = vibeHash
  }
)
