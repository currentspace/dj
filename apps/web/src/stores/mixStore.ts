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

// Auto-queue configuration
const TARGET_QUEUE_SIZE = 5

interface MixStoreState {
  // Session state
  error: string | null
  isLoading: boolean
  session: MixSession | null

  // Suggestions state
  suggestions: Suggestion[]
  suggestionsLoading: boolean
  suggestionsError: string | null

  // Vibe state
  vibeUpdating: boolean
  vibeError: string | null

  // Auto-queue state
  autoQueueEnabled: boolean
  autoQueueInProgress: boolean

  // Session actions
  clearError: () => void
  endSession: () => Promise<void>
  refreshSession: () => Promise<MixSession | null>
  setSession: (session: MixSession | null) => void
  startSession: (preferences?: SessionPreferences, seedPlaylistId?: string) => Promise<void>

  // Queue actions
  addToQueue: (trackUri: string, position?: number) => Promise<void>
  autoFillQueue: () => Promise<void>
  clearAndRebuildQueue: () => Promise<void>
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
      autoQueueEnabled: true,
      autoQueueInProgress: false,
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

      // Auto-queue actions
      autoFillQueue: async () => {
        const {session, suggestions, autoQueueEnabled, autoQueueInProgress, suggestionsLoading} = get()
        if (!session || !autoQueueEnabled || autoQueueInProgress || suggestionsLoading) return

        const queueSize = session.queue.length
        const tracksNeeded = TARGET_QUEUE_SIZE - queueSize

        if (tracksNeeded <= 0 || suggestions.length === 0) return

        // Get URIs already in queue to avoid duplicates
        const queuedUris = new Set(session.queue.map((t) => t.trackUri))
        const historyUris = new Set(session.history.map((t) => t.trackUri))

        // Find suggestions not already in queue or history
        const availableSuggestions = suggestions.filter(
          (s) => !queuedUris.has(s.trackUri) && !historyUris.has(s.trackUri)
        )

        if (availableSuggestions.length === 0) {
          console.log('[mixStore] No available suggestions to add, refreshing...')
          get().refreshSuggestions()
          return
        }

        const toAdd = availableSuggestions.slice(0, tracksNeeded)
        console.log(`[mixStore] Auto-filling queue with ${toAdd.length} tracks`)

        set({autoQueueInProgress: true})

        try {
          // Add tracks sequentially to both our queue and Spotify's playback queue
          for (const suggestion of toAdd) {
            await mixApiClient.addToQueue(suggestion.trackUri)

            // Also queue to Spotify's playback queue (best effort)
            try {
              await mixApiClient.queueToSpotify(suggestion.trackUri)
              console.log('[mixStore] Track queued to Spotify:', suggestion.name)
            } catch {
              // Non-fatal - might fail if no active device or not Premium
              console.warn('[mixStore] Could not queue to Spotify')
            }
          }

          // Refresh session to get updated queue
          const updatedSession = await mixApiClient.getCurrentSession()
          set({session: updatedSession, autoQueueInProgress: false})

          // Remove added tracks from suggestions
          const addedUris = new Set(toAdd.map((s) => s.trackUri))
          set({suggestions: suggestions.filter((s) => !addedUris.has(s.trackUri))})

          // If we still need more suggestions, fetch them
          if (availableSuggestions.length <= tracksNeeded) {
            get().refreshSuggestions()
          }
        } catch (err) {
          console.error('[mixStore] Auto-fill error:', err)
          set({autoQueueInProgress: false})
        }
      },

      clearAndRebuildQueue: async () => {
        const {session} = get()
        if (!session) return

        console.log('[mixStore] Clearing and rebuilding queue for vibe change')

        // Clear current queue
        const currentQueue = [...session.queue]
        for (const track of currentQueue) {
          try {
            await mixApiClient.removeFromQueue(track.position)
          } catch {
            // Ignore errors, queue may have shifted
          }
        }

        // Refresh session and suggestions
        const [updatedSession] = await Promise.all([
          mixApiClient.getCurrentSession(),
          get().refreshSuggestions(),
        ])

        set({session: updatedSession})

        // Auto-fill will be triggered by the subscription
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
// SUBSCRIPTIONS - Auto-queue management
// =============================================================================

let previousVibeHash: string | null = null

// Vibe change → Clear queue and rebuild with new suggestions
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
      console.log('[mixStore] Vibe changed, clearing and rebuilding queue...')
      useMixStore.getState().clearAndRebuildQueue()
    }

    previousVibeHash = vibeHash
  }
)

// Suggestions loaded → Auto-fill queue if needed
useMixStore.subscribe(
  (s) => ({suggestions: s.suggestions, loading: s.suggestionsLoading}),
  ({suggestions, loading}) => {
    if (!loading && suggestions.length > 0) {
      // Small delay to avoid race conditions with other updates
      setTimeout(() => {
        useMixStore.getState().autoFillQueue()
      }, 100)
    }
  }
)

// Queue size changed → Auto-fill if below target
useMixStore.subscribe(
  (s) => s.session?.queue.length ?? 0,
  (queueSize, previousQueueSize) => {
    if (queueSize < TARGET_QUEUE_SIZE && queueSize < previousQueueSize) {
      console.log(`[mixStore] Queue shrunk to ${queueSize}, auto-filling...`)
      // Small delay to avoid race conditions
      setTimeout(() => {
        useMixStore.getState().autoFillQueue()
      }, 500)
    }
  }
)
