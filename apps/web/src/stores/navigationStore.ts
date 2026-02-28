/**
 * Navigation Store - Zustand 5 + subscribeWithSelector
 * Simplified to overlay toggles (no more route-based navigation)
 */

import {create} from 'zustand'
import {subscribeWithSelector} from 'zustand/middleware'

// =============================================================================
// TYPES
// =============================================================================

export type Route = 'chat' | 'debug' | 'mix'

interface NavigationState {
  // Actions
  navigate: (route: Route) => void

  // State
  route: Route
}

// =============================================================================
// STORE
// =============================================================================

export const useNavigationStore = create<NavigationState>()(
  subscribeWithSelector((set, get) => ({
    navigate: (route) => {
      if (get().route === route) return
      set({route})
    },

    route: 'chat',
  }))
)
