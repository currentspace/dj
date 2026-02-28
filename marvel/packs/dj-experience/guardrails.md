# DJ Experience Design

Auto DJ experience design patterns grounded in research from Spotify DJ, Algoriddim djay, and professional DJ mixing principles.

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
- Use Opus 4.6 for narration (100-token output per message, ~$0.001 each)
- The DJ has a consistent personality: knowledgeable, enthusiastic but not overly so, honest about its choices
- Never narrate technical details ("calling analyze_playlist tool") — speak in music terms

Example narrations:
- "Starting from your Chill Vibes playlist. Feeling lo-fi and ambient — let's ease into it."
- "Noticed you skipped those last two. Steering away from hip-hop, leaning more indie."
- "Added Snarky Puppy — great BPM bridge from what's playing now."
- "Energy's been building for 4 tracks. Keeping the momentum going."

## Text Input as Universal Steering

- The single text input at the bottom handles ALL interactions:
  - Vibe steering: "more energy", "chill out", "throw in some jazz"
  - Track requests: "play some Radiohead", "queue up that song from earlier"
  - Questions: "what's playing?", "why did you pick this track?"
  - Analysis: "analyze my Running playlist"
  - Commands: "skip", "pause"
- Parse user intent server-side — the DJ has access to all 15 Spotify tools
- Mode is always "dj" — no mode selector needed

## Energy Arc Awareness

Based on professional DJ mixing research:
- Avoid sustained peak intensity — contrast between high and low energy maintains engagement
- A 45-60 minute session should have: warm-up → build → peak (⅔ through) → release → finale
- Track BPM changes should be gradual: ±10 BPM between consecutive tracks
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
