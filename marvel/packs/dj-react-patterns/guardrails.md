# DJ React Patterns

React 19.2 conventions, Zustand state management, and frontend patterns specific to the DJ app.

## State Synchronization (Critical)

- NEVER use `useEffect` for state synchronization; perform direct state checks in the component body
- React 19.2 compiler handles memoization; do not manually wrap in `useMemo`/`useCallback` unless profiling shows a need
- Use refs (`useRef`) to track previous values when comparing across renders instead of `useEffect` deps

```typescript
// CORRECT - Direct state sync in component body
const playlistId = selectedPlaylist?.id || null
if (playlistId !== currentPlaylistId) {
  setCurrentPlaylistId(playlistId)
}

// WRONG - Never use useEffect for derived state
useEffect(() => {
  setCurrentPlaylistId(selectedPlaylist?.id)
}, [selectedPlaylist?.id])
```

## Zustand Store Patterns

- Use `subscribeWithSelector` middleware on all stores for atomic subscriptions
- Select individual fields, not entire store objects: `useStore(s => s.field)` not `useStore()`
- Keep stores focused: one store per domain (auth, playback, playlist, mix, navigation)
- Use `subscribeWithSelector` for cross-store reactions (e.g., vibe change triggers suggestion refresh)
- Store actions should be defined inside the store, not as external functions

## SSE Client Handling

- Use `ReadableStream` with `getReader()` for SSE parsing; never use `EventSource` for POST requests
- Buffer incoming chunks and split on `\n\n` boundaries for SSE event parsing
- Cap internal buffers at 2MB to prevent memory bloat from long-running streams
- Handle `auth_expired` SSE events by refreshing the token and reconnecting
- Always clean up stream readers on component unmount or navigation

## Component Organization

- Organize by feature (`features/chat/`, `features/mix/`), not by file type
- Keep components focused; extract sub-components when a component exceeds ~200 lines
- Use CSS Modules for component-scoped styles; global styles go in `styles/`
- Export components as named exports, not default exports

## Error Handling in UI

- Convert technical errors to user-friendly messages before displaying
- Use the `useError` hook pattern for consistent error state management
- Show errors inline near the relevant UI element, not as global alerts
- Clear errors when the user takes a corrective action

## Loading States

- Track loading per-operation, not globally (e.g., `suggestionsLoading` separate from `sessionLoading`)
- Use `flushSync` for immediate UI updates before async operations (e.g., showing user message before streaming)
- Show skeleton/placeholder UI during loading rather than spinners where possible

## localStorage Persistence

- Use `useSyncExternalStore` for localStorage reads (cross-tab sync)
- Always handle `JSON.parse` failures gracefully with fallback defaults
- Store minimal data; derive complex state from stored primitives
- Set TTLs on stored data (e.g., tokens expire, cached playlists go stale)
