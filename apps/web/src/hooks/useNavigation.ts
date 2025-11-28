/**
 * useNavigation Hook
 * Simple URL-based navigation using History API
 * Updates URL when navigating and syncs state from URL on load
 */

import {useSyncExternalStore} from 'react'

type Route = 'chat' | 'mix' | 'debug'

interface NavigationState {
  route: Route
}

type NavigationListener = () => void

function createNavigationStore() {
  const listeners = new Set<NavigationListener>()
  let state: NavigationState = {route: 'chat'}

  function notifyListeners(): void {
    listeners.forEach(listener => listener())
  }

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

  // Initialize from current URL
  if (typeof window !== 'undefined') {
    state = {route: getRouteFromPath(window.location.pathname)}

    // Listen for browser back/forward
    window.addEventListener('popstate', () => {
      state = {route: getRouteFromPath(window.location.pathname)}
      notifyListeners()
    })
  }

  return {
    getState(): NavigationState {
      return state
    },

    navigate(route: Route): void {
      if (state.route === route) return

      state = {route}
      const path = getPathFromRoute(route)
      window.history.pushState({route}, '', path)
      notifyListeners()
    },

    subscribe(listener: NavigationListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// Singleton store
const navigationStore = createNavigationStore()

/**
 * Hook for URL-based navigation
 *
 * @example
 * ```tsx
 * function App() {
 *   const { route, navigate } = useNavigation()
 *
 *   return (
 *     <div>
 *       <nav>
 *         <button onClick={() => navigate('chat')}>Chat</button>
 *         <button onClick={() => navigate('mix')}>DJ Mode</button>
 *       </nav>
 *       {route === 'chat' && <ChatPage />}
 *       {route === 'mix' && <MixPage />}
 *     </div>
 *   )
 * }
 * ```
 */
export function useNavigation() {
  const state = useSyncExternalStore(
    navigationStore.subscribe,
    navigationStore.getState,
    () => ({route: 'chat' as Route})
  )

  return {
    route: state.route,
    navigate: navigationStore.navigate.bind(navigationStore),
  }
}
