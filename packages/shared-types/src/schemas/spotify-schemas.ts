/**
 * Zod schemas for Spotify API responses
 * Provides runtime validation and type inference for all Spotify data
 */

import {z} from 'zod'

// ===== Base Types =====

export const SpotifyImageSchema = z.object({
  height: z.number().nullable(),
  url: z.string().url(),
  width: z.number().nullable(),
})

export const SpotifyExternalUrlsSchema = z.object({
  spotify: z.string().url(),
})

export const SpotifyExternalIdsSchema = z.object({
  isrc: z.string().optional(),
  ean: z.string().optional(),
  upc: z.string().optional(),
})

// ===== Artist =====

export const SpotifyArtistSimpleSchema = z.object({
  external_urls: SpotifyExternalUrlsSchema,
  href: z.string().url(),
  id: z.string(),
  name: z.string(),
  type: z.literal('artist'),
  uri: z.string(),
})

export const SpotifyArtistFullSchema = SpotifyArtistSimpleSchema.extend({
  followers: z
    .object({
      href: z.string().url().nullable(),
      total: z.number(),
    })
    .optional(),
  genres: z.array(z.string()),
  images: z.array(SpotifyImageSchema),
  popularity: z.number().min(0).max(100),
})

// ===== Album =====

export const SpotifyAlbumSimpleSchema = z.object({
  album_type: z.enum(['album', 'single', 'compilation']),
  artists: z.array(SpotifyArtistSimpleSchema),
  external_urls: SpotifyExternalUrlsSchema,
  href: z.string().url(),
  id: z.string(),
  images: z.array(SpotifyImageSchema),
  name: z.string(),
  release_date: z.string(),
  release_date_precision: z.enum(['year', 'month', 'day']),
  total_tracks: z.number(),
  type: z.literal('album'),
  uri: z.string(),
})

export const SpotifyAlbumFullSchema = SpotifyAlbumSimpleSchema.extend({
  copyrights: z
    .array(
      z.object({
        text: z.string(),
        type: z.string(),
      }),
    )
    .optional(),
  external_ids: SpotifyExternalIdsSchema.optional(),
  genres: z.array(z.string()),
  label: z.string().optional(),
  popularity: z.number().min(0).max(100),
  tracks: z.object({
    href: z.string().url(),
    items: z.array(z.any()), // Will be SpotifyTrackSimpleSchema
    limit: z.number(),
    next: z.string().url().nullable(),
    offset: z.number(),
    previous: z.string().url().nullable(),
    total: z.number(),
  }),
})

// ===== Track =====

export const SpotifyTrackSimpleSchema = z.object({
  artists: z.array(SpotifyArtistSimpleSchema),
  disc_number: z.number(),
  duration_ms: z.number(),
  explicit: z.boolean(),
  external_urls: SpotifyExternalUrlsSchema,
  href: z.string().url(),
  id: z.string(),
  is_local: z.boolean(),
  name: z.string(),
  preview_url: z.string().url().nullable(),
  track_number: z.number(),
  type: z.literal('track'),
  uri: z.string(),
})

export const SpotifyTrackFullSchema = SpotifyTrackSimpleSchema.extend({
  album: SpotifyAlbumSimpleSchema,
  external_ids: SpotifyExternalIdsSchema,
  popularity: z.number().min(0).max(100),
})

// ===== Audio Features =====

export const SpotifyAudioFeaturesSchema = z.object({
  acousticness: z.number().min(0).max(1),
  analysis_url: z.string().url(),
  danceability: z.number().min(0).max(1),
  duration_ms: z.number(),
  energy: z.number().min(0).max(1),
  id: z.string(),
  instrumentalness: z.number().min(0).max(1),
  key: z.number().min(-1).max(11),
  liveness: z.number().min(0).max(1),
  loudness: z.number(),
  mode: z.number().min(0).max(1),
  speechiness: z.number().min(0).max(1),
  tempo: z.number().min(0),
  time_signature: z.number().min(0),
  track_href: z.string().url(),
  type: z.literal('audio_features'),
  uri: z.string(),
  valence: z.number().min(0).max(1),
})

export const SpotifyAudioFeaturesBatchSchema = z.object({
  audio_features: z.array(SpotifyAudioFeaturesSchema.nullable()),
})

// ===== Playlist =====

export const SpotifyPlaylistOwnerSchema = z.object({
  display_name: z.string().nullable(),
  external_urls: SpotifyExternalUrlsSchema,
  href: z.string().url(),
  id: z.string(),
  type: z.literal('user'),
  uri: z.string(),
})

export const SpotifyPlaylistSimpleSchema = z.object({
  collaborative: z.boolean(),
  description: z.string().nullable(),
  external_urls: SpotifyExternalUrlsSchema,
  href: z.string().url(),
  id: z.string(),
  images: z.array(SpotifyImageSchema),
  name: z.string(),
  owner: SpotifyPlaylistOwnerSchema,
  public: z.boolean().nullable(),
  snapshot_id: z.string(),
  tracks: z.object({
    href: z.string().url(),
    total: z.number(),
  }),
  type: z.literal('playlist'),
  uri: z.string(),
})

export const SpotifyPlaylistTrackSchema = z.object({
  added_at: z.string().nullable(),
  added_by: SpotifyPlaylistOwnerSchema.nullable(),
  is_local: z.boolean(),
  primary_color: z.string().nullable(),
  track: SpotifyTrackFullSchema.nullable(),
  video_thumbnail: z
    .object({
      url: z.string().url().nullable(),
    })
    .nullable(),
})

export const SpotifyPlaylistFullSchema = SpotifyPlaylistSimpleSchema.extend({
  followers: z.object({
    href: z.string().url().nullable(),
    total: z.number(),
  }),
  tracks: z.object({
    href: z.string().url(),
    items: z.array(SpotifyPlaylistTrackSchema),
    limit: z.number(),
    next: z.string().url().nullable(),
    offset: z.number(),
    previous: z.string().url().nullable(),
    total: z.number(),
  }),
})

// ===== Paging Objects =====

export const SpotifyPagingSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    href: z.string().url(),
    items: z.array(itemSchema),
    limit: z.number(),
    next: z.string().url().nullable(),
    offset: z.number(),
    previous: z.string().url().nullable(),
    total: z.number(),
  })

export const SpotifyPlaylistTracksResponseSchema = SpotifyPagingSchema(SpotifyPlaylistTrackSchema)

export const SpotifyUserPlaylistsResponseSchema = SpotifyPagingSchema(SpotifyPlaylistSimpleSchema)

// ===== User =====

export const SpotifyUserSchema = z.object({
  country: z.string().optional(),
  display_name: z.string().nullable(),
  email: z.string().email().optional(),
  explicit_content: z
    .object({
      filter_enabled: z.boolean(),
      filter_locked: z.boolean(),
    })
    .optional(),
  external_urls: SpotifyExternalUrlsSchema,
  followers: z
    .object({
      href: z.string().url().nullable(),
      total: z.number(),
    })
    .optional(),
  href: z.string().url(),
  id: z.string(),
  images: z.array(SpotifyImageSchema),
  product: z.string().optional(),
  type: z.literal('user'),
  uri: z.string(),
})

// ===== Search =====

export const SpotifySearchResponseSchema = z.object({
  albums: SpotifyPagingSchema(SpotifyAlbumSimpleSchema).optional(),
  artists: SpotifyPagingSchema(SpotifyArtistFullSchema).optional(),
  playlists: SpotifyPagingSchema(SpotifyPlaylistSimpleSchema).optional(),
  tracks: SpotifyPagingSchema(SpotifyTrackFullSchema).optional(),
})

// ===== Recommendations =====

export const SpotifyRecommendationSeedSchema = z.object({
  afterFilteringSize: z.number(),
  afterRelinkingSize: z.number(),
  href: z.string().url().nullable(),
  id: z.string(),
  initialPoolSize: z.number(),
  type: z.enum(['artist', 'track', 'genre']),
})

export const SpotifyRecommendationsResponseSchema = z.object({
  seeds: z.array(SpotifyRecommendationSeedSchema),
  tracks: z.array(SpotifyTrackFullSchema),
})

// ===== Create Playlist =====

export const SpotifyCreatePlaylistRequestSchema = z.object({
  collaborative: z.boolean().optional(),
  description: z.string().optional(),
  name: z.string(),
  public: z.boolean().optional(),
})

export const SpotifyCreatePlaylistResponseSchema = SpotifyPlaylistFullSchema

// ===== Add Tracks to Playlist =====

export const SpotifyAddTracksRequestSchema = z.object({
  position: z.number().optional(),
  uris: z.array(z.string()),
})

export const SpotifyAddTracksResponseSchema = z.object({
  snapshot_id: z.string(),
})

// ===== Token Response =====

export const SpotifyTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string(),
  token_type: z.string(),
})

// ===== Error Response =====

export const SpotifyErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    status: z.number(),
  }),
})

// ===== Type Exports =====

export type SpotifyImage = z.infer<typeof SpotifyImageSchema>
export type SpotifyArtistSimple = z.infer<typeof SpotifyArtistSimpleSchema>
export type SpotifyArtistFull = z.infer<typeof SpotifyArtistFullSchema>
export type SpotifyAlbumSimple = z.infer<typeof SpotifyAlbumSimpleSchema>
export type SpotifyAlbumFull = z.infer<typeof SpotifyAlbumFullSchema>
export type SpotifyTrackSimple = z.infer<typeof SpotifyTrackSimpleSchema>
export type SpotifyTrackFull = z.infer<typeof SpotifyTrackFullSchema>
export type SpotifyAudioFeatures = z.infer<typeof SpotifyAudioFeaturesSchema>
export type SpotifyPlaylistSimple = z.infer<typeof SpotifyPlaylistSimpleSchema>
export type SpotifyPlaylistFull = z.infer<typeof SpotifyPlaylistFullSchema>
export type SpotifyPlaylistTrack = z.infer<typeof SpotifyPlaylistTrackSchema>
export type SpotifyUser = z.infer<typeof SpotifyUserSchema>
export type SpotifySearchResponse = z.infer<typeof SpotifySearchResponseSchema>
export type SpotifyRecommendationsResponse = z.infer<typeof SpotifyRecommendationsResponseSchema>
export type SpotifyTokenResponse = z.infer<typeof SpotifyTokenResponseSchema>
