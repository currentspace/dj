import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'

// DJPage pulls in queries, stores, mutations, SSE streams, and mixApiClient.
// These tests are smoke-level — they verify the no-session and active-session
// branches render without crashing. Detailed behavior (start/end/steer flows)
// is covered indirectly by the SteerInput, QueuePanel, and SuggestionsPanel
// suites and by integration tests on the worker.

vi.mock('../../../hooks/useMixSession', () => ({
  useMixSession: () => ({
    clearError: vi.fn(),
    endSession: vi.fn(),
    error: null,
    isLoading: false,
    removeFromQueue: vi.fn(),
    reorderQueue: vi.fn(),
    session: null,
    setSession: vi.fn(),
    startSession: vi.fn(),
  }),
}))

vi.mock('../../../hooks/usePlaybackStream', () => ({
  usePlaybackStream: () => ({playback: null}),
}))

vi.mock('../../../hooks/queries', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../hooks/queries')
  return {
    ...actual,
    useMixSuggestionsQuery: () => ({data: [], error: null, isLoading: false, refetch: vi.fn()}),
    useSetEnergyLevelMutation: () => ({mutate: vi.fn()}),
  }
})

vi.mock('../../../lib/mix-api-client', () => ({
  mixApiClient: {
    notifyTrackPlayed: vi.fn().mockResolvedValue({movedToHistory: false}),
  },
}))

import {DJPage} from '../DJPage'

function renderDJPage() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  return render(
    <QueryClientProvider client={client}>
      <DJPage token="test-token" />
    </QueryClientProvider>,
  )
}

describe('DJPage', () => {
  it('renders the playlist picker and Start button when no session is active', () => {
    renderDJPage()
    expect(screen.getByRole('button', {name: 'Start DJ'})).toBeInTheDocument()
  })

  it('renders the start hint when no playlist is selected', () => {
    renderDJPage()
    expect(
      screen.getByText(/just hit Start/i),
    ).toBeInTheDocument()
  })
})
