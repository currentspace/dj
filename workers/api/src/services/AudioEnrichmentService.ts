/**
 * Audio Enrichment Service
 * Uses free catalog APIs (Deezer + MusicBrainz) to enrich tracks with BPM data
 *
 * Strategy:
 * 1. Use Spotify ISRC from track.external_ids.isrc
 * 2. Query Deezer by ISRC to get BPM and gain
 * 3. If no ISRC, fallback to MusicBrainz to find ISRC, then retry Deezer
 */

export interface BPMEnrichment {
  bpm: number | null;
  gain: number | null;
  source: 'deezer' | 'deezer-via-musicbrainz' | null;
}

export interface EnrichmentCache {
  enrichment: BPMEnrichment;
  fetched_at: string;
  ttl: number;
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
}

export class AudioEnrichmentService {
  private cache: KVNamespace | null;
  private cacheTTL: number = 90 * 24 * 60 * 60; // 90 days
  private rateLimitDelay: number = 200; // 200ms between calls (5 QPS)

  constructor(cache?: KVNamespace) {
    this.cache = cache || null;
  }

  /**
   * Enrich a single track with BPM data
   */
  async enrichTrack(track: SpotifyTrack): Promise<BPMEnrichment> {
    const cacheKey = track.id;

    // Try cache first
    if (this.cache) {
      const cached = await this.getCached(cacheKey);
      if (cached) {
        console.log(`[BPMEnrichment] Cache hit for ${track.id}`);
        return cached.enrichment;
      }
    }

    // Get ISRC from Spotify track
    const isrc = track.external_ids?.isrc;

    let enrichment: BPMEnrichment;

    if (isrc) {
      enrichment = await this.enrichByISRC(isrc, track.duration_ms);
    } else {
      // Fallback: Try to get ISRC from MusicBrainz, then retry
      console.log(`[BPMEnrichment] No ISRC for ${track.name}, trying MusicBrainz`);
      const mbIsrc = await this.findISRCViaMusicBrainz(
        track.name,
        track.artists[0]?.name || '',
        track.duration_ms
      );

      if (mbIsrc) {
        enrichment = await this.enrichByISRC(mbIsrc, track.duration_ms);
        if (enrichment.bpm) {
          enrichment.source = 'deezer-via-musicbrainz';
        }
      } else {
        enrichment = { bpm: null, gain: null, source: null };
      }
    }

    // Cache the result (even if null, to avoid repeat lookups)
    if (this.cache) {
      await this.setCached(cacheKey, enrichment);
    }

    return enrichment;
  }

  /**
   * Batch enrich multiple tracks with rate limiting
   */
  async batchEnrichTracks(tracks: SpotifyTrack[]): Promise<Map<string, BPMEnrichment>> {
    const results = new Map<string, BPMEnrichment>();

    // Process in parallel with rate limiting (max 5 concurrent)
    const batchSize = 5;
    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);

      const batchPromises = batch.map(async (track) => {
        const enrichment = await this.enrichTrack(track);
        results.set(track.id, enrichment);
      });

      await Promise.all(batchPromises);

      // Rate limiting delay between batches
      if (i + batchSize < tracks.length) {
        await this.sleep(this.rateLimitDelay);
      }
    }

    return results;
  }

  /**
   * Enrich using ISRC via Deezer
   */
  private async enrichByISRC(isrc: string, durationMs: number): Promise<BPMEnrichment> {
    try {
      // Try direct ISRC endpoint first
      const directTrack = await this.deezerSingleByISRC(isrc);

      if (directTrack?.bpm) {
        return {
          bpm: directTrack.bpm,
          gain: directTrack.gain ?? null,
          source: 'deezer'
        };
      }

      // Fallback to search endpoint with duration matching
      const searchResults = await this.deezerSearchByISRC(isrc);

      if (searchResults.length === 0) {
        return { bpm: null, gain: null, source: null };
      }

      // Find best match by duration
      const targetSec = Math.round(durationMs / 1000);
      const sorted = searchResults
        .map(t => ({ track: t, diff: Math.abs((t.duration ?? 0) - targetSec) }))
        .sort((a, b) => a.diff - b.diff);

      const bestMatch = sorted[0]?.track;

      if (bestMatch) {
        // Fetch full track details to get BPM (may not be in search results)
        const fullTrack = await this.deezerTrackById(bestMatch.id);

        if (fullTrack?.bpm) {
          return {
            bpm: fullTrack.bpm,
            gain: fullTrack.gain ?? null,
            source: 'deezer'
          };
        }
      }

      return { bpm: null, gain: null, source: null };
    } catch (error) {
      console.error('[BPMEnrichment] Deezer fetch failed:', error);
      return { bpm: null, gain: null, source: null };
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

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'DJApp/1.0 (https://dj.current.space)'
        }
      });

      if (!response.ok) {
        console.error(`[BPMEnrichment] MusicBrainz error: ${response.status}`);
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
      const response = await fetch(url);
      const data = await response.json() as any;
      return data?.data ?? [];
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
      const response = await fetch(url);
      const data = await response.json() as any;
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
      const response = await fetch(url);
      const data = await response.json() as any;
      return data?.id ? data : null;
    } catch (error) {
      console.error('[BPMEnrichment] Deezer track fetch failed:', error);
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
  private async setCached(trackId: string, enrichment: BPMEnrichment): Promise<void> {
    if (!this.cache) return;

    try {
      const cacheData: EnrichmentCache = {
        enrichment,
        fetched_at: new Date().toISOString(),
        ttl: this.cacheTTL
      };

      await this.cache.put(
        `bpm:${trackId}`,
        JSON.stringify(cacheData),
        { expirationTtl: this.cacheTTL }
      );

      console.log(`[BPMEnrichment] Cached for ${trackId}`);
    } catch (error) {
      console.error('[BPMEnrichment] Cache write error:', error);
    }
  }

  /**
   * Sleep utility for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate BPM value (reject suspicious values)
   */
  static isValidBPM(bpm: number | null): boolean {
    if (bpm === null) return false;
    return bpm >= 45 && bpm <= 220;
  }
}
