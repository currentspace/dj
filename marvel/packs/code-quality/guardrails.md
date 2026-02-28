# Code Quality (February 2026)

Strict TypeScript, zero floating promises, Zod-everywhere type safety.

## TypeScript Strictness (Critical)

- **NEVER use `any`** — use `unknown` with Zod parsing or type guards
- **NEVER use `as` type assertions** — use Zod `.parse()` or `.safeParse()` to validate and narrow
- **NEVER use `@ts-ignore` or `@ts-expect-error`** — fix the type error properly
- Use discriminated unions with exhaustive `switch` and `satisfies` for compile-time completeness
- All function signatures must have explicit return types for public APIs
- Use `satisfies` operator for type-safe object literals: `const config = { ... } satisfies Config`
- Prefer `readonly` arrays and properties where mutation is not needed

```typescript
// WRONG — type assertion
const data = response.json() as UserData

// CORRECT — Zod validation
const data = UserDataSchema.parse(await response.json())

// CORRECT — safeParse with error handling
const result = UserDataSchema.safeParse(await response.json())
if (!result.success) {
  throw new ValidationError(result.error)
}
const data = result.data  // fully typed, no assertion
```

## Zero Floating Promises (Critical)

- **NEVER use `void someAsyncFn()`** — this creates a floating promise
- **NEVER fire-and-forget async calls** — every promise must be tracked
- All async functions must be held in a tracked `PromiseSet` until completion
- Scoping options for promise ownership:
  1. **Request lifecycle**: tracked via `executionCtx.waitUntil(promise)` AND added to a `PromiseSet`
  2. **React Query mutations**: owned by the mutation lifecycle
  3. **App lifecycle**: tracked in a module-level `PromiseSet` that's awaited on shutdown
- Use a `PromiseTracker` utility class:

```typescript
class PromiseTracker {
  private pending = new Set<Promise<unknown>>()

  track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise)
    promise.finally(() => this.pending.delete(promise))
    return promise
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending])
  }

  get size(): number { return this.pending.size }
}
```

- In Cloudflare Workers: `ctx.waitUntil(tracker.track(asyncWork()))` — BOTH tracked AND registered with the runtime
- In React: wrap in `useMutation()` or `useTransition()` — never `onClick={() => { fetch(...) }}`

## Zod Everywhere

- All external data boundaries validated with Zod: API responses, KV reads, user input, LLM outputs
- Define schemas once in `@dj/shared-types`, import everywhere
- Use `z.infer<typeof Schema>` for types — never duplicate type definitions manually
- For LLM structured output: use `@anthropic-ai/sdk/helpers/beta/zod` with `betaZodTool`
- For API responses: validate with `.safeParse()` and handle errors explicitly

## Error Handling

- Use try/catch with typed error responses
- Always handle promise rejections — every `.catch()` or try/catch must log or re-throw
- Throw descriptive errors with context: `new Error(\`Failed to fetch track ${trackId}: ${status}\`)`
- Use `Result<T, E>` pattern where appropriate: `{ success: true, data: T } | { success: false, error: E }`

## Naming Conventions

- camelCase for variables/functions, PascalCase for types/components/classes
- Prefix booleans with `is`, `has`, `should`, `can`
- Suffix Zod schemas with `Schema`: `UserDataSchema`, `TrackResponseSchema`
- Use descriptive names; avoid abbreviations

## Import Organization

- Group: external libraries → workspace packages (`@dj/*`) → relative paths
- Use named exports, not default exports
- Remove unused imports before committing

## JavaScript Target

- Target: `ES2024` — use all modern syntax: `using`, `Promise.withResolvers()`, `Array.groupBy()`, `Set` methods
- Module: `ESNext`
- No polyfills for features supported by Node 24 and modern browsers
