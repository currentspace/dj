/**
 * Zod schemas for external API responses
 * Covers Deezer, Last.fm, and MusicBrainz APIs
 */

import {z} from 'zod'

// ===== Deezer API =====

/**
 * Helper for optional URLs that might be empty strings
 * Deezer API sometimes returns empty strings for missing URLs
 */
const optionalUrlOrEmpty = z.preprocess((val) => {
  if (typeof val === 'string' && val.trim() === '') {
    return undefined
  }
  return val
}, z.string().url().optional())

export const DeezerArtistSchema = z.object({
  id: z.number(),
  name: z.string(),
  picture: optionalUrlOrEmpty,
  picture_medium: optionalUrlOrEmpty,
  picture_small: optionalUrlOrEmpty,
  type: z.literal('artist').optional(),
})

export const DeezerAlbumSchema = z.object({
  cover: optionalUrlOrEmpty,
  cover_medium: optionalUrlOrEmpty,
  cover_small: optionalUrlOrEmpty,
  id: z.number(),
  title: z.string(),
  type: z.literal('album').optional(),
})

export const DeezerTrackSchema = z.object({
  album: DeezerAlbumSchema.optional(),
  artist: DeezerArtistSchema.optional(),
  bpm: z.number().min(0).max(300).nullable(),
  duration: z.number(),
  gain: z.number().nullable(),
  id: z.number(),
  isrc: z.string().optional(),
  preview: optionalUrlOrEmpty,
  rank: z.number().nullable(),
  release_date: z.string().optional(),
  title: z.string(),
  type: z.literal('track').optional(),
})

export const DeezerSearchResponseSchema = z.object({
  data: z.array(DeezerTrackSchema),
  next: optionalUrlOrEmpty,
  total: z.number(),
})

// ===== Last.fm API =====

/**
 * Helper to coerce string numbers to actual numbers
 * Last.fm API sometimes returns numbers as strings
 */
const numberCoercion = z.preprocess((val) => {
  if (typeof val === 'string' && val.trim() !== '') {
    const num = Number(val)
    return isNaN(num) ? val : num
  }
  return val
}, z.number())

/**
 * Helper to handle URLs that might be empty strings
 * Last.fm API returns empty strings instead of null/undefined
 */
const urlOrEmpty = z.preprocess((val) => {
  if (typeof val === 'string' && val.trim() === '') {
    return null
  }
  return val
}, z.string().url().nullable())

export const LastFmImageSchema = z.object({
  '#text': urlOrEmpty,
  size: z.enum(['small', 'medium', 'large', 'extralarge', 'mega', '']),
})

export const LastFmTagSchema = z.object({
  name: z.string(),
  url: urlOrEmpty,
})

export const LastFmTagWithCountSchema = LastFmTagSchema.extend({
  count: numberCoercion,
})

export const LastFmArtistSchema = z.object({
  mbid: z.string().optional(),
  name: z.string(),
  url: urlOrEmpty,
})

export const LastFmAlbumSchema = z.object({
  artist: z.string(),
  image: z.array(LastFmImageSchema).optional(),
  mbid: z.string().optional(),
  title: z.string(),
  url: urlOrEmpty,
})

export const LastFmWikiSchema = z.object({
  content: z.string().optional(),
  published: z.string().optional(),
  summary: z.string().optional(),
})

export const LastFmSimilarTrackSchema = z.object({
  artist: LastFmArtistSchema,
  duration: numberCoercion.optional(),
  image: z.array(LastFmImageSchema).optional(),
  match: numberCoercion.pipe(z.number().min(0).max(1)),
  mbid: z.string().optional(),
  name: z.string(),
  playcount: numberCoercion.optional(),
  url: urlOrEmpty,
})

export const LastFmTrackInfoSchema = z.object({
  album: LastFmAlbumSchema.optional(),
  artist: LastFmArtistSchema,
  duration: numberCoercion.optional(),
  listeners: numberCoercion.optional(),
  mbid: z.string().optional(),
  name: z.string(),
  playcount: numberCoercion.optional(),
  toptags: z
    .object({
      tag: z.array(LastFmTagSchema),
    })
    .optional(),
  url: urlOrEmpty,
  wiki: LastFmWikiSchema.optional(),
})

export const LastFmTrackCorrectionSchema = z.object({
  '@attr': z
    .object({
      index: z.string(),
    })
    .optional(),
  artist: LastFmArtistSchema,
  mbid: z.string().optional(),
  name: z.string(),
  url: urlOrEmpty,
})

export const LastFmTrackCorrectionResponseSchema = z.object({
  corrections: z.object({
    correction: z
      .object({
        track: LastFmTrackCorrectionSchema,
      })
      .nullable(),
  }),
})

export const LastFmTrackInfoResponseSchema = z.object({
  track: LastFmTrackInfoSchema,
})

export const LastFmTrackSimilarResponseSchema = z.object({
  similartracks: z.object({
    '@attr': z
      .object({
        artist: z.string(),
      })
      .optional(),
    track: z.array(LastFmSimilarTrackSchema),
  }),
})

export const LastFmArtistInfoSchema = z.object({
  bio: LastFmWikiSchema.optional(),
  image: z.array(LastFmImageSchema).optional(),
  mbid: z.string().optional(),
  name: z.string(),
  similar: z
    .object({
      artist: z.array(LastFmArtistSchema),
    })
    .optional(),
  stats: z
    .object({
      listeners: numberCoercion.optional(),
      playcount: numberCoercion.optional(),
    })
    .optional(),
  tags: z
    .object({
      tag: z.array(LastFmTagSchema),
    })
    .optional(),
  url: urlOrEmpty,
})

export const LastFmArtistInfoResponseSchema = z.object({
  artist: LastFmArtistInfoSchema,
})

export const LastFmTrackTopTagsResponseSchema = z.object({
  toptags: z.object({
    '@attr': z
      .object({
        artist: z.string(),
        track: z.string(),
      })
      .optional(),
    tag: z.array(LastFmTagSchema),
  }),
})

// ===== MusicBrainz API =====

export const MusicBrainzISRCSchema = z.object({
  id: z.string(),
  'recording-count': z.number().optional(),
})

export const MusicBrainzArtistCreditSchema = z.object({
  artist: z.object({
    id: z.string(),
    name: z.string(),
    'sort-name': z.string().optional(),
  }),
  joinphrase: z.string().optional(),
  name: z.string(),
})

export const MusicBrainzRecordingSchema = z.object({
  'artist-credit': z.array(MusicBrainzArtistCreditSchema).optional(),
  disambiguation: z.string().optional(),
  id: z.string(),
  isrcs: z.array(z.string()).optional(),
  length: z.number().optional(),
  score: z.number().optional(),
  title: z.string(),
})

export const MusicBrainzSearchResponseSchema = z.object({
  count: z.number(),
  created: z.string().optional(),
  offset: z.number(),
  recordings: z.array(MusicBrainzRecordingSchema),
})

// ===== Enrichment Response Types =====

/**
 * Enriched track data combining Deezer and Last.fm
 */
export const EnrichedTrackDataSchema = z.object({
  // Last.fm data
  album: LastFmAlbumSchema.nullable().optional(),
  artistInfo: LastFmArtistInfoSchema.nullable().optional(),
  // Deezer data
  bpm: z.number().min(0).max(300).nullable(),
  gain: z.number().nullable(),
  listeners: z.number().nullable().optional(),

  playcount: z.number().nullable().optional(),
  rank: z.number().nullable(),
  release_date: z.string().nullable(),
  similar: z.array(LastFmSimilarTrackSchema).optional(),
  source: z.enum(['deezer', 'deezer-via-musicbrainz', 'none']),
  topTags: z.array(LastFmTagSchema).optional(),
  wiki: LastFmWikiSchema.nullable().optional(),
})

// ===== Type Exports =====

export type DeezerSearchResponse = z.infer<typeof DeezerSearchResponseSchema>
export type DeezerTrack = z.infer<typeof DeezerTrackSchema>

export type EnrichedTrackData = z.infer<typeof EnrichedTrackDataSchema>
export type LastFmArtistInfo = z.infer<typeof LastFmArtistInfoSchema>
export type LastFmSimilarTrack = z.infer<typeof LastFmSimilarTrackSchema>
export type LastFmTag = z.infer<typeof LastFmTagSchema>

export type LastFmTrackInfo = z.infer<typeof LastFmTrackInfoSchema>
export type MusicBrainzRecording = z.infer<typeof MusicBrainzRecordingSchema>

export type MusicBrainzSearchResponse = z.infer<typeof MusicBrainzSearchResponseSchema>
