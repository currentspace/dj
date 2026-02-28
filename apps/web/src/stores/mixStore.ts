/**
 * Mix Store - Zustand 5 + subscribeWithSelector
 * Manages mix session, queue, suggestions, and vibe controls
 */

import type {MixSession, QueuedTrack, SessionPreferences, SteerVibeResponse, Suggestion} from '@dj/shared-types'

import {create} from 'zustand'
import {subscribeWithSelector} from 'zustand/middleware'

import {mixApiClient, type SteerStreamEvent} from '../lib/mix-api-client'
import {emitDebug} from './debugStore'

// =============================================================================
// TYPES
// =============================================================================

interface MixStoreState {
  // Queue actions (server handles auto-fill)
  addToQueue: (trackUri: string, position?: number) => Promise<void>
  // Session actions
  clearError: () => void
  clearSteerProgress: () => void

  // Suggestions actions
  clearSuggestionsError: () => void
  // Vibe actions
  clearVibeError: () => void
  endSession: () => Promise<void>

  // Session state
  error: null | string
  isLoading: boolean

  refreshSession: () => Promise<MixSession | null>
  refreshSuggestions: () => Promise<void>
  removeFromQueue: (position: number) => Promise<void>

  reorderQueue: (from: number, to: number) => Promise<void>
  session: MixSession | null
  setBpmRange: (min: number, max: number) => Promise<void>
  setEnergyDirection: (direction: 'building' | 'steady' | 'winding_down') => Promise<void>
  setEnergyLevel: (level: number) => void

  setSession: (session: MixSession | null) => void
  startSession: (preferences?: SessionPreferences, seedPlaylistId?: string) => Promise<void>
  // Steer streaming state
  steerDirection: null | string

  steerEvents: SteerStreamEvent[]
  steerInProgress: boolean

  steerVibe: (direction: string, intensity?: number) => Promise<SteerVibeResponse | undefined>
  // Streaming steer actions
  steerVibeStream: (direction: string) => Promise<void>
  // Suggestions state (preview of what server will add)
  suggestions: Suggestion[]
  suggestionsError: null | string
  suggestionsLoading: boolean

  vibeError: null | string
  // Vibe state
  vibeUpdating: boolean
}

// =============================================================================
// STORE
// =============================================================================

// Private state for debouncing
let debounceTimer: null | ReturnType<typeof setTimeout> = null
let initialFetchDone = false

export const useMixStore = create<MixStoreState>()(
  subscribeWithSelector((set, get) => {
    // ==========================================================================
    // ACTIONS
    // ==========================================================================

    return {
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

        set({error: null, session: {...session, queue: newQueue}})
        emitDebug('api', 'addToQueue', `Adding track to queue: ${trackUri}`)

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
              error: err instanceof Error ? err.message : 'Failed to add to queue',
              session: {...currentSession, queue: previousQueue},
            })
          }
        }
      },
      // Session actions
      clearError: () => set({error: null}),
      clearSteerProgress: () => {
        set({
          steerDirection: null,
          steerEvents: [],
          steerInProgress: false,
        })
      },
      // Suggestions actions
      clearSuggestionsError: () => set({suggestionsError: null}),
      // Vibe actions
      clearVibeError: () => set({vibeError: null}),
      endSession: async () => {
        set({error: null, isLoading: true})
        emitDebug('api', 'endSession', 'Ending session')

        try {
          await mixApiClient.endSession()
          emitDebug('api', 'endSession', 'Session ended')
          set({isLoading: false, session: null, suggestions: []})
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Failed to end session',
            isLoading: false,
          })
        }
      },
      // Initial state
      error: null,
      isLoading: false,
      refreshSession: async () => {
        try {
          const fetchedSession = await mixApiClient.getCurrentSession()
          set({error: null, session: fetchedSession})
          return fetchedSession
        } catch (err) {
          set({error: err instanceof Error ? err.message : 'Failed to fetch session'})
          return null
        }
      },
      refreshSuggestions: async () => {
        const {session} = get()
        if (!session) {
          set({suggestions: []})
          return
        }

        set({suggestionsError: null, suggestionsLoading: true})

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
      removeFromQueue: async (position) => {
        const {session} = get()
        if (!session) {
          set({error: 'No active session'})
          return
        }

        const previousQueue = session.queue
        const newQueue = session.queue.filter((track) => track.position !== position)

        set({error: null, session: {...session, queue: newQueue}})

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
              error: err instanceof Error ? err.message : 'Failed to remove from queue',
              session: {...currentSession, queue: previousQueue},
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

        set({error: null, session: {...session, queue: newQueue}})

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
              error: err instanceof Error ? err.message : 'Failed to reorder queue',
              session: {...currentSession, queue: previousQueue},
            })
          }
        }
      },

      session: null,

      setBpmRange: async (min, max) => {
        const {session} = get()
        if (!session) {
          set({vibeError: 'No active session'})
          return
        }

        set({vibeError: null, vibeUpdating: true})

        try {
          const response = await mixApiClient.updateVibe({bpmRange: {max, min}})
          const currentSession = get().session
          if (currentSession) {
            // Update vibe and queue (server rebuilds queue after vibe change)
            set({
              session: {
                ...currentSession,
                queue: response.queue ?? currentSession.queue,
                vibe: response.vibe,
              },
              vibeUpdating: false,
            })
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

        set({vibeError: null, vibeUpdating: true})

        try {
          const response = await mixApiClient.updateVibe({energyDirection: direction})
          const currentSession = get().session
          if (currentSession) {
            // Update vibe and queue (server rebuilds queue after vibe change)
            set({
              session: {
                ...currentSession,
                queue: response.queue ?? currentSession.queue,
                vibe: response.vibe,
              },
              vibeUpdating: false,
            })
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
          set({vibeError: null, vibeUpdating: true})

          try {
            const response = await mixApiClient.updateVibe({energyLevel: level})
            const currentSession = get().session
            if (currentSession) {
              // Update vibe and queue (server rebuilds queue after vibe change)
              set({
                session: {
                  ...currentSession,
                  queue: response.queue ?? currentSession.queue,
                  vibe: response.vibe,
                },
                vibeUpdating: false,
              })
            }
          } catch (err) {
            set({
              vibeError: err instanceof Error ? err.message : 'Failed to update energy level',
              vibeUpdating: false,
            })
          }
        }, 300) // debounce energy level changes
      },

      // Direct session update (for use when API responses include updated session)
      setSession: (session) => {
        set({error: null, session})
      },

      startSession: async (preferences, seedPlaylistId) => {
        set({error: null, isLoading: true})
        emitDebug('api', 'startSession', `Starting session${seedPlaylistId ? ` (seed: ${seedPlaylistId})` : ''}`)
        const t0 = Date.now()

        try {
          const newSession = await mixApiClient.startSession(preferences, seedPlaylistId)
          emitDebug('api', 'startSession', `Session started: ${newSession.queue.length} tracks in queue`, undefined, {durationMs: Date.now() - t0})
          set({isLoading: false, session: newSession})

          // Fetch initial suggestions
          get().refreshSuggestions()
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Failed to start session',
            isLoading: false,
          })
        }
      },

      steerDirection: null,

      steerEvents: [],

      steerInProgress: false,

      steerVibe: async (direction, intensity) => {
        const {session} = get()
        if (!session) {
          set({vibeError: 'No active session'})
          return undefined
        }

        set({vibeError: null, vibeUpdating: true})

        try {
          const response = await mixApiClient.steerVibe(direction, intensity)
          const currentSession = get().session
          if (currentSession) {
            // Update vibe and queue (server rebuilds queue after vibe steer)
            set({
              session: {
                ...currentSession,
                queue: response.queue ?? currentSession.queue,
                vibe: response.vibe,
              },
              vibeUpdating: false,
            })
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

      // Streaming steer actions
      steerVibeStream: async (direction) => {
        const {session} = get()
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
              const currentSession = get().session
              if (currentSession) {
                set({
                  session: {
                    ...currentSession,
                    vibe: event.data.vibe,
                  },
                })
              }
            }

            if (event.type === 'done') {
              const currentSession = get().session
              if (currentSession && event.data.queue) {
                set({
                  session: {
                    ...currentSession,
                    queue: event.data.queue,
                  },
                  vibeUpdating: false,
                })
              } else {
                set({vibeUpdating: false})
              }
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

      suggestions: [],

      suggestionsError: null,

      suggestionsLoading: false,

      vibeError: null,

      vibeUpdating: false,
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

let previousVibeHash: null | string = null

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
