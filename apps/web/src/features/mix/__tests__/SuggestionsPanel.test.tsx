import type {Suggestion} from '@dj/shared-types'

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {SuggestionsPanel} from '../SuggestionsPanel'

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({defaultOptions: {mutations: {retry: false}, queries: {retry: false}}})
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    artist: 'Artist',
    name: 'Track',
    trackId: 'spotify:track:abc',
    trackUri: 'spotify:track:abc',
    vibeScore: 85,
    ...overrides,
  } as Suggestion
}

describe('SuggestionsPanel', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: async () => ({success: true}),
        ok: true,
      } as Response),
    )
  })

  it('shows the loading state when isLoading is true', () => {
    renderWithQueryClient(<SuggestionsPanel isLoading suggestions={[]} />)
    expect(screen.getByText('Finding perfect tracks...')).toBeInTheDocument()
  })

  it('shows the empty state when not loading and no suggestions', () => {
    renderWithQueryClient(<SuggestionsPanel isLoading={false} suggestions={[]} />)
    expect(screen.getByText('Queue is full')).toBeInTheDocument()
  })

  it('renders one row per suggestion with vibe score', () => {
    const suggestions = [
      suggestion({name: 'Track A', trackId: 'a', vibeScore: 88}),
      suggestion({name: 'Track B', trackId: 'b', vibeScore: 72}),
    ]
    renderWithQueryClient(<SuggestionsPanel isLoading={false} suggestions={suggestions} />)
    expect(screen.getByText('Track A')).toBeInTheDocument()
    expect(screen.getByText('Track B')).toBeInTheDocument()
    expect(screen.getByText('88% match')).toBeInTheDocument()
    expect(screen.getByText('72% match')).toBeInTheDocument()
  })

  it('invokes the onRefresh callback when the refresh button is clicked', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    renderWithQueryClient(<SuggestionsPanel isLoading={false} onRefresh={onRefresh} suggestions={[]} />)
    await user.click(screen.getByTitle('Refresh suggestions'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('disables the refresh button while loading', () => {
    renderWithQueryClient(<SuggestionsPanel isLoading suggestions={[]} />)
    expect(screen.getByTitle('Refresh suggestions')).toBeDisabled()
  })

  it('optimistically removes a suggestion after add-to-queue succeeds', async () => {
    const user = userEvent.setup()
    const suggestions = [suggestion({name: 'Track A', trackId: 'a'}), suggestion({name: 'Track B', trackId: 'b'})]
    renderWithQueryClient(<SuggestionsPanel isLoading={false} suggestions={suggestions} />)
    expect(screen.getByText('Track A')).toBeInTheDocument()

    const addButtons = screen.getAllByTitle('Add to queue')
    await user.click(addButtons[0])

    await waitFor(() => {
      expect(screen.queryByText('Track A')).not.toBeInTheDocument()
    })
    // Track B should remain
    expect(screen.getByText('Track B')).toBeInTheDocument()
  })
})
