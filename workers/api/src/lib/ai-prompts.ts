/**
 * AI Prompts - Centralized prompt templates for all AI features
 *
 * All prompts are designed to return structured JSON for reliable parsing.
 * Keep prompts focused and specific to their task.
 */

import type { MixSession } from '@dj/shared-types'

// =============================================================================
// DJ MODE PROMPTS
// =============================================================================

/**
 * Prompt for curating/ranking track recommendations
 */
export function buildCurationPrompt(args: {
  candidate_tracks: { artists?: string; id: string; name: string; popularity?: number; source?: string }[]
  playlist_context?: {
    avg_popularity?: number
    bpm_range?: { max: number; min: number; }
    dominant_tags?: string[]
    era?: string
  }
  top_n: number
  user_request: string
}): string {
  return `<task>
You are an expert music curator selecting the best track recommendations from a pool of candidates.
</task>

<user_intent>
USER REQUEST: "${args.user_request}"
</user_intent>

<playlist_context>
${args.playlist_context?.bpm_range ? `BPM Range: ${args.playlist_context.bpm_range.min}-${args.playlist_context.bpm_range.max}` : ''}
${args.playlist_context?.dominant_tags?.length ? `Dominant Tags: ${args.playlist_context.dominant_tags.join(', ')}` : ''}
${args.playlist_context?.avg_popularity ? `Average Popularity: ${args.playlist_context.avg_popularity}/100` : ''}
${args.playlist_context?.era ? `Era: ${args.playlist_context.era}` : ''}
</playlist_context>

<candidate_pool>
CANDIDATE TRACKS (${args.candidate_tracks.length} total):
${args.candidate_tracks
  .slice(0, 50)
  .map((t, i) => `${i + 1}. "${t.name}" by ${t.artists} (popularity: ${t.popularity ?? 'unknown'}, source: ${t.source ?? 'unknown'})`)
  .join('\n')}
</candidate_pool>

<output_format>
Return ONLY valid JSON:
{
  "selected_track_ids": ["id1", "id2", ...],
  "reasoning": "2-3 sentence explanation of your selection approach"
}

Select exactly ${args.top_n} tracks. Return valid JSON only, no markdown code blocks.
</output_format>`
}

/**
 * Prompt for creating a discovery strategy based on vibe
 */
export function buildDiscoveryStrategyPrompt(args: {
  similar_tracks_available?: string[]
  user_request: string
  vibe_profile: Record<string, unknown>
}): string {
  return `<task>
You are a music discovery strategist creating an intelligent, multi-pronged search plan. Your goal is to find tracks that match the user's request while honoring the playlist's vibe profile.
</task>

<user_intent>
USER REQUEST: "${args.user_request}"
</user_intent>

<vibe_context>
VIBE PROFILE (extracted from playlist analysis):
${JSON.stringify(args.vibe_profile, null, 2)}
</vibe_context>

${
  Array.isArray(args.similar_tracks_available) && args.similar_tracks_available.length > 0
    ? `<lastfm_similar_tracks>
AVAILABLE LAST.FM SIMILAR TRACKS:
${args.similar_tracks_available.slice(0, 10).join('\n')}
</lastfm_similar_tracks>`
    : ''
}

<output_format>
Return ONLY valid JSON:
{
  "strategy_summary": "2-3 sentence description of the overall discovery approach",
  "lastfm_similar_priority": ["Artist - Track", ...],
  "tag_searches": [
    {
      "tags": ["tag1", "tag2"],
      "rationale": "Why this combination captures a facet of the vibe"
    }
  ],
  "spotify_searches": [
    {
      "query": "creative search query",
      "rationale": "What angle this targets"
    }
  ],
  "avoid": ["specific things to avoid"]
}

CRITICAL: Return valid JSON only. No markdown code blocks.
</output_format>`
}

/**
 * Prompt for initial track suggestions when starting a DJ session
 */
export function buildInitialSuggestionsPrompt(vibeDescription: string, count: number): string {
  return `You are a creative DJ helping someone start a mix session. Based on the following vibe profile, suggest ${count} real tracks that would be perfect to start with.

VIBE PROFILE:
${vibeDescription}

IMPORTANT GUIDELINES:
- Suggest REAL tracks that actually exist on Spotify
- Mix well-known classics with interesting deep cuts
- Consider flow and how tracks would work together
- Match the energy level and BPM range requested
- Be creative - don't just pick the most obvious choices
- Include a brief reason why each track fits the vibe

Return ONLY valid JSON in this exact format:
{
  "tracks": [
    {
      "artist": "Artist Name",
      "name": "Track Title",
      "reason": "Brief explanation of why this fits the vibe"
    }
  ]
}

Do NOT include markdown code blocks, only the raw JSON.`
}

/**
 * Prompt for suggesting the next track based on current context
 */
export function buildNextTrackPrompt(
  vibeDescription: string,
  recentTracks: { artist: string; name: string; }[],
  count: number,
  tasteContext?: { dislikedGenres: string[]; likedGenres: string[]; skippedArtists: string[] },
): string {
  const recentList = recentTracks
    .map((t, i) => `${i + 1}. "${t.name}" by ${t.artist}`)
    .join('\n')

  let tasteSection = ''
  if (tasteContext) {
    const parts: string[] = []
    if (tasteContext.likedGenres.length > 0) {
      parts.push(`The listener has been enjoying: ${tasteContext.likedGenres.join(', ')}`)
    }
    if (tasteContext.dislikedGenres.length > 0) {
      parts.push(`Avoid tracks with these vibes: ${tasteContext.dislikedGenres.join(', ')}`)
    }
    if (tasteContext.skippedArtists.length > 0) {
      parts.push(`These artists were recently skipped: ${tasteContext.skippedArtists.join(', ')}`)
    }
    if (parts.length > 0) {
      tasteSection = `\n\nLISTENER FEEDBACK:\n${parts.join('\n')}`
    }
  }

  return `You are an expert DJ planning the next tracks in a mix. Based on the vibe and recent history, suggest ${count} tracks that would flow well next.

VIBE PROFILE:
${vibeDescription}

RECENTLY PLAYED (most recent first):
${recentList}${tasteSection}

GUIDELINES:
- Maintain energy flow based on the energyDirection (${recentTracks.length > 0 ? 'building up, staying steady, or winding down' : 'starting the set'})
- Consider BPM compatibility for smooth transitions
- Suggest REAL tracks that exist on Spotify
- Include variety while staying within the vibe
- Explain why each track would work well as a transition

Return ONLY valid JSON:
{
  "tracks": [
    {
      "artist": "Artist Name",
      "name": "Track Title",
      "reason": "Why this works as the next track"
    }
  ]
}

Do NOT include markdown code blocks, only the raw JSON.`
}

// =============================================================================
// VIBE ANALYSIS PROMPTS
// =============================================================================

/**
 * Prompt for steering the vibe - transitioning from current tracks towards a new direction
 * Unlike nextTrack, this prioritizes the NEW direction while lightly acknowledging recent tracks
 */
export function buildSteeringSuggestionsPrompt(
  vibeDescription: string,
  steerDirection: string,
  recentTracks: { artist: string; name: string; }[],
  count: number
): string {
  const recentList = recentTracks.length > 0
    ? recentTracks.map((t, i) => `${i + 1}. "${t.name}" by ${t.artist}`).join('\n')
    : '(Starting fresh)'

  return `You are an expert DJ helping steer a mix in a new direction. The listener wants to shift towards "${steerDirection}".

NEW TARGET VIBE (PRIMARY - this is what we're steering TOWARDS):
${vibeDescription}

RECENT TRACKS (for context only - we're moving AWAY from this style):
${recentList}

YOUR TASK:
Suggest ${count} tracks that embody the NEW vibe direction. These should:
- STRONGLY match the new target vibe (genres, mood, energy, BPM)
- Be appropriate "bridge" tracks that wouldn't feel jarring if played after the recent tracks
- Prioritize the new direction over continuity with the old style
- Be REAL tracks that exist on Spotify

Think of it like a DJ transitioning from one genre to another - the tracks should feel like the new destination, while being reasonable pivot points from where we were.

Return ONLY valid JSON:
{
  "tracks": [
    {
      "artist": "Artist Name",
      "name": "Track Title",
      "reason": "How this embodies the new direction while bridging from the old"
    }
  ]
}

Do NOT include markdown code blocks, only the raw JSON.`
}

/**
 * Build a description of a vibe profile for use in prompts
 */
export function buildVibeDescription(vibe: MixSession['vibe']): string {
  const parts: string[] = []

  if (vibe.genres.length > 0) {
    parts.push(`Genres: ${vibe.genres.join(', ')}`)
  }

  if (vibe.mood.length > 0) {
    parts.push(`Mood: ${vibe.mood.join(', ')}`)
  }

  const energyDesc = vibe.energyLevel <= 3 ? 'low/chill' : vibe.energyLevel <= 6 ? 'medium' : 'high/intense'
  parts.push(`Energy: ${energyDesc} (${vibe.energyLevel}/10, ${vibe.energyDirection})`)

  if (vibe.bpmRange) {
    parts.push(`BPM range: ${vibe.bpmRange.min}-${vibe.bpmRange.max}`)
  }

  if (vibe.era) {
    parts.push(`Era: ${vibe.era.start}-${vibe.era.end}`)
  }

  return parts.join('\n')
}

/**
 * Prompt for extracting deep vibe characteristics from playlist analysis
 */
export function buildVibeExtractionPrompt(args: {
  deezer_analysis?: Record<string, unknown>
  lastfm_analysis?: Record<string, unknown>
  metadata_analysis?: Record<string, unknown>
  sample_tracks?: { artists: string; name: string; }[]
}): string {
  return `<task>
You are a music critic with expertise in identifying subtle sonic and emotional characteristics. Your task is to analyze the provided playlist data and extract a deep vibe profile that captures signals beyond simple genre labels.

WHY THIS MATTERS: Generic algorithmic recommendations fail because they rely on superficial tags. Your analysis will guide intelligent discovery that matches the playlist's true essence.
</task>

<input_data>
METADATA ANALYSIS:
${JSON.stringify(args.metadata_analysis ?? {}, null, 2)}

DEEZER ANALYSIS (BPM, rank, gain):
${JSON.stringify(args.deezer_analysis ?? {}, null, 2)}

LAST.FM ANALYSIS (crowd tags, similar tracks):
${JSON.stringify(args.lastfm_analysis ?? {}, null, 2)}

${
  Array.isArray(args.sample_tracks) && args.sample_tracks.length
    ? `SAMPLE TRACKS (representative examples):\n${args.sample_tracks
        .map(t => `- "${t.name}" by ${t.artists}`)
        .join('\n')}`
    : ''
}
</input_data>

<output_format>
Return ONLY valid JSON with this exact structure:
{
  "vibe_profile": "2-3 sentence natural language description capturing the playlist's essence and sonic identity",
  "emotional_characteristics": ["5-7 specific adjectives describing emotional qualities"],
  "production_style": "1-2 sentences on production aesthetic and sonic signature",
  "vocal_style": "1-2 sentences on vocal approach and delivery (or 'Instrumental focus' if applicable)",
  "instrumentation_notes": "1-2 sentences on key instrumentation and sonic palette",
  "era_feel": "1-2 sentences on temporal context and production era",
  "discovery_hints": {
    "genre_combinations": ["3-5 genre blend descriptions that capture vibe nuance"],
    "avoid_these": ["3-5 things to avoid that would break the vibe"],
    "era_ranges": ["2-3 time periods to explore"],
    "artist_archetypes": ["3-5 artist type descriptions to seek"],
    "spotify_params": {
      "target_energy": 0.0-1.0,
      "target_valence": 0.0-1.0,
      "target_danceability": 0.0-1.0,
      "target_acousticness": 0.0-1.0
    }
  }
}

CRITICAL: Ensure all JSON is valid. Do not include markdown code blocks, only the raw JSON object.
</output_format>`
}

// =============================================================================
// SYSTEM PROMPTS
// =============================================================================

export const SYSTEM_PROMPTS = {
  CURATOR: 'You are a music curator. Return only valid JSON.',
  DISCOVERY_STRATEGIST: 'You are a music discovery strategist. Return only valid JSON.',
  DJ: 'You are a music expert DJ. Suggest real tracks that exist on Spotify. Return only valid JSON.',
  MUSIC_CRITIC: 'You are a music critic. Return only valid JSON with deep vibe analysis.',
}
