/**
 * useNavigation Hook - Zustand Store Wrapper
 *
 * This hook wraps the Zustand navigation store for backward compatibility.
 * For new code, prefer using useNavigationStore directly with atomic selectors:
 *
 * @example
 * // New pattern (recommended)
 * import { useNavigationStore } from '../stores'
 * const route = useNavigationStore((s) => s.route)
 * const navigate = useNavigationStore((s) => s.navigate)
 *
 * // Legacy pattern (this hook)
 * const { route, navigate } = useNavigation()
 */

import {useNavigationStore, type Route} from '../stores'

export type {Route}

export function useNavigation() {
  // Two atomic selectors are better than one object selector for primitives
  const route = useNavigationStore((s) => s.route)
  const navigate = useNavigationStore((s) => s.navigate)

  return {navigate, route}
}
