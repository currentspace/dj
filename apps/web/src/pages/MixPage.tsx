import type {SessionPreferences} from '@dj/shared-types'

import {useState} from 'react'

import {ErrorDisplay} from '../components/ErrorDisplay'
import {MixInterface} from '../features/mix'
import {useError} from '../hooks/useError'
import {useMixSession} from '../hooks/useMixSession'
import {useSuggestions} from '../hooks/useSuggestions'
import {useVibeControls} from '../hooks/useVibeControls'
import {mixApiClient} from '../lib/mix-api-client'

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

  // Mix session hook
  const {
    addToQueue,
    clearError: clearSessionError,
    endSession,
    error: sessionError,
    isLoading: sessionLoading,
    removeFromQueue,
    reorderQueue,
    session,
    startSession,
  } = useMixSession()

  // Suggestions hook
  const {
    clearError: clearSuggestionsError,
    error: suggestionsError,
    isLoading: suggestionsLoading,
    refresh: refreshSuggestions,
  } = useSuggestions({autoRefreshOnVibeChange: true, session})

  // Vibe controls hook
  const {
    clearError: clearVibeError,
    error: vibeError,
    setEnergyLevel,
    steerVibe,
  } = useVibeControls({
    onVibeUpdate: vibe => {
      console.log('Vibe updated:', vibe)
    },
    session,
  })

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

  const handleAddToQueue = async (trackUri: string) => {
    try {
      await addToQueue(trackUri)

      // Also queue to Spotify's playback queue (best effort, don't fail if this doesn't work)
      try {
        await mixApiClient.queueToSpotify(trackUri)
        console.log('[MixPage] Track queued to Spotify:', trackUri)
      } catch (spotifyErr) {
        // Non-fatal - log but don't show error to user
        // This might fail if no active device or not Premium
        console.warn('[MixPage] Could not queue to Spotify:', spotifyErr)
      }

      // Refresh suggestions after adding
      await refreshSuggestions()
    } catch (err) {
      handleError(err, 'Failed to add track to queue')
    }
  }

  // Handle track played event - when Spotify plays a new track
  const handleTrackPlayed = async (trackId: string, trackUri: string) => {
    try {
      console.log('[MixPage] Track played:', trackId)
      const response = await mixApiClient.notifyTrackPlayed(trackId, trackUri)
      if (response.movedToHistory) {
        console.log('[MixPage] Track moved to history, refreshing session')
        // Session will be updated via polling, but refresh suggestions
        await refreshSuggestions()
      }
    } catch (err) {
      // Non-fatal error - just log
      console.warn('[MixPage] Failed to notify track played:', err)
    }
  }

  const handleSteerVibe = async (direction: string) => {
    try {
      await steerVibe(direction)
      // Refresh suggestions after vibe change
      await refreshSuggestions()
    } catch (err) {
      handleError(err, 'Failed to adjust vibe')
    }
  }

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

      <MixInterface
        onAddToQueue={handleAddToQueue}
        onEnergyChange={handleEnergyChange}
        onRefreshSuggestions={refreshSuggestions}
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
    </div>
  )
}
