/**
 * UpdateBanner - Shows when a new app version is available
 *
 * Non-intrusive banner at top of screen with options to:
 * - Update now (reloads with new version)
 * - Dismiss (update later, banner reappears on next session)
 */

import {memo} from 'react'

import {usePWAUpdate} from '../hooks/usePWAUpdate'

import '../styles/update-banner.css'

export const UpdateBanner = memo(function UpdateBanner() {
  const {updateAvailable, applyUpdate, dismissUpdate} = usePWAUpdate()

  if (!updateAvailable) {
    return null
  }

  return (
    <div className="update-banner" role="alert">
      <div className="update-banner__content">
        <span className="update-banner__icon">✨</span>
        <span className="update-banner__text">A new version is available</span>
      </div>
      <div className="update-banner__actions">
        <button
          className="update-banner__btn update-banner__btn--dismiss"
          onClick={dismissUpdate}
          type="button"
        >
          Later
        </button>
        <button
          className="update-banner__btn update-banner__btn--update"
          onClick={applyUpdate}
          type="button"
        >
          Update Now
        </button>
      </div>
    </div>
  )
})
