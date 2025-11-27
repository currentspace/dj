import type {Suggestion} from '@dj/shared-types'

import styles from './mix.module.css'

interface SuggestionsPanelProps {
  isLoading: boolean
  onAdd: (trackUri: string) => void
  onRefresh?: () => void
  suggestions: Suggestion[]
}

export function SuggestionsPanel({suggestions, onAdd, onRefresh, isLoading}: SuggestionsPanelProps) {
  return (
    <div className={styles.suggestionsPanel}>
      <div className={styles.panelHeader}>
        <h2>AI Suggestions</h2>
        <button className={styles.refreshButton} disabled={isLoading} onClick={onRefresh} type="button">
          <span className={isLoading ? styles.refreshSpinning : ''}>🔄</span>
        </button>
      </div>

      <div className={styles.suggestionsList}>
        {isLoading ? (
          <div className={styles.loadingState}>
            <div className={styles.loadingSpinner}></div>
            <p>Finding perfect tracks...</p>
          </div>
        ) : suggestions.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>🎧</span>
            <p>No suggestions yet</p>
            <p className={styles.emptyHint}>Play a track to get AI recommendations</p>
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

              <button className={styles.addButton} onClick={() => onAdd(suggestion.trackUri)} type="button">
                +
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
