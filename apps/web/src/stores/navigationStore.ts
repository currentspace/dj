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
  // State
  route: Route

  // Actions
  navigate: (route: Route) => void
}

// =============================================================================
// HELPERS
// =============================================================================

function getRouteFromPath(pathname: string): Route {
  if (pathname === '/mix' || pathname === '/dj') return 'mix'
  if (pathname === '/debug') return 'debug'
  return 'chat'
}

function getPathFromRoute(route: Route): string {
  switch (route) {
    case 'mix':
      return '/mix'
    case 'debug':
      return '/debug'
    case 'chat':
    default:
      return '/'
  }
}

// =============================================================================
// STORE
// =============================================================================

const initialRoute: Route =
  typeof window !== 'undefined' ? getRouteFromPath(window.location.pathname) : 'chat'

export const useNavigationStore = create<NavigationState>()(
  subscribeWithSelector((set, get) => ({
    route: initialRoute,

    navigate: (route) => {
      if (get().route === route) return

      set({route})
      const path = getPathFromRoute(route)
      window.history.pushState({route}, '', path)
    },
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
