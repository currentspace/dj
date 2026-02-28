/**
 * LoadingSpinner - Reusable loading indicator
 *
 * Sizes:
 * - sm: 20px (inline/button loading)
 * - md: 40px (card/section loading)
 * - lg: 60px (page/full loading)
 */

import {memo} from 'react'

interface LoadingSpinnerProps {
  className?: string
  size?: 'lg' | 'md' | 'sm'
  text?: string
}

const sizeClasses = {
  lg: 'size-[60px] border-4',
  md: 'size-10 border-3',
  sm: 'size-5 border-2',
}

const textClasses = {
  lg: 'text-base',
  md: 'text-sm',
  sm: 'text-xs',
}

export const LoadingSpinner = memo(function LoadingSpinner({
  className = '',
  size = 'md',
  text,
}: LoadingSpinnerProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div className={`${sizeClasses[size]} border-surface-4 border-t-spotify-green rounded-full animate-spin`} />
      {text && <span className={`text-text-secondary ${textClasses[size]}`}>{text}</span>}
    </div>
  )
})
