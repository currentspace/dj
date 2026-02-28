import { beforeEach, describe, expect, it } from 'vitest'

import { AudioEnrichmentService } from '../../services/AudioEnrichmentService'
import { MockKVNamespace } from './setup'

describe.skip('Simple Enrich Test', () => {
  let service: AudioEnrichmentService
  let mockKv: MockKVNamespace

  beforeEach(() => {
    mockKv = new MockKVNamespace()
     
    service = new AudioEnrichmentService(mockKv as any)
  })

  it('should enrich a track with direct properties', async () => {
    const track = {
      artists: [{ id: '1dfeR4HaWDbWqFHLkxsg1d', name: 'Queen' }],
      duration_ms: 354320,
      external_ids: { isrc: 'GBUM71029604' },
      id: '6rqhFgbbKwnb9MLmUQDhG6',
      name: 'Bohemian Rhapsody - Remastered 2011',
    }

    console.log('Starting enrichment for track:', track.name)
    console.log('ISRC:', track.external_ids.isrc)
    
    const result = await service.enrichTrack(track)
    
    console.log('Enrichment result:', result)
    console.log('Source:', result.source)
    console.log('BPM:', result.bpm)
    console.log('Rank:', result.rank)
    
    expect(result).toBeDefined()
    expect(result.source).toBe('deezer')
  })
})
