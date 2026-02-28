import type {Track} from '@dj/shared-types'

import {memo} from 'react'

interface TrackListProps {
  onError?: (message: string) => void
  tracks: Track[]
}

export const TrackList = memo(function TrackList({onError, tracks}: TrackListProps) {
  return (
    <div className="track-list">
      {tracks.map((track, index) => (
        <TrackItem key={track.id ?? index} number={index + 1} onError={onError} track={track} />
      ))}
    </div>
  )
})

interface TrackItemProps {
  number: number
  onError?: (message: string) => void
  track: Track
}

const TrackItem = memo(
  function TrackItem({number, onError, track}: TrackItemProps) {
    const handlePlayPreview = () => {
      playPreview(track.previewUrl!, onError)
    }

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
            onClick={handlePlayPreview}>
            Play
          </button>
        )}
        {track.externalUrl && (
          <a
            aria-label={`Open ${track.name} in Spotify`}
            className="spotify-link"
            href={track.externalUrl}
            rel="noopener noreferrer"
            target="_blank">
            Open
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

function playPreview(url: string, onError?: (message: string) => void) {
  const audio = new Audio(url)
  audio.volume = 0.5
  audio.play().catch((err) => {
    console.error('[TrackList] Failed to play preview:', err)
    onError?.('Unable to play track preview. Please try again.')
  })

  // Stop after 10 seconds
  setTimeout(() => audio.pause(), 10000)
}
