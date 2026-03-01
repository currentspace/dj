import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'

import {queryKeys} from './queryKeys'

interface SpotifyDevice {
  id: string
  is_active: boolean
  is_private_session: boolean
  is_restricted: boolean
  name: string
  type: string
  volume_percent: null | number
}

export function useDevicesQuery(token: null | string, enabled: boolean) {
  return useQuery({
    enabled: !!token && enabled,
    queryFn: async (): Promise<SpotifyDevice[]> => {
      const response = await fetch('/api/player/devices', {
        headers: {Authorization: `Bearer ${token}`},
      })

      if (!response.ok) throw new Error('Failed to fetch devices')
      const data = (await response.json()) as {devices: SpotifyDevice[]}
      return data.devices || []
    },
    queryKey: queryKeys.spotify.devices(token),
    staleTime: 0,
  })
}

export function useTransferPlaybackMutation(token: null | string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (deviceId: string) => {
      const response = await fetch('/api/player/device', {
        body: JSON.stringify({device_id: deviceId, play: true}),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      })

      if (!response.ok) throw new Error('Failed to transfer playback')
      return deviceId
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: queryKeys.spotify.devices(token)})
    },
  })
}
