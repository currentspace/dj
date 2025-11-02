import { useEffect, useState } from "react";

interface ScopeDebugData {
  instructions: {
    if_audio_features_forbidden: string;
    logout_method: string;
  };
  required_scopes: string[];
  scope_tests: {
    "audio-features": ScopeTestResult;
    "playlist-read-private": boolean;
    "user-read-private": boolean;
  };
  token_info: {
    country: string;
    display_name: string;
    email: string;
    product: string;
    user_id: string;
  };
}

interface ScopeTestResult {
  accessible: boolean;
  note: string;
  status: number;
}

export function ScopeDebugger() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<null | string>(null);
  const [data, setData] = useState<null | ScopeDebugData>(null);

  useEffect(() => {
    fetchScopeDebugInfo();
  }, []);

  const fetchScopeDebugInfo = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem("spotify_token");
      if (!token) {
        throw new Error("No Spotify token found");
      }

      const response = await fetch("/api/spotify/debug/scopes", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch scope debug info: ${response.status} ${response.statusText}`
        );
      }

      const result = (await response.json()) as ScopeDebugData;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="scope-debugger">
        <h2>🔍 Scope Debugger</h2>
        <div className="loading">Loading scope information...</div>
      </div>
    );
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
    );
  }

  if (!data) {
    return null;
  }

  const hasAudioFeaturesAccess = data.scope_tests["audio-features"].accessible;

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
          <div
            className={`scope-test ${
              data.scope_tests["user-read-private"] ? "success" : "failure"
            }`}
          >
            <span className="scope-icon">
              {data.scope_tests["user-read-private"] ? "✅" : "❌"}
            </span>
            <span className="scope-name">user-read-private</span>
            <span className="scope-status">
              {data.scope_tests["user-read-private"] ? "Working" : "Failed"}
            </span>
          </div>

          <div
            className={`scope-test ${
              data.scope_tests["playlist-read-private"] ? "success" : "failure"
            }`}
          >
            <span className="scope-icon">
              {data.scope_tests["playlist-read-private"] ? "✅" : "❌"}
            </span>
            <span className="scope-name">playlist-read-private</span>
            <span className="scope-status">
              {data.scope_tests["playlist-read-private"] ? "Working" : "Failed"}
            </span>
          </div>

          <div
            className={`scope-test ${
              hasAudioFeaturesAccess ? "success" : "failure"
            }`}
          >
            <span className="scope-icon">
              {hasAudioFeaturesAccess ? "✅" : "❌"}
            </span>
            <span className="scope-name">audio-features</span>
            <span className="scope-status">
              {data.scope_tests["audio-features"].note}
              {!hasAudioFeaturesAccess &&
                ` (Status: ${data.scope_tests["audio-features"].status})`}
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
          {data.required_scopes.map((scope) => (
            <span className="scope-badge" key={scope}>
              {scope}
            </span>
          ))}
        </div>
      </section>

      <button className="refresh-button" onClick={fetchScopeDebugInfo}>
        🔄 Refresh
      </button>

      <style>{`
        .scope-debugger {
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 12px;
          padding: 2rem;
          max-width: 900px;
          margin: 0 auto;
        }

        .scope-debugger h2 {
          margin: 0 0 2rem 0;
          color: #e0e0e0;
          font-size: 1.75rem;
        }

        .debug-section {
          margin-bottom: 2rem;
          padding: 1.5rem;
          background: #222;
          border: 1px solid #333;
          border-radius: 8px;
        }

        .debug-section h3 {
          margin: 0 0 1rem 0;
          color: #e0e0e0;
          font-size: 1.25rem;
        }

        .info-grid {
          display: grid;
          gap: 0.75rem;
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem;
          background: #1a1a1a;
          border-radius: 4px;
        }

        .info-label {
          color: #999;
          font-weight: 500;
        }

        .info-value {
          color: #e0e0e0;
        }

        .scope-tests {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .scope-test {
          display: grid;
          grid-template-columns: 32px 1fr auto;
          gap: 1rem;
          align-items: center;
          padding: 0.75rem;
          background: #1a1a1a;
          border-radius: 4px;
        }

        .scope-test.success {
          border-left: 3px solid #4caf50;
        }

        .scope-test.failure {
          border-left: 3px solid #f44336;
        }

        .scope-icon {
          font-size: 1.25rem;
        }

        .scope-name {
          color: #e0e0e0;
          font-family: monospace;
        }

        .scope-status {
          color: #999;
          font-size: 0.875rem;
        }

        .warning-section {
          background: #2a1a1a;
          border-color: #f44336;
        }

        .warning-content p {
          margin: 0.5rem 0;
          color: #e0e0e0;
          line-height: 1.6;
        }

        .warning-content strong {
          color: #ff6b6b;
        }

        .scopes-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .scope-badge {
          padding: 0.375rem 0.75rem;
          background: #1a1a1a;
          border: 1px solid #444;
          border-radius: 4px;
          color: #4caf50;
          font-family: monospace;
          font-size: 0.875rem;
        }

        .refresh-button,
        .retry-button {
          margin-top: 1rem;
          padding: 0.75rem 1.5rem;
          background: #1976d2;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 1rem;
          cursor: pointer;
          transition: background 0.2s;
        }

        .refresh-button:hover,
        .retry-button:hover {
          background: #1565c0;
        }

        .loading,
        .error {
          padding: 2rem;
          text-align: center;
          color: #e0e0e0;
        }

        .error {
          color: #f44336;
        }
      `}</style>
    </div>
  );
}
