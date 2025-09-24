// Spotify Tools for Anthropic Function Calling
import { z } from 'zod';

// Spotify API response schemas
const SpotifyTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(z.object({
    id: z.string(),
    name: z.string()
  })),
  album: z.object({
    id: z.string(),
    name: z.string(),
    images: z.array(z.object({
      url: z.string(),
      height: z.number(),
      width: z.number()
    }))
  }),
  preview_url: z.string().nullable(),
  external_urls: z.object({ spotify: z.string() }),
  uri: z.string()
});

const SpotifySearchResponseSchema = z.object({
  tracks: z.object({
    items: z.array(SpotifyTrackSchema)
  })
});

const SpotifyAudioFeaturesSchema = z.object({
  id: z.string(),
  danceability: z.number(),
  energy: z.number(),
  valence: z.number(),
  tempo: z.number(),
  acousticness: z.number(),
  instrumentalness: z.number(),
  speechiness: z.number(),
  liveness: z.number(),
  loudness: z.number(),
  key: z.number(),
  mode: z.number()
});

const SpotifyAudioFeaturesResponseSchema = z.object({
  audio_features: z.array(SpotifyAudioFeaturesSchema.nullable())
});

type SpotifyTrack = z.infer<typeof SpotifyTrackSchema>;
type SpotifyAudioFeatures = z.infer<typeof SpotifyAudioFeaturesSchema>;

// Tool schemas
export const SearchTracksSchema = z.object({
  query: z.string().describe('Search query for tracks'),
  limit: z.number().min(1).max(50).default(10).describe('Number of results to return'),
  filters: z.object({
    min_energy: z.number().min(0).max(1).optional(),
    max_energy: z.number().min(0).max(1).optional(),
    min_tempo: z.number().min(0).max(300).optional(),
    max_tempo: z.number().min(0).max(300).optional(),
    genre: z.string().optional()
  }).optional()
});

export const GetAudioFeaturesSchema = z.object({
  track_ids: z.array(z.string()).max(100).describe('Spotify track IDs to analyze')
});

export const GetRecommendationsSchema = z.object({
  seed_tracks: z.array(z.string()).max(5).optional(),
  seed_artists: z.array(z.string()).max(5).optional(),
  seed_genres: z.array(z.string()).max(5).optional(),
  target_energy: z.number().min(0).max(1).optional(),
  target_danceability: z.number().min(0).max(1).optional(),
  target_valence: z.number().min(0).max(1).optional(),
  limit: z.number().min(1).max(100).default(20)
});

export const CreatePlaylistSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(300).optional(),
  public: z.boolean().default(false),
  track_uris: z.array(z.string()).describe('Spotify track URIs to add')
});

export const ModifyPlaylistSchema = z.object({
  playlist_id: z.string(),
  action: z.enum(['add', 'remove', 'reorder']),
  track_uris: z.array(z.string()),
  position: z.number().optional().describe('Position to insert tracks (for add/reorder)')
});

// Tool definitions for Anthropic
export const spotifyTools = [
  {
    name: 'search_spotify_tracks',
    description: 'Search for tracks on Spotify with optional audio feature filters',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (artist name, song name, etc.)'
        },
        limit: {
          type: 'number',
          description: 'Number of results (1-50)',
          default: 10
        },
        filters: {
          type: 'object',
          properties: {
            min_energy: { type: 'number', minimum: 0, maximum: 1 },
            max_energy: { type: 'number', minimum: 0, maximum: 1 },
            min_tempo: { type: 'number', minimum: 0, maximum: 300 },
            max_tempo: { type: 'number', minimum: 0, maximum: 300 },
            genre: { type: 'string' }
          }
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_audio_features',
    description: 'Get detailed audio features for tracks (energy, danceability, tempo, etc.)',
    input_schema: {
      type: 'object',
      properties: {
        track_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of Spotify track IDs',
          maxItems: 100
        }
      },
      required: ['track_ids']
    }
  },
  {
    name: 'get_recommendations',
    description: 'Get track recommendations based on seeds and target audio features',
    input_schema: {
      type: 'object',
      properties: {
        seed_tracks: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 5,
          description: 'Seed track IDs'
        },
        seed_artists: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 5,
          description: 'Seed artist IDs'
        },
        seed_genres: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 5,
          description: 'Seed genres'
        },
        target_energy: { type: 'number', minimum: 0, maximum: 1 },
        target_danceability: { type: 'number', minimum: 0, maximum: 1 },
        target_valence: { type: 'number', minimum: 0, maximum: 1 },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 20 }
      }
    }
  },
  {
    name: 'create_playlist',
    description: 'Create a new Spotify playlist and add tracks',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Playlist name',
          minLength: 1,
          maxLength: 100
        },
        description: {
          type: 'string',
          description: 'Playlist description',
          maxLength: 300
        },
        public: {
          type: 'boolean',
          description: 'Make playlist public',
          default: false
        },
        track_uris: {
          type: 'array',
          items: { type: 'string' },
          description: 'Spotify track URIs to add (spotify:track:...)'
        }
      },
      required: ['name', 'track_uris']
    }
  },
  {
    name: 'modify_playlist',
    description: 'Add, remove, or reorder tracks in an existing playlist',
    input_schema: {
      type: 'object',
      properties: {
        playlist_id: {
          type: 'string',
          description: 'Spotify playlist ID'
        },
        action: {
          type: 'string',
          enum: ['add', 'remove', 'reorder'],
          description: 'Action to perform'
        },
        track_uris: {
          type: 'array',
          items: { type: 'string' },
          description: 'Track URIs to add/remove/reorder'
        },
        position: {
          type: 'number',
          description: 'Position for insertion (add/reorder)',
          minimum: 0
        }
      },
      required: ['playlist_id', 'action', 'track_uris']
    }
  },
  {
    name: 'analyze_playlist',
    description: 'Analyze an existing playlist to understand its characteristics',
    input_schema: {
      type: 'object',
      properties: {
        playlist_id: {
          type: 'string',
          description: 'Spotify playlist ID to analyze'
        },
        include_recommendations: {
          type: 'boolean',
          description: 'Include AI-generated recommendations',
          default: false
        }
      },
      required: ['playlist_id']
    }
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
      case 'search_spotify_tracks':
        result = await searchSpotifyTracks(args, token);
        break;
      case 'get_audio_features':
        result = await getAudioFeatures(args, token);
        break;
      case 'get_recommendations':
        result = await getRecommendations(args, token);
        break;
      case 'create_playlist':
        result = await createPlaylist(args, token);
        break;
      case 'modify_playlist':
        result = await modifyPlaylist(args, token);
        break;
      case 'analyze_playlist':
        result = await analyzePlaylist(args, token);
        break;
      case 'get_track_details':
        result = await getTrackDetails(args, token);
        break;
      case 'get_artist_info':
        result = await getArtistInfo(args, token);
        break;
      case 'get_artist_top_tracks':
        result = await getArtistTopTracks(args, token);
        break;
      case 'search_artists':
        result = await searchArtists(args, token);
        break;
      case 'get_related_artists':
        result = await getRelatedArtists(args, token);
        break;
      case 'get_album_info':
        result = await getAlbumInfo(args, token);
        break;
      case 'get_available_genres':
        result = await getAvailableGenres(token);
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

// Implementation functions
async function searchSpotifyTracks(args: z.infer<typeof SearchTracksSchema>, token: string): Promise<SpotifyTrack[]> {
  const { query, limit = 10, filters } = args;

  const response = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Spotify search failed: ${response.status}`);
  }

  const rawData = await response.json();
  const data = SpotifySearchResponseSchema.parse(rawData);
  const tracks = data.tracks.items;

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

async function getAudioFeatures(args: any, token: string) {
  const { track_ids } = args;

  console.log(`[getAudioFeatures] Starting with args:`, JSON.stringify(args));
  console.log(`[getAudioFeatures] Extracted track_ids:`, track_ids);

  if (!track_ids || !Array.isArray(track_ids) || track_ids.length === 0) {
    console.error(`[getAudioFeatures] CRITICAL: track_ids is missing, not an array, or empty!`);
    throw new Error('track_ids parameter is required and must be a non-empty array');
  }

  console.log(`[getAudioFeatures] Fetching audio features for ${track_ids.length} tracks`);
  const response = await fetch(
    `https://api.spotify.com/v1/audio-features?ids=${track_ids.join(',')}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  console.log(`[getAudioFeatures] API response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[getAudioFeatures] Failed to get audio features: ${response.status} - ${errorText}`);
    throw new Error(`Failed to get audio features: ${response.status}`);
  }

  const data = await response.json() as any;
  const features = data.audio_features || [];
  console.log(`[getAudioFeatures] Retrieved ${features.length} audio features`);
  return features;
}

async function getRecommendations(args: any, token: string) {
  const params = new URLSearchParams();

  if (args.seed_tracks) params.append('seed_tracks', args.seed_tracks.join(','));
  if (args.seed_artists) params.append('seed_artists', args.seed_artists.join(','));
  if (args.seed_genres) params.append('seed_genres', args.seed_genres.join(','));
  if (args.target_energy !== undefined) params.append('target_energy', args.target_energy.toString());
  if (args.target_danceability !== undefined) params.append('target_danceability', args.target_danceability.toString());
  if (args.target_valence !== undefined) params.append('target_valence', args.target_valence.toString());
  params.append('limit', (args.limit || 20).toString());

  const response = await fetch(
    `https://api.spotify.com/v1/recommendations?${params}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get recommendations: ${response.status}`);
  }

  const data = await response.json() as any;
  return data.tracks || [];
}

async function createPlaylist(args: any, token: string) {
  console.log(`[Tool:createPlaylist] Creating playlist: ${args.name}`);

  // Get user ID first
  const userResponse = await fetch('https://api.spotify.com/v1/me', {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!userResponse.ok) {
    console.error(`[Tool:createPlaylist] Failed to get user profile: ${userResponse.status}`);
    throw new Error('Failed to get user profile');
  }

  const userData = await userResponse.json() as any;
  const userId = userData.id;
  console.log(`[Tool:createPlaylist] User ID: ${userId}`);

  // Create playlist
  const createResponse = await fetch(
    `https://api.spotify.com/v1/users/${userId}/playlists`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: args.name,
        description: args.description || '',
        public: args.public || false
      })
    }
  );

  if (!createResponse.ok) {
    console.error(`[Tool:createPlaylist] Failed to create playlist: ${createResponse.status}`);
    throw new Error('Failed to create playlist');
  }

  const playlist = await createResponse.json() as any;
  console.log(`[Tool:createPlaylist] Playlist created with ID: ${playlist.id}`);

  // Add tracks if provided
  if (args.track_uris && args.track_uris.length > 0) {
    const addResponse = await fetch(
      `https://api.spotify.com/v1/playlists/${playlist.id}/tracks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uris: args.track_uris
        })
      }
    );

    if (!addResponse.ok) {
      throw new Error('Failed to add tracks to playlist');
    }
  }

  return playlist;
}

async function modifyPlaylist(args: any, token: string) {
  const { playlist_id, action, track_uris, position } = args;

  let url = `https://api.spotify.com/v1/playlists/${playlist_id}/tracks`;
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
        range_start: position,
        insert_before: args.insert_before,
        range_length: track_uris.length
      };
      break;
  }

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Failed to ${action} tracks: ${response.status}`);
  }

  return { success: true, action, track_count: track_uris.length };
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
  const playlistResponse = await fetch(
    `https://api.spotify.com/v1/playlists/${playlist_id}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  console.log(`[analyzePlaylist] Playlist API response status: ${playlistResponse.status}`);

  if (!playlistResponse.ok) {
    const errorText = await playlistResponse.text();
    console.error(`[analyzePlaylist] Failed to get playlist: ${playlistResponse.status} - ${errorText}`);
    throw new Error(`Failed to get playlist: ${playlistResponse.status}`);
  }

  const playlist = await playlistResponse.json() as any;
  console.log(`[analyzePlaylist] Successfully got playlist: "${playlist.name}" (${playlist.tracks?.total} tracks)`);

  // Get tracks
  console.log(`[analyzePlaylist] Fetching playlist tracks...`);
  const tracksResponse = await fetch(
    `https://api.spotify.com/v1/playlists/${playlist_id}/tracks?limit=100`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  console.log(`[analyzePlaylist] Tracks API response status: ${tracksResponse.status}`);

  if (!tracksResponse.ok) {
    const errorText = await tracksResponse.text();
    console.error(`[analyzePlaylist] Failed to get playlist tracks: ${tracksResponse.status} - ${errorText}`);
    throw new Error(`Failed to get playlist tracks: ${tracksResponse.status}`);
  }

  const tracksData = await tracksResponse.json() as any;
  const tracks = tracksData.items.map((item: any) => item.track).filter(Boolean);
  const trackIds = tracks.map((t: any) => t.id).filter(Boolean);
  console.log(`[analyzePlaylist] Found ${tracks.length} tracks, ${trackIds.length} with valid IDs`);

  // Get audio features
  let audioFeatures = [];
  if (trackIds.length > 0) {
    console.log(`[analyzePlaylist] Fetching audio features for ${trackIds.length} tracks...`);
    const featuresResponse = await fetch(
      `https://api.spotify.com/v1/audio-features?ids=${trackIds.slice(0, 100).join(',')}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    console.log(`[analyzePlaylist] Audio features API response status: ${featuresResponse.status}`);

    if (featuresResponse.ok) {
      const featuresData = await featuresResponse.json() as any;
      audioFeatures = featuresData.audio_features || [];
      console.log(`[analyzePlaylist] Got audio features for ${audioFeatures.filter(f => f).length} tracks`);
    } else {
      console.warn(`[analyzePlaylist] Failed to get audio features: ${featuresResponse.status}`);
    }
  }

  // Calculate averages
  console.log(`[analyzePlaylist] Calculating audio analysis from ${audioFeatures.length} features...`);
  const validFeatures = audioFeatures.filter((f: any) => f !== null);
  console.log(`[analyzePlaylist] Valid features: ${validFeatures.length}/${audioFeatures.length}`);

  const analysis = {
    playlist_name: playlist.name,
    playlist_description: playlist.description,
    total_tracks: tracks.length,
    audio_analysis: validFeatures.length > 0 ? {
      avg_energy: validFeatures.reduce((sum: number, f: any) => sum + f.energy, 0) / validFeatures.length,
      avg_danceability: validFeatures.reduce((sum: number, f: any) => sum + f.danceability, 0) / validFeatures.length,
      avg_valence: validFeatures.reduce((sum: number, f: any) => sum + f.valence, 0) / validFeatures.length,
      avg_tempo: validFeatures.reduce((sum: number, f: any) => sum + f.tempo, 0) / validFeatures.length,
      avg_acousticness: validFeatures.reduce((sum: number, f: any) => sum + f.acousticness, 0) / validFeatures.length,
      avg_instrumentalness: validFeatures.reduce((sum: number, f: any) => sum + f.instrumentalness, 0) / validFeatures.length,
    } : null,
    tracks: tracks.slice(0, 20), // First 20 tracks for context
    audio_features: audioFeatures.slice(0, 20) // First 20 features
  };

  console.log(`[analyzePlaylist] Analysis complete! Playlist: "${analysis.playlist_name}", Tracks: ${analysis.total_tracks}, Audio data: ${analysis.audio_analysis ? 'YES' : 'NO'}`);
  return analysis;
}

async function getTrackDetails(args: any, token: string) {
  const { track_id } = args;

  const response = await fetch(
    `https://api.spotify.com/v1/tracks/${track_id}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get track details: ${response.status}`);
  }

  const track = await response.json() as any;

  // Also get audio features for complete info
  const featuresResponse = await fetch(
    `https://api.spotify.com/v1/audio-features/${track_id}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  let audioFeatures = null;
  if (featuresResponse.ok) {
    audioFeatures = await featuresResponse.json();
  }

  return {
    id: track.id,
    name: track.name,
    artists: track.artists,
    album: {
      id: track.album.id,
      name: track.album.name,
      release_date: track.album.release_date,
      images: track.album.images
    },
    duration_ms: track.duration_ms,
    explicit: track.explicit,
    popularity: track.popularity,
    preview_url: track.preview_url,
    uri: track.uri,
    audio_features: audioFeatures
  };
}

async function getArtistInfo(args: any, token: string) {
  const { artist_id } = args;

  const response = await fetch(
    `https://api.spotify.com/v1/artists/${artist_id}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get artist info: ${response.status}`);
  }

  return await response.json();
}

async function getArtistTopTracks(args: any, token: string) {
  const { artist_id, market = 'US' } = args;

  const response = await fetch(
    `https://api.spotify.com/v1/artists/${artist_id}/top-tracks?market=${market}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get artist top tracks: ${response.status}`);
  }

  const data = await response.json() as any;
  return data.tracks || [];
}

async function searchArtists(args: any, token: string) {
  const { query, limit = 10 } = args;

  const response = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=${limit}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to search artists: ${response.status}`);
  }

  const data = await response.json() as any;
  return data.artists?.items || [];
}

async function getRelatedArtists(args: any, token: string) {
  const { artist_id } = args;

  const response = await fetch(
    `https://api.spotify.com/v1/artists/${artist_id}/related-artists`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get related artists: ${response.status}`);
  }

  const data = await response.json() as any;
  return data.artists || [];
}

async function getAlbumInfo(args: any, token: string) {
  const { album_id } = args;

  const response = await fetch(
    `https://api.spotify.com/v1/albums/${album_id}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get album info: ${response.status}`);
  }

  const album = await response.json() as any;

  // Get track IDs for audio features
  const trackIds = album.tracks?.items?.map((t: any) => t.id).filter(Boolean) || [];

  let audioFeatures = [];
  if (trackIds.length > 0) {
    const featuresResponse = await fetch(
      `https://api.spotify.com/v1/audio-features?ids=${trackIds.join(',')}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (featuresResponse.ok) {
      const featuresData = await featuresResponse.json() as any;
      audioFeatures = featuresData.audio_features || [];
    }
  }

  return {
    ...(album as object),
    track_audio_features: audioFeatures
  };
}

async function getAvailableGenres(token: string) {
  const response = await fetch(
    'https://api.spotify.com/v1/recommendations/available-genre-seeds',
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get available genres: ${response.status}`);
  }

  const data = await response.json() as any;
  return data.genres || [];
}