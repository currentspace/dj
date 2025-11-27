/**
 * useVibeControls Hook
 * Manages vibe update operations with debouncing and preset mappings
 */

import {useCallback, useRef, useState} from 'react'
import type {MixSession, SteerVibeResponse, VibeProfile} from '@dj/shared-types'
import {TIMING} from '../constants'
import {mixApiClient} from '../lib/mix-api-client'

interface UseVibeControlsOptions {
  /** Current mix session */
  session: MixSession | null
  /** Called when vibe updates successfully */
  onVibeUpdate?: (vibe: VibeProfile) => void
}

interface UseVibeControlsReturn {
  // State
  error: null | string
  isUpdating: boolean

  // Actions
  clearError: () => void
  setBpmRange: (min: number, max: number) => Promise<void>
  setEnergyDirection: (direction: 'building' | 'steady' | 'winding_down') => Promise<void>
  setEnergyLevel: (level: number) => void // Debounced
  steerVibe: (direction: string, intensity?: number) => Promise<SteerVibeResponse | undefined>
}

/**
 * Hook to manage vibe controls
 *
 * Features:
 * - Debounced energy slider updates (300ms)
 * - Preset button mappings
 * - Natural language vibe steering
 * - Error handling
 */
export function useVibeControls(options: UseVibeControlsOptions): UseVibeControlsReturn {
  const {onVibeUpdate, session} = options

  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<null | string>(null)

  // Debounce timer for energy level
  const debounceTimer = useRef<NodeJS.Timeout | null>(null)

  // Clear error
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // Update energy level (debounced)
  const setEnergyLevel = useCallback(
    (level: number) => {
      if (!session) {
        setError('No active session')
        return
      }

      // Clear existing debounce timer
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }

      // Set new debounce timer
      debounceTimer.current = setTimeout(async () => {
        setIsUpdating(true)
        setError(null)

        try {
          const updatedVibe = await mixApiClient.updateVibe({energyLevel: level})
          onVibeUpdate?.(updatedVibe)
          setIsUpdating(false)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to update energy level')
          setIsUpdating(false)
        }
      }, TIMING.DEBOUNCE_MS)
    },
    [session, onVibeUpdate],
  )

  // Update energy direction
  const setEnergyDirection = useCallback(
    async (direction: 'building' | 'steady' | 'winding_down') => {
      if (!session) {
        setError('No active session')
        return
      }

      setIsUpdating(true)
      setError(null)

      try {
        const updatedVibe = await mixApiClient.updateVibe({energyDirection: direction})
        onVibeUpdate?.(updatedVibe)
        setIsUpdating(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update energy direction')
        setIsUpdating(false)
      }
    },
    [session, onVibeUpdate],
  )

  // Update BPM range
  const setBpmRange = useCallback(
    async (min: number, max: number) => {
      if (!session) {
        setError('No active session')
        return
      }

      setIsUpdating(true)
      setError(null)

      try {
        const updatedVibe = await mixApiClient.updateVibe({
          bpmRange: {max, min},
        })
        onVibeUpdate?.(updatedVibe)
        setIsUpdating(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update BPM range')
        setIsUpdating(false)
      }
    },
    [session, onVibeUpdate],
  )

  // Steer vibe with natural language
  const steerVibe = useCallback(
    async (direction: string, intensity?: number): Promise<SteerVibeResponse | undefined> => {
      if (!session) {
        setError('No active session')
        return undefined
      }

      setIsUpdating(true)
      setError(null)

      try {
        const response = await mixApiClient.steerVibe(direction, intensity)
        onVibeUpdate?.(response.vibe)
        setIsUpdating(false)
        return response
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to steer vibe')
        setIsUpdating(false)
        return undefined
      }
    },
    [session, onVibeUpdate],
  )

  return {
    // State
    error,
    isUpdating,

    // Actions
    clearError,
    setBpmRange,
    setEnergyDirection,
    setEnergyLevel,
    steerVibe,
  }
}
