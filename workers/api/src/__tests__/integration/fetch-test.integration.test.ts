import { describe, it, expect } from 'vitest'

describe('Fetch Test', () => {
  it('should be able to call fetch directly', async () => {
    const response = await fetch('https://api.deezer.com/track/isrc:GBUM71029604')
    console.log('Response status:', response.status)
    console.log('Response OK:', response.ok)
    
    const data = await response.json()
    console.log('Response has ID:', !!data.id)
    console.log('Response has BPM:', !!data.bpm)
    
    expect(response.ok).toBe(true)
    expect(data).toHaveProperty('id')
  })
})
