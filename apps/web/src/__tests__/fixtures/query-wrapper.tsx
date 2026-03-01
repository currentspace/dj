import type {ReactNode} from 'react'

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  })
}

export function createTestWrapper() {
  const queryClient = createTestQueryClient()

  function Wrapper({children}: {children: ReactNode}) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }

  return {queryClient, Wrapper}
}
