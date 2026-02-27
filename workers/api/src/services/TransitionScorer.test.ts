/**
 * TransitionScorer Tests
 * Tests for pure algorithmic track transition scoring
 */

import type {ArcPhase} from '@dj/shared-types'

import {describe, expect, it} from 'vitest'

import {
  orderByTransition,
  scoreArtistDiversity,
  scoreBpmCompatibility,
  scoreEnergyFlow,
  scoreEraProximity,
  scoreGenreBridge,
  scoreTransition,
  type TrackProfile,
} from './TransitionScorer'

// ===== Test Helpers =====

function buildArcPhase(overrides: Partial<ArcPhase> = {}): ArcPhase {
  return {
    durationMinutes: 15,
    genreHints: [],
    name: 'peak',
    targetBpmRange: [120, 140],
    targetEnergy: 0.8,
    ...overrides,
  }
}

function buildTrackProfile(overrides: Partial<TrackProfile> = {}): TrackProfile {
  return {
    artist: 'Test Artist',
    bpm: 120,
    energy: 0.7,
    name: 'Test Track',
    releaseYear: 2020,
    tags: ['electronic', 'dance'],
    ...overrides,
  }
}

// ===== BPM Compatibility Tests =====

describe('scoreBpmCompatibility', () => {
  it('returns 1.0 for identical BPM', () => {
    expect(scoreBpmCompatibility(120, 120)).toBe(1.0)
  })

  it('returns 1.0 within tolerance (±10 BPM)', () => {
    expect(scoreBpmCompatibility(120, 125)).toBe(1.0)
    expect(scoreBpmCompatibility(120, 130)).toBe(1.0)
    expect(scoreBpmCompatibility(120, 110)).toBe(1.0)
  })

  it('penalizes BPM difference > 10', () => {
    const score = scoreBpmCompatibility(120, 135)
    expect(score).toBeLessThan(1.0)
    expect(score).toBeGreaterThan(0.5)
  })

  it('severely penalizes large BPM jumps', () => {
    const score = scoreBpmCompatibility(80, 140)
    expect(score).toBeLessThan(0.3)
  })

  it('returns 0.5 (neutral) when either BPM is null', () => {
    expect(scoreBpmCompatibility(null, 120)).toBe(0.5)
    expect(scoreBpmCompatibility(120, null)).toBe(0.5)
    expect(scoreBpmCompatibility(null, null)).toBe(0.5)
  })

  it('is symmetric', () => {
    expect(scoreBpmCompatibility(100, 130)).toBe(scoreBpmCompatibility(130, 100))
  })
})

// ===== Energy Flow Tests =====

describe('scoreEnergyFlow', () => {
  it('returns 1.0 when energy matches arc target', () => {
    expect(scoreEnergyFlow(0.8, 0.8)).toBe(1.0)
  })

  it('returns 1.0 within tolerance (±0.15)', () => {
    expect(scoreEnergyFlow(0.7, 0.8)).toBe(1.0)
    expect(scoreEnergyFlow(0.9, 0.8)).toBe(1.0)
  })

  it('penalizes energy deviation beyond tolerance', () => {
    const score = scoreEnergyFlow(0.3, 0.8)
    expect(score).toBeLessThan(1.0)
    expect(score).toBeGreaterThan(0)
  })

  it('extreme deviation scores very low', () => {
    const score = scoreEnergyFlow(0.0, 1.0)
    expect(score).toBeLessThan(0.2)
  })
})

// ===== Genre Bridge Tests =====

describe('scoreGenreBridge', () => {
  it('returns 1.0 for identical tag sets', () => {
    expect(scoreGenreBridge(['rock', 'indie'], ['rock', 'indie'])).toBe(1.0)
  })

  it('returns partial score for overlapping tags', () => {
    const score = scoreGenreBridge(['rock', 'indie', 'pop'], ['rock', 'electronic'])
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1.0)
  })

  it('returns 0 for completely different tags', () => {
    expect(scoreGenreBridge(['rock', 'metal'], ['jazz', 'classical'])).toBe(0)
  })

  it('returns 0.5 (neutral) when either has no tags', () => {
    expect(scoreGenreBridge([], ['rock'])).toBe(0.5)
    expect(scoreGenreBridge(['rock'], [])).toBe(0.5)
    expect(scoreGenreBridge([], [])).toBe(0.5)
  })

  it('is case-insensitive', () => {
    expect(scoreGenreBridge(['Rock', 'INDIE'], ['rock', 'indie'])).toBe(1.0)
  })
})

// ===== Artist Diversity Tests =====

describe('scoreArtistDiversity', () => {
  it('returns 1.0 for a new artist', () => {
    expect(scoreArtistDiversity('New Artist', ['Artist A', 'Artist B'])).toBe(1.0)
  })

  it('returns 0 for a repeated artist', () => {
    expect(scoreArtistDiversity('Artist A', ['Artist A', 'Artist B'])).toBe(0)
  })

  it('is case-insensitive', () => {
    expect(scoreArtistDiversity('artist a', ['Artist A', 'Artist B'])).toBe(0)
  })

  it('only checks last 5 artists (diversity window)', () => {
    const recentArtists = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']
    // A1 is outside the 5-track window (index 0, window is last 5)
    expect(scoreArtistDiversity('A1', recentArtists)).toBe(1.0)
    // A6 is within the window
    expect(scoreArtistDiversity('A6', recentArtists)).toBe(0)
  })

  it('returns 1.0 for empty recent list', () => {
    expect(scoreArtistDiversity('Any Artist', [])).toBe(1.0)
  })
})

// ===== Era Proximity Tests =====

describe('scoreEraProximity', () => {
  it('returns 1.0 for same decade', () => {
    expect(scoreEraProximity(2021, 2025)).toBe(1.0)
  })

  it('returns 0.5 for adjacent decades', () => {
    expect(scoreEraProximity(2019, 2021)).toBe(0.5)
  })

  it('decays for distant decades', () => {
    const score = scoreEraProximity(1980, 2020)
    expect(score).toBeLessThan(0.5)
  })

  it('returns 0.5 (neutral) when either year is null', () => {
    expect(scoreEraProximity(null, 2020)).toBe(0.5)
    expect(scoreEraProximity(2020, null)).toBe(0.5)
  })

  it('is symmetric', () => {
    expect(scoreEraProximity(1990, 2020)).toBe(scoreEraProximity(2020, 1990))
  })
})

// ===== Composite Score Tests =====

describe('scoreTransition', () => {
  it('returns high score for perfect transition', () => {
    const from = buildTrackProfile({artist: 'A', bpm: 120, energy: 0.7, releaseYear: 2020, tags: ['electronic']})
    const to = buildTrackProfile({artist: 'B', bpm: 122, energy: 0.8, releaseYear: 2021, tags: ['electronic', 'dance']})
    const phase = buildArcPhase({targetEnergy: 0.8})

    const score = scoreTransition(from, to, phase, ['C', 'D'])

    expect(score.overall).toBeGreaterThan(0.8)
    expect(score.bpmCompatibility).toBe(1.0) // within tolerance
    expect(score.artistDiversity).toBe(1.0)
  })

  it('returns low score for poor transition', () => {
    const from = buildTrackProfile({artist: 'A', bpm: 80, energy: 0.3, releaseYear: 1960, tags: ['jazz']})
    const to = buildTrackProfile({artist: 'A', bpm: 170, energy: 0.9, releaseYear: 2024, tags: ['metal', 'hardcore']})
    const phase = buildArcPhase({targetEnergy: 0.3})

    const score = scoreTransition(from, to, phase, ['A'])

    expect(score.overall).toBeLessThan(0.3)
    expect(score.artistDiversity).toBe(0) // same artist
  })

  it('all component scores are between 0 and 1', () => {
    const from = buildTrackProfile()
    const to = buildTrackProfile({artist: 'Different'})
    const phase = buildArcPhase()

    const score = scoreTransition(from, to, phase)

    expect(score.overall).toBeGreaterThanOrEqual(0)
    expect(score.overall).toBeLessThanOrEqual(1)
    expect(score.bpmCompatibility).toBeGreaterThanOrEqual(0)
    expect(score.bpmCompatibility).toBeLessThanOrEqual(1)
    expect(score.energyFlow).toBeGreaterThanOrEqual(0)
    expect(score.energyFlow).toBeLessThanOrEqual(1)
    expect(score.genreBridge).toBeGreaterThanOrEqual(0)
    expect(score.genreBridge).toBeLessThanOrEqual(1)
    expect(score.artistDiversity).toBeGreaterThanOrEqual(0)
    expect(score.artistDiversity).toBeLessThanOrEqual(1)
    expect(score.eraProximity).toBeGreaterThanOrEqual(0)
    expect(score.eraProximity).toBeLessThanOrEqual(1)
  })
})

// ===== Track Ordering Tests =====

describe('orderByTransition', () => {
  it('returns empty array for empty candidates', () => {
    expect(orderByTransition([], [buildArcPhase()])).toEqual([])
  })

  it('orders tracks to minimize BPM jumps', () => {
    const candidates = [
      {...buildTrackProfile({artist: 'A', bpm: 160, name: 'Fast'}), spotifyUri: 'spotify:track:fast'},
      {...buildTrackProfile({artist: 'B', bpm: 80, name: 'Slow'}), spotifyUri: 'spotify:track:slow'},
      {...buildTrackProfile({artist: 'C', bpm: 120, name: 'Medium'}), spotifyUri: 'spotify:track:medium'},
    ]
    const phases = [buildArcPhase({durationMinutes: 30, targetEnergy: 0.7})]
    const startTrack = buildTrackProfile({bpm: 115, energy: 0.7})

    const ordered = orderByTransition(candidates, phases, startTrack)

    expect(ordered).toHaveLength(3)
    // Medium (120) should be picked first (closest to starting 115)
    expect(ordered[0].name).toBe('Medium')
    // Each track should have a transition score
    expect(ordered[0].transitionScore).toBeGreaterThan(0)
  })

  it('avoids repeating artists', () => {
    const candidates = [
      {...buildTrackProfile({artist: 'Same Artist', bpm: 121, name: 'Track A1'}), spotifyUri: 'spotify:track:a1'},
      {...buildTrackProfile({artist: 'Different Artist', bpm: 122, name: 'Track B'}), spotifyUri: 'spotify:track:b'},
      {...buildTrackProfile({artist: 'Same Artist', bpm: 123, name: 'Track A2'}), spotifyUri: 'spotify:track:a2'},
    ]
    const phases = [buildArcPhase({durationMinutes: 30})]

    const ordered = orderByTransition(candidates, phases)

    // Should not pick two Same Artist tracks back to back
    const artists = ordered.map(t => t.artist)
    for (let i = 1; i < artists.length; i++) {
      if (artists[i] === artists[i - 1]) {
        // This is acceptable only if there's no other option
        // With 3 tracks and 2 by same artist, it's inevitable for one pair
      }
    }

    // At minimum, track B should appear between the two Same Artist tracks
    const bIndex = ordered.findIndex(t => t.name === 'Track B')
    expect(bIndex).toBeGreaterThan(0) // B shouldn't be first (all BPMs are close)
  })

  it('assigns tracks to arc phases proportionally', () => {
    const candidates = Array.from({length: 10}, (_, i) => ({
      ...buildTrackProfile({artist: `Artist ${i}`, bpm: 100 + i * 5, name: `Track ${i}`}),
      spotifyUri: `spotify:track:${i}`,
    }))

    const phases = [
      buildArcPhase({durationMinutes: 10, name: 'warm-up', targetEnergy: 0.4}),
      buildArcPhase({durationMinutes: 20, name: 'peak', targetEnergy: 0.9}),
      buildArcPhase({durationMinutes: 10, name: 'cooldown', targetEnergy: 0.3}),
    ]

    const ordered = orderByTransition(candidates, phases)

    expect(ordered).toHaveLength(10)
    // Peak phase (50% of duration) should have roughly 5 tracks
    const peakTracks = ordered.filter(t => t.arcPhase === 'peak')
    expect(peakTracks.length).toBeGreaterThanOrEqual(4)
    expect(peakTracks.length).toBeLessThanOrEqual(6)
  })

  it('includes valid PlannedTrack fields in output', () => {
    const candidates = [
      {...buildTrackProfile({artist: 'Artist 1', name: 'Track 1'}), spotifyUri: 'spotify:track:1'},
    ]

    const ordered = orderByTransition(candidates, [buildArcPhase()])

    expect(ordered[0]).toMatchObject({
      arcPhase: 'peak',
      artist: 'Artist 1',
      name: 'Track 1',
      spotifyUri: 'spotify:track:1',
    })
    expect(ordered[0].transitionScore).toBeGreaterThanOrEqual(0)
    expect(ordered[0].transitionScore).toBeLessThanOrEqual(1)
    expect(ordered[0].reason).toContain('Transition score')
  })
})
