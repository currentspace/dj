import type {QueuedTrack} from '@dj/shared-types'

import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {describe, expect, it, vi} from 'vitest'

import {QueuePanel} from '../QueuePanel'

function track(overrides: Partial<QueuedTrack> = {}): QueuedTrack {
  return {
    addedBy: 'ai',
    artist: 'Artist',
    name: 'Track',
    position: 0,
    trackId: 'spotify:track:abc',
    trackUri: 'spotify:track:abc',
    vibeScore: 80,
    ...overrides,
  }
}

describe('QueuePanel', () => {
  it('renders the empty state when the queue is empty', () => {
    render(<QueuePanel onRemove={vi.fn()} onReorder={vi.fn()} queue={[]} />)
    expect(screen.getByText('Queue is empty')).toBeInTheDocument()
    expect(screen.getByText('0 tracks')).toBeInTheDocument()
  })

  it('renders one row per track with name and artist', () => {
    const queue = [
      track({artist: 'Artist A', name: 'Track A', position: 0, trackId: 'a'}),
      track({artist: 'Artist B', name: 'Track B', position: 1, trackId: 'b'}),
    ]
    render(<QueuePanel onRemove={vi.fn()} onReorder={vi.fn()} queue={queue} />)
    expect(screen.getByText('Track A')).toBeInTheDocument()
    expect(screen.getByText('Track B')).toBeInTheDocument()
    expect(screen.getByText('Artist A')).toBeInTheDocument()
    expect(screen.getByText('Artist B')).toBeInTheDocument()
    expect(screen.getByText('2 tracks')).toBeInTheDocument()
  })

  it('shows AI badge for AI-added tracks and User badge for user-added tracks', () => {
    const queue = [
      track({addedBy: 'ai', position: 0, trackId: 'a'}),
      track({addedBy: 'user', position: 1, trackId: 'b'}),
    ]
    render(<QueuePanel onRemove={vi.fn()} onReorder={vi.fn()} queue={queue} />)
    expect(screen.getByText('AI')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('invokes onRemove with the track position when the remove button is clicked', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const queue = [track({position: 7, trackId: 'a'})]
    render(<QueuePanel onRemove={onRemove} onReorder={vi.fn()} queue={queue} />)
    await user.click(screen.getByTitle('Remove from queue'))
    expect(onRemove).toHaveBeenCalledWith(7)
  })

  it('invokes onReorder(index, index-1) when "Move up" is clicked', async () => {
    const user = userEvent.setup()
    const onReorder = vi.fn()
    const queue = [track({position: 0, trackId: 'a'}), track({position: 1, trackId: 'b'})]
    render(<QueuePanel onRemove={vi.fn()} onReorder={onReorder} queue={queue} />)
    const upButtons = screen.getAllByTitle('Move up')
    await user.click(upButtons[1]) // second row
    expect(onReorder).toHaveBeenCalledWith(1, 0)
  })

  it('disables "Move up" on the first row and "Move down" on the last row', () => {
    const queue = [track({position: 0, trackId: 'a'}), track({position: 1, trackId: 'b'})]
    render(<QueuePanel onRemove={vi.fn()} onReorder={vi.fn()} queue={queue} />)
    const upButtons = screen.getAllByTitle('Move up')
    const downButtons = screen.getAllByTitle('Move down')
    expect(upButtons[0]).toBeDisabled()
    expect(downButtons[downButtons.length - 1]).toBeDisabled()
  })

  it('shows a searching indicator when isSearching is true', () => {
    render(<QueuePanel isSearching onRemove={vi.fn()} onReorder={vi.fn()} queue={[]} />)
    expect(screen.getByText('Finding more tracks...')).toBeInTheDocument()
  })

  it('renders BPM badge when bpm is provided', () => {
    const queue = [track({position: 0, trackId: 'a'}) as QueuedTrack & {bpm?: number}]
    queue[0].bpm = 128.4
    render(<QueuePanel onRemove={vi.fn()} onReorder={vi.fn()} queue={queue} />)
    expect(screen.getByText('128 BPM')).toBeInTheDocument()
  })
})
