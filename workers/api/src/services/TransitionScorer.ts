/**
 * TransitionScorer - Pure algorithmic track transition scoring
 *
 * Scores how well one track flows into another based on BPM, energy,
 * genre tags, artist diversity, and era proximity. No AI calls —
 * this is fast, deterministic, and cheap.
 */

import type {ArcPhase, PlannedTrack} from '@dj/shared-types'

// ===== Types =====

export interface TrackProfile {
  artist: string
  bpm: null | number
  energy: number
  name: string
  releaseYear: null | number
  tags: string[]
}

export interface TransitionScore {
  artistDiversity: number
  bpmCompatibility: number
  energyFlow: number
  eraProximity: number
  genreBridge: number
  overall: number
}

// ===== Constants =====

/** Maximum BPM difference before penalty starts */
const BPM_TOLERANCE = 10

/** Standard deviation for BPM gaussian penalty */
const BPM_SIGMA = 15

/** Maximum energy difference from arc target before penalty */
const ENERGY_TOLERANCE = 0.15

/** Standard deviation for energy gaussian penalty */
const ENERGY_SIGMA = 0.25

/** Number of recent tracks to check for artist repeats */
const ARTIST_DIVERSITY_WINDOW = 5

/** Decade proximity bonus threshold (same decade = full bonus) */
const DECADE_MATCH_BONUS = 1.0
const DECADE_ADJACENT_BONUS = 0.5

/** Score weights for the composite score */
const WEIGHTS = {
  artistDiversity: 0.15,
  bpm: 0.30,
  energy: 0.25,
  era: 0.10,
  genre: 0.20,
} as const

// ===== Scoring Functions =====

/**
 * Order a list of candidate tracks for optimal transition flow.
 * Uses greedy nearest-neighbor approach: pick the best next track at each step.
 *
 * @param candidates - Unordered candidate tracks
 * @param arcPhases - Arc phases to follow (tracks are assigned to phases by duration)
 * @param startingTrack - Optional starting track (e.g., currently playing)
 * @returns Ordered PlannedTrack[] with transition scores
 */
export function orderByTransition(
  candidates: (TrackProfile & {spotifyUri: string})[],
  arcPhases: ArcPhase[],
  startingTrack?: TrackProfile,
): PlannedTrack[] {
  if (candidates.length === 0) return []

  // Assign tracks to arc phases proportionally
  const totalDuration = arcPhases.reduce((sum, p) => sum + p.durationMinutes, 0)
  const tracksPerPhase = arcPhases.map(phase =>
    Math.max(1, Math.round((phase.durationMinutes / totalDuration) * candidates.length)),
  )

  // Adjust to match total candidates
  const totalAssigned = tracksPerPhase.reduce((sum, n) => sum + n, 0)
  if (totalAssigned > candidates.length) {
    tracksPerPhase[tracksPerPhase.length - 1] -= totalAssigned - candidates.length
  } else if (totalAssigned < candidates.length) {
    tracksPerPhase[tracksPerPhase.length - 1] += candidates.length - totalAssigned
  }

  const remaining = [...candidates]
  const ordered: PlannedTrack[] = []
  const recentArtists: string[] = []
  let previous: TrackProfile = startingTrack ?? candidates[0]

  let phaseIndex = 0
  let tracksInCurrentPhase = 0

  for (const _candidate of candidates) {
    // Advance to next phase if needed
    // eslint-disable-next-line security/detect-object-injection -- safe: phaseIndex is a controlled integer incremented within bounds of arcPhases.length
    while (phaseIndex < arcPhases.length - 1 && tracksInCurrentPhase >= tracksPerPhase[phaseIndex]) {
      phaseIndex++
      tracksInCurrentPhase = 0
    }

    // eslint-disable-next-line security/detect-object-injection -- safe: phaseIndex is a controlled integer bounded by arcPhases.length - 1 check above
    const currentPhase = arcPhases[phaseIndex]

    // Score all remaining tracks and pick the best
    let bestIdx = 0
    let bestScore = -1

    for (let j = 0; j < remaining.length; j++) {
      // eslint-disable-next-line security/detect-object-injection -- safe: j is a controlled loop index bounded by remaining.length
      const score = scoreTransition(previous, remaining[j], currentPhase, recentArtists)
      if (score.overall > bestScore) {
        bestScore = score.overall
        bestIdx = j
      }
    }

    const picked = remaining.splice(bestIdx, 1)[0]

    ordered.push({
      arcPhase: currentPhase.name,
      artist: picked.artist,
      bpm: picked.bpm,
      energy: picked.energy,
      name: picked.name,
      reason: `Transition score: ${bestScore.toFixed(2)} (BPM, energy, genre match for ${currentPhase.name} phase)`,
      spotifyUri: picked.spotifyUri,
      transitionScore: bestScore,
    })

    recentArtists.push(picked.artist)
    previous = picked
    tracksInCurrentPhase++
  }

  return ordered
}

/**
 * Score artist diversity — penalize repeating the same artist within a window.
 * Returns 0 if same artist in recent history, 1.0 otherwise.
 */
export function scoreArtistDiversity(
  artist: string,
  recentArtists: string[],
): number {
  const normalized = artist.toLowerCase().trim()
  const window = recentArtists.slice(-ARTIST_DIVERSITY_WINDOW)

  for (const recent of window) {
    if (recent.toLowerCase().trim() === normalized) return 0
  }

  return 1.0
}

/**
 * Score BPM compatibility between two tracks.
 * Uses gaussian penalty — within ±10 BPM is excellent, degrades smoothly beyond that.
 */
export function scoreBpmCompatibility(fromBpm: null | number, toBpm: null | number): number {
  if (fromBpm === null || toBpm === null) return 0.5 // neutral when BPM unknown
  const distance = Math.abs(fromBpm - toBpm)
  if (distance <= BPM_TOLERANCE) return 1.0
  return gaussian(distance - BPM_TOLERANCE, BPM_SIGMA)
}

/**
 * Score how well a track's energy matches the arc phase target.
 * Penalizes tracks that deviate too far from the target energy.
 */
export function scoreEnergyFlow(trackEnergy: number, arcTarget: number): number {
  const distance = Math.abs(trackEnergy - arcTarget)
  if (distance <= ENERGY_TOLERANCE) return 1.0
  return gaussian(distance - ENERGY_TOLERANCE, ENERGY_SIGMA)
}

/**
 * Score era proximity — bonus for tracks from the same or adjacent decades.
 */
export function scoreEraProximity(
  fromYear: null | number,
  toYear: null | number,
): number {
  if (fromYear === null || toYear === null) return 0.5 // neutral when unknown

  const fromDecade = Math.floor(fromYear / 10)
  const toDecade = Math.floor(toYear / 10)
  const decadeDiff = Math.abs(fromDecade - toDecade)

  if (decadeDiff === 0) return DECADE_MATCH_BONUS
  if (decadeDiff === 1) return DECADE_ADJACENT_BONUS
  return Math.max(0, 1.0 - decadeDiff * 0.2) // gradual decay
}

/**
 * Score genre compatibility using Jaccard similarity on tag sets.
 * Returns 0-1 based on tag overlap.
 */
export function scoreGenreBridge(fromTags: string[], toTags: string[]): number {
  if (fromTags.length === 0 || toTags.length === 0) return 0.5 // neutral when no tags

  const fromSet = new Set(fromTags.map(t => t.toLowerCase()))
  const toSet = new Set(toTags.map(t => t.toLowerCase()))

  let intersection = 0
  for (const tag of fromSet) {
    if (toSet.has(tag)) intersection++
  }

  const union = fromSet.size + toSet.size - intersection
  if (union === 0) return 0.5

  return intersection / union
}

// ===== Composite Scoring =====

/**
 * Score a transition from one track to another given an arc phase context.
 */
export function scoreTransition(
  from: TrackProfile,
  to: TrackProfile,
  arcPhase: ArcPhase,
  recentArtists: string[] = [],
): TransitionScore {
  const bpmCompatibility = scoreBpmCompatibility(from.bpm, to.bpm)
  const energyFlow = scoreEnergyFlow(to.energy, arcPhase.targetEnergy)
  const genreBridge = scoreGenreBridge(from.tags, to.tags)
  const artistDiversity = scoreArtistDiversity(to.artist, recentArtists)
  const eraProximity = scoreEraProximity(from.releaseYear, to.releaseYear)

  const overall =
    bpmCompatibility * WEIGHTS.bpm +
    energyFlow * WEIGHTS.energy +
    genreBridge * WEIGHTS.genre +
    artistDiversity * WEIGHTS.artistDiversity +
    eraProximity * WEIGHTS.era

  return {
    artistDiversity,
    bpmCompatibility,
    energyFlow,
    eraProximity,
    genreBridge,
    overall,
  }
}

// ===== Track Ordering =====

/**
 * Gaussian function centered at 0 with given sigma.
 * Returns 1.0 at center, decays toward 0 as distance increases.
 */
function gaussian(distance: number, sigma: number): number {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma))
}
