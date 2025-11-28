/**
 * useVibeControls Hook - Zustand Store Wrapper
 *
 * Manages vibe update operations with debouncing and preset mappings.
 *
 * For new code, prefer using useMixStore directly with atomic selectors:
 *
 * @example
 * // New pattern (recommended)
 * import { useMixStore } from '../stores'
 * const vibeUpdating = useMixStore((s) => s.vibeUpdating)
 * const steerVibe = useMixStore((s) => s.steerVibe)
 * const setEnergyLevel = useMixStore((s) => s.setEnergyLevel)
 *
 * // Legacy pattern (this hook)
 * const { isUpdating, steerVibe, setEnergyLevel } = useVibeControls({ session })
 */

import type {MixSession, SteerVibeResponse, VibeProfile} from '@dj/shared-types'

import {useMixStore} from '../stores'

interface UseVibeControlsOptions {
  session: MixSession | null
  onVibeUpdate?: (vibe: VibeProfile) => void // Callback is now less useful - use store subscription instead
}

interface UseVibeControlsReturn {
  // State
  error: string | null
  isUpdating: boolean

  // Actions
  clearError: () => void
  setBpmRange: (min: number, max: number) => Promise<void>
  setEnergyDirection: (direction: 'building' | 'steady' | 'winding_down') => Promise<void>
  setEnergyLevel: (level: number) => void
  steerVibe: (direction: string, intensity?: number) => Promise<SteerVibeResponse | undefined>
}

export function useVibeControls(_options: UseVibeControlsOptions): UseVibeControlsReturn {
  // Note: session is passed for API compatibility but store already knows the session
  // onVibeUpdate callback is less useful now - use store subscription instead

  // Atomic selectors
  const isUpdating = useMixStore((s) => s.vibeUpdating)
  const error = useMixStore((s) => s.vibeError)

  // Actions
  const clearError = useMixStore((s) => s.clearVibeError)
  const setBpmRange = useMixStore((s) => s.setBpmRange)
  const setEnergyDirection = useMixStore((s) => s.setEnergyDirection)
  const setEnergyLevel = useMixStore((s) => s.setEnergyLevel)
  const steerVibe = useMixStore((s) => s.steerVibe)

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
