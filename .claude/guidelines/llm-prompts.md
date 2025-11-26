# LLM & Prompt Engineering Guidelines (November 2025)

These guidelines represent modern Anthropic Claude patterns for November 2025, optimized for Claude Sonnet 4.5 and Opus 4.5 with tool calling and streaming.

## Model Selection (November 2025)

| Model | Use Case | Token Budget |
|-------|----------|--------------|
| **Claude Sonnet 4.5** | Primary chat, tool calling, analysis | 10,000 (5k thinking + 5k response) |
| **Claude Opus 4.5** | Complex reasoning, creative tasks | 15,000+ |
| **Claude Haiku 4.5** | Progress messages, quick summaries | 100-200 |

**Model IDs**:
- `claude-sonnet-4-5-20250929`
- `claude-opus-4-5-20251001`
- `claude-haiku-4-5-20251001`

## System Prompt Structure

### XML-Tagged Hierarchy

Use semantic XML tags for clear structure:

```xml
<role>
You are an AI DJ assistant with direct access to Spotify and music enrichment APIs.
Your purpose is to help users discover, analyze, and create playlists.
</role>

<capabilities>
- Analyze existing playlists (tempo, energy, genres, crowd-sourced tags)
- Search Spotify catalog with intelligent queries
- Extract vibe signals beyond simple genre tags
- Create personalized playlists based on analysis
- Curate recommendations with reasoning
</capabilities>

<data_strategy>
## Three-Tier Data Fetching

**Tier 1 - Summary (analyze_playlist)**
Returns: playlist name, aggregated metrics, track IDs only
Size: ~2-5KB regardless of playlist size
Use when: High-level questions (tempo, energy, overall vibe)

**Tier 2 - Compact Tracks (get_playlist_tracks)**
Returns: name, artists, duration, popularity per track
Size: ~100 bytes per track (paginated 20-50)
Use when: Need to see specific track names/artists

**Tier 3 - Full Details (get_track_details)**
Returns: Complete metadata, album art, release dates
Size: ~2.5KB per track
Use when: User asks about specific track details
</data_strategy>

<tool_execution>
## Critical Rules

1. **Auto-inject playlist_id**: If user selects playlist, tools receive it automatically
2. **Parallel execution**: Run independent tools simultaneously when possible
3. **Progress streaming**: Long operations emit thinking events for user feedback
4. **Size limits**: Keep tool results under 5KB to avoid context bloat
5. **Graceful degradation**: If enrichment fails, continue with available data
</tool_execution>
```

**Reference**: `workers/api/src/routes/chat-stream.ts:2729-2832`

## Extended Thinking Configuration

### Initial Request (Enable Thinking)

```typescript
const response = await anthropic.messages.stream({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 10000,  // 5000 thinking + 5000 response
  temperature: 1.0,   // Required for extended thinking
  thinking: {
    type: 'enabled',
    budget_tokens: 5000,
  },
  system: [{
    type: 'text',
    text: systemPrompt,
    cache_control: { type: 'ephemeral' },  // Cache system prompt
  }],
  messages,
  tools: anthropicTools,
})
```

### Agentic Loops (Disable Thinking)

Extended thinking causes 400 errors when tool results are sent back:

```typescript
// For subsequent turns in tool-calling loop
const nextResponse = await anthropic.messages.stream({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 5000,
  temperature: 0.7,  // Lower for consistency
  // NO thinking parameter - disabled for tool result handling
  messages: messagesWithToolResults,
  tools: anthropicTools,
})
```

**Why**: Anthropic's current API doesn't support extended thinking with `tool_result` message types.

**Reference**: `workers/api/src/routes/chat-stream.ts:3267-3269`

## Tool Definition Best Practices

### Zod Schema with Descriptions

```typescript
const tool: NativeTool = {
  name: 'analyze_playlist',
  description: `Comprehensive playlist analysis with metadata, audio features, and enrichment data.
Returns aggregated statistics (not individual tracks) to minimize payload size.
Use this FIRST to understand playlist characteristics before detailed queries.`,
  schema: z.object({
    playlist_id: z.string().optional().describe(
      'Spotify playlist ID. Auto-injected from conversation context if not provided.'
    ),
  }),
  func: async (args) => {
    // Implementation
  },
}
```

### Size-Constrained Results

```typescript
// WRONG - Returns everything
return {
  tracks: fullTrackObjects,  // 55KB+
  audioFeatures: allFeatures,
}

// CORRECT - Returns summary
return {
  playlist_name: playlist.name,
  total_tracks: tracks.length,
  metadata_analysis: {
    avg_popularity: calculateAvg(tracks, 'popularity'),
    avg_duration_minutes: calculateAvg(tracks, 'duration_ms') / 60000,
    top_genres: aggregateGenres(tracks).slice(0, 5),
  },
  track_ids: tracks.map(t => t.id),  // IDs only, not full objects
}
```

**Size Reduction**: 55KB → 2.5KB (96%)

**Reference**: `workers/api/src/routes/chat-stream.ts:436-520`

## Streaming Response Handling

### Delta Accumulation

```typescript
let fullResponse = ''
let currentToolInput = ''  // Must initialize as empty string

for await (const event of stream) {
  if (event.type === 'content_block_delta') {
    if (event.delta.type === 'text_delta') {
      fullResponse += event.delta.text
      await sseWriter.write({ type: 'content', data: event.delta.text })
    }
    else if (event.delta.type === 'input_json_delta') {
      // Accumulate tool input JSON character by character
      currentToolInput += event.delta.partial_json
    }
  }
  else if (event.type === 'content_block_stop') {
    // Parse accumulated tool input
    if (currentToolInput) {
      const args = JSON.parse(currentToolInput)
      toolCalls.push({ name: currentTool, args, id: currentToolId })
      currentToolInput = ''  // Reset for next tool
    }
  }
}
```

**Critical**: Tool input arrives as deltas, not complete JSON. Parse only after `content_block_stop`.

**Reference**: `workers/api/src/routes/chat-stream.ts:2934-3054`

### Thinking Delta Handling

```typescript
if (event.delta.type === 'thinking_delta') {
  // Option 1: Surface to user (recommended for transparency)
  await sseWriter.write({ type: 'thinking', data: event.delta.thinking })

  // Option 2: Collect for analysis
  cumulativeThinking += event.delta.thinking

  // Option 3: Skip (current implementation)
  // Thinking deltas discarded
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:3961`

## AI-Powered Tool Patterns

### Vibe Extraction (Sonnet 4.5)

Use Claude to extract semantic meaning beyond genre tags:

```typescript
const vibePrompt = `Analyze this playlist data and extract vibe signals:

<playlist_data>
${JSON.stringify(analysisData, null, 2)}
</playlist_data>

<sample_tracks>
${sampleTracks.join('\n')}
</sample_tracks>

Analyze these 9 dimensions:
1. Emotional arc (energetic journey, consistent mood)
2. Production aesthetic (polished/raw, vintage/modern)
3. Vocal characteristics (presence, style, language)
4. Instrumentation (electronic/organic, prominent instruments)
5. Era feel (specific decade, timeless)
6. Listening context (workout, study, party, chill)
7. Genre blending (pure genre vs fusion)
8. Mixing philosophy (DJ-ready transitions, album flow)
9. Discovery signals (mainstream vs underground)

Return JSON with vibe_profile and discovery_hints.`

const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 2000,
  messages: [{ role: 'user', content: vibePrompt }],
})
```

**Reference**: `workers/api/src/routes/chat-stream.ts:733-838`

### Discovery Strategy Planning (Sonnet 4.5)

```typescript
const strategyPrompt = `Based on this vibe profile and user request, create a discovery strategy:

<vibe_profile>
${JSON.stringify(vibeProfile)}
</vibe_profile>

<user_request>
${userRequest}
</user_request>

Plan these 5 components:
1. lastfm_similar_priority: Specific tracks to find similar to
2. creative_spotify_queries: Search strings beyond genre
3. tag_combinations: Last.fm tag intersections
4. tuned_params: Spotify recommendation parameters
5. avoid_list: What to filter out

Return JSON with prioritized strategies and reasoning.`
```

**Reference**: `workers/api/src/routes/chat-stream.ts:1037-1153`

### Intelligent Curation (Sonnet 4.5)

```typescript
const curationPrompt = `Curate the top ${topN} tracks from these candidates:

<candidates>
${candidates.map(t => `- ${t.name} by ${t.artists} (popularity: ${t.popularity})`).join('\n')}
</candidates>

<playlist_context>
${JSON.stringify(playlistContext)}
</playlist_context>

<user_request>
${userRequest}
</user_request>

Evaluate each on:
- Vibe alignment with existing playlist
- User intent match
- Popularity balance (avoid all popular or all obscure)
- Diversity (avoid clustering)

Return JSON with selected_tracks and reasoning per track.`
```

**Reference**: `workers/api/src/routes/chat-stream.ts:1514-1623`

## Prompt Caching

### System Prompt Caching

```typescript
system: [{
  type: 'text',
  text: systemPrompt,
  cache_control: { type: 'ephemeral' },  // Cached for session
}],
```

**Benefits**:
- Faster subsequent requests
- Reduced token costs
- Same prompt reused across turns

### Haiku Progress Messages

```typescript
const response = await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 100,
  system: [{
    type: 'text',
    text: progressNarratorSystemPrompt,
    cache_control: { type: 'ephemeral' },  // Cache across messages
  }],
  messages: [{ role: 'user', content: contextPrompt }],
  temperature: 0.7,  // Some variation, not random
})
```

**Reference**: `workers/api/src/lib/progress-narrator.ts`

## Agentic Loop Management

### Turn Limits

```typescript
const MAX_TURNS = 5  // Reduced from 15 for cost control

let turnCount = 0
while (currentToolCalls.length > 0 && turnCount < MAX_TURNS) {
  turnCount++

  // Execute tools
  const toolResults = await executeTools(currentToolCalls)

  // Add results to conversation
  messages.push({
    role: 'user',
    content: toolResults.map(r => ({
      type: 'tool_result',
      tool_use_id: r.id,
      content: JSON.stringify(r.result),
    })),
  })

  // Get next response
  const nextStream = await anthropic.messages.stream({...})
  currentToolCalls = extractToolCalls(nextStream)
}
```

### Infinite Loop Detection

```typescript
const toolSignatures: string[] = []

for (const toolCall of currentToolCalls) {
  const signature = `${toolCall.name}:${JSON.stringify(toolCall.args)}`

  // Detect repeated identical calls
  const repeatCount = toolSignatures.filter(s => s === signature).length
  if (repeatCount >= 3) {
    console.warn('Detected tool loop, breaking')
    break
  }

  toolSignatures.push(signature)
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:3079-3112`

## Error Handling

### API Error Handling

```typescript
try {
  const response = await anthropic.messages.stream({...})
  for await (const event of response) {
    // Process events
  }
} catch (error) {
  if (error.status === 429) {
    // Rate limited - implement backoff
    await sleep(1000 * Math.pow(2, retryCount))
  } else if (error.status === 400) {
    // Bad request - check message format
    logger?.error('Invalid request format', { error, messages })
  } else if (error.status === 500) {
    // Server error - retry once
  }
}
```

### Tool Result Error Format

```typescript
try {
  const result = await tool.func(args)
  return {
    type: 'tool_result',
    tool_use_id: toolCall.id,
    content: JSON.stringify(result),
  }
} catch (error) {
  return {
    type: 'tool_result',
    tool_use_id: toolCall.id,
    content: `Error: ${error.message}`,
    is_error: true,  // Tells Claude the tool failed
  }
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:3151-3162`

## Token Optimization

### Message Summarization (Future)

```typescript
// After 5 tool calls, summarize for context efficiency
if (turnCount === 5) {
  const summaryPrompt = `Summarize these tool results in 2-3 sentences,
keeping only strategically important data:
${toolResults.map(r => JSON.stringify(r)).join('\n')}`

  const summary = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: summaryPrompt }],
  })

  // Replace verbose results with summary
  messages = compressMessages(messages, summary)
}
```

### Conversation History Limits

```typescript
// Max 20 messages in history
const MAX_HISTORY = 20

if (conversationHistory.length > MAX_HISTORY) {
  conversationHistory = conversationHistory.slice(-MAX_HISTORY)
}
```

**Reference**: `workers/api/src/routes/chat-stream.ts:74`

## Tool Choice Control (Future Enhancement)

```typescript
// Phase 1: Force analysis first
const phase1 = await anthropic.messages.create({
  tool_choice: { type: 'tool', name: 'analyze_playlist' },
  // ...
})

// Phase 2: Allow any tool
const phase2 = await anthropic.messages.create({
  tool_choice: 'auto',
  // ...
})

// Phase 3: Require tool use (no text-only response)
const phase3 = await anthropic.messages.create({
  tool_choice: 'any',
  // ...
})
```

## Performance Recommendations

1. **Parallel tool execution**: Run independent tools simultaneously
2. **Cache vibe profiles**: Store and reuse for same playlist
3. **Haiku for progress**: Use cheapest model for UI feedback
4. **Prompt caching**: Enable for all system prompts
5. **Result compression**: Strip verbose fields before sending to Claude
6. **Turn limits**: Cap at 5-10 turns to control costs

## Anti-Patterns

### DON'T: Send Full Track Objects

```typescript
// WRONG - 2.5KB per track
return { tracks: spotifyApiResponse.tracks }

// CORRECT - 100 bytes per track
return {
  tracks: tracks.map(t => ({
    id: t.id,
    name: t.name,
    artists: t.artists.map(a => a.name).join(', '),
  }))
}
```

### DON'T: Unlimited Agentic Loops

```typescript
// WRONG - Could run forever
while (toolCalls.length > 0) {
  // No limit
}

// CORRECT - Bounded
while (toolCalls.length > 0 && turnCount < MAX_TURNS) {
  turnCount++
}
```

### DON'T: Parse Tool Input Before Complete

```typescript
// WRONG - Partial JSON
if (event.delta.type === 'input_json_delta') {
  const args = JSON.parse(event.delta.partial_json)  // Will fail
}

// CORRECT - Wait for block stop
if (event.type === 'content_block_stop') {
  const args = JSON.parse(accumulatedInput)
}
```
