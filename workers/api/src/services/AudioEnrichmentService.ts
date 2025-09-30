/**
 * Audio Enrichment Service
 * Replaces deprecated Spotify audio features API with SoundNet API
 */

export interface AudioFeatures {
  tempo: number;
  key: string;
  mode: 'major' | 'minor';
  camelot?: string;
  energy: number;        // 0-1
  danceability: number;  // 0-1
  valence: number;       // 0-1 (happiness)
  acousticness: number;  // 0-1
  instrumentalness: number; // 0-1
  speechiness: number;   // 0-1
  loudness: number;      // dB
  source: string;
}

export interface EnrichmentCache {
  features: AudioFeatures;
  fetched_at: string;
  ttl: number;
}

export class AudioEnrichmentService {
  private rapidApiKey: string;
  private cache: KVNamespace | null;
  private cacheTTL: number = 30 * 24 * 60 * 60; // 30 days

  constructor(rapidApiKey: string, cache?: KVNamespace) {
    this.rapidApiKey = rapidApiKey;
    this.cache = cache || null;
  }

  /**
   * Get audio features for a track, with caching
   */
  async getAudioFeatures(
    trackName: string,
    artistName: string,
    cacheKey?: string
  ): Promise<AudioFeatures | null> {
    const key = cacheKey || this.generateCacheKey(trackName, artistName);

    // Try cache first
    if (this.cache) {
      const cached = await this.getCached(key);
      if (cached) {
        console.log(`[AudioEnrichment] Cache hit for ${key}`);
        return cached.features;
      }
    }

    // Fetch from SoundNet API
    console.log(`[AudioEnrichment] Fetching from SoundNet: ${trackName} - ${artistName}`);
    const features = await this.fetchFromSoundNet(trackName, artistName);

    // Cache the result
    if (features && this.cache) {
      await this.setCached(key, features);
    }

    return features;
  }

  /**
   * Batch fetch audio features for multiple tracks
   */
  async batchGetAudioFeatures(
    tracks: Array<{ name: string; artists: string; id?: string }>
  ): Promise<Map<string, AudioFeatures>> {
    const results = new Map<string, AudioFeatures>();

    // Process in parallel with rate limiting (max 5 concurrent)
    const batchSize = 5;
    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);

      const batchPromises = batch.map(async (track) => {
        const key = track.id || this.generateCacheKey(track.name, track.artists);
        const features = await this.getAudioFeatures(track.name, track.artists, key);

        if (features) {
          results.set(key, features);
        }
      });

      await Promise.all(batchPromises);

      // Small delay between batches to avoid rate limits
      if (i + batchSize < tracks.length) {
        await this.sleep(100);
      }
    }

    return results;
  }

  /**
   * Fetch audio features from SoundNet Track Analysis API
   */
  private async fetchFromSoundNet(
    songName: string,
    artistName: string
  ): Promise<AudioFeatures | null> {
    try {
      const params = new URLSearchParams({
        song: songName,
        artist: artistName
      });

      const response = await fetch(
        `https://track-analysis.p.rapidapi.com/pktx/rapid?${params}`,
        {
          headers: {
            'x-rapidapi-key': this.rapidApiKey,
            'x-rapidapi-host': 'track-analysis.p.rapidapi.com'
          }
        }
      );

      if (!response.ok) {
        console.error(`[AudioEnrichment] SoundNet API error: ${response.status}`);
        return null;
      }

      const data = await response.json() as any;

      // Map SoundNet response to our AudioFeatures interface
      return {
        tempo: parseFloat(data.tempo) || 0,
        key: data.key || 'C',
        mode: data.mode || 'major',
        camelot: data.camelot,
        energy: (parseFloat(data.energy) || 50) / 100,
        danceability: (parseFloat(data.danceability) || 50) / 100,
        valence: (parseFloat(data.happiness) || 50) / 100,
        acousticness: (parseFloat(data.acousticness) || 50) / 100,
        instrumentalness: (parseFloat(data.instrumentalness) || 50) / 100,
        speechiness: (parseFloat(data.speechiness) || 10) / 100,
        loudness: parseFloat(data.loudness) || -10,
        source: 'soundnet'
      };
    } catch (error) {
      console.error('[AudioEnrichment] SoundNet fetch failed:', error);
      return null;
    }
  }

  /**
   * Get cached audio features
   */
  private async getCached(key: string): Promise<EnrichmentCache | null> {
    if (!this.cache) return null;

    try {
      const cached = await this.cache.get(`features:${key}`, 'json');
      if (!cached) return null;

      const enrichment = cached as EnrichmentCache;

      // Check if cache is stale
      const fetchedAt = new Date(enrichment.fetched_at).getTime();
      const now = Date.now();
      const age = now - fetchedAt;

      if (age > enrichment.ttl * 1000) {
        console.log(`[AudioEnrichment] Cache expired for ${key}`);
        return null;
      }

      return enrichment;
    } catch (error) {
      console.error('[AudioEnrichment] Cache read error:', error);
      return null;
    }
  }

  /**
   * Cache audio features
   */
  private async setCached(key: string, features: AudioFeatures): Promise<void> {
    if (!this.cache) return;

    try {
      const enrichment: EnrichmentCache = {
        features,
        fetched_at: new Date().toISOString(),
        ttl: this.cacheTTL
      };

      await this.cache.put(
        `features:${key}`,
        JSON.stringify(enrichment),
        { expirationTtl: this.cacheTTL }
      );

      console.log(`[AudioEnrichment] Cached features for ${key}`);
    } catch (error) {
      console.error('[AudioEnrichment] Cache write error:', error);
    }
  }

  /**
   * Generate cache key from track name and artist
   */
  private generateCacheKey(trackName: string, artistName: string): string {
    const normalized = `${trackName}_${artistName}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_');

    return this.hashString(normalized);
  }

  /**
   * Simple hash function for cache keys
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Sleep utility for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate Camelot key from key and mode
   */
  static calculateCamelot(key: string, mode: 'major' | 'minor'): string {
    const camelotWheel: Record<string, { major: string; minor: string }> = {
      'C': { major: '8B', minor: '5A' },
      'C#': { major: '3B', minor: '12A' },
      'Db': { major: '3B', minor: '12A' },
      'D': { major: '10B', minor: '7A' },
      'D#': { major: '5B', minor: '2A' },
      'Eb': { major: '5B', minor: '2A' },
      'E': { major: '12B', minor: '9A' },
      'F': { major: '7B', minor: '4A' },
      'F#': { major: '2B', minor: '11A' },
      'Gb': { major: '2B', minor: '11A' },
      'G': { major: '9B', minor: '6A' },
      'G#': { major: '4B', minor: '1A' },
      'Ab': { major: '4B', minor: '1A' },
      'A': { major: '11B', minor: '8A' },
      'A#': { major: '6B', minor: '3A' },
      'Bb': { major: '6B', minor: '3A' },
      'B': { major: '1B', minor: '10A' }
    };

    const keyData = camelotWheel[key];
    if (!keyData) return '1A';

    return mode === 'major' ? keyData.major : keyData.minor;
  }
}
