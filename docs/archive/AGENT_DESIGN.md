# AI DJ Agent Design

This document explains the design philosophy and implementation of our AI DJ agent, following [Anthropic's 2025 best practices for building effective agents](https://www.anthropic.com/research/building-effective-agents).

## Core Principles

### 1. Simplicity
The agent is fundamentally "an LLM using tools based on environmental feedback in a loop." We avoid unnecessary complexity and framework overhead.

### 2. Transparency
The agent explicitly shows its reasoning process:
- Which data sources it's using (Spotify metadata, Deezer BPM, Last.fm tags)
- Why it's choosing specific tools
- How it's interpreting vibe and planning discovery

### 3. Just-in-Time Context
Following Anthropic's principle of "the smallest set of high-signal tokens," we:
- Start with analyze_playlist (summary + track IDs)
- Load track names only when needed (get_playlist_tracks)
- Fetch full details only for specific tracks (get_track_details)

This prevents context bloat while maintaining complete information access.

## System Prompt Structure

**Location**: `workers/api/src/routes/chat-stream.ts:2296-2357`

**Format**: XML-tagged sections (Anthropic recommendation)
```xml
<role>Brief identity</role>
<capabilities>What the agent can do</capabilities>
<data_strategy>Just-in-time loading principles</data_strategy>
<current_context>Dynamic playlist ID injection</current_context>
<decision_framework>When to use which workflow</decision_framework>
<reasoning>Transparency guidelines</reasoning>
<tool_guidelines>Core rules</tool_guidelines>
```

**Size**: ~1850 characters (reduced from 6254 - 70% smaller)

**Key Design Choices**:
- **Principle-based** not example-heavy (examples are for tool schemas, not system prompt)
- **Right altitude**: Specific enough to guide, flexible enough for heuristics
- **Minimal repetition**: Tool schemas define parameters/returns, prompt focuses on when/why
- **Clear structure**: XML tags help both humans and AI parse sections

## Workflow Patterns

### Pattern 1: Simple Q&A (Routing)
User asks about playlist → classify question → route to appropriate tool
- Tempo/genres/vibe → analyze_playlist data
- Track listing → get_playlist_tracks
- Specific track → get_track_details

### Pattern 2: Vibe-Driven Discovery (Orchestrator-Workers)
User wants recommendations → orchestrator breaks down into 4 phases:

1. **ANALYZE** (workers): analyze_playlist + get_sample_tracks + extract_playlist_vibe
   - Vibe extraction uses separate Sonnet call with focused prompt
   - Returns: emotional characteristics, production style, era feel

2. **PLAN** (strategic): plan_discovery_strategy
   - Sonnet evaluates vibe and creates multi-pronged search strategy
   - Returns: Last.fm priorities, creative Spotify queries, tag combos, parameters

3. **EXECUTE** (parallelization): Run searches based on strategy
   - Last.fm similar tracks
   - Creative Spotify searches
   - Tag-based discovery
   - Algorithm recommendations

4. **CURATE** (evaluator): curate_recommendations
   - Sonnet ranks all candidates by vibe alignment
   - Returns: Top N with reasoning

This prevents "generic algorithm trap" by understanding vibe BEFORE searching.

## Model Configuration

### Main Chat (Claude Sonnet 4.5)
```typescript
model: 'claude-sonnet-4-5-20250929'
temperature: 0.7  // Balanced for tool selection
maxTokens: 4000
```

**Extended Thinking**: Currently disabled
- Langchain doesn't preserve thinking blocks in agentic loops
- Anthropic requires: "assistant message must start with thinking block before tool_use"
- TODO: Re-enable when we implement proper thinking block preservation
- Current approach: Rely on smaller system prompt (70% reduction) for better performance

**Prompt Caching**: System prompt cached with `cache_control: ephemeral`
- ~90% cost reduction on messages after first in conversation
- Cache invalidates when playlist context changes (desired behavior)

### Vibe/Strategy/Curation (Claude Sonnet 4.5)
```typescript
model: 'claude-sonnet-4-5-20250929'
temperature: 0.7
maxTokens: 2000-3000
```

**Note**: Extended thinking also disabled here for consistency. These single-call tasks could use extended thinking (no agentic loop), but keeping configuration consistent simplifies maintenance.

### Progress Narrator (Claude Haiku 4.5)
```typescript
model: 'claude-haiku-4-5-20251001'
temperature: 0.7
maxTokens: 100
```

**Prompt Caching**: System prompt (~350 tokens) cached
- Called 10-50+ times during playlist operations
- 2x faster than Haiku 3.5

## Tool Design Philosophy

From Anthropic's "Writing Effective Tools" guidance:

1. **Self-contained**: Each tool handles one clear responsibility
2. **Non-overlapping**: No ambiguity about which tool to use
3. **Minimal**: Only the parameters that can't be inferred
4. **Natural formats**: Close to what models see in training data

**Example**: analyze_playlist
- Returns aggregated insights (not raw track dumps)
- Tool schema defines structure (system prompt just explains when to use)
- Optional `playlist_id` auto-injected from context

## Maintenance Guidelines

### Updating System Prompt

**DO**:
- Keep XML structure clear
- Focus on principles, not procedures
- Let tool schemas define technical details
- Test prompt changes with extended thinking enabled

**DON'T**:
- Add exhaustive examples (use diverse, canonical examples in tool schemas instead)
- Duplicate tool documentation
- Write step-by-step procedures (provide decision frameworks instead)
- Exceed ~2500 characters without justification

### Adding New Tools

1. Define tool with clear schema (parameters, returns, description)
2. Add to `tools` array in chat-stream.ts
3. Update `<decision_framework>` in system prompt with when/why to use
4. Test: Does agent select tool appropriately? If not, refine decision framework

### Modifying Workflows

Current workflows are proven patterns. Before changing:
1. Identify the specific problem (e.g., "discovery too generic")
2. Determine if it's a prompt issue or tool issue
3. Make minimal changes
4. A/B test if possible

## Performance Optimization

### Context Window Management
- System prompt: ~1850 chars (cached)
- Conversation history: Grows with turns
- Tool results: Kept compact (see SPOTIFY_TRACK_ANALYSIS.md)
- Extended thinking: Uses budget before response tokens

### Cost Optimization
- Prompt caching reduces main chat cost by ~90%
- Haiku 4.5 for progress (2x faster, same cost as 3.5)
- Sonnet 4.5 only for reasoning-heavy tasks (vibe/strategy/curation)
- Higher thinking budgets improve quality enough to reduce retries

### Quality Optimization
- Extended thinking: Disabled due to Langchain compatibility (see Model Configuration)
- 70% smaller system prompt compensates for lack of extended thinking
- Temperature 0.7 for balanced, focused responses
- maxTokens sized appropriately for each task (2000-4000)

## Testing & Validation

**Manual Testing**:
1. Simple questions: "What's the tempo?" → Uses analyze_playlist
2. Listing: "Show me tracks" → Uses get_playlist_tracks
3. Discovery: "Find similar tracks" → Uses 4-phase workflow
4. Edge cases: Empty BPM data → Infers intelligently instead of "not available"

**Log Analysis**:
- Check tool selection patterns
- Verify reasoning is transparent
- Ensure minimal tool calls (not fetching unnecessary data)
- Monitor context window usage

**A/B Testing** (if applicable):
- Deploy prompt changes to % of traffic
- Compare: tool selection accuracy, user satisfaction, context efficiency

## References

- [Building Effective Agents (Anthropic)](https://www.anthropic.com/research/building-effective-agents)
- [Effective Context Engineering (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Writing Tools for Agents (Anthropic)](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Extended Thinking Documentation](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)
- [Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)

## Change Log

**2025-11-03**: Initial agent restructuring
- Reduced system prompt from 6254 → 1850 chars (70%)
- Applied Anthropic 2025 best practices (XML structure, principle-based)
- Removed example bloat, shifted to decision frameworks
- Documented design philosophy and maintenance guidelines
- Extended thinking disabled due to Langchain agentic loop compatibility
  - Issue: Langchain doesn't preserve thinking blocks when creating AIMessage instances
  - Anthropic requirement: "assistant message must start with thinking block before tool_use"
  - Solution: Rely on 70% smaller prompt + better structure for quality improvements
