import {useCallback, useState} from 'react'

export interface UseErrorReturn {
  clearError: () => void
  error: null | string
  handleError: (err: unknown, context?: string) => void
  setError: (error: null | string) => void
}

/**
 * Hook for managing error state with user-friendly messages.
 * Provides utilities for setting, clearing, and handling errors.
 */
export function useError(): UseErrorReturn {
  const [error, setError] = useState<null | string>(null)

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const handleError = useCallback((err: unknown, context?: string) => {
    let message: string

    if (err instanceof Error) {
      // Make error messages more user-friendly
      message = formatErrorMessage(err.message)
    } else if (typeof err === 'string') {
      message = formatErrorMessage(err)
    } else {
      message = 'An unexpected error occurred'
    }

    const fullMessage = context ? `${context}: ${message}` : message
    setError(fullMessage)

    // Keep console logging for debugging purposes
    console.error(`[Error${context ? ` - ${context}` : ''}]`, err)
  }, [])

  return {clearError, error, handleError, setError}
}

/**
 * Convert technical error messages into user-friendly versions.
 */
function formatErrorMessage(message: string): string {
  // Network errors
  if (message.includes('fetch') || message.includes('network') || message.includes('Network')) {
    return 'Unable to connect to the server. Please check your internet connection.'
  }

  // Authentication errors
  if (message.includes('401') || message.includes('unauthorized') || message.includes('Unauthorized')) {
    return 'Your session has expired. Please log in again.'
  }

  // Rate limiting
  if (message.includes('429') || message.includes('rate limit') || message.includes('Too Many')) {
    return 'Too many requests. Please wait a moment and try again.'
  }

  // Server errors
  if (message.includes('500') || message.includes('Internal Server')) {
    return 'Something went wrong on our end. Please try again later.'
  }

  // Timeout errors
  if (message.includes('timeout') || message.includes('Timeout')) {
    return 'The request took too long. Please try again.'
  }

  // Stream/connection errors
  if (message.includes('stream') || message.includes('Stream')) {
    return 'The connection was interrupted. Please try again.'
  }

  // Return original if no transformation needed
  // but ensure it's not too technical
  if (message.length > 150) {
    return message.slice(0, 147) + '...'
  }

  return message
}
