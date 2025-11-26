# Tool & MCP Architecture Guidelines (November 2025)

These guidelines represent modern tool-calling and MCP patterns for November 2025, optimized for AI-powered applications with real-time streaming.

## Tool Definition Architecture

### Native Tool Interface

Use a lightweight native interface instead of heavy frameworks:

```typescript
interface NativeTool {
  name: string
  description: string
  schema: z.ZodObject<z.ZodRawShape>
  func: (args: Record<string, unknown>) => Promise<unknown>
}
```

**Benefits over Langchain DynamicStructuredTool**:
- No framework overhead
- Direct Zod validation
- Composable with streaming callbacks
- Supports async generators for progress

**Reference**: `workers/api/src/routes/chat-stream.ts:15-21`

### Zod Schema Best Practices

```typescript
const analyzePlaylistTool: NativeTool = {
  name: 'analyze_playlist',
  description: `Comprehensive playlist analysis with metadata, audio features, and enrichment data.
Returns aggregated statistics (not individual tracks) to minimize payload size.
Use this FIRST to understand playlist characteristics before detailed queries.`,

  schema: z.object({
    playlist_id: z.string()
      .optional()
      .describe('Spotify playlist ID. Auto-injected from conversation context if not provided.'),
  }),

  func: async (args) => {
    // Implementation
  },
}
```

**Schema Guidelines**:
- Use `.describe()` for all parameters (Claude sees this)
- Set `.min()` / `.max()` / `.default()` constraints
- Use `.optional()` for auto-injectable parameters
- Keep parameter count low (1-5)

### Converting to Anthropic Format

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema'

function convertToAnthropicTools(tools: NativeTool[]): Anthropic.Tool[] {
  return tools.map(tool => {
    const jsonSchema = zodToJsonSchema(tool.schema, { target: 'openApi3' })

    // Extract properties safely
    const properties = isObject(jsonSchema.properties) ? jsonSchema.properties : {}
    const required = isStringArray(jsonSchema.required) ? jsonSchema.required : []

    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties,
        required,
      },
    }
  })
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:231-251`

## Tool Result Size Optimization

### The 55KB Problem

**Before optimization**: `analyze_playlist` returned full track objects = 55KB+
**After optimization**: Returns aggregated summary = ~2.5KB (96% reduction)

### Three-Tier Data Strategy

| Tier | Tool | Data Returned | Size | Use When |
|------|------|---------------|------|----------|
| **1** | `analyze_playlist` | Summary stats, track IDs only | ~2-5KB | High-level questions |
| **2** | `get_playlist_tracks` | Compact track info | ~100 bytes/track | Need track names/artists |
| **3** | `get_track_details` | Full metadata, album art | ~2.5KB/track | Specific track details |

### Compact Track Format

```typescript
// WRONG - Full Spotify track object (~2.5KB each)
return { tracks: spotifyApiResponse.tracks }

// CORRECT - Compact format (~100 bytes each)
const compactTracks = tracks.map(track => ({
  id: track.id,
  name: track.name,
  artists: track.artists.map(a => a.name).join(', '),
  duration_ms: track.duration_ms,
  popularity: track.popularity,
  uri: track.uri,
  album: track.album?.name,
}))

return { tracks: compactTracks }
```

**Reference**: `workers/api/src/routes/chat-stream.ts:444-453`

### Aggregated Analysis Format

```typescript
return {
  playlist_name: playlist.name,
  playlist_description: playlist.description,
  total_tracks: tracks.length,

  metadata_analysis: {
    avg_popularity: calculateAvg(tracks, 'popularity'),
    avg_duration_minutes: calculateAvg(tracks, 'duration_ms') / 60000,
    explicit_tracks: tracks.filter(t => t.explicit).length,
    top_genres: aggregateGenres(tracks).slice(0, 5),
    release_year_range: {
      oldest: Math.min(...years),
      newest: Math.max(...years),
      average: Math.round(sum(years) / years.length),
    },
  },

  deezer_analysis: {
    total_checked: deezerResults.length,
    tracks_found: deezerResults.filter(r => r.bpm !== null).length,
    bpm: {
      avg: calculateAvg(deezerResults, 'bpm'),
      range: { min: Math.min(...bpms), max: Math.max(...bpms) },
    },
  },

  lastfm_analysis: {
    crowd_tags: aggregatedTags.slice(0, 10),
    avg_listeners: calculateAvg(lastfmResults, 'listeners'),
    similar_tracks: similarTracks.slice(0, 5),
  },

  // IDs only, not full objects
  track_ids: tracks.map(t => t.id),
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:436-520`

## Streaming Progress Pattern

### Tool-Bound SSE Writer

Tools emit progress events during execution:

```typescript
function createStreamingSpotifyTools(
  spotifyToken: string,
  env: Env,
  sseWriter: SSEWriter,
  contextPlaylistId?: string
): NativeTool[] {
  return [
    {
      name: 'analyze_playlist',
      schema: z.object({...}),
      func: async (args) => {
        // Emit start
        await sseWriter.write({
          type: 'thinking',
          data: `Analyzing playlist...`,
        })

        const tracks = await fetchTracks(args.playlist_id)

        // Emit progress
        await sseWriter.write({
          type: 'thinking',
          data: `Found ${tracks.length} tracks. Enriching with audio data...`,
        })

        const enriched = await enrichTracks(tracks, (progress) => {
          // Progress callback during enrichment
          sseWriter.writeAsync({
            type: 'thinking',
            data: `Enriched ${progress.current}/${progress.total} tracks`,
          })
        })

        // Emit completion
        await sseWriter.write({
          type: 'log',
          data: { level: 'info', message: `Analysis complete: ${tracks.length} tracks` },
        })

        return enriched
      },
    },
  ]
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:270-520`

### Progress Callback Pattern

```typescript
interface ProgressCallback {
  (progress: {
    current: number
    total: number
    message?: string
  }): void
}

async function batchProcessWithProgress<T>(
  items: T[],
  processor: (item: T) => Promise<unknown>,
  onProgress: ProgressCallback
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    await processor(items[i])

    // Emit progress every 5 items
    if ((i + 1) % 5 === 0 || i === items.length - 1) {
      onProgress({
        current: i + 1,
        total: items.length,
        message: `Processed ${i + 1} of ${items.length}`,
      })
    }
  }
}
```

**Reference**: `workers/api/src/utils/RateLimitedQueue.ts`

## Multi-Step Discovery Workflow

### Vibe-Driven Architecture

```
Phase 1: ANALYZE
├── analyze_playlist (Spotify + Deezer + Last.fm enrichment)
├── get_playlist_tracks (sample track names)
└── Output: Enriched playlist data

Phase 2: EXTRACT VIBE (AI-Powered)
├── extract_playlist_vibe (Sonnet 4.5 analysis)
└── Output: vibe_profile, emotional_characteristics, discovery_hints

Phase 3: PLAN STRATEGY (AI-Powered)
├── plan_discovery_strategy (Sonnet 4.5 planning)
└── Output: prioritized searches, tag combinations, parameters

Phase 4: EXECUTE (Parallel)
├── recommend_from_similar (Last.fm → Spotify)
├── recommend_from_tags (tag-based search)
├── search_spotify_tracks (creative queries)
└── get_recommendations (algorithm seeds)

Phase 5: CURATE (AI-Powered)
├── curate_recommendations (Sonnet 4.5 ranking)
└── Output: top N tracks with reasoning
```

### Tool Interdependencies

```typescript
// Phase 1: Must run first
const analysis = await tools.analyze_playlist({ playlist_id })

// Phase 2: Requires analysis data
const vibeProfile = await tools.extract_playlist_vibe({
  analysis_data: analysis,
  sample_tracks: await tools.get_playlist_tracks({ playlist_id, limit: 20 }),
})

// Phase 3: Requires vibe profile
const strategy = await tools.plan_discovery_strategy({
  vibe_profile: vibeProfile,
  user_request: userMessage,
})

// Phase 4: Can run in parallel
const [similar, tagBased, searched, algorithmic] = await Promise.all([
  tools.recommend_from_similar({ similar_tracks: strategy.lastfm_similar_priority }),
  tools.recommend_from_tags({ tags: strategy.tag_combinations }),
  tools.search_spotify_tracks({ query: strategy.creative_queries[0] }),
  tools.get_recommendations({ seeds: strategy.seed_tracks }),
])

// Phase 5: Requires all candidates
const curated = await tools.curate_recommendations({
  candidate_tracks: [...similar, ...tagBased, ...searched, ...algorithmic],
  playlist_context: analysis,
  user_request: userMessage,
  top_n: 10,
})
```

**Reference**: `workers/api/src/routes/chat-stream.ts` (vibe-driven tools section)

## AI-Powered Tool Pattern

### Using Claude Within Tools

```typescript
const extractPlaylistVibeTool: NativeTool = {
  name: 'extract_playlist_vibe',
  description: `Deep AI analysis of playlist vibe using enrichment data.
Extracts subtle signals beyond genre tags.`,

  schema: z.object({
    analysis_data: z.any().describe('Output from analyze_playlist'),
    sample_tracks: z.array(z.string()).optional().describe('10-20 track names for context'),
  }),

  func: async (args) => {
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

    const prompt = buildVibePrompt(args.analysis_data, args.sample_tracks)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    const content = response.content[0]
    if (content.type !== 'text') throw new Error('Expected text response')

    return JSON.parse(content.text)
  },
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:733-838`

### Fallback for AI Failures

```typescript
func: async (args) => {
  try {
    // Try AI analysis
    const aiResult = await performAIAnalysis(args)
    return aiResult
  } catch (error) {
    getLogger()?.warn('AI analysis failed, using fallback', { error })

    // Return basic analysis from available data
    return {
      vibe_profile: inferVibeFromTags(args.analysis_data.lastfm_analysis.crowd_tags),
      source: 'fallback',
      warning: 'AI analysis unavailable, using tag-based inference',
    }
  }
}
```

## Auto-Injection Pattern

### Context-Aware Parameters

```typescript
func: async (args) => {
  const finalArgs = { ...args }

  // Auto-inject playlist_id from conversation context
  if (!finalArgs.playlist_id && contextPlaylistId) {
    getLogger()?.info(`[analyze_playlist] Auto-injecting playlist_id: ${contextPlaylistId}`)
    finalArgs.playlist_id = contextPlaylistId
  }

  if (!finalArgs.playlist_id) {
    throw new Error('No playlist_id provided and no context available')
  }

  return await performAnalysis(finalArgs)
}
```

**Benefits**:
- User doesn't need to specify playlist ID repeatedly
- Claude doesn't need to ask for it
- Reduces conversation friction

**Reference**: `workers/api/src/routes/chat-stream.ts:355-370`

## Error Handling in Tools

### Structured Tool Errors

```typescript
func: async (args) => {
  try {
    const result = await performOperation(args)
    return result
  } catch (error) {
    getLogger()?.error('Tool execution failed', error, { tool: 'my_tool', args })

    // Return error in structured format
    return {
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
      suggestion: 'Try with different parameters',
    }
  }
}
```

### Tool Result Error Format

When returning to Claude:

```typescript
// Success
{
  type: 'tool_result',
  tool_use_id: toolCall.id,
  content: JSON.stringify(result),
}

// Error
{
  type: 'tool_result',
  tool_use_id: toolCall.id,
  content: `Error: ${error.message}`,
  is_error: true,  // Tells Claude the tool failed
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:3151-3162`

## Agentic Loop Management

### Turn Limits

```typescript
const MAX_TURNS = 5  // Balance between capability and cost

let turnCount = 0
while (currentToolCalls.length > 0 && turnCount < MAX_TURNS) {
  turnCount++

  // Execute tools
  const results = await executeTools(currentToolCalls)

  // Add to conversation
  messages.push({
    role: 'user',
    content: results.map(r => ({
      type: 'tool_result',
      tool_use_id: r.id,
      content: JSON.stringify(r.result),
    })),
  })

  // Get next response
  const stream = await anthropic.messages.stream({ messages, tools })
  currentToolCalls = extractToolCalls(stream)
}
```

### Loop Detection

```typescript
const toolSignatures: string[] = []

for (const toolCall of currentToolCalls) {
  const signature = `${toolCall.name}:${JSON.stringify(toolCall.args)}`

  // Detect identical calls repeating
  const repeatCount = toolSignatures.filter(s => s === signature).length
  if (repeatCount >= 3) {
    getLogger()?.warn('Detected tool loop, breaking', { signature, repeatCount })
    break
  }

  toolSignatures.push(signature)
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:3079-3112`

## Data Enrichment Services

### AudioEnrichmentService (Deezer)

```typescript
class AudioEnrichmentService {
  private cacheTTLHit = 90 * 24 * 60 * 60   // 90 days for valid data
  private cacheTTLMiss = 5 * 60             // 5 minutes for null data

  async enrichTrack(track: SpotifyTrack): Promise<BPMEnrichment> {
    // 1. Check cache
    const cached = await this.checkCache(track.id)
    if (cached?.enrichment.bpm !== null) return cached.enrichment

    // 2. Get ISRC from Spotify track
    const isrc = track.external_ids?.isrc

    // 3. Try Deezer API
    if (isrc) {
      const enrichment = await this.fetchFromDeezer(isrc)
      if (enrichment) {
        await this.cacheResult(track.id, enrichment, true)
        return enrichment
      }
    }

    // 4. Fallback to MusicBrainz
    const mbIsrc = await this.findISRCViaMusicBrainz(track)
    if (mbIsrc) {
      const enrichment = await this.fetchFromDeezer(mbIsrc)
      if (enrichment) {
        await this.cacheResult(track.id, enrichment, true)
        return { ...enrichment, source: 'deezer-via-musicbrainz' }
      }
    }

    // 5. Cache miss
    await this.cacheResult(track.id, nullEnrichment, false)
    return nullEnrichment
  }
}
```

**Reference**: `workers/api/src/services/AudioEnrichmentService.ts`

### LastFmService (Crowd-Sourced Data)

```typescript
class LastFmService {
  async fetchSignals(track: Track): Promise<LastFmSignals> {
    // 4 API calls per track
    const [corrected, info, tags, similar] = await Promise.all([
      this.correctTrackName(track.artist, track.name),
      this.getTrackInfo(track.artist, track.name),
      this.getTrackTopTags(track.artist, track.name),
      this.getTrackSimilar(track.artist, track.name),
    ])

    return {
      canonicalArtist: corrected.artist,
      canonicalTrack: corrected.name,
      listeners: info.listeners,
      playcount: info.playcount,
      topTags: tags,
      similar,
    }
  }

  // N+1 prevention: Batch fetch unique artists separately
  async enrichWithArtistInfo(
    tracks: Track[],
    signals: Map<string, LastFmSignals>
  ): Promise<void> {
    const uniqueArtists = [...new Set(tracks.map(t => t.artist))]

    const artistInfos = await Promise.all(
      uniqueArtists.map(artist => this.getArtistInfo(artist))
    )

    // Attach to signals
    for (const track of tracks) {
      const signal = signals.get(track.id)
      const artistInfo = artistInfos.find(a => a.name === track.artist)
      if (signal && artistInfo) {
        signal.artistInfo = artistInfo
      }
    }
  }
}
```

**Reference**: `workers/api/src/services/LastFmService.ts`

## Tool Definition Checklist

### Before Adding a New Tool

- [ ] Clear, action-oriented description
- [ ] Zod schema with `.describe()` on all params
- [ ] Constraints: `.min()`, `.max()`, `.default()`
- [ ] Auto-injection for context parameters
- [ ] Compact result format (<2KB typical)
- [ ] SSE progress for operations >2 seconds
- [ ] Graceful error handling with fallbacks
- [ ] Cache strategy if applicable
- [ ] Rate limiting through RequestOrchestrator

### Tool Naming Conventions

```typescript
// Action verbs
analyze_playlist   // not: playlist_analysis
get_playlist_tracks   // not: playlist_tracks
create_playlist   // not: new_playlist
search_spotify_tracks   // not: spotify_search

// Prefixes indicate data source
recommend_from_similar   // Last.fm-based
recommend_from_tags   // Tag-based
get_recommendations   // Spotify algorithm
```

### Description Template

```typescript
description: `[Primary purpose in one sentence].
[What data it returns and why it's useful].
[When to use this tool vs alternatives].
${constraints ? `Constraints: ${constraints}` : ''}`,
```

## Anti-Patterns to Avoid

### DON'T: Return Full API Responses

```typescript
// WRONG
return await spotifyApi.getPlaylistTracks(playlistId)

// CORRECT
const response = await spotifyApi.getPlaylistTracks(playlistId)
return {
  tracks: response.items.map(item => ({
    id: item.track.id,
    name: item.track.name,
    artists: item.track.artists.map(a => a.name).join(', '),
  })),
  total: response.total,
}
```

### DON'T: Unbounded Tool Loops

```typescript
// WRONG
while (hasMoreToCrawl) {
  await crawlNext()  // Could run forever
}

// CORRECT
while (hasMoreToCrawl && turnCount < MAX_TURNS) {
  turnCount++
  await crawlNext()
}
```

### DON'T: Block on Non-Critical Operations

```typescript
// WRONG - Blocks return on cache
await cache.put(key, value)
return result

// CORRECT - Fire and forget
cache.put(key, value).catch(err => console.error('Cache write failed:', err))
return result
```

### DON'T: Silent Failures

```typescript
// WRONG
try {
  return await riskyOperation()
} catch {
  return null  // Claude has no idea what went wrong
}

// CORRECT
try {
  return await riskyOperation()
} catch (error) {
  return {
    error: true,
    message: error.message,
    suggestion: 'Try alternative approach',
  }
}
```
