# DJ LLM Tools (February 2026)

Claude Sonnet 4.6 / Opus 4.6 integration with Zod-validated structured output and ElevenLabs voice.

## Model Configuration

- All model IDs centralized in `workers/api/src/constants.ts` as `LLM.MODEL` and `LLM.MODEL_HAIKU`
- NEVER hardcode model ID strings in source files; always import from constants
- Primary model: Claude Sonnet 4.6 (`claude-sonnet-4-6-20260219`) via `LLM.MODEL` — main chat, discovery, set planning
- Quick tasks: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) via `LLM.MODEL_HAIKU` — progress narrator, vibe steering
- DJ narration: Claude Opus 4.6 via `LLM.MODEL_OPUS` — opinionated, personality-driven narration
- Extended thinking: 5000 token budget on initial response; disabled in agentic loop follow-ups
- Temperature: 1.0 when extended thinking enabled (required); 0.7 in agentic loop turns

## Anthropic SDK + Zod Structured Output (Critical)

- **ALWAYS use `betaZodTool` from `@anthropic-ai/sdk/helpers/beta/zod`** for tool definitions
- **ALWAYS use Zod schemas** for both tool inputs AND expected outputs
- **NEVER manually construct JSON schemas** — derive from Zod via the SDK
- **NEVER use `JSON.parse()` on LLM output without Zod validation** — use `.safeParse()`
- Use `client.messages.toolRunner()` for automatic tool execution with Zod validation

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'

const TrackSuggestionSchema = z.object({
  tracks: z.array(z.object({
    artist: z.string(),
    name: z.string(),
    reason: z.string(),
  })),
})

const suggestTracks = betaZodTool({
  name: 'suggest_tracks',
  description: 'Suggest tracks for the DJ queue',
  inputSchema: TrackSuggestionSchema,
  run: async (input) => {
    // input is fully typed from Zod schema
    return input.tracks
  },
})

// Use toolRunner for automatic tool execution
const result = await client.messages.toolRunner({
  model: LLM.MODEL,
  tools: [suggestTracks],
  messages: [{ role: 'user', content: prompt }],
})
```

- For structured output WITHOUT tools: use the `response_format` parameter with Zod-derived JSON schema
- Validate ALL LLM responses with Zod `.safeParse()` — never trust raw output

## Agentic Loop Control (Critical)

- Maximum 5 agentic turns to prevent infinite loops and control costs
- Loop detection: break if same tool with same arguments called 3+ times consecutively
- All tool execution promises tracked in a `PromiseTracker` — no floating promises
- Tool errors sent as `is_error: true` in tool_result; Claude adapts
- If API call fails mid-loop but content exists: break gracefully, return what we have

## ElevenLabs Voice Integration

- Use `@elevenlabs/elevenlabs-js` SDK for text-to-speech
- API key from environment: `env.ELEVEN_API_KEY` (Workers) or `process.env.ELEVEN` (local)
- DJ narration: generate audio from Opus 4.6 text, stream to client as audio chunks
- User voice input: use browser Web Speech API (`SpeechRecognition`) for speech-to-text on client
- Audio format: MP3 streaming for minimal latency
- Voice model: `eleven_multilingual_v2` for natural-sounding DJ personality
- Cache common narrations (session start, skip detection) to reduce API calls

```typescript
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'

const elevenlabs = new ElevenLabsClient({ apiKey: env.ELEVEN_API_KEY })

const audioStream = await elevenlabs.textToSpeech.stream(VOICE_ID, {
  text: narrationText,
  modelId: 'eleven_multilingual_v2',
})
```

## DJ Narration with Opus 4.6

- Use Opus 4.6 for narration generation — it's the most capable model for personality and music knowledge
- Narrations are 1-2 sentences, max 100 tokens output
- Cost: ~$0.001 per narration at Opus pricing
- Always validate narration output with Zod schema before sending to client/ElevenLabs

```typescript
const NarrationSchema = z.object({
  text: z.string().max(200),
  mood: z.enum(['neutral', 'excited', 'thoughtful', 'apologetic']),
})
```

## Prompt Engineering Patterns

- Structure prompts with XML tags: `<task>`, `<input_data>`, `<output_format>`, `<constraints>`
- Always specify exact JSON schema in `<output_format>` — but prefer Zod-validated structured output
- Include `<constraints>` to prevent hallucination: "Base analysis ONLY on provided data"
- For DJ narration: include current track, vibe state, and event context in prompt

## Progress Narrator

- Use Haiku for lightweight progress messages during enrichment
- Throttle: minimum 5 seconds between progress updates
- Cache common messages (LRU, max 100 entries)
- Messages under 80 characters, present tense, music vocabulary, no emojis
