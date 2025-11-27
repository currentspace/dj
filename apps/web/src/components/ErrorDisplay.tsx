import {memo} from 'react'

import '../styles/error-display.css'

export interface ErrorDisplayProps {
  error: null | string
  onDismiss?: () => void
  variant?: 'banner' | 'inline' | 'toast'
}

/**
 * Displays error messages to users with dismiss functionality.
 * Supports three variants:
 * - inline: For showing errors within a component context
 * - toast: Fixed position notification at bottom-right
 * - banner: Full-width banner at top of container
 */
export const ErrorDisplay = memo(function ErrorDisplay({
  error,
  onDismiss,
  variant = 'inline',
}: ErrorDisplayProps) {
  if (!error) return null

  const className = `error-display error-display--${variant}`

  return (
    <div aria-live="polite" className={className} role="alert">
      <div className="error-display__content">
        <span aria-hidden="true" className="error-display__icon">!</span>
        <span className="error-display__message">{error}</span>
      </div>
      {onDismiss && (
        <button
          aria-label="Dismiss error"
          className="error-display__dismiss"
          onClick={onDismiss}
          type="button"
        >
          <span aria-hidden="true">x</span>
        </button>
      )}
    </div>
  )
})
