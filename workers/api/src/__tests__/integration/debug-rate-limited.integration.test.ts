import { describe, it, expect } from 'vitest'
import { rateLimitedDeezerCall, getGlobalOrchestrator } from '../../utils/RateLimitedAPIClients'

describe.skip('Debug Rate Limited API', () => {
  it('should call Deezer via rate limited wrapper', async () => {
    const isrc = 'GBUM71029604'
    const url = `https://api.deezer.com/track/isrc:${isrc}`
    
    console.log('Calling via rate limited wrapper...')
    const response = await rateLimitedDeezerCall(() => fetch(url), undefined, 'test')
    
    console.log('Response:', response)
    console.log('Response ok:', response?.ok)
    
    if (response) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await response.json() as Record<string, any>
      console.log('BPM:', data.bpm)
      expect(data.bpm).toBeDefined()
    }
  })
  
  it('should have orchestrator available', () => {
    const orchestrator = getGlobalOrchestrator()
    console.log('Orchestrator:', orchestrator)
    console.log('Orchestrator type:', typeof orchestrator)
    expect(orchestrator).toBeDefined()
  })
})
