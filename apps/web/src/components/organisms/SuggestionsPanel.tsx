import type {Suggestion} from '@dj/shared-types'

import {useCallback, useRef} from 'react'

import {useMixStore} from '../../stores'
import sharedStyles from '../templates/mix-shared.module.css'
import styles from './suggestions-panel.module.css'

interface SuggestionsPanelProps {
  isLoading: boolean
  onRefresh?: () => void
  suggestions: Suggestion[]
}

export function SuggestionsPanel({isLoading, onRefresh, suggestions}: SuggestionsPanelProps) {
  const addToQueue = useMixStore((s) => s.addToQueue)
  const addingRef = useRef<Set<string>>(new Set())
  const removedRef = useRef<Set<string>>(new Set())
  // Track render key to force updates on optimistic removal
  const renderCountRef = useRef(0)

  const handleAdd = useCallback(async (suggestion: Suggestion) => {
    if (addingRef.current.has(suggestion.trackId)) return
    addingRef.current.add(suggestion.trackId)
    // Force re-render to show loading state
    renderCountRef.current++
    useMixStore.setState({})

    try {
      await addToQueue(suggestion.trackUri)
      // Optimistic: remove suggestion from visible list
      removedRef.current.add(suggestion.trackId)
    } finally {
      addingRef.current.delete(suggestion.trackId)
      renderCountRef.current++
      useMixStore.setState({})
    }
  }, [addToQueue])

  const visibleSuggestions = suggestions.filter((s) => !removedRef.current.has(s.trackId))

  // Clear removed set when suggestions refresh (new suggestions come in)
  const prevSuggestionsLenRef = useRef(suggestions.length)
  if (suggestions.length !== prevSuggestionsLenRef.current) {
    prevSuggestionsLenRef.current = suggestions.length
    removedRef.current.clear()
  }

  return (
    <div className={styles.suggestionsPanel}>
      <div className={sharedStyles.panelHeader}>
        <h2>Coming Up</h2>
        <button className={styles.refreshButton} disabled={isLoading} onClick={onRefresh} title="Refresh suggestions" type="button">
          <svg className={isLoading ? styles.refreshSpinning : ''} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className={styles.suggestionsList}>
        {isLoading ? (
          <div className={sharedStyles.loadingState}>
            <div className={sharedStyles.loadingSpinner}></div>
            <p>Finding perfect tracks...</p>
          </div>
        ) : visibleSuggestions.length === 0 ? (
          <div className={sharedStyles.emptyState}>
            <span className={sharedStyles.emptyIcon}>🎧</span>
            <p>Queue is full</p>
            <p className={sharedStyles.emptyHint}>More tracks will be added as the queue plays</p>
          </div>
        ) : (
          visibleSuggestions.map(suggestion => {
            const isAdding = addingRef.current.has(suggestion.trackId)
            return (
              <div className={styles.suggestionItem} key={suggestion.trackId}>
                {suggestion.albumArt && (
                  <img alt={`${suggestion.name} album art`} className={styles.suggestionAlbumArt} src={suggestion.albumArt} />
                )}

                <div className={styles.suggestionInfo}>
                  <div className={styles.suggestionTrackName}>{suggestion.name}</div>
                  <div className={styles.suggestionArtist}>{suggestion.artist}</div>

                  <div className={styles.suggestionMeta}>
                    <span className={styles.vibeScore}>{suggestion.vibeScore}% match</span>
                    {suggestion.bpm && <span className={styles.metaBadge}>{Math.round(suggestion.bpm)} BPM</span>}
                  </div>

                  {suggestion.reason && <div className={styles.suggestionReason}>{suggestion.reason}</div>}
                </div>

                <button
                  className={styles.addButton}
                  disabled={isAdding}
                  onClick={() => handleAdd(suggestion)}
                  title="Add to queue"
                  type="button"
                >
                  {isAdding ? (
                    <svg className={styles.refreshSpinning} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path d="M12 5v14m-7-7h14" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
