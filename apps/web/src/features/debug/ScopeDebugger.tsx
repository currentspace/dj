import {useEffect, useState} from 'react'

import '../../styles/scope-debugger.css'

interface ScopeDebugData {
  instructions: {
    if_audio_features_forbidden: string
    logout_method: string
  }
  required_scopes: string[]
  scope_tests: {
    'audio-features': ScopeTestResult
    'playlist-read-private': boolean
    'user-read-private': boolean
  }
  token_info: {
    country: string
    display_name: string
    email: string
    product: string
    user_id: string
  }
}

interface ScopeTestResult {
  accessible: boolean
  note: string
  status: number
}

export function ScopeDebugger() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<null | string>(null)
  const [data, setData] = useState<null | ScopeDebugData>(null)

  useEffect(() => {
    fetchScopeDebugInfo()
  }, [])

  const fetchScopeDebugInfo = async () => {
    try {
      setLoading(true)
      setError(null)

      const token = localStorage.getItem('spotify_token')
      if (!token) {
        throw new Error('No Spotify token found')
      }

      const response = await fetch('/api/spotify/debug/scopes', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch scope debug info: ${response.status} ${response.statusText}`)
      }

      const result = (await response.json()) as ScopeDebugData
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="scope-debugger">
        <h2>🔍 Scope Debugger</h2>
        <div className="loading">Loading scope information...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="scope-debugger">
        <h2>🔍 Scope Debugger</h2>
        <div className="error">
          <p>❌ Error: {error}</p>
          <button className="retry-button" onClick={fetchScopeDebugInfo}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!data) {
    return null
  }

  const hasAudioFeaturesAccess = data.scope_tests['audio-features'].accessible

  return (
    <div className="scope-debugger">
      <h2>🔍 Scope Debugger</h2>

      <section className="debug-section">
        <h3>User Information</h3>
        <div className="info-grid">
          <div className="info-item">
            <span className="info-label">User ID:</span>
            <span className="info-value">{data.token_info.user_id}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Display Name:</span>
            <span className="info-value">{data.token_info.display_name}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Email:</span>
            <span className="info-value">{data.token_info.email}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Product:</span>
            <span className="info-value">{data.token_info.product}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Country:</span>
            <span className="info-value">{data.token_info.country}</span>
          </div>
        </div>
      </section>

      <section className="debug-section">
        <h3>Permission Tests</h3>
        <div className="scope-tests">
          <div className={`scope-test ${data.scope_tests['user-read-private'] ? 'success' : 'failure'}`}>
            <span className="scope-icon">{data.scope_tests['user-read-private'] ? '✅' : '❌'}</span>
            <span className="scope-name">user-read-private</span>
            <span className="scope-status">{data.scope_tests['user-read-private'] ? 'Working' : 'Failed'}</span>
          </div>

          <div className={`scope-test ${data.scope_tests['playlist-read-private'] ? 'success' : 'failure'}`}>
            <span className="scope-icon">{data.scope_tests['playlist-read-private'] ? '✅' : '❌'}</span>
            <span className="scope-name">playlist-read-private</span>
            <span className="scope-status">{data.scope_tests['playlist-read-private'] ? 'Working' : 'Failed'}</span>
          </div>

          <div className={`scope-test ${hasAudioFeaturesAccess ? 'success' : 'failure'}`}>
            <span className="scope-icon">{hasAudioFeaturesAccess ? '✅' : '❌'}</span>
            <span className="scope-name">audio-features</span>
            <span className="scope-status">
              {data.scope_tests['audio-features'].note}
              {!hasAudioFeaturesAccess && ` (Status: ${data.scope_tests['audio-features'].status})`}
            </span>
          </div>
        </div>
      </section>

      {!hasAudioFeaturesAccess && (
        <section className="debug-section warning-section">
          <h3>⚠️ Action Required</h3>
          <div className="warning-content">
            <p>
              <strong>{data.instructions.if_audio_features_forbidden}</strong>
            </p>
            <p>How to logout: {data.instructions.logout_method}</p>
          </div>
        </section>
      )}

      <section className="debug-section">
        <h3>Required Scopes</h3>
        <div className="scopes-list">
          {data.required_scopes.map(scope => (
            <span className="scope-badge" key={scope}>
              {scope}
            </span>
          ))}
        </div>
      </section>

      <button className="refresh-button" onClick={fetchScopeDebugInfo}>
        🔄 Refresh
      </button>
    </div>
  )
}
