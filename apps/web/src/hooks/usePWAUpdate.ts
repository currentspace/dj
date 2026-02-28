/**
 * usePWAUpdate - Hook for detecting and managing PWA service worker updates
 *
 * Uses ref-based patterns instead of useEffect for React 19.2 compatibility.
 * Service worker registration and periodic checks are managed via refs.
 */

import {useCallback, useRef, useState} from 'react'

import {usePlaybackStore} from '../stores'

interface PWAUpdateState {
  checking: boolean
  error: null | string
  updateAvailable: boolean
  waitingForPlaybackStop: boolean
  waitingWorker: null | ServiceWorker
}

interface UsePWAUpdateReturn extends PWAUpdateState {
  applyUpdate: (force?: boolean) => void
  checkForUpdate: () => Promise<void>
  dismissUpdate: () => void
  isPlaybackActive: boolean
}

const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000 // 5 minutes

export function usePWAUpdate(): UsePWAUpdateReturn {
  const [state, setState] = useState<PWAUpdateState>({
    checking: false,
    error: null,
    updateAvailable: false,
    waitingForPlaybackStop: false,
    waitingWorker: null,
  })

  const isPlaying = usePlaybackStore((s) => s.playbackCore?.isPlaying ?? false)

  const registrationRef = useRef<null | ServiceWorkerRegistration>(null)
  const intervalRef = useRef<null | number>(null)
  const dismissedRef = useRef(false)
  const pendingUpdateRef = useRef(false)
  const initStartedRef = useRef(false)
  const visibilityHandlerRef = useRef<(() => void) | null>(null)

  const checkWaitingWorker = useCallback((registration: ServiceWorkerRegistration) => {
    if (registration.waiting && !dismissedRef.current) {
      console.log('[PWA] Found waiting service worker')
      setState(prev => ({
        ...prev,
        updateAvailable: true,
        waitingWorker: registration.waiting,
      }))
    }
  }, [])

  const handleUpdateFound = useCallback((registration: ServiceWorkerRegistration) => {
    const newWorker = registration.installing
    if (!newWorker) return

    console.log('[PWA] Update found, new worker installing...')

    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        console.log('[PWA] New worker installed, update available')
        if (!dismissedRef.current) {
          setState(prev => ({
            ...prev,
            checking: false,
            updateAvailable: true,
            waitingWorker: newWorker,
          }))
        }
      }
    })
  }, [])

  const checkForUpdate = useCallback(async () => {
    if (!registrationRef.current) return

    setState(prev => ({...prev, checking: true, error: null}))

    try {
      console.log('[PWA] Checking for updates...')
      await registrationRef.current.update()
      checkWaitingWorker(registrationRef.current)
      setState(prev => ({...prev, checking: false}))
    } catch (err) {
      console.error('[PWA] Update check failed:', err)
      setState(prev => ({
        ...prev,
        checking: false,
        error: err instanceof Error ? err.message : 'Update check failed',
      }))
    }
  }, [checkWaitingWorker])

  const performUpdate = useCallback((waitingWorker: ServiceWorker) => {
    console.log('[PWA] Performing update...')

    const onControllerChange = () => {
      console.log('[PWA] Controller changed, reloading...')
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    waitingWorker.postMessage({type: 'SKIP_WAITING'})
  }, [])

  const applyUpdate = useCallback((force = false) => {
    const {waitingWorker} = state
    if (!waitingWorker) {
      console.warn('[PWA] No waiting worker to activate')
      return
    }

    if (force) {
      console.log('[PWA] Force update requested')
      performUpdate(waitingWorker)
      return
    }

    const currentlyPlaying = usePlaybackStore.getState().playbackCore?.isPlaying ?? false

    if (currentlyPlaying) {
      console.log('[PWA] Music is playing, will update when playback stops')
      pendingUpdateRef.current = true
      setState(prev => ({...prev, waitingForPlaybackStop: true}))
    } else {
      console.log('[PWA] No playback active, updating now')
      performUpdate(waitingWorker)
    }
  }, [state, performUpdate])

  const dismissUpdate = useCallback(() => {
    dismissedRef.current = true
    setState(prev => ({
      ...prev,
      updateAvailable: false,
    }))
  }, [])

  // Initialize service worker registration (component body, no useEffect)
  if (!initStartedRef.current && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    initStartedRef.current = true

    navigator.serviceWorker.ready.then((registration) => {
      registrationRef.current = registration
      console.log('[PWA] Service worker ready, scope:', registration.scope)

      checkWaitingWorker(registration)

      registration.addEventListener('updatefound', () => {
        handleUpdateFound(registration)
      })

      registration.update().catch(() => {
        // Silent fail for initial check
      }).then(() => {
        checkWaitingWorker(registration)
      })

      // Start periodic update checks
      if (!intervalRef.current) {
        intervalRef.current = window.setInterval(() => {
          if (document.visibilityState === 'visible') {
            console.log('[PWA] Periodic update check')
            registration.update().catch(() => {}).then(() => {
              checkWaitingWorker(registration)
            })
          }
        }, UPDATE_CHECK_INTERVAL)
      }

      // Set up visibility change handler
      if (!visibilityHandlerRef.current) {
        visibilityHandlerRef.current = () => {
          if (document.visibilityState === 'visible') {
            console.log('[PWA] App became visible, checking for updates')
            registration.update().catch(() => {}).then(() => {
              checkWaitingWorker(registration)
            })
          }
        }
        document.addEventListener('visibilitychange', visibilityHandlerRef.current)
      }
    }).catch((err) => {
      console.error('[PWA] Failed to get service worker registration:', err)
    })
  }

  // Watch for playback to stop when we have a pending update (component body)
  if (pendingUpdateRef.current && state.waitingWorker && !isPlaying) {
    console.log('[PWA] Playback stopped, applying pending update')
    pendingUpdateRef.current = false
    setState(prev => ({...prev, waitingForPlaybackStop: false}))
    performUpdate(state.waitingWorker)
  }

  return {
    ...state,
    applyUpdate,
    checkForUpdate,
    dismissUpdate,
    isPlaybackActive: isPlaying,
  }
}
