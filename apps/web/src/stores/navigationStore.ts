/**
 * Navigation Store - Zustand 5 + subscribeWithSelector
 * URL-based navigation with History API
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
// HELPERS
// =============================================================================

function getPathFromRoute(route: Route): string {
  switch (route) {
    case 'debug':
      return '/debug'
    case 'mix':
      return '/mix'
    case 'chat':
    default:
      return '/'
  }
}

function getRouteFromPath(pathname: string): Route {
  if (pathname === '/mix' || pathname === '/dj') return 'mix'
  if (pathname === '/debug') return 'debug'
  return 'chat'
}

// =============================================================================
// STORE
// =============================================================================

const initialRoute: Route =
  typeof window !== 'undefined' ? getRouteFromPath(window.location.pathname) : 'chat'

export const useNavigationStore = create<NavigationState>()(
  subscribeWithSelector((set, get) => ({
    navigate: (route) => {
      if (get().route === route) return

      set({route})
      const path = getPathFromRoute(route)
      window.history.pushState({route}, '', path)
    },

    route: initialRoute,
  }))
)

// =============================================================================
// BROWSER HISTORY - Listen for back/forward
// =============================================================================

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const route = getRouteFromPath(window.location.pathname)
    useNavigationStore.setState({route})
  })
}
