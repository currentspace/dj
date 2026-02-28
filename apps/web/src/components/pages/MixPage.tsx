import type {SessionPreferences} from '@dj/shared-types'

import {useState} from 'react'

import {ErrorDisplay} from '../atoms/ErrorDisplay'
import {SteerProgress} from '../molecules/SteerProgress'
import {MixLayout} from '../templates/MixLayout'
import {useError} from '../../hooks/useError'
import {useMixSession} from '../../hooks/useMixSession'
import {mixApiClient} from '../../lib/mix-api-client'
import {useMixStore} from '../../stores'

interface MixPageProps {
  onBackToChat: () => void
  seedPlaylistId?: string
  /** Spotify access token for playback stream */
  token?: string | null
}

export function MixPage({onBackToChat, seedPlaylistId, token}: MixPageProps) {
  const [showStartDialog, setShowStartDialog] = useState(true)

  // Local error state for action-specific errors
  const {clearError: clearLocalError, error: localError, handleError} = useError()

  // Mix session from store
  const {
    clearError: clearSessionError,
    endSession,
    error: sessionError,
    isLoading: sessionLoading,
    removeFromQueue,
    reorderQueue,
    session,
    setSession,
    startSession,
  } = useMixSession()

  // Suggestions from store (atomic selectors)
  const suggestionsError = useMixStore((s) => s.suggestionsError)
  const suggestionsLoading = useMixStore((s) => s.suggestionsLoading)
  const refreshSuggestions = useMixStore((s) => s.refreshSuggestions)
  const clearSuggestionsError = useMixStore((s) => s.clearSuggestionsError)

  // Vibe controls from store (atomic selectors)
  const vibeError = useMixStore((s) => s.vibeError)
  const setEnergyLevel = useMixStore((s) => s.setEnergyLevel)
  const steerVibeStream = useMixStore((s) => s.steerVibeStream)
  const clearVibeError = useMixStore((s) => s.clearVibeError)

  // Steer progress state (atomic selectors)
  const steerInProgress = useMixStore((s) => s.steerInProgress)
  const steerDirection = useMixStore((s) => s.steerDirection)
  const steerEvents = useMixStore((s) => s.steerEvents)
  const clearSteerProgress = useMixStore((s) => s.clearSteerProgress)

  // Direct state sync: hide start dialog when existing session is detected
  if (session && showStartDialog) {
    setShowStartDialog(false)
  }

  const handleStartSession = async () => {
    const preferences: SessionPreferences = {
      autoFill: true,
      avoidGenres: [],
      bpmLock: null,
      favoriteArtists: [],
    }

    try {
      await startSession(preferences, seedPlaylistId)
      setShowStartDialog(false)
    } catch (err) {
      handleError(err, 'Failed to start session')
    }
  }

  const handleEndSession = async () => {
    try {
      await endSession()
      setShowStartDialog(true)
    } catch (err) {
      handleError(err, 'Failed to end session')
    }
  }

  // Handle track played event - when Spotify plays a new track
  const handleTrackPlayed = async (trackId: string, trackUri: string) => {
    try {
      console.log('[MixPage] Track played:', trackId)
      const response = await mixApiClient.notifyTrackPlayed(trackId, trackUri)
      if (response.movedToHistory) {
        console.log('[MixPage] Track moved to history, updating session from response')
        // Update session directly from the API response (no polling needed)
        setSession(response.session)
        // Refresh suggestions for the new track
        await refreshSuggestions()
      }
    } catch (err) {
      // Non-fatal error - just log
      console.warn('[MixPage] Failed to notify track played:', err)
    }
  }

  const handleSteerVibe = async (direction: string) => {
    try {
      // Use streaming steer for better UX with progress feedback
      await steerVibeStream(direction)
      // Refresh suggestions after vibe change (streaming already updates queue)
      await refreshSuggestions()
    } catch (err) {
      handleError(err, 'Failed to adjust vibe')
    }
  }

  // Check if steer is complete (has done or error event)
  const steerIsComplete = steerEvents.some((e) => e.type === 'done' || e.type === 'error')

  const handleEnergyChange = (level: number) => {
    // setEnergyLevel is already debounced and handles async internally
    setEnergyLevel(level)
    // Suggestions will auto-refresh via useSuggestions hook
  }

  // Clear all errors
  const clearAllErrors = () => {
    clearSessionError()
    clearSuggestionsError()
    clearVibeError()
    clearLocalError()
  }

  // Combine all error sources
  const combinedError = sessionError ?? suggestionsError ?? vibeError ?? localError

  // Show start dialog if no session
  if (!session || showStartDialog) {
    return (
      <div style={{margin: '0 auto', maxWidth: '500px', padding: '2rem', textAlign: 'center'}}>
        <h1>Live DJ Mode</h1>
        <p>
          Create a dynamic, AI-powered music mix with real-time vibe control and intelligent suggestions.
        </p>
        {combinedError && (
          <ErrorDisplay
            error={combinedError}
            onDismiss={clearAllErrors}
            variant="inline"
          />
        )}
        <div style={{marginTop: '2rem'}}>
          <button disabled={sessionLoading} onClick={handleStartSession} style={{fontSize: '1.2rem', padding: '1rem 2rem'}}>
            {sessionLoading ? 'Starting...' : 'Start Mix Session'}
          </button>
        </div>
        <div style={{marginTop: '1rem'}}>
          <button onClick={onBackToChat} style={{padding: '0.5rem 1rem'}}>
            Back to Chat
          </button>
        </div>
      </div>
    )
  }

  // Show mix interface
  return (
    <div>
      <div style={{background: '#f5f5f5', display: 'flex', justifyContent: 'space-between', padding: '1rem'}}>
        <h2>Live DJ Mode</h2>
        <div style={{display: 'flex', gap: '1rem'}}>
          <button disabled={sessionLoading} onClick={handleEndSession}>
            End Session
          </button>
          <button onClick={onBackToChat}>Back to Chat</button>
        </div>
      </div>

      <MixLayout
        onEnergyChange={handleEnergyChange}
        onRemoveFromQueue={removeFromQueue}
        onReorderQueue={reorderQueue}
        onSteerVibe={handleSteerVibe}
        onTrackPlayed={handleTrackPlayed}
        session={session}
        token={token}
      />

      {/* Show loading overlay */}
      {(sessionLoading || suggestionsLoading) && (
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.8)',
            borderRadius: '0.5rem',
            bottom: '1rem',
            color: 'white',
            padding: '1rem',
            position: 'fixed',
            right: '1rem',
          }}
        >
          Loading...
        </div>
      )}

      {/* Show error toast */}
      {combinedError && (
        <ErrorDisplay
          error={combinedError}
          onDismiss={clearAllErrors}
          variant="toast"
        />
      )}

      {/* Show steer progress modal */}
      {steerInProgress && steerDirection && (
        <SteerProgress
          direction={steerDirection}
          events={steerEvents}
          isComplete={steerIsComplete}
          onClose={clearSteerProgress}
        />
      )}
    </div>
  )
}
