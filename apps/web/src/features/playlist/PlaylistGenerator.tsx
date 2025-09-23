import { useState, useActionState, useOptimistic, Suspense } from 'react';
import { apiClient } from '@dj/api-client';
import type { Playlist, Track } from '@dj/shared-types';
import { PlaylistSkeleton } from './PlaylistSkeleton';
import { TrackList } from './TrackList';

// Server action for generating playlist
async function generatePlaylistAction(
  prevState: { playlist: Playlist | null; error: string | null },
  formData: FormData
): Promise<{ playlist: Playlist | null; error: string | null }> {
  const prompt = formData.get('prompt') as string;

  if (!prompt?.trim()) {
    return { playlist: null, error: 'Please enter a description' };
  }

  try {
    const response = await apiClient.generatePlaylist(prompt);
    return { playlist: response.playlist, error: null };
  } catch (error) {
    return {
      playlist: null,
      error: error instanceof Error ? error.message : 'Failed to generate playlist'
    };
  }
}

export function PlaylistGenerator() {
  const [state, formAction, isPending] = useActionState(
    generatePlaylistAction,
    { playlist: null, error: null }
  );

  const [optimisticPlaylist, setOptimisticPlaylist] = useOptimistic(
    state.playlist,
    (_, newPlaylist: Playlist) => newPlaylist
  );

  const handleSaveToSpotify = async () => {
    if (!state.playlist) return;

    try {
      setOptimisticPlaylist({
        ...state.playlist,
        spotifyId: 'saving...'
      });

      const result = await apiClient.savePlaylistToSpotify(state.playlist);

      if (result.success && result.playlistUrl) {
        window.open(result.playlistUrl, '_blank');
      }
    } catch (error) {
      console.error('Failed to save playlist:', error);
    }
  };

  return (
    <div className="playlist-generator">
      <form action={formAction} className="playlist-form">
        <div className="form-group">
          <label htmlFor="prompt">
            <h2>Describe your perfect playlist</h2>
            <p>Tell me what kind of music you're in the mood for...</p>
          </label>
          <textarea
            id="prompt"
            name="prompt"
            placeholder="e.g., Upbeat songs for a morning workout, or Chill jazz for studying..."
            rows={4}
            disabled={isPending}
            className="prompt-input"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="generate-button"
        >
          {isPending ? 'Generating...' : 'Generate Playlist'}
        </button>
      </form>

      {state.error && (
        <div className="error-message" role="alert">
          <p>⚠️ {state.error}</p>
        </div>
      )}

      {isPending && <PlaylistSkeleton />}

      {optimisticPlaylist && !isPending && (
        <Suspense fallback={<PlaylistSkeleton />}>
          <div className="playlist-result">
            <header className="playlist-header">
              <h3>{optimisticPlaylist.name}</h3>
              <p>{optimisticPlaylist.description}</p>
            </header>

            <TrackList tracks={optimisticPlaylist.tracks} />

            <footer className="playlist-actions">
              <button
                onClick={handleSaveToSpotify}
                className="save-button"
                disabled={optimisticPlaylist.spotifyId === 'saving...'}
              >
                {optimisticPlaylist.spotifyId === 'saving...'
                  ? 'Saving...'
                  : 'Save to Spotify'}
              </button>
            </footer>
          </div>
        </Suspense>
      )}
    </div>
  );
}