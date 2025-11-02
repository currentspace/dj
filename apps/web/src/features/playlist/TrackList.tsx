import type { Track } from '@dj/shared-types'

import { memo } from 'react'

interface TrackListProps {
  tracks: Track[]
}

export const TrackList = memo(function TrackList({ tracks }: TrackListProps) {
  return (
    <div className="track-list">
      {tracks.map((track, index) => (
        <TrackItem key={track.id ?? index} number={index + 1} track={track} />
      ))}
    </div>
  )
})

interface TrackItemProps {
  number: number
  track: Track
}

const TrackItem = memo(
  function TrackItem({ number, track }: TrackItemProps) {
    return (
      <div className="track-item">
        <span className="track-number">{number}</span>
        <div className="track-info">
          <div className="track-name">{track.name}</div>
          <div className="track-artist">{track.artist}</div>
        </div>
        {track.previewUrl && (
          <button
            aria-label={`Play preview of ${track.name}`}
            className="preview-button"
            onClick={() => playPreview(track.previewUrl!)}
          >
            ▶️
          </button>
        )}
        {track.externalUrl && (
          <a
            aria-label={`Open ${track.name} in Spotify`}
            className="spotify-link"
            href={track.externalUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            🔗
          </a>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Only re-render if track ID or preview URL changes
    return (
      prevProps.track.id === nextProps.track.id &&
      prevProps.track.previewUrl === nextProps.track.previewUrl &&
      prevProps.number === nextProps.number
    )
  },
)

function playPreview(url: string) {
  const audio = new Audio(url)
  audio.volume = 0.5
  audio.play().catch(console.error)

  // Stop after 10 seconds
  setTimeout(() => audio.pause(), 10000)
}
