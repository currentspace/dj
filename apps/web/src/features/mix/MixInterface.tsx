import type {MixSession, PlayedTrack, QueuedTrack, VibeProfile} from '@dj/shared-types'

import {useCallback, useTransition} from 'react'
import {usePlaybackStream} from '../../hooks/usePlaybackStream'
import {useMixStore} from '../../stores'

import {NowPlayingHero} from './NowPlayingHero'
import {QueuePanel} from './QueuePanel'
import {SuggestionsPanel} from './SuggestionsPanel'
import {VibeControls} from './VibeControls'
import styles from './mix.module.css'

interface MixInterfaceProps {
  onAddToQueue?: (trackUri: string) => void
  onEnergyChange?: (level: number) => void
  onRefreshSuggestions?: () => void
  onRemoveFromQueue?: (position: number) => void
  onReorderQueue?: (from: number, to: number) => void
  onSteerVibe?: (direction: string) => void
  /** Called when a track finishes playing and changes to the next track */
  onTrackPlayed?: (trackId: string, trackUri: string) => void
  session: MixSession | null
  /** Spotify access token for playback stream */
  token?: string | null
}

export function MixInterface({
  session,
  token,
  onAddToQueue,
  onRemoveFromQueue,
  onReorderQueue,
  onEnergyChange,
  onSteerVibe,
  onRefreshSuggestions: _onRefreshSuggestions, // Unused - store handles refresh directly
  onTrackPlayed,
}: MixInterfaceProps) {
  const [_isPending, startTransition] = useTransition()

  // Get suggestions from store (centralized state)
  const suggestions = useMixStore((s) => s.suggestions)
  const isLoadingSuggestions = useMixStore((s) => s.suggestionsLoading)
  const refreshSuggestions = useMixStore((s) => s.refreshSuggestions)

  // Handle track change - notify parent when the track being played changes
  const handleTrackChange = useCallback(
    (previousTrackId: string, previousTrackUri: string, _newTrackId: string) => {
      // Only notify if we have valid track info (not empty strings)
      if (previousTrackId && previousTrackUri) {
        onTrackPlayed?.(previousTrackId, previousTrackUri)
      }
    },
    [onTrackPlayed]
  )

  // Real-time playback state from SSE stream with track change detection
  const {playback, status: playbackStatus} = usePlaybackStream(token ?? null, {
    onTrackChange: handleTrackChange,
  })

  // Direct state derivation (NOT useEffect)
  const currentTrack: PlayedTrack | null = session?.history[0] ?? null
  const queue: QueuedTrack[] = session?.queue ?? []
  const vibe: VibeProfile | null = session?.vibe ?? null

  const handleAddToQueue = useCallback(
    (trackUri: string) => {
      startTransition(() => {
        onAddToQueue?.(trackUri)
      })
    },
    [onAddToQueue],
  )

  const handleRemoveFromQueue = useCallback(
    (position: number) => {
      startTransition(() => {
        onRemoveFromQueue?.(position)
      })
    },
    [onRemoveFromQueue],
  )

  const handleReorderQueue = useCallback(
    (from: number, to: number) => {
      startTransition(() => {
        onReorderQueue?.(from, to)
      })
    },
    [onReorderQueue],
  )

  const handleEnergyChange = useCallback(
    (level: number) => {
      startTransition(() => {
        onEnergyChange?.(level)
      })
    },
    [onEnergyChange],
  )

  const handleSteerVibe = useCallback(
    (direction: string) => {
      startTransition(() => {
        onSteerVibe?.(direction)
      })
    },
    [onSteerVibe],
  )

  const handleRefreshSuggestions = useCallback(() => {
    startTransition(() => {
      // Use store's refreshSuggestions only - onRefreshSuggestions prop is redundant
      // since it also calls the same store action via useSuggestions hook
      refreshSuggestions()
    })
  }, [refreshSuggestions])

  if (!session) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.loadingSpinner}></div>
          <p>Loading mix session...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Show connection status if not connected */}
      {playbackStatus === 'connecting' && (
        <div className={styles.connectionStatus}>Connecting to Spotify...</div>
      )}

      <NowPlayingHero playback={playback} queue={queue} token={token} track={currentTrack} />

      <div className={styles.panels}>
        <QueuePanel queue={queue} onRemove={handleRemoveFromQueue} onReorder={handleReorderQueue} />
        <SuggestionsPanel
          isLoading={isLoadingSuggestions}
          onAdd={handleAddToQueue}
          onRefresh={handleRefreshSuggestions}
          suggestions={suggestions}
        />
      </div>

      <VibeControls onEnergyChange={handleEnergyChange} onSteer={handleSteerVibe} vibe={vibe} />
    </div>
  )
}
