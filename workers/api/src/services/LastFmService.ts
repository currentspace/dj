/**
 * Last.fm Service
 * Provides crowd-sourced taste signals: tags, popularity, and similar tracks
 *
 * Use cases:
 * - Genre/mood/era tagging (crowd-applied labels)
 * - Popularity metrics (listeners, playcounts)
 * - Similar tracks for transitions and recommendations
 * - Track/artist name normalization
 */

export interface LastFmSignals {
  // Track identifiers
  canonicalArtist: string;
  canonicalTrack: string;
  mbid: string | null;
  url: string | null; // Last.fm track URL
  duration: number | null; // Track duration in seconds

  // Track popularity
  listeners: number;
  playcount: number;
  userplaycount?: number;

  // Tags/genres
  topTags: string[];

  // Album info
  album: {
    title: string;
    artist: string;
    mbid: string | null;
    url: string | null;
    image: string | null; // Album art URL (largest available)
  } | null;

  // Track description
  wiki: {
    summary: string;
    content: string;
    published: string;
  } | null;

  // Similar tracks (for transitions/recommendations)
  similar: Array<{ artist: string; name: string; match: number }>;

  // Artist info (enriched data)
  artistInfo: {
    listeners: number;
    playcount: number;
    bio: {
      summary: string;
      content: string;
    } | null;
    tags: string[];
    similar: Array<{ name: string; url: string }>;
    images: {
      small: string | null;
      medium: string | null;
      large: string | null;
    };
  } | null;
}

export interface LastFmCache {
  signals: LastFmSignals;
  fetched_at: string;
  ttl: number;
}

interface LastFmTrack {
  name: string;
  artist: string;
  duration_ms?: number;
}

export class LastFmService {
  private apiKey: string;
  private cache: KVNamespace | null;
  private cacheTTL: number = 7 * 24 * 60 * 60; // 7 days (refresh weekly)
  private apiBaseUrl = 'https://ws.audioscrobbler.com/2.0/';

  constructor(apiKey: string, cache?: KVNamespace) {
    this.apiKey = apiKey;
    this.cache = cache || null;
  }

  /**
   * Get comprehensive Last.fm signals for a track
   */
  async getTrackSignals(track: LastFmTrack): Promise<LastFmSignals | null> {
    const cacheKey = this.generateCacheKey(track.artist, track.name);

    // Try cache first
    if (this.cache) {
      const cached = await this.getCached(cacheKey);
      if (cached) {
        console.log(`[LastFm] Cache hit for ${track.artist} - ${track.name}`);
        return cached.signals;
      }
    }

    try {
      // Step 1: Get corrected/canonical names
      const corrected = await this.getCorrection(track.artist, track.name);
      const canonicalArtist = corrected?.artist || track.artist;
      const canonicalTrack = corrected?.track || track.name;

      // Step 2: Get track info (popularity, MBID, album, wiki, duration)
      const info = await this.getTrackInfo(canonicalArtist, canonicalTrack);

      // Step 3: Get top tags
      const tags = await this.getTopTags(canonicalArtist, canonicalTrack);

      // Step 4: Get similar tracks
      const similar = await this.getSimilarTracks(canonicalArtist, canonicalTrack);

      // Step 5: Get artist info (bio, tags, similar artists)
      const artistInfo = await this.getArtistInfo(canonicalArtist);

      const signals: LastFmSignals = {
        // Track identifiers
        canonicalArtist,
        canonicalTrack,
        mbid: info?.mbid || null,
        url: info?.url || null,
        duration: info?.duration || null,

        // Track popularity
        listeners: info?.listeners || 0,
        playcount: info?.playcount || 0,
        userplaycount: info?.userplaycount,

        // Tags/genres
        topTags: tags || [],

        // Album info
        album: info?.album || null,

        // Track description
        wiki: info?.wiki || null,

        // Similar tracks
        similar: similar || [],

        // Artist info
        artistInfo
      };

      // Cache the result
      if (this.cache) {
        await this.setCached(cacheKey, signals);
      }

      return signals;
    } catch (error) {
      console.error('[LastFm] Failed to get track signals:', error);
      return null;
    }
  }

  /**
   * Batch get signals for multiple tracks
   */
  async batchGetSignals(tracks: LastFmTrack[]): Promise<Map<string, LastFmSignals>> {
    const results = new Map<string, LastFmSignals>();

    // Process in batches with delay to respect rate limits
    const batchSize = 5;
    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);

      const batchPromises = batch.map(async (track) => {
        const signals = await this.getTrackSignals(track);
        if (signals) {
          const key = this.generateCacheKey(track.artist, track.name);
          results.set(key, signals);
        }
      });

      await Promise.all(batchPromises);

      // Delay between batches (Last.fm rate limit)
      if (i + batchSize < tracks.length) {
        await this.sleep(200);
      }
    }

    return results;
  }

  /**
   * Get track correction (canonical names)
   */
  private async getCorrection(artist: string, track: string): Promise<{ artist: string; track: string } | null> {
    try {
      const data = await this.callApi('track.getCorrection', {
        artist,
        track
      });

      const correction = data?.corrections?.correction;
      if (correction?.track) {
        return {
          artist: correction.track.artist?.name || artist,
          track: correction.track.name || track
        };
      }

      return null;
    } catch (error) {
      console.error('[LastFm] Correction failed:', error);
      return null;
    }
  }

  /**
   * Get track info (listeners, playcount, MBID, album, wiki, etc.)
   */
  private async getTrackInfo(artist: string, track: string): Promise<{
    listeners: number;
    playcount: number;
    mbid: string | null;
    url: string | null;
    duration: number | null;
    userplaycount?: number;
    album: {
      title: string;
      artist: string;
      mbid: string | null;
      url: string | null;
      image: string | null;
    } | null;
    wiki: {
      summary: string;
      content: string;
      published: string;
    } | null;
  } | null> {
    try {
      const data = await this.callApi('track.getInfo', {
        artist,
        track,
        autocorrect: '1'
      });

      const trackData = data?.track;
      if (!trackData) return null;

      // Extract album info
      let album = null;
      if (trackData.album) {
        // Get largest available album image
        const images = trackData.album.image || [];
        const largestImage = images.find((img: any) => img.size === 'extralarge' || img.size === 'large' || img.size === 'medium');

        album = {
          title: trackData.album.title || trackData.album['#text'] || '',
          artist: trackData.album.artist || artist,
          mbid: trackData.album.mbid || null,
          url: trackData.album.url || null,
          image: largestImage?.['#text'] || null
        };
      }

      // Extract wiki info
      let wiki = null;
      if (trackData.wiki) {
        wiki = {
          summary: trackData.wiki.summary || '',
          content: trackData.wiki.content || '',
          published: trackData.wiki.published || ''
        };
      }

      return {
        listeners: parseInt(trackData.listeners || '0', 10),
        playcount: parseInt(trackData.playcount || '0', 10),
        mbid: trackData.mbid || null,
        url: trackData.url || null,
        duration: trackData.duration ? parseInt(trackData.duration, 10) : null,
        userplaycount: trackData.userplaycount ? parseInt(trackData.userplaycount, 10) : undefined,
        album,
        wiki
      };
    } catch (error) {
      console.error('[LastFm] Track info failed:', error);
      return null;
    }
  }

  /**
   * Get top tags for a track (genre/mood/era)
   */
  private async getTopTags(artist: string, track: string): Promise<string[]> {
    try {
      const data = await this.callApi('track.getTopTags', {
        artist,
        track,
        autocorrect: '1'
      });

      const tags = data?.toptags?.tag;
      if (!tags || !Array.isArray(tags)) return [];

      return tags.slice(0, 10).map((t: any) => t.name);
    } catch (error) {
      console.error('[LastFm] Top tags failed:', error);
      return [];
    }
  }

  /**
   * Get similar tracks (for transitions and recommendations)
   */
  private async getSimilarTracks(artist: string, track: string): Promise<Array<{ artist: string; name: string; match: number }>> {
    try {
      const data = await this.callApi('track.getSimilar', {
        artist,
        track,
        autocorrect: '1',
        limit: '20'
      });

      const tracks = data?.similartracks?.track;
      if (!tracks || !Array.isArray(tracks)) return [];

      return tracks.map((t: any) => ({
        artist: t.artist?.name || '',
        name: t.name || '',
        match: parseFloat(t.match || '0')
      }));
    } catch (error) {
      console.error('[LastFm] Similar tracks failed:', error);
      return [];
    }
  }

  /**
   * Get artist info (bio, tags, similar artists, stats)
   */
  private async getArtistInfo(artist: string): Promise<{
    listeners: number;
    playcount: number;
    bio: { summary: string; content: string } | null;
    tags: string[];
    similar: Array<{ name: string; url: string }>;
    images: { small: string | null; medium: string | null; large: string | null };
  } | null> {
    try {
      const data = await this.callApi('artist.getInfo', {
        artist,
        autocorrect: '1'
      });

      const artistData = data?.artist;
      if (!artistData) return null;

      // Extract bio
      let bio = null;
      if (artistData.bio) {
        bio = {
          summary: artistData.bio.summary || '',
          content: artistData.bio.content || ''
        };
      }

      // Extract tags
      const tags = artistData.tags?.tag || [];
      const tagNames = Array.isArray(tags) ? tags.slice(0, 10).map((t: any) => t.name) : [];

      // Extract similar artists
      const similar = artistData.similar?.artist || [];
      const similarArtists = Array.isArray(similar) ? similar.slice(0, 10).map((a: any) => ({
        name: a.name || '',
        url: a.url || ''
      })) : [];

      // Extract images
      const images = artistData.image || [];
      const imageMap = {
        small: images.find((img: any) => img.size === 'small')?.[' #text'] || null,
        medium: images.find((img: any) => img.size === 'medium')?['#text'] || null,
        large: images.find((img: any) => img.size === 'large' || img.size === 'extralarge')?['#text'] || null
      };

      return {
        listeners: parseInt(artistData.stats?.listeners || '0', 10),
        playcount: parseInt(artistData.stats?.playcount || '0', 10),
        bio,
        tags: tagNames,
        similar: similarArtists,
        images: imageMap
      };
    } catch (error) {
      console.error('[LastFm] Artist info failed:', error);
      return null;
    }
  }

  /**
   * Call Last.fm API
   */
  private async callApi(method: string, params: Record<string, string>): Promise<any> {
    const queryParams = new URLSearchParams({
      method,
      api_key: this.apiKey,
      format: 'json',
      ...params
    });

    const url = `${this.apiBaseUrl}?${queryParams}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Last.fm API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get cached signals
   */
  private async getCached(key: string): Promise<LastFmCache | null> {
    if (!this.cache) return null;

    try {
      const cached = await this.cache.get(`lastfm:${key}`, 'json');
      if (!cached) return null;

      const lastfmCache = cached as LastFmCache;

      // Check if cache is stale
      const fetchedAt = new Date(lastfmCache.fetched_at).getTime();
      const now = Date.now();
      const age = now - fetchedAt;

      if (age > lastfmCache.ttl * 1000) {
        console.log(`[LastFm] Cache expired for ${key}`);
        return null;
      }

      return lastfmCache;
    } catch (error) {
      console.error('[LastFm] Cache read error:', error);
      return null;
    }
  }

  /**
   * Cache signals
   */
  private async setCached(key: string, signals: LastFmSignals): Promise<void> {
    if (!this.cache) return;

    try {
      const cacheData: LastFmCache = {
        signals,
        fetched_at: new Date().toISOString(),
        ttl: this.cacheTTL
      };

      await this.cache.put(
        `lastfm:${key}`,
        JSON.stringify(cacheData),
        { expirationTtl: this.cacheTTL }
      );

      console.log(`[LastFm] Cached signals for ${key}`);
    } catch (error) {
      console.error('[LastFm] Cache write error:', error);
    }
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(artist: string, track: string): string {
    const normalized = `${artist}_${track}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_');

    return this.hashString(normalized);
  }

  /**
   * Simple hash function
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Aggregate tags from multiple tracks to get playlist-level tags
   */
  static aggregateTags(signalsMap: Map<string, LastFmSignals>): Array<{ tag: string; count: number }> {
    const tagCounts = new Map<string, number>();

    for (const signals of signalsMap.values()) {
      for (const tag of signals.topTags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }

  /**
   * Calculate average popularity from signals
   */
  static calculateAveragePopularity(signalsMap: Map<string, LastFmSignals>): {
    avgListeners: number;
    avgPlaycount: number;
  } {
    const signals = Array.from(signalsMap.values());
    if (signals.length === 0) {
      return { avgListeners: 0, avgPlaycount: 0 };
    }

    const totalListeners = signals.reduce((sum, s) => sum + s.listeners, 0);
    const totalPlaycount = signals.reduce((sum, s) => sum + s.playcount, 0);

    return {
      avgListeners: Math.round(totalListeners / signals.length),
      avgPlaycount: Math.round(totalPlaycount / signals.length)
    };
  }
}
