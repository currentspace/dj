import { useState } from 'react'

// Import build info - will be generated at build time
let buildInfo = {
  commitHash: 'dev',
  buildTime: new Date().toISOString(),
  branch: 'local',
  commitMessage: 'Development build',
  version: 'dev-local'
}

try {
  // Try to load actual build info
  const info = await import('../build-info.json')
  buildInfo = info.default
} catch {
  // Use defaults in dev
}

export function BuildInfo() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        className="build-info-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title="Build Information"
      >
        <span className="build-version">v{buildInfo.commitHash}</span>
      </button>

      {isOpen && (
        <div className="build-info-modal">
          <div className="build-info-content">
            <h3>Build Information</h3>
            <button className="close-btn" onClick={() => setIsOpen(false)}>×</button>

            <div className="build-details">
              <div className="build-row">
                <span className="build-label">Commit:</span>
                <span className="build-value">{buildInfo.commitHash}</span>
              </div>
              <div className="build-row">
                <span className="build-label">Branch:</span>
                <span className="build-value">{buildInfo.branch}</span>
              </div>
              <div className="build-row">
                <span className="build-label">Built:</span>
                <span className="build-value">
                  {new Date(buildInfo.buildTime).toLocaleString()}
                </span>
              </div>
              <div className="build-row">
                <span className="build-label">Message:</span>
                <span className="build-value build-message">{buildInfo.commitMessage}</span>
              </div>
              <div className="build-row">
                <span className="build-label">Version:</span>
                <span className="build-value">{buildInfo.version}</span>
              </div>
            </div>

            <div className="build-footer">
              <a
                href={`https://github.com/currentspace/dj/commit/${buildInfo.commitHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on GitHub →
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}