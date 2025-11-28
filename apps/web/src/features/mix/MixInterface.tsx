import type {MixSession, PlayedTrack, QueuedTrack, Suggestion, VibeProfile} from '@dj/shared-types'

import {useCallback, useState, useTransition} from 'react'
import {TIMING} from '../../constants'
import {usePlaybackStream} from '../../hooks/usePlaybackStream'

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
  onRefreshSuggestions,
  onTrackPlayed,
}: MixInterfaceProps) {
  const [_isPending, startTransition] = useTransition()
  const [suggestions, _setSuggestions] = useState<Suggestion[]>([])
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)

  // Handle track change - notify parent when the track being played changes
  const handleTrackChange = useCallback(
    (previousTrackId: string, previousTrackUri: string, _newTrackId: string) => {
      // The previous track finished playing, notify the parent
      onTrackPlayed?.(previousTrackId, previousTrackUri)
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
    setIsLoadingSuggestions(true)
    startTransition(() => {
      onRefreshSuggestions?.()
      // In a real implementation, this would be updated by the API response
      setTimeout(() => setIsLoadingSuggestions(false), TIMING.SUGGESTIONS_LOADING_DELAY_MS)
    })
  }, [onRefreshSuggestions])

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

      <NowPlayingHero playback={playback} queue={queue} track={currentTrack} />

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
