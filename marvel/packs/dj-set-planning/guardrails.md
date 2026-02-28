# DJ Set Planning (February 2026)

Domain knowledge for planning coherent DJ sets with energy arcs, transitions, and contrast. Based on professional DJ mixing theory (Mixed In Key, DJ.Studio, DJ TechTools) and validated against Spotify Smart Reorder patterns.

## Five-Phase Energy Structure (Critical)

Every DJ session follows this arc. Track selection must be phase-aware.

| Phase | Set % | Energy (1-10) | Character |
|-------|-------|---------------|-----------|
| Warm-up | 15-20% | 3-5 | Spacious, atmospheric, setting the mood |
| Build | 20-25% | 5-7 | Stronger rhythms, gradual intensity increase |
| Peak | 20-25% | 7-9 | High energy, shorter transitions, anthems |
| Release | 15-20% | 5-7 | Melodic, vocal, letting the listener breathe |
| Finale | 10-15% | 4-6 | Extended outros, memorable closer |

The peak hits approximately **two-thirds** through the set. This is not arbitrary — it follows the tension-release cycle that maintains engagement.

```typescript
// CORRECT — phase-aware track selection
function getPhaseForTrackNumber(trackNumber: number, totalTracks: number): SetPhase {
  const position = trackNumber / totalTracks
  if (position < 0.18) return 'warm_up'
  if (position < 0.43) return 'build'
  if (position < 0.67) return 'peak'
  if (position < 0.85) return 'release'
  return 'finale'
}

// WRONG — flat energy targeting
const targetEnergy = session.vibe.energyLevel // Same target for every track
```

## The Serpentine Pattern

Within each phase, energy should oscillate in waves, not climb linearly.

```
Peak phase example (target 7-9):
  Track 1: Energy 7 (entering peak)
  Track 2: Energy 8 (climbing)
  Track 3: Energy 9 (high point)
  Track 4: Energy 7 (brief dip — creates anticipation)
  Track 5: Energy 9 (climactic moment)
  Track 6: Energy 8 (beginning release)
```

A constant Energy 9 causes fatigue. The dip at Track 4 makes Track 5 feel more intense by contrast.

## BPM Transitions

- **Gradual changes**: Maximum +/-10 BPM between consecutive tracks
- **Energy-BPM correlation**: Higher energy phases generally have higher BPM, but this is NOT linear
- **Bridge tracks**: When transitioning between BPM ranges, use tracks that work at both tempos
- **BPM validation**: Only trust BPM values in the 45-220 range (Deezer data can be unreliable outside this)

```typescript
// CORRECT — gradual BPM transition scoring
function scoreBpmTransition(currentBpm: number, candidateBpm: number): number {
  const diff = Math.abs(currentBpm - candidateBpm)
  if (diff <= 5) return 1.0   // Perfect
  if (diff <= 10) return 0.8  // Good
  if (diff <= 20) return 0.4  // Acceptable for genre shift
  return 0.1                   // Jarring
}

// WRONG — only checking if BPM is in range
function checkBpm(bpm: number, range: BpmRange): boolean {
  return bpm >= range.min && bpm <= range.max // Ignores transition smoothness
}
```

## Genre Clustering and Bridge Tracks

Group similar genres into clusters. Use bridge tracks (tracks that share characteristics with both clusters) to transition between them.

**Bridge track properties:**
- Shares at least 1 tag with the outgoing genre cluster
- Shares at least 1 tag with the incoming genre cluster
- BPM is compatible with both clusters
- Energy level is between the two clusters

```typescript
// CORRECT — genre bridge scoring
function scoreGenreBridge(
  candidateTags: string[],
  outgoingClusterTags: string[],
  incomingClusterTags: string[],
): number {
  const outgoingOverlap = candidateTags.filter(t => outgoingClusterTags.includes(t)).length
  const incomingOverlap = candidateTags.filter(t => incomingClusterTags.includes(t)).length
  if (outgoingOverlap > 0 && incomingOverlap > 0) return 1.0 // Perfect bridge
  if (outgoingOverlap > 0 || incomingOverlap > 0) return 0.5 // Partial bridge
  return 0.0 // No connection
}
```

## Contrast Principles (Critical)

Based on research: 34% of Spotify DJ users are negative primarily due to echo chamber / repetition.

- **After 10+ tracks**: Inject a surprise — different but compatible genre, era, or style
- **No single genre > 40%**: In any 15-track window, no genre should dominate more than 40%
- **Artist diversity**: No artist appears more than twice in a 10-track window
- **Era mixing**: At least 2 different decades represented in any 10-track window
- **Contrast creates engagement**: The difference between tracks is what holds attention, not consistency

```typescript
// CORRECT — track contrast against recent history
function needsSurprise(recentTracks: Track[], tracksSinceLastSteer: number): boolean {
  if (tracksSinceLastSteer < 10) return false
  const genres = recentTracks.flatMap(t => t.tags)
  const genreCounts = countOccurrences(genres)
  const maxGenreShare = Math.max(...Object.values(genreCounts)) / genres.length
  return maxGenreShare > 0.4 // Too monotonous
}
```

## Skip Signal Interpretation

Skips contain more information than "the user didn't like it." Interpret skips in context.

| Pattern | Likely Issue | Response |
|---------|-------------|----------|
| Skipped 3 tracks, all same genre | Genre mismatch | Shift genre focus |
| Skipped 2 high-energy, kept 1 low-energy | Energy too high | Lower energy target |
| Skipped 3 tracks, all from same era | Era mismatch | Broaden era range |
| Skipped 1, kept next 3 | One bad track, not a pattern | Minor adjustment only |
| Skipped 3 tracks with > 140 BPM | Tempo too fast | Lower BPM target |

- Never adjust all dimensions on a single skip — identify the likely cause
- Batch skip analysis: 2+ skips in 5 minutes triggers analysis
- Use the contrast between KEPT and SKIPPED tracks to isolate the variable

## Transition Scoring Weights

Composite score for candidate track selection:

| Dimension | Weight | What It Measures |
|-----------|--------|-----------------|
| BPM compatibility | 30% | Gradual tempo transition |
| Energy flow | 25% | Matches phase target energy |
| Genre bridge | 15% | Connects genre clusters smoothly |
| Contrast/novelty | 15% | Adds variety to recent history |
| Artist diversity | 10% | Avoids artist repetition |
| Era proximity | 5% | Compatible time period |

## Set Plan as Prompt Context

All AI calls (Opus, Sonnet, Haiku) should include the current phase context:

```
SET PLAN — CURRENT PHASE:
Phase: build (track 5 of ~8)
Target energy: 6/10
Target BPM: 115-125
Genre focus: indie rock, post-punk, shoegaze
Strategy: Building momentum with driving rhythms, transitioning toward electronic elements
```

This ensures every model tier makes decisions within the strategic framework.
