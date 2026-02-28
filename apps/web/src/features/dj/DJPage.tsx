/**
 * DJPage - Single-page always-on DJ layout
 * Replaces the two-page chat/mix architecture
 */

import type {SpotifyPlaylist} from '@dj/shared-types'
import type {SessionPreferences} from '@dj/shared-types'

import {useCallback, useRef, useState} from 'react'

import {ErrorDisplay} from '../../components/atoms/ErrorDisplay'
import {QueuePanel} from '../../components/organisms/QueuePanel'
import {SuggestionsPanel} from '../../components/organisms/SuggestionsPanel'
import {useMixSession} from '../../hooks/useMixSession'
import {usePlaybackStream} from '../../hooks/usePlaybackStream'
import {mixApiClient} from '../../lib/mix-api-client'
import {useMixStore, usePlaybackStore} from '../../stores'
import {emitDebug} from '../../stores/debugStore'
import {CompactNowPlaying} from './CompactNowPlaying'
import {DJLog, type DJLogEntry} from './DJLog'
import styles from './DJPage.module.css'
import {PlaylistPicker} from './PlaylistPicker'
import {SettingsDrawer} from './SettingsDrawer'
import {SteerInput} from './SteerInput'

interface DJPageProps {
  token: null | string
}

const MAX_LOG_ENTRIES = 50

export function DJPage({token}: DJPageProps) {
  // Session state
  const {
    clearError,
    endSession,
    error: sessionError,
    isLoading,
    removeFromQueue,
    reorderQueue,
    session,
    setSession,
    startSession,
  } = useMixSession()

  // Suggestions from store
  const suggestions = useMixStore((s) => s.suggestions)
  const suggestionsLoading = useMixStore((s) => s.suggestionsLoading)
  const refreshSuggestions = useMixStore((s) => s.refreshSuggestions)
  const suggestionsError = useMixStore((s) => s.suggestionsError)
  const clearSuggestionsError = useMixStore((s) => s.clearSuggestionsError)

  // Vibe from store
  const vibeError = useMixStore((s) => s.vibeError)
  const clearVibeError = useMixStore((s) => s.clearVibeError)
  const setEnergyLevel = useMixStore((s) => s.setEnergyLevel)
  const steerVibeStream = useMixStore((s) => s.steerVibeStream)
  const steerInProgress = useMixStore((s) => s.steerInProgress)

  // Local state
  const [selectedPlaylist, setSelectedPlaylist] = useState<null | SpotifyPlaylist>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [logEntries, setLogEntries] = useState<DJLogEntry[]>([])

  const logIdRef = useRef(0)

  const addLogEntry = useCallback((type: DJLogEntry['type'], message: string) => {
    logIdRef.current++
    const entry: DJLogEntry = {
      id: String(logIdRef.current),
      message,
      timestamp: Date.now(),
      type,
    }
    setLogEntries((prev) => {
      const next = [...prev, entry]
      return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next
    })
  }, [])

  // Track change callback
  const handleTrackChange = useCallback(
    (previousTrackId: string, previousTrackUri: string, _newTrackId: string) => {
      if (!previousTrackId || !previousTrackUri) return

      // Get the current playback to show new track name
      const playbackCore = usePlaybackStore.getState().playbackCore
      const newTrackName = playbackCore?.track?.name ?? 'Unknown'
      const newArtist = playbackCore?.track?.artist ?? ''

      addLogEntry('track', `${newTrackName} — ${newArtist}`)
      emitDebug('state', 'track_change', `Track changed: ${newTrackName} — ${newArtist}`)

      // Notify mix API if session exists
      if (!useMixStore.getState().session) return

      mixApiClient.notifyTrackPlayed(previousTrackId, previousTrackUri)
        .then((response) => {
          if (response.movedToHistory) {
            setSession(response.session)
            refreshSuggestions()
          }
        })
        .catch((err) => {
          console.warn('[DJPage] Failed to notify track played:', err)
        })
    },
    [addLogEntry, setSession, refreshSuggestions],
  )

  // Playback stream
  const {playback} = usePlaybackStream(token, {
    onTrackChange: handleTrackChange,
  })

  // Derived state
  const queue = session?.queue ?? []
  const vibe = session?.vibe ?? null
  const autoFill = session?.preferences?.autoFill ?? true

  // Handlers
  const handleStartSession = useCallback(async () => {
    const preferences: SessionPreferences = {
      autoFill: true,
      avoidGenres: [],
      bpmLock: null,
      favoriteArtists: [],
    }

    try {
      await startSession(preferences, selectedPlaylist?.id)
      addLogEntry('dj', `Session started${selectedPlaylist ? ` with "${selectedPlaylist.name}"` : ''}`)
    } catch {
      addLogEntry('info', 'Failed to start session')
    }
  }, [startSession, selectedPlaylist, addLogEntry])

  const handleEndSession = useCallback(async () => {
    try {
      await endSession()
      addLogEntry('info', 'Session ended')
    } catch {
      addLogEntry('info', 'Failed to end session')
    }
  }, [endSession, addLogEntry])

  const handleSteer = useCallback(async (direction: string) => {
    addLogEntry('user', direction)
    addLogEntry('steer', `Processing: "${direction}"`)
    try {
      await steerVibeStream(direction)
      await refreshSuggestions()
      addLogEntry('dj', 'Vibe updated, queue refreshed')
    } catch {
      addLogEntry('info', 'Steer failed')
    }
  }, [steerVibeStream, refreshSuggestions, addLogEntry])

  const handleRemove = useCallback((position: number) => {
    removeFromQueue(position)
  }, [removeFromQueue])

  const handleReorder = useCallback((from: number, to: number) => {
    reorderQueue(from, to)
  }, [reorderQueue])

  const handleEnergyChange = useCallback((level: number) => {
    setEnergyLevel(level)
  }, [setEnergyLevel])

  // Combined errors
  const combinedError = sessionError ?? suggestionsError ?? vibeError
  const clearAllErrors = useCallback(() => {
    clearError()
    clearSuggestionsError()
    clearVibeError()
  }, [clearError, clearSuggestionsError, clearVibeError])

  // No session: show playlist picker + start button
  if (!session) {
    return (
      <div className={styles.djPage}>
        <PlaylistPicker onSelect={setSelectedPlaylist} selected={selectedPlaylist} />

        <div className={styles.startSection}>
          {combinedError && (
            <ErrorDisplay error={combinedError} onDismiss={clearAllErrors} variant="inline" />
          )}
          <button
            className={styles.startButton}
            disabled={isLoading}
            onClick={handleStartSession}
          >
            {isLoading ? 'Starting...' : 'Start DJ'}
          </button>
          <p className={styles.startHint}>
            {selectedPlaylist
              ? `Seeding from "${selectedPlaylist.name}"`
              : "Or just hit Start — I'll pick from your recent listens"}
          </p>
        </div>
      </div>
    )
  }

  // Active session: full DJ view
  return (
    <div className={styles.djPage}>
      <CompactNowPlaying playback={playback} />

      <div className={styles.sessionHeader}>
        <button
          className={styles.endSessionBtn}
          disabled={isLoading}
          onClick={handleEndSession}
        >
          End Session
        </button>
        <button
          className={styles.settingsBtn}
          onClick={() => setShowSettings(true)}
          type="button"
        >
          Settings
        </button>
      </div>

      <div className={styles.panels}>
        <QueuePanel
          isSearching={suggestionsLoading && queue.length < 3}
          onRemove={handleRemove}
          onReorder={handleReorder}
          queue={queue}
        />
        <SuggestionsPanel
          isLoading={suggestionsLoading}
          onRefresh={refreshSuggestions}
          suggestions={suggestions}
        />
      </div>

      <DJLog entries={logEntries} />

      <SteerInput
        disabled={!session}
        isLoading={steerInProgress}
        onSteer={handleSteer}
      />

      {combinedError && (
        <ErrorDisplay error={combinedError} onDismiss={clearAllErrors} variant="toast" />
      )}

      {showSettings && (
        <SettingsDrawer
          autoFill={autoFill}
          deviceId={playback?.deviceId ?? null}
          deviceName={playback?.deviceName ?? null}
          onClose={() => setShowSettings(false)}
          onEnergyChange={handleEnergyChange}
          token={token}
          vibe={vibe}
        />
      )}
    </div>
  )
}

