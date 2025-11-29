/**
 * usePWAUpdate - Hook for detecting and managing PWA service worker updates
 *
 * iOS-specific considerations:
 * - iOS checks for SW updates BEFORE app starts, so we may miss `updatefound`
 * - Need to manually call registration.update() periodically
 * - Check for waiting SW on mount (may already be waiting from iOS pre-check)
 *
 * Strategy:
 * 1. Check for already-waiting SW on mount
 * 2. Listen for updatefound events
 * 3. Periodically check for updates (every 5 minutes when visible)
 * 4. Check on visibility change (when app comes to foreground)
 * 5. Provide applyUpdate() to trigger skipWaiting and reload
 */

import {useCallback, useEffect, useRef, useState} from 'react'

interface PWAUpdateState {
  /** Whether an update is available and waiting */
  updateAvailable: boolean
  /** Whether the service worker is currently checking for updates */
  checking: boolean
  /** The waiting service worker, if any */
  waitingWorker: ServiceWorker | null
  /** Error message if update check failed */
  error: string | null
}

interface UsePWAUpdateReturn extends PWAUpdateState {
  /** Manually check for updates */
  checkForUpdate: () => Promise<void>
  /** Apply the waiting update (reloads the page) */
  applyUpdate: () => void
  /** Dismiss the update notification (user chose to defer) */
  dismissUpdate: () => void
}

const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000 // 5 minutes

export function usePWAUpdate(): UsePWAUpdateReturn {
  const [state, setState] = useState<PWAUpdateState>({
    updateAvailable: false,
    checking: false,
    waitingWorker: null,
    error: null,
  })

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)
  const intervalRef = useRef<number | null>(null)
  const dismissedRef = useRef(false)

  // Check if there's already a waiting worker
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

  // Handle new service worker installation
  const handleUpdateFound = useCallback((registration: ServiceWorkerRegistration) => {
    const newWorker = registration.installing
    if (!newWorker) return

    console.log('[PWA] Update found, new worker installing...')

    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        // New worker installed and there's an existing controller = update available
        console.log('[PWA] New worker installed, update available')
        if (!dismissedRef.current) {
          setState(prev => ({
            ...prev,
            updateAvailable: true,
            waitingWorker: newWorker,
            checking: false,
          }))
        }
      }
    })
  }, [])

  // Manually trigger update check
  const checkForUpdate = useCallback(async () => {
    if (!registrationRef.current) {
      console.log('[PWA] No registration available for update check')
      return
    }

    setState(prev => ({...prev, checking: true, error: null}))

    try {
      console.log('[PWA] Checking for updates...')
      await registrationRef.current.update()
      // Check if there's now a waiting worker
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

  // Apply the update by telling SW to skip waiting, then reload
  const applyUpdate = useCallback(() => {
    const {waitingWorker} = state
    if (!waitingWorker) {
      console.warn('[PWA] No waiting worker to activate')
      return
    }

    console.log('[PWA] Applying update...')

    // Listen for controller change to know when new SW takes over
    const onControllerChange = () => {
      console.log('[PWA] Controller changed, reloading...')
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    // Tell the waiting worker to take over
    waitingWorker.postMessage({type: 'SKIP_WAITING'})
  }, [state])

  // Dismiss the update notification
  const dismissUpdate = useCallback(() => {
    dismissedRef.current = true
    setState(prev => ({
      ...prev,
      updateAvailable: false,
    }))
  }, [])

  // Initialize service worker registration and listeners
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      console.log('[PWA] Service workers not supported')
      return
    }

    let mounted = true

    const init = async () => {
      try {
        const registration = await navigator.serviceWorker.ready
        if (!mounted) return

        registrationRef.current = registration
        console.log('[PWA] Service worker ready, scope:', registration.scope)

        // Check for already waiting worker (iOS may have pre-checked)
        checkWaitingWorker(registration)

        // Listen for future updates
        registration.addEventListener('updatefound', () => {
          handleUpdateFound(registration)
        })

        // Initial update check
        await registration.update().catch(() => {
          // Silent fail for initial check
        })
        if (mounted) {
          checkWaitingWorker(registration)
        }
      } catch (err) {
        console.error('[PWA] Failed to get service worker registration:', err)
      }
    }

    init()

    return () => {
      mounted = false
    }
  }, [checkWaitingWorker, handleUpdateFound])

  // Periodic update checks when page is visible
  useEffect(() => {
    if (!registrationRef.current) return

    const startPeriodicCheck = () => {
      if (intervalRef.current) return

      intervalRef.current = window.setInterval(() => {
        if (document.visibilityState === 'visible' && !state.updateAvailable) {
          console.log('[PWA] Periodic update check')
          checkForUpdate()
        }
      }, UPDATE_CHECK_INTERVAL)
    }

    const stopPeriodicCheck = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    // Check on visibility change (when app comes to foreground)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[PWA] App became visible, checking for updates')
        checkForUpdate()
        startPeriodicCheck()
      } else {
        stopPeriodicCheck()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Start periodic checks if currently visible
    if (document.visibilityState === 'visible') {
      startPeriodicCheck()
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopPeriodicCheck()
    }
  }, [checkForUpdate, state.updateAvailable])

  return {
    ...state,
    checkForUpdate,
    applyUpdate,
    dismissUpdate,
  }
}
