# DJ React Patterns (February 2026)

React 19.2 with strict patterns, Tailwind 4, Atomic Design, and zero useEffect.

## No useEffect — Ever (Critical)

- **NEVER use `useEffect`** for any purpose — state sync, data fetching, subscriptions, or side effects
- Use `useSyncExternalStore` for subscribing to external state (stores, localStorage, SSE streams)
- Use `useRef` to track previous values and trigger actions on change in the component body
- Use React 19 `use()` hook for consuming promises and context
- Use `useTransition` for non-blocking state updates during async work
- React Query (`useMutation`, `useQuery`) owns all async data fetching and mutation lifecycle

```typescript
// WRONG — useEffect for external subscription
useEffect(() => {
  const unsub = store.subscribe(handler)
  return () => unsub()
}, [])

// CORRECT — useSyncExternalStore
const value = useSyncExternalStore(
  store.subscribe,
  store.getSnapshot,
  store.getServerSnapshot  // optional SSR
)

// WRONG — useEffect for derived state
useEffect(() => {
  setPlaylistId(selectedPlaylist?.id)
}, [selectedPlaylist?.id])

// CORRECT — direct computation in component body
const playlistId = selectedPlaylist?.id ?? null

// WRONG — useEffect for data fetching
useEffect(() => { fetchData() }, [])

// CORRECT — React Query
const { data } = useQuery({ queryKey: ['playlists'], queryFn: fetchPlaylists })
```

## useRef for Value Tracking

- Use `useRef` to track "previous" values across renders
- Compare in the component body, not in useEffect

```typescript
const prevTokenRef = useRef(token)
if (token && token !== prevTokenRef.current) {
  prevTokenRef.current = token
  startTransition(() => { connect(token) })
}
```

## Zustand Store Patterns

- Use `subscribeWithSelector` middleware on all stores
- Select individual fields: `useStore(s => s.field)` — never `useStore()`
- Integrate with `useSyncExternalStore` where needed for fine-grained subscriptions
- Store actions defined inside the store creator, not as external functions
- No async actions that aren't tracked — use React Query mutations for API calls

## Tailwind 4 Styling (Critical)

- **NEVER write raw CSS files** — use Tailwind 4 utility classes exclusively
- **NEVER use CSS Modules** (`.module.css`) — migrate to Tailwind classes
- **NEVER use inline `style` props** on HTML elements
- Use `@theme` directive in the root CSS file for design tokens
- Use `@apply` sparingly and only in component-level styles for complex compositions
- Class names via `clsx()` or `cn()` utility for conditional styling

```css
/* apps/web/src/styles/theme.css */
@import "tailwindcss";

@theme {
  --color-spotify-green: #1db954;
  --color-spotify-light: #1ed760;
  --color-surface-0: #121212;
  --color-surface-1: #1a1a1a;
  --color-surface-2: #222222;
  --color-surface-3: #2a2a2a;
  --color-accent-purple: #667eea;
  --color-accent-pink: #764ba2;
  --color-text-primary: #e0e0e0;
  --color-text-secondary: #999999;
  --color-text-muted: #666666;
}
```

```tsx
// WRONG — CSS Module import
import styles from './Component.module.css'
<div className={styles.container}>

// WRONG — inline style
<div style={{ padding: '1rem', color: '#e0e0e0' }}>

// CORRECT — Tailwind 4 utility classes
<div className="p-4 text-text-primary bg-surface-1 rounded-lg">
```

## Atomic Design System

Organize components in five tiers (Brad Frost's Atomic Design):

```
components/
├── atoms/           # Single HTML elements with styling
│   ├── Button.tsx
│   ├── Badge.tsx
│   ├── Slider.tsx
│   ├── Input.tsx
│   └── Icon.tsx
├── molecules/       # Composed atoms working together
│   ├── SearchBar.tsx     # Input + Button
│   ├── TrackCard.tsx     # Image + Text + Badge
│   ├── ProgressBar.tsx   # Slider + Time labels
│   └── VolumeControl.tsx # Icon + Slider + Label
├── organisms/       # Complex UI sections
│   ├── NowPlaying.tsx       # TrackCard + ProgressBar + Controls
│   ├── QueuePanel.tsx       # List of TrackCards + actions
│   ├── DJMessages.tsx       # Message list + scroll behavior
│   └── PlaylistStrip.tsx    # Horizontal scroll of cards
├── templates/       # Page layouts with slot positions
│   └── DJLayout.tsx         # NowPlaying + Messages + Input arrangement
└── pages/           # Hydrated templates with data
    └── DJPage.tsx           # DJLayout + store connections
```

- Atoms: zero business logic, only presentation + Tailwind classes
- Molecules: compose atoms, minimal logic (click handlers, local state)
- Organisms: full sections, may connect to stores
- Templates: layout-only, no data fetching
- Pages: connect templates to stores and data

## SSE Client Handling

- Use `ReadableStream` with `getReader()` for SSE parsing (not `EventSource` for POST)
- Buffer chunks, split on `\n\n` boundaries
- Cap buffers at 2MB to prevent memory bloat
- Handle `auth_expired` events by refreshing token and reconnecting
- Clean up readers on unmount via `useRef` + component body cleanup pattern

## Promise Tracking in React

- **NEVER fire async calls without tracking**: no `onClick={() => { fetch(...) }}`
- Use `useMutation()` for all state-changing API calls
- Use `useTransition()` + `startTransition()` for non-blocking UI updates
- Use `useQuery()` for all data fetching with cache management
