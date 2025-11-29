/**
 * LoadingSpinner - Reusable loading indicator
 *
 * Sizes:
 * - sm: 20px (inline/button loading)
 * - md: 40px (card/section loading)
 * - lg: 60px (page/full loading)
 */

import {memo} from 'react'
import './LoadingSpinner.css'

interface LoadingSpinnerProps {
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Optional loading text */
  text?: string
  /** Additional CSS class */
  className?: string
}

export const LoadingSpinner = memo(function LoadingSpinner({
  size = 'md',
  text,
  className = '',
}: LoadingSpinnerProps) {
  return (
    <div className={`loading-spinner loading-spinner--${size} ${className}`}>
      <div className="loading-spinner__ring" />
      {text && <span className="loading-spinner__text">{text}</span>}
    </div>
  )
})
