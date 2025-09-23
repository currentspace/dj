import { useState } from 'react';
import { useSpotifyAuth } from './useSpotifyAuth';

interface GeneratedPlaylist {
  name: string;
  description: string;
  tracks: Array<{
    name: string;
    artist: string;
    spotifyUri?: string;
  }>;
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  external_urls: {
    spotify: string;
  };
}

export function usePlaylistCreation() {
  const { token } = useSpotifyAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        .map(track => track.spotifyUri as string);

      if (trackUris.length === 0) {
        throw new Error('No tracks found on Spotify to add to the playlist');
      }

      const response = await fetch('/api/spotify/playlists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: generatedPlaylist.name,
          description: generatedPlaylist.description || 'AI-generated playlist created by DJ',
          public: false,
          trackUris
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create playlist');
      }

      const playlist = await response.json();

      // Return the created playlist
      return {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description || '',
        external_urls: playlist.external_urls
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
    createPlaylist,
    isCreating,
    error,
    clearError
  };
}