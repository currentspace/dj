import { memo } from 'react';
import type { Track } from '@dj/shared-types';

interface TrackListProps {
  tracks: Track[];
}

export const TrackList = memo(function TrackList({ tracks }: TrackListProps) {
  return (
    <div className="track-list">
      {tracks.map((track, index) => (
        <TrackItem key={track.id || index} track={track} number={index + 1} />
      ))}
    </div>
  );
});

interface TrackItemProps {
  track: Track;
  number: number;
}

const TrackItem = memo(function TrackItem({ track, number }: TrackItemProps) {
  return (
    <div className="track-item">
      <span className="track-number">{number}</span>
      <div className="track-info">
        <div className="track-name">{track.name}</div>
        <div className="track-artist">{track.artist}</div>
      </div>
      {track.previewUrl && (
        <button
          className="preview-button"
          onClick={() => playPreview(track.previewUrl!)}
          aria-label={`Play preview of ${track.name}`}
        >
          ▶️
        </button>
      )}
      {track.externalUrl && (
        <a
          href={track.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="spotify-link"
          aria-label={`Open ${track.name} in Spotify`}
        >
          🔗
        </a>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render if track ID or preview URL changes
  return (
    prevProps.track.id === nextProps.track.id &&
    prevProps.track.previewUrl === nextProps.track.previewUrl &&
    prevProps.number === nextProps.number
  );
});

function playPreview(url: string) {
  const audio = new Audio(url);
  audio.volume = 0.5;
  audio.play().catch(console.error);

  // Stop after 10 seconds
  setTimeout(() => audio.pause(), 10000);
}