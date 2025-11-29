/**
 * Zustand Stores - Central Export
 *
 * All stores use Zustand 5 + subscribeWithSelector for minimal re-renders.
 * Use atomic selectors to subscribe to only the state you need.
 *
 * @example
 * // Atomic selector (best - only rerenders when this value changes)
 * const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
 *
 * // Multiple primitives (each is a separate subscription)
 * const token = useAuthStore((s) => s.token)
 * const isLoading = useAuthStore((s) => s.isLoading)
 *
 * // Object selector with useShallow (for multiple related values)
 * import { useShallow } from 'zustand/react/shallow'
 * const { token, isAuthenticated } = useAuthStore(useShallow((s) => ({
 *   token: s.token,
 *   isAuthenticated: s.isAuthenticated,
 * })))
 */

export {useAuthStore, processOAuthCallback} from './authStore'
export {useNavigationStore, type Route} from './navigationStore'
export {usePlaybackStore, getPlaybackState, useDevice, type ConnectionStatus, type PlaybackCore, type PlaybackState} from './playbackStore'
export {useMixStore, initializeMixStore} from './mixStore'
export {usePlaylistStore, selectCurrentMessages, selectMessagesForPlaylist, selectHasConversation} from './playlistStore'
