/**
 * Progress Narrator - Uses Claude Haiku to generate dynamic, contextual progress messages
 *
 * This creates engaging, natural-sounding progress updates that adapt to:
 * - The user's original request
 * - The current operation being performed
 * - Recent conversation context
 *
 * Examples:
 * Static:  "Searching for tracks..."
 * Dynamic: "Digging through Spotify's crates for workout bangers..."
 */

import Anthropic from '@anthropic-ai/sdk';

interface MessageContext {
  eventType: string;
  toolName?: string;
  parameters?: Record<string, any>;
  previousMessages?: string[];
  userRequest?: string;
  metadata?: Record<string, any>;
}

export class ProgressNarrator {
  private anthropic: Anthropic;
  private messageCache: Map<string, string> = new Map();
  private systemPrompt: string;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
    this.systemPrompt = this.buildSystemPrompt();
  }

  /**
   * Generate a dynamic progress message using Haiku
   */
  async generateMessage(context: MessageContext, skipCache = false): Promise<string> {
    // Create cache key for similar contexts
    const cacheKey = this.getCacheKey(context);

    // Return cached message if available (for common scenarios) and caching is enabled
    if (!skipCache && this.messageCache.has(cacheKey)) {
      return this.messageCache.get(cacheKey)!;
    }

    try {
      // Add random salt and explicit variation instruction when skipCache is true
      let prompt = this.buildPrompt(context);
      if (skipCache) {
        const variationStyles = [
          'Be creative and spontaneous.',
          'Use a fresh perspective.',
          'Try a completely different angle.',
          'Mix up your vocabulary.',
          'Surprise me with your wording.',
        ];
        const randomStyle = variationStyles[Math.floor(Math.random() * variationStyles.length)];
        prompt += `\n\n${randomStyle} Variation #${Math.floor(Math.random() * 10000)}`;
      }
      console.log(`[ProgressNarrator] Generating message for event: ${context.eventType}${skipCache ? ' (uncached)' : ''}`);
      console.log(`[ProgressNarrator] Prompt preview: ${prompt.substring(0, 200)}...`);

      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-20250514',
        max_tokens: 100,
        temperature: skipCache ? 1.0 : 0.7, // Max temperature for variety when uncached
        top_p: skipCache ? 0.95 : undefined, // Add nucleus sampling for more randomness
        messages: [{
          role: 'user',
          content: prompt,
        }],
        system: [{
          type: 'text',
          text: this.systemPrompt,
          cache_control: { type: 'ephemeral' },
        }],
      });

      // Log the full response for debugging
      console.log(`[ProgressNarrator] API Response:`, JSON.stringify({
        content_type: response.content[0]?.type,
        content_length: response.content[0]?.type === 'text' ? response.content[0].text.length : 0,
        stop_reason: response.stop_reason,
        model: response.model
      }));

      const message = response.content[0].type === 'text'
        ? response.content[0].text.trim()
        : this.getFallbackMessage(context);

      console.log(`[ProgressNarrator] Success! Generated: "${message}"`);

      // Cache the result only if caching is enabled
      if (!skipCache) {
        this.messageCache.set(cacheKey, message);

        // Limit cache size to prevent memory issues
        if (this.messageCache.size > 100) {
          const firstKey = this.messageCache.keys().next().value;
          this.messageCache.delete(firstKey);
        }
      }

      return message;
    } catch (error) {
      console.error('[ProgressNarrator] Failed to generate message:', error);
      console.error('[ProgressNarrator] Error details:', error instanceof Error ? error.message : JSON.stringify(error));
      console.log(`[ProgressNarrator] Using fallback for: ${context.eventType}`);
      return this.getFallbackMessage(context);
    }
  }

  /**
   * System prompt that defines the narrator's personality and style
   */
  private buildSystemPrompt(): string {
    return `You are a helpful music docent, guiding the user along a journey of musical discovery.

Your role:
- Generate SHORT, engaging progress messages (1-2 sentences max, under 80 characters)
- Be enthusiastic but natural - like a knowledgeable friend showing them around
- Make technical operations sound like exciting discoveries
- Use music-related language and metaphors
- Keep it conversational and fun
- Never use emojis (the UI adds those)

Tone examples:
❌ "Searching Spotify API for tracks matching query parameters"
✅ "Digging through Spotify's crates for the perfect tracks..."

❌ "Analyzing audio feature vectors for track selection"
✅ "Checking the vibe on these tracks - tempo, energy, the works!"

❌ "Enriching 10/50 tracks with Last.fm data"
✅ "Discovering hidden gems in your collection..."

❌ "Fetching artist info for 45 unique artists"
✅ "Learning the story behind these artists..."

❌ "Creating playlist via Spotify Web API"
✅ "Spinning up your new playlist right now..."

Keep messages:
- Short (under 80 characters when possible)
- Active and present tense
- Focused on what's happening NOW
- Relatable to music lovers
- Professional but warm
- No emojis or special characters`;
  }

  /**
   * Build a specific prompt for the current context
   */
  private buildPrompt(context: MessageContext): string {
    const parts: string[] = [];

    // Add user context
    if (context.userRequest) {
      parts.push(`User asked: "${context.userRequest}"\n`);
    }

    // Add current action
    parts.push(`Current action: ${context.eventType}`);

    // Add specific details based on event type
    switch (context.eventType) {
      case 'started':
        parts.push('\nStarting to process the request');
        break;

      case 'analyzing_request':
        parts.push('\nUnderstanding what kind of music they want');
        break;

      case 'searching_tracks':
        if (context.parameters?.query) {
          parts.push(`\nSearching for: "${context.parameters.query}"`);
        }
        break;

      case 'enriching_tracks':
        const enriched = context.metadata?.enrichedCount || 0;
        const enrichTotal = context.metadata?.totalTracks || 0;
        const recentTags = context.metadata?.recentTags;
        const recentTrack = context.metadata?.recentTrackName;
        const recentTrackNames = context.metadata?.recentTrackNames;
        if (enriched && enrichTotal) {
          parts.push(`\nEnriching ${enriched} of ${enrichTotal} tracks with Last.fm data`);
        }
        if (recentTrackNames) {
          parts.push(`\nRecent tracks: ${recentTrackNames}`);
        }
        if (recentTags) {
          parts.push(`\nRecent tags discovered: ${recentTags}`);
        }
        if (recentTrack) {
          parts.push(`\nJust analyzed: "${recentTrack}"`);
        }
        break;

      case 'enriching_artists':
        const artistsEnriched = context.metadata?.enrichedCount || 0;
        const artistsTotal = context.metadata?.totalArtists || 0;
        const recentArtist = context.metadata?.recentArtistName;
        if (artistsEnriched && artistsTotal) {
          parts.push(`\nFetching info for ${artistsEnriched} of ${artistsTotal} artists`);
        }
        if (recentArtist) {
          parts.push(`\nLearning about: ${recentArtist}`);
        }
        break;

      case 'analyzing_audio':
        const trackName = context.metadata?.trackName;
        const current = context.metadata?.currentTrack;
        const total = context.metadata?.trackCount;
        if (current && total) {
          parts.push(`\nAnalyzing track ${current} of ${total}`);
        }
        if (trackName) {
          parts.push(`\nTrack: "${trackName}"`);
        }
        break;

      case 'creating_playlist':
        if (context.parameters?.name) {
          parts.push(`\nPlaylist name: "${context.parameters.name}"`);
        }
        break;

      case 'adding_tracks':
        const added = context.metadata?.addedTracks || 0;
        const totalTracks = context.metadata?.totalTracks || 0;
        parts.push(`\nAdding ${added} of ${totalTracks} tracks`);
        break;

      case 'tool_call_start':
        parts.push(`\nTool: ${context.toolName}`);
        if (context.parameters) {
          const paramSummary = JSON.stringify(context.parameters).slice(0, 100);
          parts.push(`\nParameters: ${paramSummary}`);
        }
        break;

      case 'tool_call_complete':
        parts.push(`\nTool completed: ${context.toolName}`);
        if (context.metadata?.success === false) {
          parts.push('\nThere was an issue');
        }
        break;

      case 'completed':
        parts.push('\nPlaylist is ready!');
        break;
    }

    // Add conversation continuity
    if (context.previousMessages && context.previousMessages.length > 0) {
      parts.push(`\nRecent messages: ${context.previousMessages.slice(-2).join(', ')}`);
    }

    parts.push('\n\nGenerate ONE short, engaging progress message (under 80 characters) that tells the user what\'s happening right now. Be a friendly DJ, not a robot. Just give the message, nothing else.');

    return parts.join('');
  }

  /**
   * Fallback messages for when Haiku is unavailable
   */
  private getFallbackMessage(context: MessageContext): string {
    const fallbacks: Record<string, string> = {
      'started': 'Getting started...',
      'analyzing_request': 'Understanding your request...',
      'searching_tracks': 'Searching for tracks...',
      'enriching_tracks': 'Discovering hidden gems in your collection...',
      'enriching_artists': 'Learning the story behind these artists...',
      'analyzing_audio': 'Analyzing the tracks...',
      'creating_playlist': 'Creating your playlist...',
      'adding_tracks': 'Adding tracks to the playlist...',
      'tool_call_start': 'Processing...',
      'tool_call_complete': 'Done!',
      'thinking': 'Thinking about the best tracks...',
      'completed': 'Your playlist is ready!',
    };

    return fallbacks[context.eventType] || 'Working on it...';
  }

  /**
   * Generate a cache key to reuse similar messages
   */
  private getCacheKey(context: MessageContext): string {
    // Create a cache key that groups similar contexts
    const key = [
      context.eventType,
      context.toolName,
      context.parameters?.query?.toLowerCase().slice(0, 20),
      context.metadata?.currentTrack ? 'progress' : null,
    ].filter(Boolean).join(':');

    return key;
  }

  /**
   * Pre-warm the cache with common messages
   */
  async warmupCache(): Promise<void> {
    const contexts: MessageContext[] = [
      { eventType: 'started' },
      { eventType: 'analyzing_request' },
      { eventType: 'searching_tracks' },
      { eventType: 'analyzing_audio' },
      { eventType: 'creating_playlist' },
      { eventType: 'adding_tracks' },
      { eventType: 'completed' },
    ];

    // Generate common messages in parallel
    await Promise.all(
      contexts.map(ctx => this.generateMessage(ctx))
    ).catch(err => {
      console.error('[ProgressNarrator] Cache warmup failed:', err);
    });
  }
}
