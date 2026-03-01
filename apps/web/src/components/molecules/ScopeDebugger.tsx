import {useScopeDebugQuery} from '../../hooks/queries'
import '../../styles/scope-debugger.css'

export function ScopeDebugger() {
  const {data, error, isLoading, refetch} = useScopeDebugQuery()

  if (isLoading) {
    return (
      <div className="scope-debugger">
        <h2>Scope Debugger</h2>
        <div className="loading">Loading scope information...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="scope-debugger">
        <h2>Scope Debugger</h2>
        <div className="error">
          <p>Error: {error.message}</p>
          <button className="retry-button" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!data) {
    return null
  }

  return (
    <div className="scope-debugger">
      <h2>Scope Debugger</h2>

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
            <span className="scope-icon">{data.scope_tests['user-read-private'] ? 'OK' : 'FAIL'}</span>
            <span className="scope-name">user-read-private</span>
            <span className="scope-status">{data.scope_tests['user-read-private'] ? 'Working' : 'Failed'}</span>
          </div>

          <div className={`scope-test ${data.scope_tests['playlist-read-private'] ? 'success' : 'failure'}`}>
            <span className="scope-icon">{data.scope_tests['playlist-read-private'] ? 'OK' : 'FAIL'}</span>
            <span className="scope-name">playlist-read-private</span>
            <span className="scope-status">{data.scope_tests['playlist-read-private'] ? 'Working' : 'Failed'}</span>
          </div>
        </div>
      </section>

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

      <button className="refresh-button" onClick={() => refetch()}>
        Refresh
      </button>
    </div>
  )
}
