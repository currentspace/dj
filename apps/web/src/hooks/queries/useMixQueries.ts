import type {MixSession, Suggestion} from '@dj/shared-types'

import {useQuery} from '@tanstack/react-query'

import {mixApiClient} from '../../lib/mix-api-client'
import {queryKeys} from './queryKeys'

export function useMixSessionQuery() {
  return useQuery({
    queryFn: async (): Promise<MixSession | null> => {
      try {
        return await mixApiClient.getCurrentSession()
      } catch {
        // "No session" is the normal default state
        return null
      }
    },
    queryKey: queryKeys.mix.session(),
    staleTime: 30_000,
  })
}

export function useMixSuggestionsQuery(hasSession: boolean) {
  return useQuery({
    enabled: hasSession,
    queryFn: async (): Promise<Suggestion[]> => {
      return mixApiClient.getSuggestions()
    },
    queryKey: queryKeys.mix.suggestions(),
    staleTime: 30_000,
  })
}
