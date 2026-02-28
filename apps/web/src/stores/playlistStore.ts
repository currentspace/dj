/**
 * Playlist Store - Zustand 5 + subscribeWithSelector
 *
 * Manages:
 * - Selected playlist (eliminates prop drilling)
 * - Conversation history per playlist (with automatic cleanup)
 *
 * Why a store instead of signals:
 * - Zustand + subscribeWithSelector already provides fine-grained subscriptions
 * - React's Virtual DOM model doesn't benefit from signals (VDOM still reconciles)
 * - Centralized state with derived selectors is more maintainable
 */

import type {ChatMessage, SpotifyPlaylist} from '@dj/shared-types'

import {create} from 'zustand'
import {subscribeWithSelector} from 'zustand/middleware'

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Maximum number of playlist conversations to keep in memory */
const MAX_CONVERSATIONS = 20

/** Maximum messages per conversation (older messages are trimmed) */
const MAX_MESSAGES_PER_CONVERSATION = 100

// =============================================================================
// TYPES
// =============================================================================

interface PlaylistState {
  addMessage: (playlistId: string, message: ChatMessage) => void
  clearAllConversations: () => void

  // Derived (computed in selectors, not stored)
  // currentMessages: ChatMessage[] - use selector instead

  clearConversation: (playlistId: string) => void
  conversationsByPlaylist: Map<string, ChatMessage[]>
  // State
  selectedPlaylist: null | SpotifyPlaylist
  // Actions
  selectPlaylist: (playlist: null | SpotifyPlaylist) => void
  updateLastMessage: (playlistId: string, content: string) => void
}

// =============================================================================
// STORE
// =============================================================================

export const usePlaylistStore = create<PlaylistState>()(
  subscribeWithSelector((set, get) => ({
    addMessage: (playlistId, message) => {
      set((state) => {
        const newMap = new Map(state.conversationsByPlaylist)
        const messages = newMap.get(playlistId) ?? []

        // Trim old messages if exceeding limit
        const trimmedMessages =
          messages.length >= MAX_MESSAGES_PER_CONVERSATION
            ? messages.slice(-MAX_MESSAGES_PER_CONVERSATION + 1)
            : messages

        newMap.set(playlistId, [...trimmedMessages, message])
        return {conversationsByPlaylist: newMap}
      })
    },
    clearAllConversations: () => {
      set({conversationsByPlaylist: new Map()})
    },

    clearConversation: (playlistId) => {
      set((state) => {
        const newMap = new Map(state.conversationsByPlaylist)
        newMap.delete(playlistId)
        return {conversationsByPlaylist: newMap}
      })
    },

    conversationsByPlaylist: new Map(),

    selectedPlaylist: null,

    selectPlaylist: (playlist) => {
      const current = get().selectedPlaylist
      if (current?.id === playlist?.id) return // No change

      set({selectedPlaylist: playlist})

      // Cleanup old conversations when selecting a new playlist
      if (playlist) {
        cleanupOldConversations(get, set)
      }
    },

    updateLastMessage: (playlistId, content) => {
      set((state) => {
        const newMap = new Map(state.conversationsByPlaylist)
        const messages = newMap.get(playlistId) ?? []

        if (messages.length === 0) return state

        const lastMessage = messages[messages.length - 1]
        if (lastMessage.role === 'assistant') {
          // Update existing assistant message
          newMap.set(playlistId, [
            ...messages.slice(0, -1),
            {...lastMessage, content},
          ])
        } else {
          // Add new assistant message
          newMap.set(playlistId, [...messages, {content, role: 'assistant' as const}])
        }

        return {conversationsByPlaylist: newMap}
      })
    },
  }))
)

// =============================================================================
// CLEANUP HELPER
// =============================================================================

/**
 * Removes oldest conversations when exceeding MAX_CONVERSATIONS.
 * Keeps the most recently accessed conversations.
 */
function cleanupOldConversations(
  get: () => PlaylistState,
  set: (partial: Partial<PlaylistState>) => void
) {
  const {conversationsByPlaylist, selectedPlaylist} = get()

  if (conversationsByPlaylist.size <= MAX_CONVERSATIONS) return

  // Get all playlist IDs except the currently selected one
  const playlistIds = [...conversationsByPlaylist.keys()]
  const currentId = selectedPlaylist?.id

  // Remove oldest conversations (first in Map = oldest)
  const toRemove = playlistIds
    .filter((id) => id !== currentId)
    .slice(0, conversationsByPlaylist.size - MAX_CONVERSATIONS)

  if (toRemove.length === 0) return

  const newMap = new Map(conversationsByPlaylist)
  for (const id of toRemove) {
    newMap.delete(id)
  }

  console.log(`[PlaylistStore] Cleaned up ${toRemove.length} old conversations`)
  set({conversationsByPlaylist: newMap})
}

// =============================================================================
// SELECTORS (for fine-grained subscriptions)
// =============================================================================

/**
 * Get messages for the currently selected playlist.
 * Use this selector to subscribe only to current conversation changes.
 *
 * @example
 * const messages = usePlaylistStore(selectCurrentMessages)
 */
export const selectCurrentMessages = (state: PlaylistState): ChatMessage[] => {
  const playlistId = state.selectedPlaylist?.id
  if (!playlistId) return []
  return state.conversationsByPlaylist.get(playlistId) ?? []
}

/**
 * Get messages for a specific playlist by ID.
 *
 * @example
 * const messages = usePlaylistStore((s) => selectMessagesForPlaylist(s, playlistId))
 */
export const selectMessagesForPlaylist = (
  state: PlaylistState,
  playlistId: string
): ChatMessage[] => {
  return state.conversationsByPlaylist.get(playlistId) ?? []
}

/**
 * Check if a playlist has any conversation history.
 *
 * @example
 * const hasHistory = usePlaylistStore((s) => selectHasConversation(s, playlistId))
 */
export const selectHasConversation = (
  state: PlaylistState,
  playlistId: string
): boolean => {
  const messages = state.conversationsByPlaylist.get(playlistId)
  return messages !== undefined && messages.length > 0
}
