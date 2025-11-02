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

import { getGlobalOrchestrator, rateLimitedLastFmCall } from '../utils/RateLimitedAPIClients';

export interface LastFmCache {
  fetched_at: string;
  is_miss?: boolean; // Track if this was a cache miss (no data found)
  signals: LastFmSignals;
  ttl: number;
}

export interface LastFmSignals {
  // Album info
  album: null | {
    artist: string;
    image: null | string; // Album art URL (largest available)
    mbid: null | string;
    title: string;
    url: null | string;
  };
  // Artist info (enriched data)
  artistInfo: null | {
    bio: null | {
      content: string;
      summary: string;
    };
    images: {
      large: null | string;
      medium: null | string;
      small: null | string;
    };
    listeners: number;
    playcount: number;
    similar: { name: string; url: string }[];
    tags: string[];
  };
  // Track identifiers
  canonicalArtist: string;
  canonicalTrack: string;
  duration: null | number; // Track duration in seconds

  // Track popularity
  listeners: number;
  mbid: null | string;
  playcount: number;

  // Similar tracks (for transitions/recommendations)
  similar: { artist: string; match: number; name: string; }[];

  // Tags/genres
  topTags: string[];

  url: null | string; // Last.fm track URL

  userplaycount?: number;

  // Track description
  wiki: null | {
    content: string;
    published: string;
    summary: string;
  };
}

interface LastFmTrack {
  artist: string;
  duration_ms?: number;
  name: string;
}

export class LastFmService {
  private apiBaseUrl = 'https://ws.audioscrobbler.com/2.0/';
  private apiKey: string;
  private cache: KVNamespace | null;
  private cacheTTL: number = 7 * 24 * 60 * 60; // 7 days for hits (refresh weekly)
  private missCacheTTL: number = 5 * 60; // 5 minutes for misses (retry very soon)

  constructor(apiKey: string, cache?: KVNamespace) {
    this.apiKey = apiKey;
    this.cache = cache || null;
  }

  /**
   * Aggregate tags from multiple tracks to get playlist-level tags
   */
  static aggregateTags(signalsMap: Map<string, LastFmSignals>): { count: number; tag: string; }[] {
    const tagCounts = new Map<string, number>();

    for (const signals of signalsMap.values()) {
      for (const tag of signals.topTags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ count, tag }))
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

  /**
   * Batch get artist info for unique artists with KV caching and rate-limited queue
   */
  async batchGetArtistInfo(
    artists: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<Map<string, any>> {
    const results = new Map();
    const uniqueArtists = [...new Set(artists)]; // Deduplicate

    console.log(`[LastFm] Fetching artist info for ${uniqueArtists.length} unique artists (orchestrated)...`);

    const orchestrator = getGlobalOrchestrator();

    // Create tasks for all artists
    const tasks = uniqueArtists.map(artist => async () => {
      const cacheKey = `artist_${this.hashString(artist.toLowerCase())}`;

      try {
        // Check cache first
        let artistInfo = null;
        if (this.cache) {
          const cached = await this.cache.get(cacheKey, 'json');
          if (cached) {
            artistInfo = cached as any;
            console.log(`[LastFm] Artist cache hit: ${artist}`);
            return { artist, info: artistInfo };
          }
        }

        // Fetch via rate-limited orchestrator (not cached)
        artistInfo = await rateLimitedLastFmCall(
          () => this.getArtistInfo(artist),
          undefined,
          `artist:${artist}`
        );

        // Cache the result
        if (artistInfo && this.cache) {
          await this.cache.put(cacheKey, JSON.stringify(artistInfo), {
            expirationTtl: this.cacheTTL
          });
        }

        return { artist, info: artistInfo };
      } catch (error) {
        console.error(`[LastFm] Failed to get artist info for ${artist}:`, error);
        return { artist, info: null };
      }
    });

    // Execute batch using new orchestrator API (executeBatch)
    // All tasks execute in parallel respecting lane concurrency (10 for lastfm)
    let completed = 0;
    const wrappedTasks = tasks.map((task) => async () => {
      const result = await task();
      completed++;
      if (onProgress && completed % 10 === 0) {
        onProgress(completed, uniqueArtists.length);
      }
      return result;
    });

    const batchResults = await orchestrator.executeBatch(wrappedTasks, 'lastfm');

    // Final progress update
    if (onProgress) {
      onProgress(uniqueArtists.length, uniqueArtists.length);
    }

    // Build results map
    for (const result of batchResults) {
      if (result?.info) {
        results.set(result.artist.toLowerCase(), result.info);
      }
    }

    return results;
  }

  /**
   * Batch get signals for multiple tracks (skips artist info by default for performance)
   * Rate limiting is handled by the orchestrator via continuous queue processing
   */
  async batchGetSignals(tracks: LastFmTrack[], skipArtistInfo = true): Promise<Map<string, LastFmSignals>> {
    const results = new Map<string, LastFmSignals>();

    // Process all tracks in parallel - orchestrator controls concurrency and rate
    const promises = tracks.map(async (track) => {
      const signals = await this.getTrackSignals(track, skipArtistInfo);
      if (signals) {
        const key = this.generateCacheKey(track.artist, track.name);
        results.set(key, signals);
      }
    });

    await Promise.all(promises);

    return results;
  }

  /**
   * Generate cache key (public for external cache updates)
   */
  generateCacheKey(artist: string, track: string): string {
    const normalized = `${artist}_${track}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_');

    return this.hashString(normalized);
  }

  /**
   * Get comprehensive Last.fm signals for a track (WITHOUT artist info to avoid rate limiting)
   * Use getArtistInfo() separately for unique artists to minimize API calls
   */
  async getTrackSignals(track: LastFmTrack, skipArtistInfo = true): Promise<LastFmSignals | null> {
    const cacheKey = this.generateCacheKey(track.artist, track.name);

    // Try cache first
    let existingSignals: LastFmSignals | null = null;
    if (this.cache) {
      const cached = await this.getCached(cacheKey);
      if (cached) {
        // If this has meaningful data (tags or popularity), return it
        const hasData = cached.signals.topTags.length > 0 || cached.signals.listeners > 0;
        if (hasData) {
          console.log(`[LastFm] ✅ Cache hit for ${track.artist} - ${track.name}`);
          return cached.signals;
        }

        // If this is a recent miss (less than 5 minutes old), return the miss
        const age = Date.now() - new Date(cached.fetched_at).getTime();
        if (cached.is_miss && age < this.missCacheTTL * 1000) {
          console.log(`[LastFm] 🔄 Recent miss cached for ${track.artist} - ${track.name}, age: ${Math.round(age / 1000 / 60)}m`);
          return cached.signals;
        }

        // Store existing partial data for merging
        existingSignals = cached.signals;
        console.log(`[LastFm] 🔄 Retrying old miss for ${track.artist} - ${track.name}`);
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

      // Step 5: Get artist info (bio, tags, similar artists) - ONLY if requested
      let artistInfo = null;
      if (!skipArtistInfo) {
        artistInfo = await this.getArtistInfo(canonicalArtist);
      }

      let signals: LastFmSignals = {
        // Album info
        album: info?.album || null,
        // Artist info (null if skipArtistInfo=true)
        artistInfo,
        // Track identifiers
        canonicalArtist,
        canonicalTrack,
        duration: info?.duration || null,

        // Track popularity
        listeners: info?.listeners || 0,
        mbid: info?.mbid || null,
        playcount: info?.playcount || 0,

        // Similar tracks
        similar: similar || [],

        // Tags/genres
        topTags: tags || [],

        url: info?.url || null,

        userplaycount: info?.userplaycount,

        // Track description
        wiki: info?.wiki || null
      };

      // Merge with existing signals (additive)
      if (existingSignals) {
        signals = {
          album: signals.album ?? existingSignals.album,
          artistInfo: signals.artistInfo ?? existingSignals.artistInfo,
          canonicalArtist: signals.canonicalArtist || existingSignals.canonicalArtist,
          canonicalTrack: signals.canonicalTrack || existingSignals.canonicalTrack,
          duration: signals.duration ?? existingSignals.duration,
          listeners: Math.max(signals.listeners, existingSignals.listeners),
          mbid: signals.mbid ?? existingSignals.mbid,
          playcount: Math.max(signals.playcount, existingSignals.playcount),
          similar: signals.similar.length > 0 ? signals.similar : existingSignals.similar,
          topTags: signals.topTags.length > 0 ? signals.topTags : existingSignals.topTags,
          url: signals.url ?? existingSignals.url,
          userplaycount: signals.userplaycount ?? existingSignals.userplaycount,
          wiki: signals.wiki ?? existingSignals.wiki
        };
        console.log(`[LastFm] 🔗 Merged with existing data for ${track.artist} - ${track.name}`);
      }

      // Cache the result with appropriate TTL
      if (this.cache) {
        const isMiss = signals.topTags.length === 0 && signals.listeners === 0;
        await this.setCached(cacheKey, signals, isMiss);
        console.log(`[LastFm] Cached ${isMiss ? 'miss' : 'hit'} for ${track.artist} - ${track.name}`);
      }

      return signals;
    } catch (error) {
      console.error('[LastFm] Failed to get track signals:', error);
      return null;
    }
  }

  /**
   * Update cached signals (used to add artist info after initial cache)
   */
  async updateCachedSignals(cacheKey: string, signals: LastFmSignals): Promise<void> {
    if (!this.cache) return;

    try {
      const cacheData = {
        fetched_at: new Date().toISOString(),
        signals,
        ttl: this.cacheTTL
      };

      await this.cache.put(
        `lastfm:${cacheKey}`,
        JSON.stringify(cacheData),
        { expirationTtl: this.cacheTTL }
      );

      console.log(`[LastFm] Updated cache for ${cacheKey} with artist info`);
    } catch (error) {
      console.error('[LastFm] Cache update error:', error);
    }
  }

  /**
   * Call Last.fm API
   */
  private async callApi(method: string, params: Record<string, string>): Promise<any> {
    const queryParams = new URLSearchParams({
      api_key: this.apiKey,
      format: 'json',
      method,
      ...params
    });

    const url = `${this.apiBaseUrl}?${queryParams}`;

    // Use orchestrator for rate limiting
    const response = await rateLimitedLastFmCall(
      () => fetch(url),
      undefined,
      method
    );

    if (!response?.ok) {
      throw new Error(`Last.fm API error: ${response?.status || 'null'}`);
    }

    return response.json();
  }

  /**
   * Get artist info (bio, tags, similar artists, stats)
   */
  private async getArtistInfo(artist: string): Promise<null | {
    bio: null | { content: string; summary: string; };
    images: { large: null | string; medium: null | string; small: null | string; };
    listeners: number;
    playcount: number;
    similar: { name: string; url: string }[];
    tags: string[];
  }> {
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
          content: artistData.bio.content || '',
          summary: artistData.bio.summary || ''
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
      const smallImg = images.find((img: any) => img.size === 'small');
      const mediumImg = images.find((img: any) => img.size === 'medium');
      const largeImg = images.find((img: any) => img.size === 'large' || img.size === 'extralarge');

      const imageMap = {
        large: largeImg ? largeImg['#text'] : null,
        medium: mediumImg ? mediumImg['#text'] : null,
        small: smallImg ? smallImg['#text'] : null
      };

      return {
        bio,
        images: imageMap,
        listeners: parseInt(artistData.stats?.listeners || '0', 10),
        playcount: parseInt(artistData.stats?.playcount || '0', 10),
        similar: similarArtists,
        tags: tagNames
      };
    } catch (error) {
      console.error('[LastFm] Artist info failed:', error);
      return null;
    }
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
   * Get track correction (canonical names)
   */
  private async getCorrection(artist: string, track: string): Promise<null | { artist: string; track: string }> {
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
   * Get similar tracks (for transitions and recommendations)
   */
  private async getSimilarTracks(artist: string, track: string): Promise<{ artist: string; match: number; name: string; }[]> {
    try {
      const data = await this.callApi('track.getSimilar', {
        artist,
        autocorrect: '1',
        limit: '20',
        track
      });

      const tracks = data?.similartracks?.track;
      if (!tracks || !Array.isArray(tracks)) return [];

      return tracks.map((t: any) => ({
        artist: t.artist?.name || '',
        match: parseFloat(t.match || '0'),
        name: t.name || ''
      }));
    } catch (error) {
      console.error('[LastFm] Similar tracks failed:', error);
      return [];
    }
  }

  /**
   * Get top tags for a track (genre/mood/era)
   */
  private async getTopTags(artist: string, track: string): Promise<string[]> {
    try {
      const data = await this.callApi('track.getTopTags', {
        artist,
        autocorrect: '1',
        track
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
   * Get track info (listeners, playcount, MBID, album, wiki, etc.)
   */
  private async getTrackInfo(artist: string, track: string): Promise<null | {
    album: null | {
      artist: string;
      image: null | string;
      mbid: null | string;
      title: string;
      url: null | string;
    };
    duration: null | number;
    listeners: number;
    mbid: null | string;
    playcount: number;
    url: null | string;
    userplaycount?: number;
    wiki: null | {
      content: string;
      published: string;
      summary: string;
    };
  }> {
    try {
      const data = await this.callApi('track.getInfo', {
        artist,
        autocorrect: '1',
        track
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
          artist: trackData.album.artist || artist,
          image: largestImage?.['#text'] || null,
          mbid: trackData.album.mbid || null,
          title: trackData.album.title || trackData.album['#text'] || '',
          url: trackData.album.url || null
        };
      }

      // Extract wiki info
      let wiki = null;
      if (trackData.wiki) {
        wiki = {
          content: trackData.wiki.content || '',
          published: trackData.wiki.published || '',
          summary: trackData.wiki.summary || ''
        };
      }

      return {
        album,
        duration: trackData.duration ? parseInt(trackData.duration, 10) : null,
        listeners: parseInt(trackData.listeners || '0', 10),
        mbid: trackData.mbid || null,
        playcount: parseInt(trackData.playcount || '0', 10),
        url: trackData.url || null,
        userplaycount: trackData.userplaycount ? parseInt(trackData.userplaycount, 10) : undefined,
        wiki
      };
    } catch (error) {
      console.error('[LastFm] Track info failed:', error);
      return null;
    }
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
   * Cache signals
   */
  private async setCached(key: string, signals: LastFmSignals, isMiss = false): Promise<void> {
    if (!this.cache) return;

    try {
      const ttl = isMiss ? this.missCacheTTL : this.cacheTTL;
      const cacheData: LastFmCache = {
        fetched_at: new Date().toISOString(),
        is_miss: isMiss,
        signals,
        ttl
      };

      await this.cache.put(
        `lastfm:${key}`,
        JSON.stringify(cacheData),
        { expirationTtl: ttl }
      );

      const ttlDisplay = isMiss ? `${Math.round(ttl / 60)}m` : `${Math.round(ttl / 86400)}d`;
      console.log(`[LastFm] Cached ${isMiss ? 'miss' : 'hit'} for ${key} (TTL: ${ttlDisplay})`);
    } catch (error) {
      console.error('[LastFm] Cache write error:', error);
    }
  }
}
