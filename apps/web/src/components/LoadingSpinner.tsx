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
  size?: 'sm' | 'md' | 'lg'
  text?: string
  className?: string
}

const sizeClasses = {
  sm: 'size-5 border-2',
  md: 'size-10 border-3',
  lg: 'size-[60px] border-4',
}

const textClasses = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
}

export const LoadingSpinner = memo(function LoadingSpinner({
  size = 'md',
  text,
  className = '',
}: LoadingSpinnerProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div className={`${sizeClasses[size]} border-surface-4 border-t-spotify-green rounded-full animate-spin`} />
      {text && <span className={`text-text-secondary ${textClasses[size]}`}>{text}</span>}
    </div>
  )
})
