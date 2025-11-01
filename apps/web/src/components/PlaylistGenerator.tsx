import { useState } from 'react'

import { generatePlaylist } from '../lib/api'

export function PlaylistGenerator() {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [playlist, setPlaylist] = useState<any>(null)
  const [error, setError] = useState<null | string>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) return

    setLoading(true)
    setError(null)

    try {
      const result = await generatePlaylist(prompt)
      setPlaylist(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate playlist')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="playlist-generator">
      <form onSubmit={handleSubmit}>
        <label htmlFor="prompt">
          <h2>Describe your perfect playlist</h2>
          <p>Tell me what kind of music you're in the mood for...</p>
        </label>
        <textarea
          disabled={loading}
          id="prompt"
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., Upbeat songs for a morning workout, or Chill jazz for studying..."
          rows={4}
          value={prompt}
        />
        <button disabled={loading || !prompt.trim()} type="submit">
          {loading ? 'Generating...' : 'Generate Playlist'}
        </button>
      </form>

      {error && (
        <div className="error">
          <p>Error: {error}</p>
        </div>
      )}

      {playlist && (
        <div className="playlist-result">
          <h3>{playlist.name}</h3>
          <p>{playlist.description}</p>
          <div className="track-list">
            {playlist.tracks?.map((track: any, index: number) => (
              <div className="track" key={index}>
                <span className="track-number">{index + 1}</span>
                <div className="track-info">
                  <div className="track-name">{track.name}</div>
                  <div className="track-artist">{track.artist}</div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => console.log('Save to Spotify')}>
            Save to Spotify
          </button>
        </div>
      )}
    </div>
  )
}