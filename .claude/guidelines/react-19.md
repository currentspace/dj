# React 19.2 Guidelines (November 2025)

These guidelines represent modern React patterns for November 2025, specifically optimized for this DJ application's real-time streaming architecture.

## Core Principles

### 1. NEVER Use useEffect for State Synchronization

**The Pattern**: Direct state synchronization in component body, not in effects.

```typescript
// CORRECT - React 19.2 Pattern
const playlistId = selectedPlaylist?.id ?? null
if (playlistId !== currentPlaylistId) {
  setCurrentPlaylistId(playlistId)
}

// WRONG - Never do this
useEffect(() => {
  setCurrentPlaylistId(selectedPlaylist?.id)
}, [selectedPlaylist?.id])
```

**Why**: React Compiler optimizes direct synchronization. Effects add unnecessary render cycles.

**Reference**: `apps/web/src/features/chat/ChatInterface.tsx:37-41`

### 2. Legitimate useEffect Use Cases (Only These)

| Use Case | Example | Why Allowed |
|----------|---------|-------------|
| **OAuth callbacks** | Processing URL params once | Must run after mount, SSR-safe |
| **API token validation** | Async validation on token change | Requires async operation |
| **Cleanup on unmount** | Abort controllers, refs | Standard cleanup pattern |
| **Dynamic imports** | Optional module loading | Runtime-dependent |
| **External subscriptions** | Storage events, WebSocket | Browser APIs require effects |

**Reference**: `apps/web/src/hooks/useSpotifyAuth.ts` - All 6 useEffect instances are justified.

### 3. External Store Pattern with useSyncExternalStore

For shared state (auth, preferences), use external stores:

```typescript
// Create store with closure
let state: AuthState = getInitialState()
const listeners = new Set<() => void>()

const store = {
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getState: () => state,
  setState: (newState: AuthState) => {
    state = newState
    listeners.forEach(l => l())
  },
}

// Use in components
function useAuth() {
  return useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState // Server snapshot
  )
}
```

**Benefits**:
- Works with React Compiler
- No tearing issues
- Proper server-side support
- Cross-tab sync via storage events

**Reference**: `apps/web/src/hooks/useSpotifyAuth.ts:402-520`

### 4. useTransition for Non-Blocking Updates

Use `useTransition` for state updates that shouldn't block UI:

```typescript
const [isPending, startTransition] = useTransition()

const handleModeChange = (newMode: Mode) => {
  startTransition(() => {
    setMode(newMode)
  })
}
```

**When to use**:
- Mode switching (analyze/create/edit)
- Large list filtering
- Tab/view changes

**Reference**: `apps/web/src/features/chat/ChatInterface.tsx:32`

### 5. Memoization with Custom Comparators

For large lists, use `memo()` with custom equality:

```typescript
export const TrackList = memo(
  function TrackList({ tracks }: Props) {
    return (...)
  },
  (prev, next) => {
    // Only re-render if track IDs change
    return prev.tracks.map(t => t.id).join(',') ===
           next.tracks.map(t => t.id).join(',')
  }
)
```

**Reference**: `apps/web/src/features/playlist/TrackList.tsx`

### 6. Map for O(1) Per-Entity State

Use `Map` for per-entity state (conversations per playlist):

```typescript
const [conversationsByPlaylist, setConversationsByPlaylist] =
  useState<Map<string, ChatMessage[]>>(new Map())

// Update immutably
setConversationsByPlaylist(prev => {
  const next = new Map(prev)
  next.set(playlistId, [...(prev.get(playlistId) ?? []), newMessage])
  return next
})
```

**Benefits**:
- O(1) lookup per playlist
- Preserves conversation history on playlist switch
- Type-safe with generics

**Reference**: `apps/web/src/features/chat/ChatInterface.tsx:29-30`

### 7. flushSync for Immediate DOM Updates

Use `flushSync` when DOM must update before continuing:

```typescript
import { flushSync } from 'react-dom'

const injectMessage = (message: ChatMessage) => {
  flushSync(() => {
    setConversationsByPlaylist(prev => {
      // Update state
    })
  })
  // DOM is now updated, safe to scroll
  scrollToBottom()
}
```

**When to use**:
- Scroll-to-bottom after message injection
- Form focus after dynamic element creation
- Accessibility announcements

**Reference**: `apps/web/src/features/chat/ChatInterface.tsx:88-96`

## Streaming-Specific Patterns

### 8. Callback-Based Streaming Updates

For SSE streams, use callbacks to update state:

```typescript
const streamHandleRef = useRef<AbortableStream | null>(null)

const handleSubmit = async () => {
  streamHandleRef.current = await chatStreamClient.streamMessage(
    message,
    history,
    mode,
    {
      onContent: (content) => {
        setStreamingContent(prev => prev + content)
      },
      onToolStart: (tool, args) => {
        setStreamingStatus(prev => ({
          ...prev,
          currentTool: tool,
          toolsUsed: [...prev.toolsUsed, tool],
        }))
      },
      onDone: () => {
        setStreamingStatus({ isStreaming: false, toolsUsed: [] })
      },
      onError: (error) => {
        setError(error)
      },
    }
  )
}
```

**Reference**: `apps/web/src/features/chat/ChatInterface.tsx:181-260`

### 9. AbortController for Stream Cancellation

Always support cancellation for streaming operations:

```typescript
const abortRef = useRef<AbortController | null>(null)

const startStream = async () => {
  abortRef.current = new AbortController()

  try {
    await streamWithSignal(abortRef.current.signal)
  } catch (err) {
    if (err.name === 'AbortError') {
      // User cancelled, not an error
      return
    }
    throw err
  }
}

const handleCancel = () => {
  abortRef.current?.abort()
}
```

**Reference**: `apps/web/src/lib/streaming-client.ts`

## Component Patterns

### 10. Error Boundaries (Class Components Required)

Error boundaries must be class components (React limitation):

```typescript
export class ErrorBoundary extends Component<Props, State> {
  static getDerivedStateFromError(error: Error): State {
    return { error, hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <DefaultErrorUI />
    }
    return this.props.children
  }
}
```

**Wrap Error-Prone Components**:
```typescript
<ErrorBoundary fallback={<PlaylistErrorFallback />}>
  <Suspense fallback={<PlaylistSkeleton />}>
    <UserPlaylists />
  </Suspense>
</ErrorBoundary>
```

**Reference**: `apps/web/src/app/ErrorBoundary.tsx`

### 11. Suspense for Async Components

Use Suspense boundaries around async content:

```typescript
<Suspense fallback={<div className="skeleton">Loading...</div>}>
  <AsyncComponent />
</Suspense>
```

**Reference**: `apps/web/src/App.tsx`

## Type Safety Patterns

### 12. Strict Event Handlers

Type event handlers explicitly:

```typescript
const handleSubmit = useCallback(
  async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // ...
  },
  [dependencies]
)

const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setInput(e.target.value)
}
```

### 13. Props Interface Convention

Define props interface above component:

```typescript
interface ChatInterfaceProps {
  selectedPlaylist: SpotifyPlaylist | null
}

export function ChatInterface({ selectedPlaylist }: ChatInterfaceProps) {
  // ...
}
```

### 14. Centralized Type Imports

Import shared types from `@dj/shared-types`:

```typescript
// CORRECT
import type { SpotifyPlaylist, ChatMessage } from '@dj/shared-types'

// WRONG - Don't duplicate interfaces
interface SpotifyPlaylist { ... } // Already defined elsewhere
```

## Anti-Patterns to Avoid

### DO NOT: dangerouslySetInnerHTML Without Sanitization

```typescript
// DANGEROUS - XSS risk
dangerouslySetInnerHTML={{
  __html: message.content.replace(/\n/g, '<br />')
}}

// SAFER - Use markdown library with sanitization
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const sanitizedHtml = DOMPurify.sanitize(marked.parse(content))
```

### DO NOT: Excessive useCallback Dependencies

```typescript
// PROBLEMATIC - Too many dependencies
const handleSubmit = useCallback(
  () => { /* ... */ },
  [input, isStreaming, mode, playlist, messages, scrollFn, settings, user]
)

// BETTER - Extract stable values
const playlistId = playlist?.id
const messageCount = messages.length
const handleSubmit = useCallback(
  () => { /* ... */ },
  [input, isStreaming, mode, playlistId, messageCount]
)
```

### DO NOT: Inline Style Tags

```typescript
// AVOID - Reparsed every render
<style>{`
  .my-component { ... }
`}</style>

// BETTER - CSS Modules
import styles from './MyComponent.module.css'
<div className={styles.myComponent}>
```

## React 19.2 Features to Adopt When Ready

### useActionState (Requires Server Actions)

```typescript
// Future pattern when backend supports server actions
const [state, formAction, isPending] = useActionState(submitMessage, null)

return (
  <form action={formAction}>
    <input name="message" disabled={isPending} />
    <button>{isPending ? 'Sending...' : 'Send'}</button>
  </form>
)
```

### React Compiler

Currently commented out in `vite.config.ts`. Enable when stable:

```typescript
// vite.config.ts
babel: {
  plugins: [
    ['babel-plugin-react-compiler', {}]
  ],
}
```

The codebase is already compiler-friendly (no forbidden patterns detected).

## Testing Guidelines

### Test Async State with flushPromises

```typescript
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0))

it('should update state after async operation', async () => {
  const { result } = renderHook(() => useMyHook())

  act(() => {
    result.current.doAsyncThing()
  })

  await flushPromises()

  expect(result.current.state).toBe('updated')
})
```

### Clean Up Between Tests

```typescript
beforeEach(() => {
  vi.clearAllMocks()
  cleanupAuthStore()
})

afterEach(() => {
  const { result, unmount } = renderHook(() => useAuth())
  if (result.current.isAuthenticated) {
    result.current.logout()
  }
  unmount()
})
```

**Reference**: `apps/web/src/hooks/useSpotifyAuth.test.ts`
