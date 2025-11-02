/**
 * Zod schemas for external API responses
 * Covers Deezer, Last.fm, and MusicBrainz APIs
 */

import {z} from 'zod'

// ===== Deezer API =====

export const DeezerArtistSchema = z.object({
  id: z.number(),
  name: z.string(),
  picture: z.string().url().optional(),
  picture_medium: z.string().url().optional(),
  picture_small: z.string().url().optional(),
  type: z.literal('artist').optional(),
})

export const DeezerAlbumSchema = z.object({
  cover: z.string().url().optional(),
  cover_medium: z.string().url().optional(),
  cover_small: z.string().url().optional(),
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
  preview: z.string().url().optional(),
  rank: z.number().nullable(),
  release_date: z.string().optional(),
  title: z.string(),
  type: z.literal('track').optional(),
})

export const DeezerSearchResponseSchema = z.object({
  data: z.array(DeezerTrackSchema),
  next: z.string().url().optional(),
  total: z.number(),
})

// ===== Last.fm API =====

export const LastFmImageSchema = z.object({
  '#text': z.string().url(),
  size: z.enum(['small', 'medium', 'large', 'extralarge', 'mega', '']),
})

export const LastFmTagSchema = z.object({
  name: z.string(),
  url: z.string().url(),
})

export const LastFmTagWithCountSchema = LastFmTagSchema.extend({
  count: z.number(),
})

export const LastFmArtistSchema = z.object({
  mbid: z.string().optional(),
  name: z.string(),
  url: z.string().url(),
})

export const LastFmAlbumSchema = z.object({
  artist: z.string(),
  image: z.array(LastFmImageSchema).optional(),
  mbid: z.string().optional(),
  title: z.string(),
  url: z.string().url(),
})

export const LastFmWikiSchema = z.object({
  content: z.string().optional(),
  published: z.string().optional(),
  summary: z.string().optional(),
})

export const LastFmSimilarTrackSchema = z.object({
  artist: LastFmArtistSchema,
  duration: z.number().optional(),
  image: z.array(LastFmImageSchema).optional(),
  match: z.number().min(0).max(1),
  mbid: z.string().optional(),
  name: z.string(),
  playcount: z.number().optional(),
  url: z.string().url(),
})

export const LastFmTrackInfoSchema = z.object({
  album: LastFmAlbumSchema.optional(),
  artist: LastFmArtistSchema,
  duration: z.number().optional(),
  listeners: z.number().optional(),
  mbid: z.string().optional(),
  name: z.string(),
  playcount: z.number().optional(),
  toptags: z
    .object({
      tag: z.array(LastFmTagSchema),
    })
    .optional(),
  url: z.string().url(),
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
  url: z.string().url(),
})

export const LastFmTrackCorrectionResponseSchema = z.object({
  corrections: z.object({
    correction: z.object({
      track: LastFmTrackCorrectionSchema,
    }),
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
      listeners: z.number().optional(),
      playcount: z.number().optional(),
    })
    .optional(),
  tags: z
    .object({
      tag: z.array(LastFmTagSchema),
    })
    .optional(),
  url: z.string().url(),
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
  // Deezer data
  bpm: z.number().min(0).max(300).nullable(),
  gain: z.number().nullable(),
  rank: z.number().nullable(),
  release_date: z.string().nullable(),
  source: z.enum(['deezer', 'deezer-via-musicbrainz', 'none']),

  // Last.fm data
  album: LastFmAlbumSchema.nullable().optional(),
  artistInfo: LastFmArtistInfoSchema.nullable().optional(),
  listeners: z.number().nullable().optional(),
  playcount: z.number().nullable().optional(),
  similar: z.array(LastFmSimilarTrackSchema).optional(),
  topTags: z.array(LastFmTagSchema).optional(),
  wiki: LastFmWikiSchema.nullable().optional(),
})

// ===== Type Exports =====

export type DeezerTrack = z.infer<typeof DeezerTrackSchema>
export type DeezerSearchResponse = z.infer<typeof DeezerSearchResponseSchema>

export type LastFmTrackInfo = z.infer<typeof LastFmTrackInfoSchema>
export type LastFmArtistInfo = z.infer<typeof LastFmArtistInfoSchema>
export type LastFmSimilarTrack = z.infer<typeof LastFmSimilarTrackSchema>
export type LastFmTag = z.infer<typeof LastFmTagSchema>

export type MusicBrainzRecording = z.infer<typeof MusicBrainzRecordingSchema>
export type MusicBrainzSearchResponse = z.infer<typeof MusicBrainzSearchResponseSchema>

export type EnrichedTrackData = z.infer<typeof EnrichedTrackDataSchema>
