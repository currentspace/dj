/**
 * Audio Enrichment Service
 * Uses free catalog APIs (Deezer + MusicBrainz) to enrich tracks with BPM data
 *
 * Strategy:
 * 1. Use Spotify ISRC from track.external_ids.isrc
 * 2. Query Deezer by ISRC to get BPM and gain
 * 3. If no ISRC, fallback to MusicBrainz to find ISRC, then retry Deezer
 */

import { getGlobalOrchestrator } from '../utils/RateLimitedAPIClients';

export interface BPMEnrichment {
  bpm: number | null;
  gain: number | null;
  rank: number | null; // Deezer popularity rank (higher = more popular)
  release_date: string | null; // Full release date from Deezer
  source: 'deezer' | 'deezer-via-musicbrainz' | null;
}

export interface EnrichmentCache {
  enrichment: BPMEnrichment;
  fetched_at: string;
  ttl: number;
  is_miss?: boolean; // Track if this was a cache miss (null result)
}

interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  external_ids?: { isrc?: string };
}

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  bpm?: number;
  gain?: number;
  rank?: number;
  release_date?: string;
}

export class AudioEnrichmentService {
  private cache: KVNamespace | null;
  private cacheTTL: number = 90 * 24 * 60 * 60; // 90 days for hits
  private missCacheTTL: number = 5 * 60; // 5 minutes for misses (retry very soon)

  constructor(cache?: KVNamespace) {
    this.cache = cache || null;
  }

  /**
   * Enrich a single track with BPM data
   */
  async enrichTrack(track: SpotifyTrack): Promise<BPMEnrichment> {
    const cacheKey = track.id;

    // Debug: Log incoming track structure
    console.log(`[BPMEnrichment] enrichTrack called for "${track.name}" by ${track.artists[0]?.name}`, {
      has_external_ids: !!track.external_ids,
      external_ids: track.external_ids,
      track_keys: Object.keys(track)
    });

    // Try cache first
    let existingEnrichment: BPMEnrichment | null = null;
    if (this.cache) {
      const cached = await this.getCached(cacheKey);
      if (cached) {
        // If this is a complete hit (has BPM), return it
        if (cached.enrichment.bpm !== null) {
          console.log(`[DeezerEnrichment] ✅ Cache hit for ${track.id}:`, {
            bpm: cached.enrichment.bpm,
            gain: cached.enrichment.gain,
            rank: cached.enrichment.rank,
            release_date: cached.enrichment.release_date
          });
          return cached.enrichment;
        }

        // If this is a recent miss (less than 5 minutes old), return the miss
        const age = Date.now() - new Date(cached.fetched_at).getTime();
        if (cached.is_miss && age < this.missCacheTTL * 1000) {
          console.log(`[DeezerEnrichment] 🔄 Recent miss cached for ${track.id}, age: ${Math.round(age / 1000 / 60)}m`);
          return cached.enrichment;
        }

        // Store existing partial data for merging
        existingEnrichment = cached.enrichment;
        console.log(`[DeezerEnrichment] 🔄 Retrying old miss for ${track.id}`);
      }
    }

    // Get ISRC from Spotify track
    const isrc = track.external_ids?.isrc;

    console.log(`[BPMEnrichment] Track "${track.name}" ISRC: ${isrc || 'NOT FOUND'}`);

    let enrichment: BPMEnrichment;

    if (isrc) {
      console.log(`[BPMEnrichment] Querying Deezer with ISRC: ${isrc}`);
      enrichment = await this.enrichByISRC(isrc, track.duration_ms);
      console.log(`[BPMEnrichment] Deezer result for ${isrc}: BPM=${enrichment.bpm}`);
    } else {
      // Fallback: Try to get ISRC from MusicBrainz, then retry
      console.log(`[BPMEnrichment] No ISRC for "${track.name}", trying MusicBrainz`);
      const mbIsrc = await this.findISRCViaMusicBrainz(
        track.name,
        track.artists[0]?.name || '',
        track.duration_ms
      );

      if (mbIsrc) {
        console.log(`[BPMEnrichment] MusicBrainz found ISRC: ${mbIsrc}, querying Deezer`);
        enrichment = await this.enrichByISRC(mbIsrc, track.duration_ms);
        if (enrichment.bpm) {
          enrichment.source = 'deezer-via-musicbrainz';
        }
        console.log(`[BPMEnrichment] Deezer result via MusicBrainz: BPM=${enrichment.bpm}`);
      } else {
        console.log(`[DeezerEnrichment] MusicBrainz found no ISRC for "${track.name}"`);
        enrichment = { bpm: null, gain: null, rank: null, release_date: null, source: null };
      }
    }

    // Merge with existing enrichment data (additive)
    if (existingEnrichment) {
      enrichment = {
        bpm: enrichment.bpm ?? existingEnrichment.bpm,
        gain: enrichment.gain ?? existingEnrichment.gain,
        rank: enrichment.rank ?? existingEnrichment.rank,
        release_date: enrichment.release_date ?? existingEnrichment.release_date,
        source: enrichment.source ?? existingEnrichment.source
      };
      console.log(`[DeezerEnrichment] 🔗 Merged with existing data for ${track.id}`);
    }

    // Cache the result with appropriate TTL
    if (this.cache) {
      const isMiss = enrichment.bpm === null;
      await this.setCached(cacheKey, enrichment, isMiss);
      console.log(`[DeezerEnrichment] Cached ${isMiss ? 'miss' : 'hit'} for ${track.id}`);
    }

    return enrichment;
  }

  /**
   * Batch enrich multiple tracks
   * Rate limiting is handled by the orchestrator via continuous queue processing
   */
  async batchEnrichTracks(tracks: SpotifyTrack[]): Promise<Map<string, BPMEnrichment>> {
    const results = new Map<string, BPMEnrichment>();

    // Process all tracks in parallel - orchestrator controls concurrency and rate
    const promises = tracks.map(async (track) => {
      const enrichment = await this.enrichTrack(track);
      results.set(track.id, enrichment);
    });

    await Promise.all(promises);

    return results;
  }

  /**
   * Enrich using ISRC via Deezer
   */
  private async enrichByISRC(isrc: string, durationMs: number): Promise<BPMEnrichment> {
    try {
      console.log(`[BPMEnrichment] enrichByISRC called with ISRC: ${isrc}, duration: ${durationMs}ms`);

      // Try direct ISRC endpoint first
      console.log(`[BPMEnrichment] Attempting direct Deezer ISRC lookup...`);
      const directTrack = await this.deezerSingleByISRC(isrc);

      if (directTrack) {
        console.log(`[DeezerEnrichment] ✅ Direct ISRC lookup succeeded:`, {
          bpm: directTrack.bpm,
          gain: directTrack.gain,
          rank: directTrack.rank,
          release_date: directTrack.release_date
        });
        return {
          bpm: directTrack.bpm || null,
          gain: directTrack.gain ?? null,
          rank: directTrack.rank ?? null,
          release_date: directTrack.release_date ?? null,
          source: 'deezer'
        };
      } else {
        console.log(`[DeezerEnrichment] Direct ISRC lookup failed, trying search...`);
      }

      // Fallback to search endpoint with duration matching
      console.log(`[BPMEnrichment] Attempting Deezer search by ISRC...`);
      const searchResults = await this.deezerSearchByISRC(isrc);

      console.log(`[BPMEnrichment] Deezer search returned ${searchResults.length} results`);
      if (searchResults.length === 0) {
        console.log(`[BPMEnrichment] No search results for ISRC: ${isrc}`);
        return { bpm: null, gain: null, source: null };
      }

      // Find best match by duration
      const targetSec = Math.round(durationMs / 1000);
      console.log(`[BPMEnrichment] Searching for best duration match (target: ${targetSec}s)`);
      const sorted = searchResults
        .map(t => ({ track: t, diff: Math.abs((t.duration ?? 0) - targetSec) }))
        .sort((a, b) => a.diff - b.diff);

      const bestMatch = sorted[0]?.track;

      if (bestMatch) {
        console.log(`[BPMEnrichment] Best match: Deezer ID ${bestMatch.id}, duration diff: ${sorted[0].diff}s`);
        // Fetch full track details to get BPM (may not be in search results)
        console.log(`[BPMEnrichment] Fetching full track details for Deezer ID ${bestMatch.id}...`);
        const fullTrack = await this.deezerTrackById(bestMatch.id);

        if (fullTrack) {
          console.log(`[DeezerEnrichment] ✅ Successfully got full track details:`, {
            bpm: fullTrack.bpm,
            gain: fullTrack.gain,
            rank: fullTrack.rank,
            release_date: fullTrack.release_date
          });
          return {
            bpm: fullTrack.bpm || null,
            gain: fullTrack.gain ?? null,
            rank: fullTrack.rank ?? null,
            release_date: fullTrack.release_date ?? null,
            source: 'deezer'
          };
        } else {
          console.log(`[DeezerEnrichment] ❌ Full track details lookup failed`);
        }
      } else {
        console.log(`[BPMEnrichment] ❌ No best match found in search results`);
      }

      console.log(`[DeezerEnrichment] ❌ Returning null - no data found via any method`);
      return { bpm: null, gain: null, rank: null, release_date: null, source: null };
    } catch (error) {
      console.error('[DeezerEnrichment] ❌ Deezer fetch EXCEPTION:', error);
      return { bpm: null, gain: null, rank: null, release_date: null, source: null };
    }
  }

  /**
   * Find ISRC via MusicBrainz recording search
   */
  private async findISRCViaMusicBrainz(
    trackName: string,
    artistName: string,
    durationMs: number
  ): Promise<string | null> {
    try {
      const query = `recording:"${trackName}" AND artist:"${artistName}"`;
      const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=5`;

      const orchestrator = getGlobalOrchestrator();
      const response = await orchestrator.execute(() =>
        fetch(url, {
          headers: {
            'User-Agent': 'DJApp/1.0 (https://dj.current.space)'
          }
        })
      );

      if (!response || !response.ok) {
        console.error(`[BPMEnrichment] MusicBrainz error: ${response?.status || 'null'}`);
        return null;
      }

      const data = await response.json() as any;
      const recordings = data.recordings || [];

      if (recordings.length === 0) return null;

      // Find best match by duration
      const targetMs = durationMs;
      const withDuration = recordings
        .filter((r: any) => r.length && r.isrcs?.length > 0)
        .map((r: any) => ({
          recording: r,
          diff: Math.abs(r.length - targetMs),
          isrc: r.isrcs[0]
        }))
        .sort((a: any, b: any) => a.diff - b.diff);

      const best = withDuration[0];

      if (best && best.diff < 10000) { // Within 10 seconds
        console.log(`[BPMEnrichment] Found ISRC via MusicBrainz: ${best.isrc}`);
        return best.isrc;
      }

      // If no duration match, just return first ISRC
      const firstWithISRC = recordings.find((r: any) => r.isrcs?.length > 0);
      return firstWithISRC?.isrcs[0] || null;
    } catch (error) {
      console.error('[BPMEnrichment] MusicBrainz fetch failed:', error);
      return null;
    }
  }

  /**
   * Query Deezer by ISRC (search endpoint)
   */
  private async deezerSearchByISRC(isrc: string): Promise<DeezerTrack[]> {
    try {
      const url = `https://api.deezer.com/search?q=${encodeURIComponent(`isrc:${isrc}`)}`;
      console.log(`[BPMEnrichment] Deezer search URL: ${url}`);

      const orchestrator = getGlobalOrchestrator();
      const response = await orchestrator.execute(() => fetch(url));

      console.log(`[BPMEnrichment] Deezer search response status: ${response?.status || 'null'}`);
      if (!response || !response.ok) {
        return [];
      }

      const data = await response.json() as any;
      const results = data?.data ?? [];
      console.log(`[BPMEnrichment] Deezer search results: ${results.length} tracks found`);
      return results;
    } catch (error) {
      console.error('[BPMEnrichment] Deezer search failed:', error);
      return [];
    }
  }

  /**
   * Get single Deezer track by ISRC
   */
  private async deezerSingleByISRC(isrc: string): Promise<DeezerTrack | null> {
    try {
      const url = `https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`;
      console.log(`[BPMEnrichment] Deezer direct ISRC URL: ${url}`);

      const orchestrator = getGlobalOrchestrator();
      const response = await orchestrator.execute(() => fetch(url));

      console.log(`[BPMEnrichment] Deezer direct ISRC response status: ${response?.status || 'null'}`);
      if (!response || !response.ok) {
        return null;
      }

      const data = await response.json() as any;
      const hasTrack = !!data?.id;
      const hasBPM = !!data?.bpm;
      console.log(`[BPMEnrichment] Deezer direct result: hasTrack=${hasTrack}, hasBPM=${hasBPM}, BPM=${data?.bpm || 'N/A'}`);
      return data?.id ? data : null;
    } catch (error) {
      console.error('[BPMEnrichment] Deezer ISRC lookup failed:', error);
      return null;
    }
  }

  /**
   * Get full Deezer track details by ID (to ensure BPM is included)
   */
  private async deezerTrackById(id: number): Promise<DeezerTrack | null> {
    try {
      const url = `https://api.deezer.com/track/${id}`;
      console.log(`[BPMEnrichment] Fetching Deezer track by ID: ${url}`);

      const orchestrator = getGlobalOrchestrator();
      const response = await orchestrator.execute(() => fetch(url));

      console.log(`[BPMEnrichment] Deezer track by ID response status: ${response?.status || 'null'}`);
      if (!response || !response.ok) {
        return null;
      }

      const data = await response.json() as any;
      const hasTrack = !!data?.id;
      const hasBPM = !!data?.bpm;
      console.log(`[BPMEnrichment] Deezer track by ID result: hasTrack=${hasTrack}, hasBPM=${hasBPM}, BPM=${data?.bpm || 'N/A'}`);
      if (data?.error) {
        console.error(`[BPMEnrichment] Deezer track by ID error:`, data.error);
      }
      return data?.id ? data : null;
    } catch (error) {
      console.error('[BPMEnrichment] Deezer track fetch EXCEPTION:', error);
      return null;
    }
  }

  /**
   * Get cached enrichment
   */
  private async getCached(trackId: string): Promise<EnrichmentCache | null> {
    if (!this.cache) return null;

    try {
      const cached = await this.cache.get(`bpm:${trackId}`, 'json');
      if (!cached) return null;

      const enrichment = cached as EnrichmentCache;

      // Check if cache is stale
      const fetchedAt = new Date(enrichment.fetched_at).getTime();
      const now = Date.now();
      const age = now - fetchedAt;

      if (age > enrichment.ttl * 1000) {
        console.log(`[BPMEnrichment] Cache expired for ${trackId}`);
        return null;
      }

      return enrichment;
    } catch (error) {
      console.error('[BPMEnrichment] Cache read error:', error);
      return null;
    }
  }

  /**
   * Cache enrichment data
   */
  private async setCached(trackId: string, enrichment: BPMEnrichment, isMiss: boolean = false): Promise<void> {
    if (!this.cache) return;

    try {
      const ttl = isMiss ? this.missCacheTTL : this.cacheTTL;
      const cacheData: EnrichmentCache = {
        enrichment,
        fetched_at: new Date().toISOString(),
        ttl,
        is_miss: isMiss
      };

      await this.cache.put(
        `bpm:${trackId}`,
        JSON.stringify(cacheData),
        { expirationTtl: ttl }
      );

      const ttlDisplay = isMiss ? `${Math.round(ttl / 60)}m` : `${Math.round(ttl / 86400)}d`;
      console.log(`[BPMEnrichment] Cached ${isMiss ? 'miss' : 'hit'} for ${trackId} (TTL: ${ttlDisplay})`);
    } catch (error) {
      console.error('[BPMEnrichment] Cache write error:', error);
    }
  }

  /**
   * Validate BPM value (reject suspicious values)
   */
  static isValidBPM(bpm: number | null): boolean {
    if (bpm === null) return false;
    return bpm >= 45 && bpm <= 220;
  }
}
