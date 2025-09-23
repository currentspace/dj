import { z } from 'zod';

// Anthropic API Response Schema
export const AnthropicMessageSchema = z.object({
  content: z.array(z.object({
    text: z.string(),
    type: z.literal('text')
  })),
  model: z.string(),
  role: z.literal('assistant'),
  stop_reason: z.string().optional(),
  stop_sequence: z.string().nullable().optional(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number()
  }).optional()
});

export type AnthropicMessage = z.infer<typeof AnthropicMessageSchema>;

// Spotify API Response Schemas
export const SpotifyTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  uri: z.string(),
  preview_url: z.string().nullable(),
  external_urls: z.object({
    spotify: z.string()
  }).optional(),
  artists: z.array(z.object({
    name: z.string(),
    id: z.string()
  }))
});

export const SpotifySearchResponseSchema = z.object({
  tracks: z.object({
    items: z.array(SpotifyTrackSchema)
  }).optional()
});

export const SpotifyUserSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable().optional(),
  email: z.string().optional()
});

export const SpotifyPlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  external_urls: z.object({
    spotify: z.string()
  }).optional()
});

export type SpotifyTrack = z.infer<typeof SpotifyTrackSchema>;
export type SpotifySearchResponse = z.infer<typeof SpotifySearchResponseSchema>;
export type SpotifyUser = z.infer<typeof SpotifyUserSchema>;
export type SpotifyPlaylist = z.infer<typeof SpotifyPlaylistSchema>;

// Generated Playlist Schema (from Claude)
export const GeneratedPlaylistSchema = z.object({
  name: z.string(),
  description: z.string(),
  tracks: z.array(z.object({
    name: z.string(),
    artist: z.string(),
    query: z.string()
  }))
});

export type GeneratedPlaylist = z.infer<typeof GeneratedPlaylistSchema>;

// Request schemas
export const GeneratePlaylistRequestSchema = z.object({
  prompt: z.string().min(1).max(500)
});

// Enhanced track schema for playlist processing
export const PlaylistTrackSchema = z.object({
  name: z.string(),
  artist: z.string(),
  query: z.string(),
  spotifyId: z.string().optional(),
  spotifyUri: z.string().optional(),
  preview_url: z.string().nullable().optional(),
  external_url: z.string().optional()
});

export const SavePlaylistRequestSchema = z.object({
  playlist: z.object({
    name: z.string(),
    description: z.string(),
    tracks: z.array(PlaylistTrackSchema)
  })
});

export type GeneratePlaylistRequest = z.infer<typeof GeneratePlaylistRequestSchema>;
export type SavePlaylistRequest = z.infer<typeof SavePlaylistRequestSchema>;
export type PlaylistTrack = z.infer<typeof PlaylistTrackSchema>;