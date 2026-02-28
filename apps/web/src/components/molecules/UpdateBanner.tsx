/**
 * UpdateBanner - Shows when a new app version is available
 *
 * Non-intrusive banner at top of screen with options to:
 * - Update now (reloads with new version)
 * - Dismiss (update later, banner reappears on next session)
 *
 * Playback-aware: If music is playing, shows a different message and
 * waits for playback to stop before reloading. User can force update
 * by holding the button or clicking again.
 */

import {memo, useCallback, useState} from 'react'

import {usePWAUpdate} from '../../hooks/usePWAUpdate'

import '../../styles/update-banner.css'

export const UpdateBanner = memo(function UpdateBanner() {
  const {updateAvailable, waitingForPlaybackStop, isPlaybackActive, applyUpdate, dismissUpdate} = usePWAUpdate()
  const [showForceOption, setShowForceOption] = useState(false)

  const handleUpdateClick = useCallback(() => {
    if (waitingForPlaybackStop) {
      // If already waiting, offer force option
      setShowForceOption(true)
    } else {
      applyUpdate()
    }
  }, [waitingForPlaybackStop, applyUpdate])

  const handleForceUpdate = useCallback(() => {
    applyUpdate(true) // Force update regardless of playback
  }, [applyUpdate])

  if (!updateAvailable) {
    return null
  }

  // Determine banner state and text
  const bannerText = waitingForPlaybackStop
    ? 'Update ready - will apply when music stops'
    : 'A new version is available'

  const updateButtonText = waitingForPlaybackStop
    ? 'Waiting...'
    : isPlaybackActive
      ? 'Update (will wait)'
      : 'Update Now'

  return (
    <div className={`update-banner ${waitingForPlaybackStop ? 'update-banner--waiting' : ''}`} role="alert">
      <div className="update-banner__content">
        <span className="update-banner__icon">{waitingForPlaybackStop ? '⏳' : '✨'}</span>
        <span className="update-banner__text">{bannerText}</span>
      </div>
      <div className="update-banner__actions">
        {showForceOption && waitingForPlaybackStop ? (
          <>
            <button
              className="update-banner__btn update-banner__btn--dismiss"
              onClick={() => setShowForceOption(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="update-banner__btn update-banner__btn--force"
              onClick={handleForceUpdate}
              type="button"
            >
              Update Now (stops music)
            </button>
          </>
        ) : (
          <>
            <button
              className="update-banner__btn update-banner__btn--dismiss"
              onClick={dismissUpdate}
              type="button"
            >
              Later
            </button>
            <button
              className={`update-banner__btn update-banner__btn--update ${waitingForPlaybackStop ? 'update-banner__btn--waiting' : ''}`}
              onClick={handleUpdateClick}
              type="button"
            >
              {updateButtonText}
            </button>
          </>
        )}
      </div>
    </div>
  )
})
