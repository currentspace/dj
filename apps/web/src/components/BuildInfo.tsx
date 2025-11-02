import {useEffect, useState} from 'react'

// Default build info for development
const defaultBuildInfo = {
  branch: 'local',
  buildTime: new Date().toISOString(),
  commitHash: 'dev',
  commitMessage: 'Development build',
  version: 'dev-local',
}

export function BuildInfo() {
  const [isOpen, setIsOpen] = useState(false)
  const [buildInfo, setBuildInfo] = useState(defaultBuildInfo)

  useEffect(() => {
    // Try to load actual build info
    import('../build-info.json')
      .then(module => setBuildInfo(module.default))
      .catch(() => {
        console.log('Using default build info (dev mode)')
      })
  }, [])

  return (
    <>
      <button className="build-info-toggle" onClick={() => setIsOpen(!isOpen)} title="Build Information">
        <span className="build-version">v{buildInfo.commitHash}</span>
      </button>

      {isOpen && (
        <div className="build-info-modal">
          <div className="build-info-content">
            <h3>Build Information</h3>
            <button className="close-btn" onClick={() => setIsOpen(false)}>
              ×
            </button>

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
                <span className="build-value">{new Date(buildInfo.buildTime).toLocaleString()}</span>
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
                rel="noopener noreferrer"
                target="_blank">
                View on GitHub →
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
