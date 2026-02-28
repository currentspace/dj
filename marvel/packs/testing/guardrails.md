# Testing (February 2026)

Vitest 4.x testing standards with strict type safety and Zod validation.

## Test Naming

- Descriptive sentence-style names: `it("returns validated tracks when Spotify responds with valid data")`
- Group with `describe` blocks naming the unit under test
- File naming: `utils.ts` → `utils.test.ts` (colocated)

## Arrange-Act-Assert

- Structure every test with Arrange-Act-Assert pattern
- Separate phases with blank lines
- Keep "act" to a single function call

## Type Safety in Tests

- **NEVER use `as any` or `as unknown as X` in test code** — use proper Zod-validated test builders
- Create type-safe test fixture builders that return fully-typed objects
- All mock data must satisfy the Zod schema for its type
- Use `satisfies` for inline test data: `const track = { ... } satisfies Track`

```typescript
// WRONG — type assertion in tests
const session = { id: 'test' } as MixSession

// CORRECT — builder with Zod validation
function buildTestSession(overrides?: Partial<MixSession>): MixSession {
  return MixSessionSchema.parse({
    id: crypto.randomUUID(),
    userId: 'test-user',
    ...defaults,
    ...overrides,
  })
}
```

## Mocking

- Mock at boundaries only: network calls, KV, external services
- Prefer dependency injection over module-level mocking
- Reset mocks between tests (`clearMocks`, `mockReset`, `restoreMocks` all enabled in config)
- For Anthropic SDK mocks: mock the `messages.stream()` / `messages.create()` methods, validate that Zod schemas are passed correctly

## Assertions

- Use strong, specific assertions — not `toBeTruthy` for objects
- Use `toEqual` for deep comparison, `toBe` for primitives
- Test error paths with specific error messages
- For Zod: test both valid and invalid data through schemas

## Behavior Over Implementation

- Test observable behavior and outputs, not internal details
- Refactoring internals should not break tests
- Test through public APIs; don't test private methods directly

## Async Testing

- **NEVER leave unhandled promises in tests** — always `await` or use `expect(...).rejects`
- Use `vi.useFakeTimers()` for testing timeouts and intervals
- For SSE streams: create mock ReadableStream with known events
