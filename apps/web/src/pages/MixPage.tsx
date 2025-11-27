import {useState} from 'react'
import type {SessionPreferences} from '@dj/shared-types'
import {MixInterface} from '../features/mix'
import {useMixSession} from '../hooks/useMixSession'
import {useSuggestions} from '../hooks/useSuggestions'
import {useVibeControls} from '../hooks/useVibeControls'

interface MixPageProps {
  onBackToChat: () => void
  seedPlaylistId?: string
}

export function MixPage({onBackToChat, seedPlaylistId}: MixPageProps) {
  const [showStartDialog, setShowStartDialog] = useState(true)

  // Mix session hook
  const {
    session,
    isLoading: sessionLoading,
    error: sessionError,
    startSession,
    endSession,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    clearError: clearSessionError,
  } = useMixSession()

  // Suggestions hook
  const {
    isLoading: suggestionsLoading,
    error: suggestionsError,
    refresh: refreshSuggestions,
    clearError: clearSuggestionsError,
  } = useSuggestions({session, autoRefreshOnVibeChange: true})

  // Vibe controls hook
  const {
    steerVibe,
    setEnergyLevel,
    clearError: clearVibeError,
    error: vibeError,
  } = useVibeControls({
    session,
    onVibeUpdate: vibe => {
      console.log('Vibe updated:', vibe)
    },
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
    } catch (error) {
      console.error('Failed to start session:', error)
    }
  }

  const handleEndSession = async () => {
    try {
      await endSession()
      setShowStartDialog(true)
    } catch (error) {
      console.error('Failed to end session:', error)
    }
  }

  const handleAddToQueue = async (trackUri: string) => {
    try {
      await addToQueue(trackUri)
      // Refresh suggestions after adding
      await refreshSuggestions()
    } catch (error) {
      console.error('Failed to add to queue:', error)
    }
  }

  const handleSteerVibe = async (direction: string) => {
    try {
      await steerVibe(direction)
      // Refresh suggestions after vibe change
      await refreshSuggestions()
    } catch (error) {
      console.error('Failed to steer vibe:', error)
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
  }

  // Show error state
  const error = sessionError || suggestionsError || vibeError
  if (error) {
    return (
      <div style={{padding: '2rem', textAlign: 'center'}}>
        <h2>Error</h2>
        <p style={{color: 'red'}}>{error}</p>
        <button onClick={clearAllErrors} style={{marginTop: '1rem'}}>
          Clear Error
        </button>
        <button onClick={onBackToChat} style={{marginTop: '1rem', marginLeft: '1rem'}}>
          Back to Chat
        </button>
      </div>
    )
  }

  // Show start dialog if no session
  if (!session || showStartDialog) {
    return (
      <div style={{padding: '2rem', textAlign: 'center'}}>
        <h1>Live DJ Mode</h1>
        <p>
          Create a dynamic, AI-powered music mix with real-time vibe control and intelligent suggestions.
        </p>
        <div style={{marginTop: '2rem'}}>
          <button onClick={handleStartSession} disabled={sessionLoading} style={{fontSize: '1.2rem', padding: '1rem 2rem'}}>
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
      <div style={{display: 'flex', justifyContent: 'space-between', padding: '1rem', background: '#f5f5f5'}}>
        <h2>Live DJ Mode</h2>
        <div style={{display: 'flex', gap: '1rem'}}>
          <button onClick={handleEndSession} disabled={sessionLoading}>
            End Session
          </button>
          <button onClick={onBackToChat}>Back to Chat</button>
        </div>
      </div>

      <MixInterface
        session={session}
        onAddToQueue={handleAddToQueue}
        onRemoveFromQueue={removeFromQueue}
        onReorderQueue={reorderQueue}
        onEnergyChange={handleEnergyChange}
        onSteerVibe={handleSteerVibe}
        onRefreshSuggestions={refreshSuggestions}
      />

      {/* Show loading overlay */}
      {(sessionLoading || suggestionsLoading) && (
        <div
          style={{
            position: 'fixed',
            bottom: '1rem',
            right: '1rem',
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '1rem',
            borderRadius: '0.5rem',
          }}
        >
          Loading...
        </div>
      )}
    </div>
  )
}
