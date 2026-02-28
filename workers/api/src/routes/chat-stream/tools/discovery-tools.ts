import Anthropic from '@anthropic-ai/sdk'
import {z} from 'zod'
import {VibeAnalysisSchema, DiscoveryStrategySchema, CurationResponseSchema} from '@dj/shared-types'

import type {Env} from '../../../index'
import {LLM} from '../../../constants'
import {getLogger} from '../../../utils/LoggerContext'
import {isNumber, isObject, isString, isStringArray} from '../streaming/anthropic-utils'
import type {SSEWriter} from '../streaming/sse-writer'
import type {NativeTool} from '../types'

/**
 * Create AI-powered discovery tools (vibe extraction, strategy planning, curation)
 */
export function createDiscoveryTools(
  sseWriter: SSEWriter,
  abortSignal?: AbortSignal,
  env?: Env,
): NativeTool[] {
  return [
    {
      description:
        'Use AI to deeply analyze playlist enrichment data and extract subtle vibe signals that go beyond genre tags. Returns natural language vibe profile with discovery hints.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        // Debug logging to understand what's being passed
        const analysisData: unknown = args.analysis_data
        getLogger()?.info('[extract_playlist_vibe] Received args:', {
          has_analysis_data: !!analysisData,
          is_object: isObject(analysisData),
          type_of: typeof analysisData,
          keys: isObject(analysisData) ? Object.keys(analysisData) : [],
          metadata_exists: isObject(analysisData) && 'metadata_analysis' in analysisData,
          deezer_exists: isObject(analysisData) && 'deezer_analysis' in analysisData,
          lastfm_exists: isObject(analysisData) && 'lastfm_analysis' in analysisData,
        })

        if (isObject(analysisData)) {
          getLogger()?.info('[extract_playlist_vibe] Metadata analysis:', {data: analysisData.metadata_analysis})
          getLogger()?.info('[extract_playlist_vibe] Deezer analysis:', {data: analysisData.deezer_analysis})
          getLogger()?.info('[extract_playlist_vibe] Last.fm analysis:', {data: analysisData.lastfm_analysis})
        } else {
          getLogger()?.warn('[extract_playlist_vibe] analysis_data is not an object:', {data: analysisData})
        }

        await sseWriter.write({
          data: {
            args: {has_metadata: !!args.analysis_data},
            tool: 'extract_playlist_vibe',
          },
          type: 'tool_start',
        })

        await sseWriter.write({
          data: `Analyzing playlist vibe using AI...`,
          type: 'thinking',
        })

        const anthropic = new Anthropic({
          apiKey: env!.ANTHROPIC_API_KEY,
        })

        const vibePrompt = buildVibeExtractionPrompt(args)

        try {
          const response = await anthropic.messages.create({
            max_tokens: 2000,
            messages: [{content: vibePrompt, role: 'user'}],
            model: LLM.MODEL,
            system: 'You are a music critic. Return only valid JSON with deep vibe analysis.',
            temperature: 0.7,
          })

          // Extract text from content blocks
          const content = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map(block => block.text)
            .join('')
          const jsonMatch = /\{[\s\S]*\}/.exec(content)
          if (!jsonMatch) {
            throw new Error('No JSON found in vibe analysis response')
          }

          let rawParsed: unknown
          try {
            rawParsed = JSON.parse(jsonMatch[0])
          } catch (parseError) {
            getLogger()?.error('[extract_playlist_vibe] Failed to parse vibe analysis JSON', {
              error: parseError instanceof Error ? parseError.message : String(parseError),
              jsonPreview: jsonMatch[0].substring(0, 200),
            })
            throw new Error('Failed to parse vibe analysis response as JSON')
          }

          const vibeResult = VibeAnalysisSchema.safeParse(rawParsed)
          const vibeAnalysis = vibeResult.success ? vibeResult.data : rawParsed

          await sseWriter.write({
            data: `Vibe extracted: ${vibeResult.success ? vibeResult.data.vibe_profile?.substring(0, 80) : 'unknown'}...`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: `Analyzed vibe: ${vibeResult.success ? vibeResult.data.emotional_characteristics?.slice(0, 3).join(', ') : 'analysis complete'}`,
              tool: 'extract_playlist_vibe',
            },
            type: 'tool_end',
          })

          return vibeAnalysis
        } catch (error) {
          getLogger()?.error('[extract_playlist_vibe] AI analysis failed:', error)

          // Fallback: Basic analysis from tags
          const tags =
            isObject(args.analysis_data) &&
            isObject(args.analysis_data.lastfm_analysis) &&
            Array.isArray(args.analysis_data.lastfm_analysis.crowd_tags)
              ? args.analysis_data.lastfm_analysis.crowd_tags
                  .slice(0, 5)
                  .map((t: {count: number; tag: string}) => t.tag)
              : []
          const fallbackVibe = {
            discovery_hints: {
              artist_archetypes: [],
              avoid_these: [],
              era_ranges: [],
              genre_combinations: tags.slice(0, 2),
              spotify_params: {
                target_danceability: 0.5,
                target_energy: 0.5,
                target_valence: 0.5,
              },
            },
            emotional_characteristics: tags,
            era_feel: 'Unknown',
            instrumentation_notes: 'Unknown',
            production_style: 'Unknown',
            vibe_profile: `Playlist characterized by tags: ${tags.join(', ')}`,
            vocal_style: 'Unknown',
          }

          await sseWriter.write({
            data: `Using basic tag analysis (AI unavailable)`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: `Basic analysis: ${tags.join(', ')}`,
              tool: 'extract_playlist_vibe',
            },
            type: 'tool_end',
          })

          return fallbackVibe
        }
      },
      name: 'extract_playlist_vibe',
      schema: z.object({
        analysis_data: z
          .object({
            deezer_analysis: z
              .object({
                bpm: z
                  .object({
                    avg: z.number(),
                    range: z.object({max: z.number(), min: z.number()}),
                    sample_size: z.number(),
                  })
                  .optional(),
                gain: z
                  .object({
                    avg: z.number(),
                    range: z.object({max: z.number(), min: z.number()}),
                    sample_size: z.number(),
                  })
                  .optional(),
                rank: z
                  .object({
                    avg: z.number(),
                    range: z.object({max: z.number(), min: z.number()}),
                    sample_size: z.number(),
                  })
                  .optional(),
                source: z.string(),
                total_checked: z.number(),
                tracks_found: z.number(),
              })
              .passthrough()
              .optional(),
            lastfm_analysis: z
              .object({
                artists_enriched: z.number(),
                avg_listeners: z.number(),
                avg_playcount: z.number(),
                crowd_tags: z.array(z.object({count: z.number(), tag: z.string()})),
                sample_size: z.number(),
                similar_tracks: z.array(z.string()),
                source: z.string(),
              })
              .passthrough()
              .optional(),
            metadata_analysis: z
              .object({
                avg_duration_minutes: z.number(),
                avg_duration_ms: z.number(),
                avg_popularity: z.number(),
                explicit_percentage: z.number(),
                explicit_tracks: z.number(),
                release_year_range: z
                  .object({
                    average: z.number(),
                    newest: z.number(),
                    oldest: z.number(),
                  })
                  .nullable(),
                top_genres: z.array(z.string()),
                total_artists: z.number(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .describe('Full analysis from analyze_playlist'),
        sample_tracks: z
          .array(
            z.object({
              artists: z.string(),
              duration_ms: z.number().optional(),
              name: z.string(),
              popularity: z.number().optional(),
            }),
          )
          .max(20)
          .optional()
          .describe('Sample track names for additional context'),
      }),
    },

    {
      description:
        'Use AI to create a smart multi-pronged discovery strategy based on vibe analysis. Returns specific search queries and parameters to find interesting recommendations.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        await sseWriter.write({
          data: {
            args: {has_vibe: !!args.vibe_profile},
            tool: 'plan_discovery_strategy',
          },
          type: 'tool_start',
        })

        await sseWriter.write({
          data: `Planning discovery strategy using AI...`,
          type: 'thinking',
        })

        const anthropic = new Anthropic({
          apiKey: env!.ANTHROPIC_API_KEY,
        })

        const strategyPrompt = buildStrategyPrompt(args)

        try {
          const response = await anthropic.messages.create({
            max_tokens: 3000,
            messages: [{content: strategyPrompt, role: 'user'}],
            model: LLM.MODEL,
            system: 'You are a music discovery strategist. Return only valid JSON.',
            temperature: 0.7,
          })

          // Extract text from content blocks
          const content = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map(block => block.text)
            .join('')
          const jsonMatch = /\{[\s\S]*\}/.exec(content)
          if (!jsonMatch) {
            throw new Error('No JSON found in strategy response')
          }

          let rawStrategy: unknown
          try {
            rawStrategy = JSON.parse(jsonMatch[0])
          } catch (parseError) {
            getLogger()?.error('[plan_discovery_strategy] Failed to parse strategy JSON', {
              error: parseError instanceof Error ? parseError.message : String(parseError),
              jsonPreview: jsonMatch[0].substring(0, 200),
            })
            throw new Error('Failed to parse discovery strategy response as JSON')
          }

          const strategyResult = DiscoveryStrategySchema.safeParse(rawStrategy)
          const strategy = strategyResult.success ? strategyResult.data : rawStrategy

          await sseWriter.write({
            data: `Strategy: ${strategyResult.success ? strategyResult.data.reasoning?.substring(0, 80) : 'planned'}...`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: `Created ${strategyResult.success ? (strategyResult.data.tag_searches?.length ?? 0) : 0} tag searches, ${
                strategyResult.success ? (strategyResult.data.spotify_queries?.length ?? 0) : 0
              } custom queries`,
              tool: 'plan_discovery_strategy',
            },
            type: 'tool_end',
          })

          return strategy
        } catch (error) {
          getLogger()?.error('[plan_discovery_strategy] AI planning failed:', error)

          // Fallback: Basic strategy
          const fallbackStrategy = {
            avoid: [],
            lastfm_similar_priority: isStringArray(args.similar_tracks_available)
              ? args.similar_tracks_available.slice(0, 5)
              : [],
            recommendation_seeds: {
              approach: 'Use top tracks as seeds',
              parameters: {
                target_danceability: 0.5,
                target_energy: 0.5,
                target_valence: 0.5,
              },
            },
            spotify_searches: [],
            strategy_summary: 'Using basic tag-based discovery',
            tag_searches: [],
          }

          await sseWriter.write({
            data: `Using basic strategy (AI unavailable)`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: 'Basic fallback strategy',
              tool: 'plan_discovery_strategy',
            },
            type: 'tool_end',
          })

          return fallbackStrategy
        }
      },
      name: 'plan_discovery_strategy',
      schema: z.object({
        similar_tracks_available: z
          .array(z.string())
          .max(20)
          .optional()
          .describe('Last.fm similar tracks if available'),
        user_request: z.string().describe("User's original request to understand intent"),
        vibe_profile: z.record(z.string(), z.unknown()).describe('Output from extract_playlist_vibe'),
      }),
    },

    {
      description:
        'Use AI to intelligently rank and filter track recommendations based on user criteria and playlist characteristics. Provide tracks and context, get back curated top picks with reasoning.',
      func: async args => {
        if (abortSignal?.aborted) throw new Error('Request aborted')

        if (!Array.isArray(args.candidate_tracks)) {
          throw new Error('candidate_tracks must be an array')
        }

        await sseWriter.write({
          data: {
            args: {
              top_n: args.top_n,
              track_count: args.candidate_tracks.length,
            },
            tool: 'curate_recommendations',
          },
          type: 'tool_start',
        })

        await sseWriter.write({
          data: `Using AI to curate ${args.top_n} best picks from ${args.candidate_tracks.length} candidates...`,
          type: 'thinking',
        })

        // Use Claude Sonnet 4.5 for high-quality intelligent curation
        const anthropic = new Anthropic({
          apiKey: env!.ANTHROPIC_API_KEY,
        })

        const curationPrompt = buildCurationPrompt(args)

        try {
          const response = await anthropic.messages.create({
            max_tokens: 2000,
            messages: [{content: curationPrompt, role: 'user'}],
            model: LLM.MODEL,
            system: 'You are a music curator. Return only valid JSON.',
            temperature: 0.7,
          })

          // Extract text from content blocks
          const content = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map(block => block.text)
            .join('')

          getLogger()?.info(`[curate_recommendations] Claude response:`, {preview: content.substring(0, 200)})
          const jsonMatch = /\{[\s\S]*\}/.exec(content)
          if (!jsonMatch) {
            throw new Error('No JSON found in response')
          }

          let rawCuration: unknown
          try {
            rawCuration = JSON.parse(jsonMatch[0])
          } catch (parseError) {
            getLogger()?.error('[curate_recommendations] Failed to parse curation JSON', {
              error: parseError instanceof Error ? parseError.message : String(parseError),
              jsonPreview: jsonMatch[0].substring(0, 200),
            })
            throw new Error('Failed to parse curation response as JSON')
          }
          const curationResult = CurationResponseSchema.safeParse(rawCuration)
          const selectedIds = curationResult.success ? (curationResult.data.selected_track_ids ?? []) : []
          const reasoning = curationResult.success ? (curationResult.data.reasoning ?? 'AI curation complete') : 'AI curation complete'

          // Filter candidate tracks to only selected ones
          const curatedTracks = args.candidate_tracks.filter((t: {id: string}) => selectedIds.includes(t.id))

          // Preserve order from AI selection
          const orderedTracks = selectedIds
            .map((id: string) => curatedTracks.find((t: {id: string}) => t.id === id))
            .filter((t): t is {id: string} => !!t)

          await sseWriter.write({
            data: `Curated ${orderedTracks.length} top picks: ${reasoning}`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: `Curated ${orderedTracks.length} tracks using AI`,
              tool: 'curate_recommendations',
            },
            type: 'tool_end',
          })

          return {
            curated_tracks: orderedTracks,
            original_count: args.candidate_tracks.length,
            reasoning: reasoning,
            total_curated: orderedTracks.length,
          }
        } catch (error) {
          getLogger()?.error('[curate_recommendations] AI curation failed:', error)

          // Fallback: Sort by popularity and return top N
          const topN = isNumber(args.top_n) ? args.top_n : 10
          const fallbackTracks = args.candidate_tracks
            .sort((a: {popularity?: number}, b: {popularity?: number}) => (b.popularity ?? 0) - (a.popularity ?? 0))
            .slice(0, topN)

          await sseWriter.write({
            data: `AI curation unavailable, using popularity-based ranking`,
            type: 'thinking',
          })

          await sseWriter.write({
            data: {
              result: `Fallback: Sorted ${fallbackTracks.length} tracks by popularity`,
              tool: 'curate_recommendations',
            },
            type: 'tool_end',
          })

          return {
            curated_tracks: fallbackTracks,
            original_count: args.candidate_tracks.length,
            reasoning: 'Ranked by popularity (AI curation unavailable)',
            total_curated: fallbackTracks.length,
          }
        }
      },
      name: 'curate_recommendations',
      schema: z.object({
        candidate_tracks: z
          .array(
            z.object({
              artists: z.string(),
              id: z.string(),
              name: z.string(),
              popularity: z.number().optional(),
              source: z.string().optional(),
            }),
          )
          .min(1)
          .max(100)
          .describe('Tracks to curate (from various sources like tag search, similar tracks, Spotify recommendations)'),
        playlist_context: z
          .object({
            avg_popularity: z.number().optional(),
            bpm_range: z.object({max: z.number(), min: z.number()}).optional(),
            dominant_tags: z.array(z.string()).optional(),
            era: z.string().optional(),
          })
          .describe('Context from analyze_playlist to guide curation'),
        top_n: z.number().min(1).max(50).default(10).describe('How many curated recommendations to return'),
        user_request: z.string().describe("User's original request to understand intent"),
      }),
    },
  ]
}

// Helper function to build vibe extraction prompt
function buildVibeExtractionPrompt(args: Record<string, unknown>): string {
  return `<task>
You are a music critic with expertise in identifying subtle sonic and emotional characteristics. Your task is to analyze the provided playlist data and extract a deep vibe profile that captures signals beyond simple genre labels.

WHY THIS MATTERS: Generic algorithmic recommendations fail because they rely on superficial tags. Your analysis will guide intelligent discovery that matches the playlist's true essence.
</task>

<input_data>
METADATA ANALYSIS:
${isObject(args.analysis_data) ? JSON.stringify(args.analysis_data.metadata_analysis ?? {}, null, 2) : '{}'}

DEEZER ANALYSIS (BPM, rank, gain):
${isObject(args.analysis_data) ? JSON.stringify(args.analysis_data.deezer_analysis ?? {}, null, 2) : '{}'}

LAST.FM ANALYSIS (crowd tags, similar tracks):
${isObject(args.analysis_data) ? JSON.stringify(args.analysis_data.lastfm_analysis ?? {}, null, 2) : '{}'}

${
  Array.isArray(args.sample_tracks) && args.sample_tracks.length
    ? `SAMPLE TRACKS (representative examples):\n${args.sample_tracks
        .map((t: {artists: string; name: string}) => `- "${t.name}" by ${t.artists}`)
        .join('\n')}`
    : ''
}
</input_data>

<analysis_instructions>
STEP 1: Synthesize the data above to identify patterns across these dimensions:

<emotional_arc>
How does the emotional energy flow? Does it build progressively, cycle between states, or maintain consistency? Consider valence (positive/negative) and arousal (calm/energetic).
</emotional_arc>

<production_aesthetic>
What's the sonic signature? Lo-fi warmth vs polished clarity? Analog character vs digital precision? Spacious reverb vs dry intimacy? Dense layering vs minimal arrangements?
</production_aesthetic>

<vocal_characteristics>
What's the vocal approach? Breathy and intimate vs powerful and projected? Vocals as centerpiece vs instrumental focus? Lyrical language and delivery style?
</vocal_characteristics>

<instrumentation>
What instruments define the sound? What's prominent, what's absent? Acoustic vs electronic? Live vs programmed? Signature sounds or production techniques?
</instrumentation>

<temporal_context>
What era does this evoke? Vintage production nostalgia? Modern/contemporary? Retro-futuristic? How do production values signal time period?
</temporal_context>

<mixing_philosophy>
Bright and crisp vs warm and rounded? Heavily compressed "loudness war" vs dynamic range? Upfront vocals vs balanced mix? Intentional distortion/saturation?
</mixing_philosophy>

<mood_trajectory>
Introspective and contemplative vs energetic and outward? Dark/moody vs bright/uplifting? Consistent mood or emotional journey?
</mood_trajectory>

<structural_patterns>
Traditional verse-chorus-bridge vs experimental forms? Track length patterns? Build-ups and drops vs steady-state? Intro/outro approaches?
</structural_patterns>

<cultural_resonance>
What musical scene, movement, or cultural moment does this connect to? Underground vs mainstream aesthetic? Geographic associations? Subcultural identity?
</cultural_resonance>

STEP 2: Based on your analysis, formulate discovery hints that will guide strategic search:
- Which genre combinations capture the vibe (not just primary genres)
- What to AVOID (genres/styles that would break the vibe despite seeming related)
- Time periods to explore based on production and aesthetic
- Artist archetypes that embody the characteristics you identified
- Spotify audio feature targets (energy, valence, danceability, acousticness)

STEP 3: Synthesize everything into a cohesive vibe profile that captures the playlist's essence in natural language.
</analysis_instructions>

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
</output_format>

<constraints>
- Base analysis ONLY on provided data - never hallucinate track details you haven't seen
- If sample tracks are absent, rely more heavily on metadata and enrichment data
- Be specific and descriptive, avoid generic music criticism cliches
- Discovery hints should be actionable for search query construction
</constraints>`
}

// Helper function to build strategy prompt
function buildStrategyPrompt(args: Record<string, unknown>): string {
  return `<task>
You are a music discovery strategist creating an intelligent, multi-pronged search plan. Your goal is to find tracks that match the user's request while honoring the playlist's vibe profile.

WHY THIS MATTERS: Single-strategy searches (like "just use algorithm recommendations") produce generic results. A strategic combination of Last.fm similar tracks, creative Spotify queries, tag-based discovery, and tuned recommendations captures the vibe's nuance.
</task>

<user_intent>
USER REQUEST: "${args.user_request}"

What is the user actually asking for? Are they seeking:
- More tracks like the playlist (expansion)
- Tracks for a specific mood/activity (contextual)
- Discovery of new artists with similar vibe (exploration)
- Specific characteristics (tempo, energy, era)
</user_intent>

<vibe_context>
VIBE PROFILE (extracted from playlist analysis):
${JSON.stringify(args.vibe_profile, null, 2)}

This vibe profile contains:
- Overall essence and sonic identity
- Emotional characteristics and mood
- Production aesthetic and era feel
- Discovery hints (genre blends, artist archetypes, what to avoid)
- Spotify audio feature targets

Use this to inform your strategy - the discovery hints are especially valuable.
</vibe_context>

${
  isStringArray(args.similar_tracks_available) && args.similar_tracks_available.length > 0
    ? `<lastfm_similar_tracks>
AVAILABLE LAST.FM SIMILAR TRACKS:
${args.similar_tracks_available.slice(0, 10).join('\n')}
${args.similar_tracks_available.length > 10 ? `\n... and ${args.similar_tracks_available.length - 10} more available` : ''}

These are community-identified similar tracks. Evaluate which ones best match the vibe profile and user intent. Don't just pick the first N - select strategically.
</lastfm_similar_tracks>`
    : '<lastfm_similar_tracks>\nNo Last.fm similar tracks available for this playlist.\n</lastfm_similar_tracks>'
}

<strategy_instructions>
Create a comprehensive discovery plan with these components:

COMPONENT 1 - Last.fm Similar Track Selection:
- Review available similar tracks against vibe profile
- Select 5-8 that best capture the essence (not just the most popular)
- Consider: Do they match production style? Era feel? Emotional characteristics?
- Skip tracks that seem algorithmically related but vibe-mismatched

COMPONENT 2 - Tag-Based Search Combinations:
- Combine 2-3 tags creatively to capture vibe nuance
- Use vibe_profile.discovery_hints.genre_combinations as starting point
- Think beyond single genres - combinations reveal micro-niches
- Include 2-3 tag combos with rationale for each

COMPONENT 3 - Creative Spotify Searches:
- Construct 2-3 search queries that capture vibe WITHOUT just using genre labels
- Examples: "dreamy bedroom pop 2010s", "80s synthwave workout", "minimal techno berlin"
- Use era, production style, mood descriptors, and cultural context
- Each query should target a different angle on the vibe

COMPONENT 4 - Recommendation Algorithm Parameters:
- Use vibe_profile.discovery_hints.spotify_params as baseline
- Adjust based on user request specifics
- Set target_energy, target_valence, target_danceability, target_acousticness
- Describe the seed selection approach (how to pick tracks to seed from)

COMPONENT 5 - Avoidance List:
- What genres/styles/eras would BREAK the vibe?
- Use vibe_profile.discovery_hints.avoid_these as starting point
- Think about adjacent genres that seem related but would clash
- Be specific - "avoid mainstream pop" is too vague

FINAL STEP: Synthesize into strategy summary explaining the overall approach.
</strategy_instructions>

<output_format>
Return ONLY valid JSON with this exact structure:
{
  "strategy_summary": "2-3 sentence description of the overall discovery approach and why it will succeed",
  "lastfm_similar_priority": ["Artist - Track", "Artist - Track", ...],
  "tag_searches": [
    {
      "tags": ["tag1", "tag2", "tag3"],
      "rationale": "Specific reason why this combination captures a facet of the vibe"
    }
  ],
  "spotify_searches": [
    {
      "query": "creative search query string",
      "rationale": "What angle on the vibe this query targets"
    }
  ],
  "recommendation_seeds": {
    "approach": "How to select seed tracks from the playlist (e.g., 'pick highest energy tracks', 'use most popular tracks')",
    "parameters": {
      "target_energy": 0.0-1.0,
      "target_valence": 0.0-1.0,
      "target_danceability": 0.0-1.0,
      "target_acousticness": 0.0-1.0
    }
  },
  "avoid": ["specific thing to avoid 1", "specific thing to avoid 2", "specific thing to avoid 3"]
}

CRITICAL: Return valid JSON only. No markdown code blocks, no explanatory text outside the JSON.
</output_format>

<constraints>
- Base strategy on vibe profile and user request - don't introduce unrelated preferences
- Be specific in rationales - explain the "why" not just "what"
- Ensure diversity across search strategies (don't just repeat the same approach 4 times)
- If Last.fm tracks unavailable, compensate with more creative Spotify/tag searches
- Think strategically about how each component contributes to comprehensive discovery
</constraints>`
}

// Helper function to build curation prompt
function buildCurationPrompt(args: Record<string, unknown>): string {
  const candidateTracks = args.candidate_tracks as Array<{
    artists?: string
    id: string
    name: string
    popularity?: number
    source?: string
  }>

  return `<task>
You are an expert music curator selecting the best track recommendations from a pool of candidates. Your goal is to pick tracks that best match the user's request while honoring the playlist's established vibe and characteristics.

WHY THIS MATTERS: The discovery strategy has gathered candidates from multiple sources. Your curation ensures quality over quantity - selecting tracks with the right vibe alignment, diversity, and user intent match.
</task>

<user_intent>
USER REQUEST: "${args.user_request}"

Interpret what the user truly wants:
- Are they seeking expansion (more of the same vibe)?
- Contextual recommendations (workout, study, party)?
- Discovery (new artists with similar aesthetic)?
- Specific characteristics (more upbeat, mellower, specific era)?

This interpretation should guide your selection priorities.
</user_intent>

<playlist_context>
PLAYLIST CHARACTERISTICS (baseline for vibe matching):
${
  isObject(args.playlist_context) && isObject(args.playlist_context.bpm_range)
    ? `BPM Range: ${args.playlist_context.bpm_range.min}-${args.playlist_context.bpm_range.max} (tempo profile)`
    : ''
}
${isObject(args.playlist_context) && Array.isArray(args.playlist_context.dominant_tags) && args.playlist_context.dominant_tags.length ? `Dominant Tags: ${args.playlist_context.dominant_tags.join(', ')} (genre/mood signals)` : ''}
${isObject(args.playlist_context) && isNumber(args.playlist_context.avg_popularity) ? `Average Popularity: ${args.playlist_context.avg_popularity}/100 (mainstream vs underground)` : ''}
${isObject(args.playlist_context) && isString(args.playlist_context.era) ? `Era: ${args.playlist_context.era} (temporal context)` : ''}

Use these characteristics as baseline expectations. Candidates should generally align with these patterns unless user intent explicitly requests deviation.
</playlist_context>

<candidate_pool>
CANDIDATE TRACKS (${candidateTracks.length} total from multiple discovery strategies):
${candidateTracks
  .slice(0, 50)
  .map(
    (t, i) =>
      `${i + 1}. "${t.name}" by ${t.artists} (popularity: ${
        t.popularity ?? 'unknown'
      }, source: ${t.source ?? 'unknown'})`,
  )
  .join('\n')}
${candidateTracks.length > 50 ? `\n... and ${candidateTracks.length - 50} more candidates available` : ''}

Each track comes from a specific discovery source (Last.fm similar, Spotify search, tag-based, algorithm). Consider source diversity in your selection - don't pick all tracks from one source.
</candidate_pool>

<curation_instructions>
STEP 1: Evaluate each candidate against these criteria:

<vibe_alignment>
Does the track match the playlist's BPM range, dominant tags, and era? Look for tracks that feel like they "belong" in the playlist based on sonic characteristics.
</vibe_alignment>

<user_intent_match>
Does this track specifically address what the user requested? If they wanted "upbeat workout tracks", does it deliver on energy and context?
</user_intent_match>

<popularity_balance>
Does the track match the playlist's popularity profile? If playlist averages 45/100, avoid both mega-hits (90+) and ultra-obscure tracks (10-) unless user requested discovery.
</popularity_balance>

<diversity>
Are you selecting from multiple discovery sources? Are you avoiding artist repetition? Is there variety in specific sound within the vibe constraints?
</diversity>

<quality_signals>
Popularity isn't everything, but extremely low popularity might indicate poor quality. Balance "hidden gem" with "unheard for a reason."
</quality_signals>

STEP 2: Select top ${args.top_n} tracks that best meet the combined criteria.

STEP 3: Formulate reasoning that explains:
- What selection criteria you prioritized (and why based on user request)
- How you balanced vibe alignment with diversity
- Any specific considerations that guided your choices

Your reasoning should be specific and insightful, not generic.
</curation_instructions>

<output_format>
Return ONLY valid JSON with this exact structure:
{
  "selected_track_ids": ["id1", "id2", "id3", ...],
  "reasoning": "2-3 sentence explanation of your selection criteria and approach, referencing specific considerations from user request and playlist context"
}

CRITICAL:
- Return exactly ${args.top_n} track IDs (no more, no less)
- Ensure all IDs exist in the candidate list
- Return valid JSON only - no markdown code blocks, no extra text
</output_format>

<constraints>
- Select ONLY from provided candidate tracks - do not invent track IDs
- Return exactly ${args.top_n} tracks as requested
- Base selection on stated criteria - don't introduce personal music preferences
- Be specific in reasoning - explain the "why" behind your approach
- If candidate pool is smaller than ${args.top_n}, return all candidates and note limitation in reasoning
</constraints>`
}
