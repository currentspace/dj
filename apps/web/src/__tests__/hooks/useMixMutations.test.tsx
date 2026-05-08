import type {MixSession} from '@dj/shared-types'
import type {ReactNode} from 'react'

import {QueryClient, QueryClientProvider, useQueryClient} from '@tanstack/react-query'
import {act, renderHook, waitFor} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {queryKeys} from '../../hooks/queries/queryKeys'
import {useAddToQueueMutation} from '../../hooks/queries/useMixMutations'

vi.mock('../../lib/mix-api-client', () => ({
  mixApiClient: {
    addToQueue: vi.fn(),
    removeFromQueue: vi.fn(),
  },
}))

import {mixApiClient} from '../../lib/mix-api-client'

function makeSession(overrides: Partial<MixSession> = {}): MixSession {
  return {
    queue: [],
    ...overrides,
  } as MixSession
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {mutations: {retry: false}, queries: {retry: false}},
  })
  function Wrapper({children}: {children: ReactNode}) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return {client, Wrapper}
}

describe('useAddToQueueMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends an optimistic track to the session queue immediately on mutate', async () => {
    const {client, Wrapper} = makeWrapper()
    const initial = makeSession({queue: []})
    client.setQueryData(queryKeys.mix.session(), initial)

    vi.mocked(mixApiClient.addToQueue).mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves so we can observe optimistic state */
        }),
    )

    const {result} = renderHook(
      () => {
        const mutation = useAddToQueueMutation()
        const qc = useQueryClient()
        return {mutation, qc}
      },
      {wrapper: Wrapper},
    )

    act(() => {
      result.current.mutation.mutate({trackUri: 'spotify:track:abc'})
    })

    await waitFor(() => {
      const session = result.current.qc.getQueryData<MixSession>(queryKeys.mix.session())
      expect(session?.queue).toHaveLength(1)
      expect(session?.queue[0].trackUri).toBe('spotify:track:abc')
      expect(session?.queue[0].addedBy).toBe('user')
    })
  })

  it('rolls back the optimistic update when the request fails', async () => {
    const {client, Wrapper} = makeWrapper()
    const initial = makeSession({queue: []})
    client.setQueryData(queryKeys.mix.session(), initial)

    vi.mocked(mixApiClient.addToQueue).mockRejectedValue(new Error('boom'))

    const {result} = renderHook(
      () => {
        const mutation = useAddToQueueMutation()
        const qc = useQueryClient()
        return {mutation, qc}
      },
      {wrapper: Wrapper},
    )

    await act(async () => {
      await result.current.mutation.mutateAsync({trackUri: 'spotify:track:abc'}).catch(() => null)
    })

    const session = result.current.qc.getQueryData<MixSession>(queryKeys.mix.session())
    expect(session?.queue).toHaveLength(0)
  })

  it('replaces the optimistic queue with the server response on success', async () => {
    const {client, Wrapper} = makeWrapper()
    const initial = makeSession({queue: []})
    client.setQueryData(queryKeys.mix.session(), initial)

    const serverQueue = [
      {
        addedBy: 'user',
        artist: 'A',
        name: 'Real',
        position: 0,
        trackId: 'x',
        trackUri: 'spotify:track:x',
        vibeScore: 0,
      },
    ]
    vi.mocked(mixApiClient.addToQueue).mockResolvedValue(serverQueue as never)

    const {result} = renderHook(
      () => {
        const mutation = useAddToQueueMutation()
        const qc = useQueryClient()
        return {mutation, qc}
      },
      {wrapper: Wrapper},
    )

    await act(async () => {
      await result.current.mutation.mutateAsync({trackUri: 'spotify:track:abc'})
    })

    const session = result.current.qc.getQueryData<MixSession>(queryKeys.mix.session())
    expect(session?.queue).toEqual(serverQueue)
  })
})
