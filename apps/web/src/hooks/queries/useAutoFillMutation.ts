import {useMutation} from '@tanstack/react-query'

import {storage, STORAGE_KEYS} from '../useLocalStorage'

export function useAutoFillMutation(onToggle?: (enabled: boolean) => void) {
  return useMutation({
    mutationFn: async (newValue: boolean) => {
      const token = getToken()
      if (!token) throw new Error('No auth token')

      const response = await fetch('/api/mix/preferences', {
        body: JSON.stringify({autoFill: newValue}),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'PATCH',
      })

      if (!response.ok) {
        const error: unknown = await response.json().catch(() => ({error: 'Request failed'}))
        const msg = error && typeof error === 'object' && 'error' in error && typeof (error as Record<string, unknown>).error === 'string'
          ? (error as Record<string, unknown>).error as string
          : 'Failed to update preferences'
        throw new Error(msg)
      }

      return newValue
    },
    onSuccess: (newValue) => {
      onToggle?.(newValue)
    },
  })
}

function getToken(): null | string {
  const tokenData = storage.get<null | {expiresAt: null | number; token: string}>(
    STORAGE_KEYS.SPOTIFY_TOKEN_DATA,
    null,
  )
  return tokenData?.token ?? null
}
