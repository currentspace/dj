import type { Playlist } from '@dj/shared-types';

import { apiClient } from '@dj/api-client';
import { Suspense, useActionState, useOptimistic } from 'react';

import { PlaylistSkeleton } from './PlaylistSkeleton';
import { TrackList } from './TrackList';

export function PlaylistGenerator() {
  const [state, formAction, isPending] = useActionState(
    generatePlaylistAction,
    { error: null, playlist: null }
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
            className="prompt-input"
            disabled={isPending}
            id="prompt"
            name="prompt"
            placeholder="e.g., Upbeat songs for a morning workout, or Chill jazz for studying..."
            rows={4}
          />
        </div>

        <button
          className="generate-button"
          disabled={isPending}
          type="submit"
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
                className="save-button"
                disabled={optimisticPlaylist.spotifyId === 'saving...'}
                onClick={handleSaveToSpotify}
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

// Server action for generating playlist
async function generatePlaylistAction(
  _prevState: { error: null | string; playlist: null | Playlist; },
  formData: FormData
): Promise<{ error: null | string; playlist: null | Playlist; }> {
  const promptValue = formData.get('prompt');

  if (typeof promptValue !== 'string' || !promptValue.trim()) {
    return { error: 'Please enter a description', playlist: null };
  }

  const prompt = promptValue;

  try {
    const response = await apiClient.generatePlaylist(prompt);
    return { error: null, playlist: response.playlist };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Failed to generate playlist',
      playlist: null
    };
  }
}