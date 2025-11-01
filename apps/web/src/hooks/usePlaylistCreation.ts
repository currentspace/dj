import { useState } from 'react';

import { useSpotifyAuth } from './useSpotifyAuth';

interface GeneratedPlaylist {
  description: string;
  name: string;
  tracks: {
    artist: string;
    name: string;
    spotifyUri?: string;
  }[];
}

interface SpotifyPlaylist {
  description: string;
  external_urls: {
    spotify: string;
  };
  id: string;
  name: string;
}

export function usePlaylistCreation() {
  const { token } = useSpotifyAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<null | string>(null);

  const createPlaylist = async (generatedPlaylist: GeneratedPlaylist): Promise<SpotifyPlaylist> => {
    if (!token) {
      throw new Error('No Spotify token available');
    }

    setIsCreating(true);
    setError(null);

    try {
      // Filter tracks that have Spotify URIs
      const trackUris = generatedPlaylist.tracks
        .filter(track => track.spotifyUri)
        .map(track => track.spotifyUri!);

      if (trackUris.length === 0) {
        throw new Error('No tracks found on Spotify to add to the playlist');
      }

      const response = await fetch('/api/spotify/playlists', {
        body: JSON.stringify({
          description: generatedPlaylist.description || 'AI-generated playlist created by DJ',
          name: generatedPlaylist.name,
          public: false,
          trackUris
        }),
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create playlist');
      }

      const playlist = await response.json();

      // Return the created playlist
      return {
        description: playlist.description || '',
        external_urls: playlist.external_urls,
        id: playlist.id,
        name: playlist.name
      };

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create playlist';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  const clearError = () => setError(null);

  return {
    clearError,
    createPlaylist,
    error,
    isCreating
  };
}