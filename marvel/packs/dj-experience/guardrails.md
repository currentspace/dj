# DJ Experience Design (February 2026)

Auto DJ experience design patterns grounded in research from Spotify DJ, Algoriddim djay, professional DJ mixing principles, and the Opus 4.6 strategic brain architecture.

## Three-Tier Model Hierarchy (Critical)

Route every AI decision to the right model tier:

| Tier | Model | Use For | Never Use For |
|------|-------|---------|---------------|
| Strategic (Opus 4.6) | Set planning, skip reasoning, narration, replan | Search, tool execution, progress messages |
| Execution (Sonnet 4.6) | Tool calling, track search, basic curation | Strategic planning, personality narration |
| Reactive (Haiku 4.5) | Progress messages, preset matching, acks | Any decision requiring musical judgment |

```typescript
// CORRECT — Opus for strategic decisions
const plan = await aiService.promptForJSON(LLM.MODEL_OPUS, buildSetPlanPrompt(context))

// CORRECT — Sonnet for search/execution
const tracks = await aiService.promptForJSON(LLM.MODEL, buildNextTrackPrompt(context))

// CORRECT — Haiku for quick reactions
const message = await aiService.promptForText(LLM.MODEL_HAIKU, buildProgressPrompt(context))

// WRONG — Opus for search (wasteful)
const results = await aiService.promptForJSON(LLM.MODEL_OPUS, buildSearchPrompt(query))

// WRONG — Haiku for curation (insufficient reasoning)
const curated = await aiService.promptForJSON(LLM.MODEL_HAIKU, buildCurationPrompt(tracks))
```

## Opus Calls Must Never Block Playback (Critical)

All Opus calls run in `waitUntil()` or non-critical paths. The player-stream poll loop must never await an Opus response.

```typescript
// CORRECT — Opus in waitUntil
ctx.waitUntil(generateNarration(env, session, event))

// CORRECT — Opus in endpoint handler (user is already waiting)
const plan = await generateSetPlan(env, session)

// WRONG — Opus in poll loop
const narration = await generateNarration(env, session, event) // blocks 1Hz polling
```

## Playback-First Design (Critical)

- The app is a DJ, not a dashboard. Music playing is the default state, not a feature to navigate to.
- Maximum 1 user action between app open and music playing (tap "Start DJ")
- Seed playlist selection is optional — "surprise me" from user's top tracks is the default path
- Fallback pool tracks should start playing BEFORE AI-generated suggestions are ready (3-5 second target)
- Never show an empty screen while waiting for AI — play fallback tracks immediately

## Progressive Disclosure

- Default view: NowPlaying (compact) + DJ Messages + Text Input — nothing else visible
- Queue panel: hidden by default, accessible by tapping "Up Next" line
- Vibe controls: hidden in settings drawer, accessible via gear icon
- Track details: accessible by tapping/long-pressing a DJ message about a track
- Never show queue + suggestions + vibe controls + playback all at once — it overwhelms

## DJ Narration Voice

- The DJ should narrate its decisions in the message stream, not silently manage a queue
- Narration is 1-2 sentences, conversational, opinionated, music-savvy
- Narrate on: session start, track additions, skip detection, vibe shifts, queue refills, user steers
- Use Opus 4.6 for important narrations (session start, skip patterns, replans, user steers)
- Use Haiku for simple narrations (single skips, queue refills, progress)
- The DJ has a consistent personality: knowledgeable, enthusiastic but not overly so, honest about its choices
- Never narrate technical details ("calling analyze_playlist tool") — speak in music terms
- Include session narrative context (what DJ already said) to prevent repetition

Example narrations:
- "Starting from your Chill Vibes playlist. Feeling lo-fi and ambient — let's ease into it."
- "Noticed you skipped those last two. Steering away from hip-hop, leaning more indie."
- "Added Snarky Puppy — great BPM bridge from what's playing now."
- "Energy's been building for 4 tracks. Keeping the momentum going."
- "Wild card incoming — this is a left turn but trust me, the groove connects."

## Text Input as Universal Steering

- The single text input at the bottom handles ALL interactions:
  - Vibe steering: "more energy", "chill out", "throw in some jazz"
  - Track requests: "play some Radiohead", "queue up that song from earlier"
  - Questions: "what's playing?", "why did you pick this track?"
  - Analysis: "analyze my Running playlist"
  - Commands: "skip", "pause"
- Parse user intent server-side — the DJ has access to all 15 Spotify tools
- Mode is always "dj" — no mode selector needed

## Set Planning (Opus-Driven)

- Every DJ session starts with an Opus-generated set plan (energy arc, genre clusters, surprise points)
- Plans follow the five-phase structure: warm-up > build > peak > release > finale
- The plan is a strategy, not a playlist — it defines targets, not specific tracks
- Sonnet and Haiku operate within the plan's framework (phase context in prompts)
- Plans are regenerated on major vibe shifts or consecutive skip patterns

## Contrast and Diversity (Critical)

Based on user research (34% negative sentiment on Spotify DJ due to echo chamber):
- Avoid sustained monotony — contrast between styles maintains engagement
- After 10+ tracks without user steering, inject a mild surprise (different but compatible genre/era)
- No single genre should dominate more than 40% of a 15-track sequence
- Score candidates for novelty alongside vibe fit
- The "serpentine" energy pattern: wave-like fluctuations within phases, not linear ramps

## Skip Reasoning (Not Just Skip Counting)

- 2+ skips in 5 minutes trigger Opus skip analysis (batch, not per-skip)
- Opus identifies the LIKELY ISSUE (energy, genre, era, tempo, production style)
- Taste model updates target the identified issue, not all tags uniformly
- Maximum 3 skip-analysis calls per session for cost control

```typescript
// WRONG — blunt heuristic
for (const tag of skippedTrack.tags) {
  tasteModel.genreWeights[tag] = (tasteModel.genreWeights[tag] ?? 0) - 0.2
}

// CORRECT — targeted adjustment based on Opus reasoning
const analysis = await analyzeSkips(skippedTracks, completedTracks)
if (analysis.likelyIssue === 'energy') {
  // Only adjust energy preference, not genre weights
  session.vibe.energyLevel = Math.max(1, session.vibe.energyLevel - 2)
}
```

## Energy Arc Awareness

Based on professional DJ mixing research:
- Avoid sustained peak intensity — contrast between high and low energy maintains engagement
- A 45-60 minute session should have: warm-up > build > peak (2/3 through) > release > finale
- Track BPM changes should be gradual: +/-10 BPM between consecutive tracks
- Genre shifts should use "bridge tracks" that share characteristics with both clusters
- After 10+ tracks without user steering, inject a mild surprise (different but compatible genre/era)

## Mobile-First Layout

- Touch targets: minimum 44px height for all interactive elements
- NowPlaying art: 200px on mobile, scalable up on desktop
- Text input: always visible at bottom, above safe area insets
- Expandable panels: full-width slide-up drawers on mobile, side panels on desktop
- Progress bar: minimum 6px height for seekable area (thumb target 44px)

## Feedback Visibility

- Every DJ action should produce visible feedback in the message stream
- Skip detection: user sees acknowledgment within 2 seconds
- Queue refill: "Finding more tracks..." message while loading
- Vibe steer: immediate acknowledgment, then detailed response
- Error states: conversational ("Hmm, having trouble reaching Spotify. Trying again...")
- Never show technical error messages to the user

## Cost Guardrails

- Maximum Opus calls per session: ~21 (1 plan + 2 replans + 3 skip analyses + 15 narrations)
- Estimated Opus cost per session: $0.60-1.00
- Some narrations (single skips, queue refills) should use Haiku instead of Opus
- Cache set plan in session KV — do not regenerate unless vibe significantly changes
- Batch skip analysis (2+ skips in 5 min) rather than per-skip Opus calls
