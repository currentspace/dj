import { describe, it, expect } from 'vitest'

describe.skip('Debug Deezer Direct', () => {
  it('should call Deezer API directly', async () => {
    const isrc = 'GBUM71029604'
    const url = `https://api.deezer.com/track/isrc:${isrc}`
    
    console.log('Calling Deezer URL:', url)
    const response = await fetch(url)
    console.log('Response status:', response.status)
    console.log('Response ok:', response.ok)
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await response.json() as Record<string, any>
    console.log('Data keys:', Object.keys(data))
    console.log('Has ID:', !!data.id)
    console.log('Has BPM:', !!data.bpm)
    console.log('BPM value:', data.bpm)
    console.log('Rank value:', data.rank)
    
    expect(response.ok).toBe(true)
  })
})
