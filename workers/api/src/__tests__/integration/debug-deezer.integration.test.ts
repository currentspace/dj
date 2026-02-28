import { describe, expect, it } from 'vitest'

import { asRecord } from '../contracts/helpers'

describe.skip('Debug Deezer Direct', () => {
  it('should call Deezer API directly', async () => {
    const isrc = 'GBUM71029604'
    const url = `https://api.deezer.com/track/isrc:${isrc}`

    console.log('Calling Deezer URL:', url)
    const response = await fetch(url)
    console.log('Response status:', response.status)
    console.log('Response ok:', response.ok)

    const data = asRecord(await response.json())
    console.log('Data keys:', Object.keys(data))
    console.log('Has ID:', !!data.id)
    console.log('Has BPM:', !!data.bpm)
    console.log('BPM value:', data.bpm)
    console.log('Rank value:', data.rank)

    expect(response.ok).toBe(true)
  })
})
