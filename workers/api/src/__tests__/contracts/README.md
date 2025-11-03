# API Contract Tests

Contract tests validate that external APIs match our schema expectations. These tests run against **REAL APIs** (not mocks) to catch breaking changes before they reach production.

## What Are Contract Tests?

Contract tests verify that:
1. External API responses match our Zod schemas
2. API data types, fields, and structures remain consistent
3. Our assumptions about API behavior are still valid

**Example:** If Spotify changes their API to rename `track.duration_ms` to `track.duration_milliseconds`, our contract tests will catch this immediately.

## Running Contract Tests

### Local Development

```bash
# Run all contract tests
pnpm test:contracts

# Run specific API contracts
pnpm test:contracts spotify
pnpm test:contracts deezer
pnpm test:contracts lastfm
```

### Required Environment Variables

Create `.dev.vars` in `workers/api/` with:

```bash
# Required for contract tests
SPOTIFY_ACCESS_TOKEN=your_spotify_bearer_token
LASTFM_API_KEY=your_lastfm_api_key

# Optional (defaults provided)
TEST_PLAYLIST_ID=spotify_playlist_id
TEST_TRACK_ID=spotify_track_id
```

**Where to get credentials:**
- **SPOTIFY_ACCESS_TOKEN**: Get from [developer.spotify.com](https://developer.spotify.com) after OAuth flow
  - Use the implicit grant flow or authorization code flow
  - Token expires after 1 hour, so you'll need to regenerate periodically
- **LASTFM_API_KEY**: Get from [last.fm/api/account/create](https://www.last.fm/api/account/create)

### CI/CD Integration

Contract tests run automatically in GitHub Actions:
- **Nightly at 2 AM UTC** - Catch API changes early
- **On schema changes** - When `packages/shared-types/src/schemas/*` is modified
- **Manually via workflow dispatch** - For on-demand validation

Tests are skipped gracefully if API credentials are not configured (won't fail CI).

## Writing Contract Tests

### Basic Structure

```typescript
import { describe, it, expect } from 'vitest'
import {
  rateLimitedFetch,
  getTestCredentials,
  skipIfMissingCredentials,
  validateSchema,
  logSchemaFailure
} from './helpers'
import { RATE_LIMITS, TEST_DEFAULTS } from './setup'
import { SpotifyTrackFullSchema } from '@dj/shared-types'

describe('Spotify API Contract', () => {
  it('GET /tracks/{id} matches SpotifyTrackFullSchema', async () => {
    // Skip if credentials missing
    skipIfMissingCredentials('SPOTIFY_ACCESS_TOKEN')

    const { spotifyToken } = getTestCredentials()

    // Fetch real data with rate limiting
    const response = await rateLimitedFetch(
      `https://api.spotify.com/v1/tracks/${TEST_DEFAULTS.TRACK_ID}`,
      RATE_LIMITS.SPOTIFY,
      {
        headers: {
          Authorization: `Bearer ${spotifyToken}`,
        },
      }
    )

    const track = await response.json()

    // Validate against schema
    const result = validateSchema(SpotifyTrackFullSchema, track)

    if (!result.success) {
      logSchemaFailure('SpotifyTrackFullSchema', result.errors, track)
    }

    expect(result.success).toBe(true)
  })
})
```

### Best Practices

1. **Use Known Test Data**
   - Use well-known, stable entities (e.g., Queen - Bohemian Rhapsody)
   - Avoid using recently released tracks that might have incomplete metadata
   - Use public playlists like Spotify's "Today's Top Hits"

2. **Respect Rate Limits**
   - Always use `rateLimitedFetch()` helper
   - Configure appropriate delays per API (see `setup.ts`)
   - Use `cachedFetch()` for repeated requests

3. **Skip Gracefully**
   - Always call `skipIfMissingCredentials()` at test start
   - This allows tests to pass in CI without all credentials

4. **Provide Helpful Errors**
   - Use `validateSchema()` instead of `.parse()` for better errors
   - Use `logSchemaFailure()` to show detailed validation errors
   - Include sample data in error messages

5. **Test Error Cases Too**
   - Validate error response formats
   - Test with invalid IDs, missing parameters
   - Document expected error structures

### Rate Limits by API

| API | Limit | Delay | Notes |
|-----|-------|-------|-------|
| **Spotify** | ~180 req/min | 1000ms | OAuth required, 1 hour token expiry |
| **Deezer** | Unlimited* | 1000ms | Self-limit to be nice, no auth required |
| **Last.fm** | 5 req/sec | 200ms | API key required, generous limits |
| **MusicBrainz** | 1 req/sec | 1000ms | Be respectful, community-run |

*Self-imposed limit

## Test Organization

```
contracts/
├── README.md                    # This file
├── setup.ts                     # Global setup, rate limiting, caching
├── helpers.ts                   # Test utilities and helpers
├── spotify.contract.test.ts     # Spotify API contracts
├── deezer.contract.test.ts      # Deezer API contracts
├── lastfm.contract.test.ts      # Last.fm API contracts
└── musicbrainz.contract.test.ts # MusicBrainz API contracts (optional)
```

## Handling Schema Mismatches

When a contract test fails:

### 1. API Added New Fields (Non-Breaking)
```typescript
// Before: { id, name, artists }
// After:  { id, name, artists, new_field }

// Action: Update schema to include new field (optional)
export const SpotifyTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(...),
  new_field: z.string().optional(), // Add as optional
})
```

### 2. API Removed Fields (Breaking Change!)
```typescript
// Before: { id, name, duration_ms }
// After:  { id, name } // duration_ms removed!

// Action:
// 1. Update schema to mark as optional
// 2. Update code to handle missing field
// 3. File issue with API provider
// 4. Add fallback logic
```

### 3. API Changed Field Types (Breaking Change!)
```typescript
// Before: { duration_ms: number }
// After:  { duration_ms: string } // Changed to string!

// Action:
// 1. Update schema to accept both types (union)
// 2. Add type guards in code
// 3. File issue with API provider
```

### 4. API Changed Field Names (Breaking Change!)
```typescript
// Before: { duration_ms: number }
// After:  { duration_milliseconds: number } // Renamed!

// Action:
// 1. Update schema to include both (with one optional)
// 2. Update code to check both fields
// 3. File issue with API provider
// 4. Plan migration
```

## Debugging Tips

### Enable Detailed Logging
```typescript
// In your test file
console.log('Raw API response:', JSON.stringify(data, null, 2))

// Use validateSchema for detailed error breakdown
const result = validateSchema(schema, data)
if (!result.success) {
  console.error('Validation errors:', result.errors)
  console.error('Full details:', result.details)
}
```

### Check Cache
```typescript
// Cache is stored in memory and logged in setup
// Clear cache between runs:
// Just restart the test process
```

### Inspect Network
```bash
# Use curl to manually inspect API responses
curl -H "Authorization: Bearer $SPOTIFY_ACCESS_TOKEN" \
  https://api.spotify.com/v1/tracks/6rqhFgbbKwnb9MLmUQDhG6

# Compare with schema expectations
```

## Value Proposition

Contract tests provide **⭐⭐⭐⭐⭐ CRITICAL** value:

✅ **Catch API changes before production**
- APIs change without warning
- Contract tests alert you immediately
- Prevents production crashes from schema mismatches

✅ **Document API expectations**
- Tests serve as living documentation
- Show exactly what fields are used and required
- Make assumptions explicit

✅ **Enable confident refactoring**
- Know when API changes break your code
- Safe to update schemas and types
- Automated validation of assumptions

✅ **Reduce debugging time**
- Schema errors are caught in CI, not production
- Clear error messages show what changed
- No more "why is this field suddenly missing?" mysteries

## Anti-Patterns to Avoid

### ❌ DON'T Mock APIs in Contract Tests
```typescript
// BAD - This is not a contract test!
global.fetch = vi.fn().mockResolvedValue({
  json: () => ({ id: '123', name: 'Track' })
})

const track = await spotifyAPI.getTrack('123')
expect(SpotifyTrackSchema.parse(track)).toBeTruthy()
// ↑ You're testing your mock, not the real API!
```

### ❌ DON'T Test Business Logic
```typescript
// BAD - Contract tests validate schemas, not logic
it('calculates average BPM', async () => {
  const tracks = await fetchTracks()
  const avgBpm = calculateAverage(tracks.map(t => t.bpm))
  expect(avgBpm).toBeGreaterThan(0)
  // ↑ This is a unit test, not a contract test!
})
```

### ❌ DON'T Rely on Changing Data
```typescript
// BAD - Using data that changes frequently
it('validates playlist', async () => {
  // "Today's Top Hits" changes daily!
  const playlist = await spotifyAPI.getPlaylist('37i9dQZF1DXcBWIGoYBM5M')
  expect(playlist.tracks.items.length).toBe(50) // Will break tomorrow!
})

// GOOD - Validate structure, not content
it('validates playlist structure', async () => {
  const playlist = await spotifyAPI.getPlaylist('37i9dQZF1DXcBWIGoYBM5M')
  expect(playlist.tracks.items.length).toBeGreaterThan(0) // Always true
  expect(playlist).toHaveProperty('name')
  expect(playlist).toHaveProperty('tracks')
})
```

## Summary

Contract tests are a critical part of our testing strategy:

| Test Type | Purpose | Mocking | Frequency |
|-----------|---------|---------|-----------|
| **Unit** | Test logic | 0-20% | Every commit |
| **Integration** | Test service interactions | 0-30% | On merge |
| **Contract** | Validate API schemas | 0% | Nightly |
| **E2E** | Test user workflows | 0-10% | Pre-release |

**Remember:** Contract tests validate that external APIs haven't changed in ways that break our assumptions. They're our early warning system for API changes.
