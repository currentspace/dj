import type {Suggestion} from '@dj/shared-types'

import sharedStyles from './mix-shared.module.css'
import styles from './suggestions-panel.module.css'

interface SuggestionsPanelProps {
  isLoading: boolean
  onRefresh?: () => void
  suggestions: Suggestion[]
}

export function SuggestionsPanel({suggestions, onRefresh, isLoading}: SuggestionsPanelProps) {
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
        ) : suggestions.length === 0 ? (
          <div className={sharedStyles.emptyState}>
            <span className={sharedStyles.emptyIcon}>🎧</span>
            <p>Queue is full</p>
            <p className={sharedStyles.emptyHint}>More tracks will be added as the queue plays</p>
          </div>
        ) : (
          suggestions.map(suggestion => (
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
            </div>
          ))
        )}
      </div>
    </div>
  )
}
