// Spotify Tools for Anthropic Function Calling
import { z } from 'zod';

import {
  formatZodError,
  safeParse,
  SpotifyAlbumFullSchema,
  SpotifyAudioFeaturesBatchSchema,
  SpotifyAudioFeaturesSchema,
  SpotifyCreatePlaylistResponseSchema,
  SpotifyPlaylistFullSchema,
  SpotifyPlaylistTracksResponseSchema,
  SpotifyPagingSchema,
  SpotifyRecommendationsResponseSchema,
  SpotifySearchResponseSchema,
  SpotifyTrackFullSchema,
  SpotifyUserSchema,
} from '@dj/shared-types';

import { rateLimitedSpotifyCall } from '../utils/RateLimitedAPIClients';

// Tool schemas
export const SearchTracksSchema = z.object({
  filters: z.object({
    genre: z.string().optional(),
    max_energy: z.number().min(0).max(1).optional(),
    max_tempo: z.number().min(0).max(300).optional(),
    min_energy: z.number().min(0).max(1).optional(),
    min_tempo: z.number().min(0).max(300).optional()
  }).optional(),
  limit: z.number().min(1).max(50).default(10).describe('Number of results to return'),
  query: z.string().describe('Search query for tracks')
});

export const GetAudioFeaturesSchema = z.object({
  track_ids: z.array(z.string()).max(100).describe('Spotify track IDs to analyze')
});

export const GetRecommendationsSchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  seed_artists: z.array(z.string()).max(5).optional(),
  seed_genres: z.array(z.string()).max(5).optional(),
  seed_tracks: z.array(z.string()).max(5).optional(),
  target_danceability: z.number().min(0).max(1).optional(),
  target_energy: z.number().min(0).max(1).optional(),
  target_valence: z.number().min(0).max(1).optional()
});

export const CreatePlaylistSchema = z.object({
  description: z.string().max(300).optional(),
  name: z.string().min(1).max(100),
  public: z.boolean().default(false),
  track_uris: z.array(z.string()).describe('Spotify track URIs to add')
});

export const ModifyPlaylistSchema = z.object({
  action: z.enum(['add', 'remove', 'reorder']),
  playlist_id: z.string(),
  position: z.number().optional().describe('Position to insert tracks (for add/reorder)'),
  track_uris: z.array(z.string())
});

// Tool definitions for Anthropic
export const spotifyTools = [
  {
    description: 'Search for tracks on Spotify with optional audio feature filters',
    input_schema: {
      properties: {
        filters: {
          properties: {
            genre: { type: 'string' },
            max_energy: { maximum: 1, minimum: 0, type: 'number' },
            max_tempo: { maximum: 300, minimum: 0, type: 'number' },
            min_energy: { maximum: 1, minimum: 0, type: 'number' },
            min_tempo: { maximum: 300, minimum: 0, type: 'number' }
          },
          type: 'object'
        },
        limit: {
          default: 10,
          description: 'Number of results (1-50)',
          type: 'number'
        },
        query: {
          description: 'Search query (artist name, song name, etc.)',
          type: 'string'
        }
      },
      required: ['query'],
      type: 'object'
    },
    name: 'search_spotify_tracks'
  },
  {
    description: 'Get detailed audio features for tracks (energy, danceability, tempo, etc.)',
    input_schema: {
      properties: {
        track_ids: {
          description: 'Array of Spotify track IDs',
          items: { type: 'string' },
          maxItems: 100,
          type: 'array'
        }
      },
      required: ['track_ids'],
      type: 'object'
    },
    name: 'get_audio_features'
  },
  {
    description: 'Get track recommendations based on seeds and target audio features',
    input_schema: {
      properties: {
        limit: { default: 20, maximum: 100, minimum: 1, type: 'number' },
        seed_artists: {
          description: 'Seed artist IDs',
          items: { type: 'string' },
          maxItems: 5,
          type: 'array'
        },
        seed_genres: {
          description: 'Seed genres',
          items: { type: 'string' },
          maxItems: 5,
          type: 'array'
        },
        seed_tracks: {
          description: 'Seed track IDs',
          items: { type: 'string' },
          maxItems: 5,
          type: 'array'
        },
        target_danceability: { maximum: 1, minimum: 0, type: 'number' },
        target_energy: { maximum: 1, minimum: 0, type: 'number' },
        target_valence: { maximum: 1, minimum: 0, type: 'number' }
      },
      type: 'object'
    },
    name: 'get_recommendations'
  },
  {
    description: 'Create a new Spotify playlist and add tracks',
    input_schema: {
      properties: {
        description: {
          description: 'Playlist description',
          maxLength: 300,
          type: 'string'
        },
        name: {
          description: 'Playlist name',
          maxLength: 100,
          minLength: 1,
          type: 'string'
        },
        public: {
          default: false,
          description: 'Make playlist public',
          type: 'boolean'
        },
        track_uris: {
          description: 'Spotify track URIs to add (spotify:track:...)',
          items: { type: 'string' },
          type: 'array'
        }
      },
      required: ['name', 'track_uris'],
      type: 'object'
    },
    name: 'create_playlist'
  },
  {
    description: 'Add, remove, or reorder tracks in an existing playlist',
    input_schema: {
      properties: {
        action: {
          description: 'Action to perform',
          enum: ['add', 'remove', 'reorder'],
          type: 'string'
        },
        playlist_id: {
          description: 'Spotify playlist ID',
          type: 'string'
        },
        position: {
          description: 'Position for insertion (add/reorder)',
          minimum: 0,
          type: 'number'
        },
        track_uris: {
          description: 'Track URIs to add/remove/reorder',
          items: { type: 'string' },
          type: 'array'
        }
      },
      required: ['playlist_id', 'action', 'track_uris'],
      type: 'object'
    },
    name: 'modify_playlist'
  },
  {
    description: 'Analyze an existing playlist to understand its characteristics',
    input_schema: {
      properties: {
        include_recommendations: {
          default: false,
          description: 'Include AI-generated recommendations',
          type: 'boolean'
        },
        playlist_id: {
          description: 'Spotify playlist ID to analyze',
          type: 'string'
        }
      },
      required: ['playlist_id'],
      type: 'object'
    },
    name: 'analyze_playlist'
  }
];

// Tool executor with logging
export async function executeSpotifyTool(
  toolName: string,
  args: Record<string, unknown>,
  token: string
): Promise<unknown> {
  console.log(`[Tool] Executing ${toolName} with args:`, JSON.stringify(args).substring(0, 200));
  const startTime = Date.now();

  try {
    let result;
    switch (toolName) {
      case 'analyze_playlist':
        result = await analyzePlaylist(args, token);
        break;
      case 'create_playlist':
        result = await createPlaylist(args, token);
        break;
      case 'get_album_info':
        result = await getAlbumInfo(args, token);
        break;
      case 'get_artist_info':
        result = await getArtistInfo(args, token);
        break;
      case 'get_artist_top_tracks':
        result = await getArtistTopTracks(args, token);
        break;
      case 'get_audio_features':
        result = await getAudioFeatures(args, token);
        break;
      case 'get_available_genres':
        result = await getAvailableGenres(token);
        break;
      case 'get_recommendations':
        result = await getRecommendations(args, token);
        break;
      case 'get_related_artists':
        result = await getRelatedArtists(args, token);
        break;
      case 'get_track_details':
        result = await getTrackDetails(args, token);
        break;
      case 'modify_playlist':
        result = await modifyPlaylist(args, token);
        break;
      case 'search_artists':
        result = await searchArtists(args, token);
        break;
      case 'search_spotify_tracks':
        result = await searchSpotifyTracks(args as z.infer<typeof SearchTracksSchema>, token);
        break;
      default:
        console.error(`[Tool] Unknown tool: ${toolName}`);
        throw new Error(`Unknown tool: ${toolName}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[Tool] ${toolName} completed successfully in ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Tool] ${toolName} failed after ${duration}ms:`, error);
    throw error;
  }
}

async function analyzePlaylist(args: any, token: string) {
  const { playlist_id } = args;

  console.log(`[analyzePlaylist] Starting analysis with args:`, JSON.stringify(args));
  console.log(`[analyzePlaylist] Extracted playlist_id: "${playlist_id}"`);
  console.log(`[analyzePlaylist] Token present: ${token ? 'YES' : 'NO'}`);

  if (!playlist_id) {
    console.error(`[analyzePlaylist] CRITICAL: playlist_id is missing or empty!`);
    throw new Error('playlist_id parameter is required');
  }

  // Get playlist details
  console.log(`[analyzePlaylist] Fetching playlist details for ID: ${playlist_id}`);
  const playlistResponse = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/playlists/${playlist_id}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'playlist:details'
  );

  console.log(`[analyzePlaylist] Playlist API response status: ${playlistResponse.status}`);

  if (!playlistResponse.ok) {
    const errorText = await playlistResponse.text();
    console.error(`[analyzePlaylist] Failed to get playlist: ${playlistResponse.status} - ${errorText}`);
    throw new Error(`Failed to get playlist: ${playlistResponse.status}`);
  }

  const playlistJson = await playlistResponse.json();
  const playlistResult = safeParse(SpotifyPlaylistFullSchema, playlistJson);

  if (!playlistResult.success) {
    console.error('[analyzePlaylist] Failed to parse playlist:', formatZodError(playlistResult.error));
    throw new Error(`Invalid playlist data: ${formatZodError(playlistResult.error)}`);
  }

  const playlist = playlistResult.data;
  console.log(`[analyzePlaylist] Successfully got playlist: "${playlist.name}" (${playlist.tracks?.total} tracks)`);

  // Get tracks
  console.log(`[analyzePlaylist] Fetching playlist tracks...`);
  const tracksResponse = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/playlists/${playlist_id}/tracks?limit=100`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'playlist:tracks'
  );

  console.log(`[analyzePlaylist] Tracks API response status: ${tracksResponse.status}`);

  if (!tracksResponse.ok) {
    const errorText = await tracksResponse.text();
    console.error(`[analyzePlaylist] Failed to get playlist tracks: ${tracksResponse.status} - ${errorText}`);
    throw new Error(`Failed to get playlist tracks: ${tracksResponse.status}`);
  }

  const tracksJson = await tracksResponse.json();
  const tracksResult = safeParse(SpotifyPlaylistTracksResponseSchema, tracksJson);

  if (!tracksResult.success) {
    console.error('[analyzePlaylist] Failed to parse tracks:', formatZodError(tracksResult.error));
    throw new Error(`Invalid tracks data: ${formatZodError(tracksResult.error)}`);
  }

  const tracksData = tracksResult.data;
  const tracks = tracksData.items.map(item => item.track).filter((track): track is NonNullable<typeof track> => track !== null);
  const trackIds = tracks.map(t => t.id).filter(Boolean);
  console.log(`[analyzePlaylist] Found ${tracks.length} tracks, ${trackIds.length} with valid IDs`);

  // Log the structure of a single track object to see what Spotify returns
  if (tracks.length > 0) {
    const sampleTrack = tracks[0];
    console.log(`[analyzePlaylist] Sample track object keys: ${Object.keys(sampleTrack).join(', ')}`);
    console.log(`[analyzePlaylist] Single track JSON size: ${JSON.stringify(sampleTrack).length} bytes`);

    // Log size of specific fields
    if (sampleTrack.album) {
      console.log(`[analyzePlaylist]   - album field size: ${JSON.stringify(sampleTrack.album).length} bytes`);
      console.log(`[analyzePlaylist]   - album keys: ${Object.keys(sampleTrack.album).join(', ')}`);
    }
    // Note: available_markets not included in schema to reduce payload size
    if (sampleTrack.external_ids) {
      console.log(`[analyzePlaylist]   - external_ids: ${JSON.stringify(sampleTrack.external_ids)}`);
    }
  }

  // Get audio features
  let audioFeatures: (z.infer<typeof SpotifyAudioFeaturesSchema> | null)[] = [];
  if (trackIds.length > 0) {
    console.log(`[analyzePlaylist] Fetching audio features for ${trackIds.length} tracks...`);
    const featuresResponse = await rateLimitedSpotifyCall(
      () => fetch(
        `https://api.spotify.com/v1/audio-features?ids=${trackIds.slice(0, 100).join(',')}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      ),
      undefined,
      'audio-features:analyze'
    );

    console.log(`[analyzePlaylist] Audio features API response status: ${featuresResponse.status}`);

    if (featuresResponse.ok) {
      const featuresJson = await featuresResponse.json();
      const featuresResult = safeParse(SpotifyAudioFeaturesBatchSchema, featuresJson);

      if (featuresResult.success) {
        audioFeatures = featuresResult.data.audio_features ?? [];
        console.log(`[analyzePlaylist] Got audio features for ${audioFeatures.filter(f => f).length} tracks`);
      } else {
        console.error('[analyzePlaylist] Failed to parse audio features:', formatZodError(featuresResult.error));
      }
    } else {
      const errorText = await featuresResponse.text();
      console.error(`[analyzePlaylist] Failed to get audio features: ${featuresResponse.status} - ${errorText}`);
      console.error(`[analyzePlaylist] Request URL: https://api.spotify.com/v1/audio-features?ids=${trackIds.slice(0, 100).join(',').substring(0, 200)}...`);
      console.error(`[analyzePlaylist] Token starts with: ${token.substring(0, 10)}...`);
    }
  }

  // Calculate averages
  console.log(`[analyzePlaylist] Calculating audio analysis from ${audioFeatures.length} features...`);
  const validFeatures = audioFeatures.filter((f: any) => f !== null);
  console.log(`[analyzePlaylist] Valid features: ${validFeatures.length}/${audioFeatures.length}`);

  // Create a MUCH smaller analysis object for Claude (was 55KB, now ~2KB)
  const analysis = {
    audio_analysis: validFeatures.length > 0 ? {
      avg_acousticness: validFeatures.reduce((sum: number, f: any) => sum + f.acousticness, 0) / validFeatures.length,
      avg_danceability: validFeatures.reduce((sum: number, f: any) => sum + f.danceability, 0) / validFeatures.length,
      avg_energy: validFeatures.reduce((sum: number, f: any) => sum + f.energy, 0) / validFeatures.length,
      avg_instrumentalness: validFeatures.reduce((sum: number, f: any) => sum + f.instrumentalness, 0) / validFeatures.length,
      avg_tempo: validFeatures.reduce((sum: number, f: any) => sum + f.tempo, 0) / validFeatures.length,
      avg_valence: validFeatures.reduce((sum: number, f: any) => sum + f.valence, 0) / validFeatures.length,
    } : null,
    // Add genre analysis if available
    genres: Array.from(new Set(tracks.flatMap((t: any) => t.genres ?? []))).slice(0, 5),
    playlist_description: playlist.description ?? 'No description',
    playlist_name: playlist.name,
    // Only include a sample of tracks with minimal data (not full track objects)
    sample_tracks: tracks.slice(0, 5).map((track: any) => ({
      artists: track.artists?.map((a: any) => a.name).join(', ') ?? 'Unknown',
      duration_ms: track.duration_ms,
      name: track.name,
      popularity: track.popularity
    })),
    // Include artist frequency analysis
    top_artists: Object.entries(
      tracks.reduce((acc: any, track: any) => {
        track.artists?.forEach((artist: any) => {
          acc[artist.name] = (acc[artist.name] ?? 0) + 1;
        });
        return acc;
      }, {})
    )
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 5)
    .map(([artist, count]) => ({ artist, track_count: count })),
    total_tracks: tracks.length
  };

  const analysisSize = JSON.stringify(analysis).length;
  console.log(`[analyzePlaylist] Analysis complete! Playlist: "${analysis.playlist_name}", Tracks: ${analysis.total_tracks}, Audio data: ${analysis.audio_analysis ? 'YES' : 'NO'}`);
  console.log(`[analyzePlaylist] Analysis object size: ${analysisSize} bytes (reduced from ~55KB)`);

  // Log what would have been sent in the old version
  const oldAnalysis = {
    audio_analysis: analysis.audio_analysis,
    audio_features: audioFeatures.slice(0, 20), // And this!
    playlist_description: playlist.description,
    playlist_name: playlist.name,
    total_tracks: tracks.length,
    tracks: tracks.slice(0, 20) // This was the problem!
  };
  const oldSize = JSON.stringify(oldAnalysis).length;
  console.log(`[analyzePlaylist] OLD analysis size would have been: ${oldSize} bytes`);
  console.log(`[analyzePlaylist] Size breakdown of old format:`);
  console.log(`[analyzePlaylist]   - tracks field: ${JSON.stringify(tracks.slice(0, 20)).length} bytes`);
  console.log(`[analyzePlaylist]   - audio_features field: ${JSON.stringify(audioFeatures.slice(0, 20)).length} bytes`);
  console.log(`[analyzePlaylist]   - other fields: ${oldSize - JSON.stringify(tracks.slice(0, 20)).length - JSON.stringify(audioFeatures.slice(0, 20)).length} bytes`);
  console.log(`[analyzePlaylist] Size reduction: ${oldSize} → ${analysisSize} (${Math.round((1 - analysisSize/oldSize) * 100)}% smaller)`);

  return analysis;
}

async function createPlaylist(args: any, token: string) {
  console.log(`[Tool:createPlaylist] Creating playlist: ${args.name}`);

  // Get user ID first
  const userResponse = await rateLimitedSpotifyCall(
    () => fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    }),
    undefined,
    'user:profile'
  );

  if (!userResponse.ok) {
    console.error(`[Tool:createPlaylist] Failed to get user profile: ${userResponse.status}`);
    throw new Error('Failed to get user profile');
  }

  const userJson = await userResponse.json();
  const userResult = safeParse(SpotifyUserSchema, userJson);

  if (!userResult.success) {
    console.error('[Tool:createPlaylist] Failed to parse user data:', formatZodError(userResult.error));
    throw new Error(`Invalid user data: ${formatZodError(userResult.error)}`);
  }

  const userId = userResult.data.id;
  console.log(`[Tool:createPlaylist] User ID: ${userId}`);

  // Create playlist
  const createResponse = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/users/${userId}/playlists`,
      {
        body: JSON.stringify({
          description: args.description ?? '',
          name: args.name,
          public: args.public ?? false
        }),
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        method: 'POST'
      }
    ),
    undefined,
    'playlist:create'
  );

  if (!createResponse.ok) {
    console.error(`[Tool:createPlaylist] Failed to create playlist: ${createResponse.status}`);
    throw new Error('Failed to create playlist');
  }

  const playlistJson = await createResponse.json();
  const playlistResult = safeParse(SpotifyCreatePlaylistResponseSchema, playlistJson);

  if (!playlistResult.success) {
    console.error('[Tool:createPlaylist] Failed to parse playlist response:', formatZodError(playlistResult.error));
    throw new Error(`Invalid playlist response: ${formatZodError(playlistResult.error)}`);
  }

  const playlist = playlistResult.data;
  console.log(`[Tool:createPlaylist] Playlist created with ID: ${playlist.id}`);

  // Add tracks if provided
  if (args.track_uris && args.track_uris.length > 0) {
    const addResponse = await rateLimitedSpotifyCall(
      () => fetch(
        `https://api.spotify.com/v1/playlists/${playlist.id}/tracks`,
        {
          body: JSON.stringify({
            uris: args.track_uris
          }),
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          method: 'POST'
        }
      ),
      undefined,
      'playlist:add-tracks'
    );

    if (!addResponse.ok) {
      throw new Error('Failed to add tracks to playlist');
    }
  }

  return playlist;
}

async function getAlbumInfo(args: any, token: string) {
  const { album_id } = args;

  const response = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/albums/${album_id}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'album:info'
  );

  if (!response.ok) {
    throw new Error(`Failed to get album info: ${response.status}`);
  }

  const albumJson = await response.json();
  const albumResult = safeParse(SpotifyAlbumFullSchema, albumJson);

  if (!albumResult.success) {
    console.error('[getAlbumInfo] Failed to parse album data:', formatZodError(albumResult.error));
    throw new Error(`Invalid album data: ${formatZodError(albumResult.error)}`);
  }

  const album = albumResult.data;

  // Get track IDs for audio features
  const trackIds = album.tracks?.items?.map(t => t.id).filter(Boolean) ?? [];

  let audioFeatures: (z.infer<typeof SpotifyAudioFeaturesSchema> | null)[] = [];
  if (trackIds.length > 0) {
    const featuresResponse = await rateLimitedSpotifyCall(
      () => fetch(
        `https://api.spotify.com/v1/audio-features?ids=${trackIds.join(',')}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      ),
      undefined,
      'audio-features:album'
    );

    if (featuresResponse.ok) {
      const featuresJson = await featuresResponse.json();
      const featuresResult = safeParse(SpotifyAudioFeaturesBatchSchema, featuresJson);

      if (featuresResult.success) {
        audioFeatures = featuresResult.data.audio_features ?? [];
      } else {
        console.error('[getAlbumInfo] Failed to parse audio features:', formatZodError(featuresResult.error));
      }
    }
  }

  return {
    ...(album as object),
    track_audio_features: audioFeatures
  };
}

async function getArtistInfo(args: any, token: string) {
  const { artist_id } = args;

  const response = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/artists/${artist_id}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'artist:info'
  );

  if (!response.ok) {
    throw new Error(`Failed to get artist info: ${response.status}`);
  }

  return await response.json();
}

async function getArtistTopTracks(args: any, token: string) {
  const { artist_id, market = 'US' } = args;

  const response = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/artists/${artist_id}/top-tracks?market=${market}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'artist:top-tracks'
  );

  if (!response.ok) {
    throw new Error(`Failed to get artist top tracks: ${response.status}`);
  }

  const json = await response.json();
  const result = safeParse(SpotifyPagingSchema(SpotifyTrackFullSchema), json);

  if (!result.success) {
    console.error('[getArtistTopTracks] Failed to parse response:', formatZodError(result.error));
    return [];
  }

  return result.data.items ?? [];
}

async function getAudioFeatures(args: any, token: string) {
  const { track_ids } = args;

  console.log(`[getAudioFeatures] Starting with args:`, JSON.stringify(args));
  console.log(`[getAudioFeatures] Extracted track_ids:`, track_ids);

  if (!track_ids || !Array.isArray(track_ids) || track_ids.length === 0) {
    console.error(`[getAudioFeatures] CRITICAL: track_ids is missing, not an array, or empty!`);
    throw new Error('track_ids parameter is required and must be a non-empty array');
  }

  console.log(`[getAudioFeatures] Fetching audio features for ${track_ids.length} tracks`);
  const response = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/audio-features?ids=${track_ids.join(',')}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'audio-features:batch'
  );

  console.log(`[getAudioFeatures] API response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[getAudioFeatures] Failed to get audio features: ${response.status} - ${errorText}`);
    throw new Error(`Failed to get audio features: ${response.status}`);
  }

  const json = await response.json();
  const result = safeParse(SpotifyAudioFeaturesBatchSchema, json);

  if (!result.success) {
    console.error('[getAudioFeatures] Failed to parse response:', formatZodError(result.error));
    return [];
  }

  const features = result.data.audio_features ?? [];
  console.log(`[getAudioFeatures] Retrieved ${features.length} audio features`);
  return features;
}

async function getAvailableGenres(token: string) {
  const response = await rateLimitedSpotifyCall(
    () => fetch(
      'https://api.spotify.com/v1/recommendations/available-genre-seeds',
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'genres:available'
  );

  if (!response.ok) {
    throw new Error(`Failed to get available genres: ${response.status}`);
  }

  const json = await response.json();
  const GenresSchema = z.object({ genres: z.array(z.string()) });
  const result = safeParse(GenresSchema, json);

  if (!result.success) {
    console.error('[getAvailableGenres] Failed to parse response:', formatZodError(result.error));
    return [];
  }

  return result.data.genres ?? [];
}

async function getRecommendations(args: any, token: string) {
  const params = new URLSearchParams();

  if (args.seed_tracks) params.append('seed_tracks', args.seed_tracks.join(','));
  if (args.seed_artists) params.append('seed_artists', args.seed_artists.join(','));
  if (args.seed_genres) params.append('seed_genres', args.seed_genres.join(','));
  if (args.target_energy !== undefined) params.append('target_energy', args.target_energy.toString());
  if (args.target_danceability !== undefined) params.append('target_danceability', args.target_danceability.toString());
  if (args.target_valence !== undefined) params.append('target_valence', args.target_valence.toString());
  params.append('limit', (args.limit ?? 20).toString());

  const response = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/recommendations?${params}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'recommendations'
  );

  if (!response.ok) {
    throw new Error(`Failed to get recommendations: ${response.status}`);
  }

  const json = await response.json();
  const result = safeParse(SpotifyRecommendationsResponseSchema, json);

  if (!result.success) {
    console.error('[getRecommendations] Failed to parse response:', formatZodError(result.error));
    return [];
  }

  return result.data.tracks ?? [];
}

async function getRelatedArtists(args: any, token: string) {
  const { artist_id } = args;

  const response = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/artists/${artist_id}/related-artists`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'artist:related'
  );

  if (!response.ok) {
    throw new Error(`Failed to get related artists: ${response.status}`);
  }

  const json = await response.json();
  const ArtistsSchema = z.object({ artists: z.array(z.any()) }); // Artists have complex schema
  const result = safeParse(ArtistsSchema, json);

  if (!result.success) {
    console.error('[getRelatedArtists] Failed to parse response:', formatZodError(result.error));
    return [];
  }

  return result.data.artists ?? [];
}

async function getTrackDetails(args: any, token: string) {
  const { track_id } = args;

  const response = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/tracks/${track_id}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'track:details'
  );

  if (!response.ok) {
    throw new Error(`Failed to get track details: ${response.status}`);
  }

  const trackJson = await response.json();
  const trackResult = safeParse(SpotifyTrackFullSchema, trackJson);

  if (!trackResult.success) {
    console.error('[getTrackDetails] Failed to parse track:', formatZodError(trackResult.error));
    throw new Error(`Invalid track data: ${formatZodError(trackResult.error)}`);
  }

  const track = trackResult.data;

  // Also get audio features for complete info
  const featuresResponse = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/audio-features/${track_id}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'audio-features:single'
  );

  let audioFeatures = null;
  if (featuresResponse.ok) {
    const featuresJson = await featuresResponse.json();
    const featuresResult = safeParse(SpotifyAudioFeaturesSchema, featuresJson);

    if (featuresResult.success) {
      audioFeatures = featuresResult.data;
    } else {
      console.error('[getTrackDetails] Failed to parse audio features:', formatZodError(featuresResult.error));
    }
  }

  return {
    album: {
      id: track.album.id,
      images: track.album.images,
      name: track.album.name,
      release_date: track.album.release_date
    },
    artists: track.artists,
    audio_features: audioFeatures,
    duration_ms: track.duration_ms,
    explicit: track.explicit,
    id: track.id,
    name: track.name,
    popularity: track.popularity,
    preview_url: track.preview_url,
    uri: track.uri
  };
}

async function modifyPlaylist(args: any, token: string) {
  const { action, playlist_id, position, track_uris } = args;

  const url = `https://api.spotify.com/v1/playlists/${playlist_id}/tracks`;
  let method = 'POST';
  let body: any = {};

  switch (action) {
    case 'add':
      body.uris = track_uris;
      if (position !== undefined) body.position = position;
      break;
    case 'remove':
      method = 'DELETE';
      body.tracks = track_uris.map((uri: string) => ({ uri }));
      break;
    case 'reorder':
      method = 'PUT';
      body = {
        insert_before: args.insert_before,
        range_length: track_uris.length,
        range_start: position
      };
      break;
  }

  const response = await rateLimitedSpotifyCall(
    () => fetch(url, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      method
    }),
    undefined,
    `playlist:${action}`
  );

  if (!response.ok) {
    throw new Error(`Failed to ${action} tracks: ${response.status}`);
  }

  return { action, success: true, track_count: track_uris.length };
}

async function searchArtists(args: any, token: string) {
  const { limit = 10, query } = args;

  const response = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=${limit}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'search:artists'
  );

  if (!response.ok) {
    throw new Error(`Failed to search artists: ${response.status}`);
  }

  const json = await response.json();
  const ArtistsPagingSchema = z.object({
    artists: SpotifyPagingSchema(z.any()) // Artist schema is complex, use any for now
  });
  const result = safeParse(ArtistsPagingSchema, json);

  if (!result.success) {
    console.error('[searchArtists] Failed to parse response:', formatZodError(result.error));
    return [];
  }

  return result.data.artists?.items ?? [];
}

// Implementation functions
async function searchSpotifyTracks(args: z.infer<typeof SearchTracksSchema>, token: string): Promise<z.infer<typeof SpotifyTrackFullSchema>[]> {
  const { filters, limit = 10, query } = args;

  const response = await rateLimitedSpotifyCall(
    () => fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ),
    undefined,
    'search:tracks'
  );

  if (!response.ok) {
    throw new Error(`Spotify search failed: ${response.status}`);
  }

  const json = await response.json();
  const result = safeParse(SpotifySearchResponseSchema, json);

  if (!result.success) {
    console.error('[searchSpotifyTracks] Failed to parse response:', formatZodError(result.error));
    throw new Error(`Invalid search response: ${formatZodError(result.error)}`);
  }

  const tracks = result.data.tracks?.items ?? [];

  // Apply filters if provided
  if (filters && tracks.length > 0) {
    const trackIds = tracks.map((track) => track.id);
    const features = await getAudioFeatures({ track_ids: trackIds }, token);

    return tracks.filter((_track, index) => {
      const feature = features[index];
      if (!feature) return true;

      if (filters.min_energy && feature.energy < filters.min_energy) return false;
      if (filters.max_energy && feature.energy > filters.max_energy) return false;
      if (filters.min_tempo && feature.tempo < filters.min_tempo) return false;
      if (filters.max_tempo && feature.tempo > filters.max_tempo) return false;

      return true;
    });
  }

  return tracks;
}