# DJ LLM Tools

Claude integration patterns, tool definitions, agentic loop control, prompt engineering, and vibe-driven discovery workflow.

## Model Configuration

- Primary model: Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`) for main chat and discovery tools
- Progress narrator: Claude Haiku 4.5 for lightweight, fast progress messages
- Extended thinking: 5000 token budget on initial response; disabled in agentic loop follow-ups
- Temperature: 1.0 when extended thinking is enabled (required); 0.7 in agentic loop turns
- Max tokens: 10,000 for initial response (5000 thinking + 5000 output); 5000 in agentic loop
- System prompt uses `cache_control: { type: 'ephemeral' }` for prompt caching

## Tool Definition Pattern (NativeTool)

- Define tools as `NativeTool` objects: `{ name, description, schema (Zod), func (async) }`
- Convert to Anthropic format via `convertToAnthropicTools()` which transforms Zod to JSON schema
- Tool results must be under 5KB; strip unnecessary fields before returning
- Auto-inject playlist ID into tool args when context is available (avoid making user repeat it)
- Write `tool_start` and `tool_end` SSE events for every tool execution

```typescript
const myTool: NativeTool = {
  name: 'tool_name',
  description: 'Clear description of what this tool does and when to use it',
  schema: z.object({ param: z.string().describe('What this param is for') }),
  func: async (args) => {
    // Execute, return compact result
    return JSON.stringify({ key: 'compact data' })
  }
}
```

## Agentic Loop Control (Critical)

- Maximum 5 agentic turns to prevent infinite loops and control costs
- Loop detection: break if same tool with same arguments called 3+ times consecutively
- Each turn: execute tools → build assistant+tool_result messages → stream next Claude response
- If max turns reached with no text content: ask Claude for a final summary response with extended thinking
- If API call fails mid-loop but content exists: break gracefully, return what we have
- Tool errors are sent as `is_error: true` in tool_result; Claude sees the error and can adapt

## 4-Phase Vibe-Driven Discovery Workflow

When recommending tracks, follow this workflow (encoded in the system prompt):

1. **ANALYZE**: `analyze_playlist` + `get_playlist_tracks` (sample) + `extract_playlist_vibe`
2. **PLAN**: `plan_discovery_strategy` — multi-pronged search strategy from AI
3. **EXECUTE**: Run independent searches in parallel — `recommend_from_similar`, `search_spotify_tracks`, `recommend_from_tags`, `get_recommendations`
4. **CURATE**: `curate_recommendations` — AI ranks all candidates by vibe alignment

- Never skip to Phase 3 without extracting the vibe first; algorithm-only produces generic results
- Execute Phase 3 searches in parallel for speed
- Phase 4 curation uses Claude Sonnet to rank; falls back to popularity sort if AI unavailable

## Prompt Engineering Patterns

- Structure AI prompts with XML tags: `<task>`, `<input_data>`, `<analysis_instructions>`, `<output_format>`, `<constraints>`
- Always specify "Return ONLY valid JSON" with exact schema in `<output_format>`
- Never allow markdown code blocks in JSON responses (just raw JSON)
- Include `<constraints>` section to prevent hallucination: "Base analysis ONLY on provided data"
- Provide concrete examples of expected output structure

## System Prompt Architecture

- Standard mode: describes data sources (Spotify, Deezer, Last.fm), tool usage patterns, 3-tier data strategy
- DJ mode: injects current playback state (track, artist, progress, queue depth), focuses on queue management
- Auto-inject playlist ID when available so user doesn't have to specify it
- System prompt is dynamically built based on mode and context

## Progress Narrator

- Use Haiku for generating contextual progress messages (not static strings)
- Throttle messages: minimum 5 seconds between progress updates
- Cache common messages (LRU, max 100 entries) to avoid redundant Haiku calls
- Messages must be under 80 characters, present tense, music vocabulary, no emojis
- Predefined fallback messages for when Haiku is unavailable or slow
