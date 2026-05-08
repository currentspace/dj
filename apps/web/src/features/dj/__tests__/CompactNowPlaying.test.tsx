import {render, screen} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'

import {CompactNowPlaying} from '../CompactNowPlaying'

// Avoid pulling in the full PlaybackControls (and player API client) for these
// presentation-focused tests.
vi.mock('../../playback/PlaybackControls', () => ({
  PlaybackControls: () => <div data-testid="playback-controls" />,
}))

vi.mock('../../../stores', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../stores')
  return {
    ...actual,
    useDevice: () => null,
  }
})

describe('CompactNowPlaying', () => {
  it('shows the empty state when there is no playback', () => {
    render(<CompactNowPlaying playback={null} />)
    expect(screen.getByText('No track playing')).toBeInTheDocument()
    expect(screen.getByText('Start playing on Spotify')).toBeInTheDocument()
  })

  it('shows the empty state when playback has no trackId', () => {
    render(
      <CompactNowPlaying
        playback={{
          albumArt: null,
          artistName: '',
          deviceId: null,
          deviceName: '',
          duration: 0,
          isPlaying: false,
          progress: 0,
          timestamp: 0,
          trackId: null,
          trackName: '',
          trackUri: null,
        }}
      />,
    )
    expect(screen.getByText('No track playing')).toBeInTheDocument()
  })

  it('shows track name and artist when a track is playing', () => {
    render(
      <CompactNowPlaying
        playback={{
          albumArt: null,
          artistName: 'Daft Punk',
          deviceId: 'd1',
          deviceName: 'Phone',
          duration: 240000,
          isPlaying: true,
          progress: 60000,
          timestamp: Date.now(),
          trackId: 't1',
          trackName: 'One More Time',
          trackUri: 'spotify:track:t1',
        }}
      />,
    )
    expect(screen.getByText('One More Time')).toBeInTheDocument()
    expect(screen.getByText('Daft Punk')).toBeInTheDocument()
  })

  it('formats progress and duration as M:SS', () => {
    render(
      <CompactNowPlaying
        playback={{
          albumArt: null,
          artistName: 'A',
          deviceId: null,
          deviceName: '',
          duration: 65000, // 1:05
          isPlaying: false,
          progress: 9000, // 0:09
          timestamp: 0,
          trackId: 't',
          trackName: 'X',
          trackUri: 'spotify:track:t',
        }}
      />,
    )
    expect(screen.getByText('0:09')).toBeInTheDocument()
    expect(screen.getByText('1:05')).toBeInTheDocument()
  })

  it('renders album art when provided', () => {
    render(
      <CompactNowPlaying
        playback={{
          albumArt: 'https://example.com/art.jpg',
          artistName: 'A',
          deviceId: null,
          deviceName: '',
          duration: 1000,
          isPlaying: false,
          progress: 0,
          timestamp: 0,
          trackId: 't',
          trackName: 'X',
          trackUri: 'spotify:track:t',
        }}
      />,
    )
    expect(screen.getByAltText('Album art')).toHaveAttribute('src', 'https://example.com/art.jpg')
  })
})
