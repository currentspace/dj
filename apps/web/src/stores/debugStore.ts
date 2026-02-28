/**
 * Debug Store - Zustand 5 + subscribeWithSelector
 * Circular buffer of debug events with category filtering
 */

import {create} from 'zustand'
import {subscribeWithSelector} from 'zustand/middleware'

// =============================================================================
// TYPES
// =============================================================================

export type DebugCategory = 'api' | 'error' | 'sse' | 'state' | 'steer'

export interface DebugEvent {
  category: DebugCategory
  data?: unknown
  id: string
  meta?: {durationMs?: number; status?: number; url?: string}
  summary: string
  timestamp: number
  type: string
}

interface DebugStoreState {
  // Actions
  addEvent: (event: Omit<DebugEvent, 'id' | 'timestamp'>) => void
  clear: () => void
  connectedAt: null | number
  errorCount: number

  // State
  events: DebugEvent[]
  filter: DebugCategory | null
  isOpen: boolean
  setFilter: (filter: DebugCategory | null) => void
  toggle: () => void
}

const MAX_EVENTS = 500

// =============================================================================
// STORE
// =============================================================================

export const useDebugStore = create<DebugStoreState>()(
  subscribeWithSelector((set, get) => ({
    addEvent: (event) => {
      const fullEvent: DebugEvent = {
        ...event,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      }

      set((state) => {
        const events = [...state.events, fullEvent]
        // Circular buffer: trim from front if over limit
        if (events.length > MAX_EVENTS) {
          events.splice(0, events.length - MAX_EVENTS)
        }
        return {
          connectedAt: state.connectedAt ?? Date.now(),
          errorCount: state.errorCount + (event.category === 'error' ? 1 : 0),
          events,
        }
      })
    },

    clear: () => set({errorCount: 0, events: []}),

    connectedAt: null,

    errorCount: 0,

    events: [],

    filter: null,

    isOpen: false,

    setFilter: (filter) => {
      // Avoid unnecessary re-renders
      if (get().filter === filter) return
      set({filter})
    },

    toggle: () => set((s) => ({isOpen: !s.isOpen})),
  }))
)

// =============================================================================
// HELPERS
// =============================================================================

/** Emit a debug event from anywhere (no hook needed) */
export function emitDebug(
  category: DebugCategory,
  type: string,
  summary: string,
  data?: unknown,
  meta?: DebugEvent['meta'],
): void {
  useDebugStore.getState().addEvent({category, data, meta, summary, type})
}
