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

## Zustand 5 State Management (November 2025)

This section documents Zustand 5.0.8 patterns for minimal re-renders with SSE streaming.

### Store Setup with subscribeWithSelector

```typescript
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'

interface Store {
  // Normalized state (by ID for O(1) access)
  messages: Record<string, Message>
  messageIds: string[]
  connectionStatus: 'connected' | 'disconnected' | 'connecting'

  // Actions (always at end of interface)
  addMessage: (msg: Message) => void
  setStatus: (status: Store['connectionStatus']) => void
}

const useStore = create<Store>()(
  subscribeWithSelector((set) => ({
    messages: {},
    messageIds: [],
    connectionStatus: 'disconnected',

    addMessage: (msg) => set((s) => ({
      messages: { ...s.messages, [msg.id]: msg },
      messageIds: [...s.messageIds, msg.id],
    })),

    setStatus: (status) => set({ connectionStatus: status }),
  }))
)
```

### Selector Patterns

| Selector Type | Pattern | When to Use |
|---------------|---------|-------------|
| **Primitive** | `useStore((s) => s.count)` | Single string/number/boolean |
| **Single by ID** | `useStore((s) => s.items[id])` | Per-item subscriptions |
| **Multiple primitives** | Two separate `useStore()` calls | Independent values |
| **Object/array** | `useStore(useShallow((s) => ({})))` | Multi-value selections |
| **Filtered array** | `useStore(useShallow((s) => arr.filter(...)))` | Derived arrays |
| **Actions only** | `useStore((s) => s.actionName)` | Always stable |

### ❌ DON'T: Subscribe to Entire Store

```typescript
// BAD - Rerenders on ANY state change
function BadComponent() {
  const store = useStore()
  return <div>{store.unreadCount}</div>
}
```

### ✅ DO: Atomic Selectors for Primitives

```typescript
// GOOD - Only rerenders when unreadCount changes
function GoodComponent() {
  const count = useStore((s) => s.unreadCount)
  return <div>{count}</div>
}
```

### ❌ DON'T: Create New Objects/Arrays in Selector

```typescript
// BAD - New array every render = infinite rerenders
function BadComponent() {
  const messages = useStore((s) => Object.values(s.messages))
  return <div>{messages.length}</div>
}
```

### ✅ DO: useShallow for Objects/Arrays

```typescript
// GOOD - Shallow comparison prevents unnecessary rerenders
function GoodComponent() {
  const messageIds = useStore(useShallow((s) => s.messageIds))
  return (
    <div>
      {messageIds.map((id) => <MessageItem key={id} id={id} />)}
    </div>
  )
}

// Item-level selector for list items
const MessageItem = memo(({ id }: { id: string }) => {
  const message = useStore((s) => s.messages[id])
  if (!message) return null
  return <div>{message.text}</div>
})
```

### ✅ DO: Separate Primitives Over Object Selectors

```typescript
// BEST - Two atomic subscriptions
function BestComponent() {
  const status = useStore((s) => s.connectionStatus)
  const count = useStore((s) => s.unreadCount)
  return <div>{status}: {count}</div>
}

// GOOD - If you must select multiple, use useShallow
function GoodComponent() {
  const { status, count } = useStore(
    useShallow((s) => ({
      status: s.connectionStatus,
      count: s.unreadCount,
    }))
  )
  return <div>{status}: {count}</div>
}
```

### SSE Handler Pattern with useEffectEvent (React 19.2)

```typescript
import { useEffect, useEffectEvent } from 'react'

function useSSEConnection(url: string) {
  const setStatus = useStore((s) => s.setStatus)
  const addMessage = useStore((s) => s.addMessage)

  // useEffectEvent: always reads latest state, never stale
  const onMessage = useEffectEvent((e: MessageEvent) => {
    const { type, payload } = JSON.parse(e.data)
    if (type === 'message') addMessage(payload)
  })

  const onOpen = useEffectEvent(() => setStatus('connected'))
  const onError = useEffectEvent(() => setStatus('disconnected'))

  // Effect only depends on URL - handlers are stable via useEffectEvent
  useEffect(() => {
    setStatus('connecting')
    const es = new EventSource(url)
    es.onmessage = onMessage
    es.onopen = onOpen
    es.onerror = onError
    return () => es.close()
  }, [url])
}
```

**Note**: If `useEffectEvent` is not available, use refs with current pattern:

```typescript
const onMessageRef = useRef(onMessage)
onMessageRef.current = onMessage

useEffect(() => {
  const handler = (e: MessageEvent) => onMessageRef.current(e)
  // ...
}, [url])
```

### External Subscriptions with subscribeWithSelector

```typescript
import { shallow } from 'zustand/shallow'

// Subscribe to specific slice
useStore.subscribe(
  (s) => s.connectionStatus,
  (status, prevStatus) => {
    console.log(`Status: ${prevStatus} → ${status}`)
  }
)

// With equality function for arrays
useStore.subscribe(
  (s) => s.messageIds,
  (ids) => console.log('New message count:', ids.length),
  { equalityFn: shallow }
)
```

### Actions Selector (Always Stable)

```typescript
// Actions never change identity, safe to select together
const useActions = () => useStore((s) => ({
  addMessage: s.addMessage,
  updateUser: s.updateUser,
  setStatus: s.setStatus,
}))
```

### Quick Reference Table

```
┌─────────────────────────────────────────────────────────────┐
│ SELECTOR TYPE          │ PATTERN                           │
├─────────────────────────────────────────────────────────────┤
│ Primitive (string/num) │ useStore((s) => s.count)          │
│ Single object by ID    │ useStore((s) => s.items[id])      │
│ Multiple primitives    │ Two separate useStore() calls     │
│ Object with multi keys │ useStore(useShallow((s) => ({})   │
│ Array of IDs           │ useStore(useShallow((s) => s.ids))│
│ Filtered array         │ useStore(useShallow((s) => ...))  │
│ Actions only           │ useStore((s) => s.actionName)     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ SSE HANDLER PATTERN (React 19.2)                            │
├─────────────────────────────────────────────────────────────┤
│ const handler = useEffectEvent((e) => {                     │
│   // Always sees latest state, no stale closures            │
│   doSomething(e.data)                                       │
│ })                                                          │
│                                                             │
│ useEffect(() => {                                           │
│   const es = new EventSource(url)                           │
│   es.onmessage = handler // Stable reference                │
│   return () => es.close()                                   │
│ }, [url]) // Handler NOT in deps!                           │
└─────────────────────────────────────────────────────────────┘
```

**Reference**: `apps/web/src/stores/*.ts`

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
