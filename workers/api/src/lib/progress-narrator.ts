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

import { ChatAnthropic } from '@langchain/anthropic';

import { rateLimitedAnthropicCall } from '../utils/RateLimitedAPIClients';
import { ServiceLogger } from '../utils/ServiceLogger';

interface MessageContext {
  eventType: string;
  metadata?: Record<string, any>;
  parameters?: Record<string, any>;
  previousMessages?: string[];
  toolName?: string;
  userRequest?: string;
}

export class ProgressNarrator {
  private apiKey: string;
  private logger: ServiceLogger;
  private messageCache = new Map<string, string>();
  private systemPrompt: string;

  constructor(apiKey: string, logger?: ServiceLogger) {
    this.apiKey = apiKey;
    this.systemPrompt = this.buildSystemPrompt();
    this.logger = logger ?? new ServiceLogger('ProgressNarrator');
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

      this.logger.debug(`Generating message for event: ${context.eventType}${skipCache ? ' (uncached)' : ''}`, {
        maxTokens: 100,
        model: 'claude-3-5-haiku-20241022',
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 200),
        systemPromptLength: this.systemPrompt.length,
        temperature: skipCache ? 1.0 : 0.7
      });

      this.logger.info('About to call Anthropic API (rate-limited)', {
        hasApiKey: !!this.apiKey,
        model: 'claude-3-5-haiku-20241022'
      });

      // Create Langchain messages
      const messages = [
        { content: this.systemPrompt, role: 'system' as const },
        { content: prompt, role: 'user' as const }
      ];

      // Use rate-limited API wrapper (no timeout - orchestrator handles queuing)
      // Create a fresh ChatAnthropic instance for each call to avoid state issues in Workers
      const response = await rateLimitedAnthropicCall(
        async () => {
          const anthropic = new ChatAnthropic({
            apiKey: this.apiKey,
            maxTokens: 100,
            model: 'claude-3-5-haiku-20241022',
            temperature: skipCache ? 1.0 : 0.7,
            ...(skipCache ? { topP: 0.95 } : {}),
            maxRetries: 0,
          });
          return await anthropic.invoke(messages);
        },
        this.logger,
        `narrator:${context.eventType}`
      );

      if (!response) {
        throw new Error('Rate-limited call returned null');
      }

      this.logger.info('Anthropic API call succeeded', {
        hasContent: !!response.content,
        responseType: response.constructor.name
      });

      const message = typeof response.content === 'string'
        ? response.content.trim()
        : this.getFallbackMessage(context);

      this.logger.info(`Generated message`, {
        contentLength: message.length,
        event: context.eventType,
        message
      });

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
      // Detailed error logging
      const errorDetails: Record<string, any> = {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorType: error?.constructor?.name,
        event: context.eventType,
      };

      // Extract specific error details from Anthropic SDK errors
      if (error && typeof error === 'object') {
        if ('status' in error) errorDetails.httpStatus = error.status;
        if ('statusCode' in error) errorDetails.statusCode = error.statusCode;
        if ('code' in error) errorDetails.errorCode = error.code;
        if ('type' in error) errorDetails.errorType = error.type;
        if ('headers' in error) errorDetails.headers = error.headers;
        if ('error' in error) errorDetails.apiError = error.error;
      }

      // Log the full error stack
      if (error instanceof Error && error.stack) {
        errorDetails.stack = error.stack.split('\n').slice(0, 5).join('\n');
      }

      this.logger.error('Failed to generate message, using fallback', error, errorDetails);

      return this.getFallbackMessage(context);
    }
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
      case 'adding_tracks':
        const added = context.metadata?.addedTracks ?? 0;
        const totalTracks = context.metadata?.totalTracks ?? 0;
        parts.push(`\nAdding ${added} of ${totalTracks} tracks`);
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

      case 'analyzing_request':
        parts.push('\nUnderstanding what kind of music they want');
        break;

      case 'completed':
        parts.push('\nPlaylist is ready!');
        break;

      case 'creating_playlist':
        if (context.parameters?.name) {
          parts.push(`\nPlaylist name: "${context.parameters.name}"`);
        }
        break;

      case 'enriching_artists':
        const artistsEnriched = context.metadata?.enrichedCount ?? 0;
        const artistsTotal = context.metadata?.totalArtists ?? 0;
        const recentArtist = context.metadata?.recentArtistName;
        if (artistsEnriched && artistsTotal) {
          parts.push(`\nFetching info for ${artistsEnriched} of ${artistsTotal} artists`);
        }
        if (recentArtist) {
          parts.push(`\nLearning about: ${recentArtist}`);
        }
        break;

      case 'enriching_tracks':
        const enriched = context.metadata?.enrichedCount ?? 0;
        const enrichTotal = context.metadata?.totalTracks ?? 0;
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

      case 'searching_tracks':
        if (context.parameters?.query) {
          parts.push(`\nSearching for: "${context.parameters.query}"`);
        }
        break;

      case 'started':
        parts.push('\nStarting to process the request');
        break;

      case 'tool_call_complete':
        parts.push(`\nTool completed: ${context.toolName}`);
        if (context.metadata?.success === false) {
          parts.push('\nThere was an issue');
        }
        break;

      case 'tool_call_start':
        parts.push(`\nTool: ${context.toolName}`);
        if (context.parameters) {
          const paramSummary = JSON.stringify(context.parameters).slice(0, 100);
          parts.push(`\nParameters: ${paramSummary}`);
        }
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
   * Fallback messages for when Haiku is unavailable
   */
  private getFallbackMessage(context: MessageContext): string {
    const fallbacks: Record<string, string> = {
      'adding_tracks': 'Adding tracks to the playlist...',
      'analyzing_audio': 'Analyzing the tracks...',
      'analyzing_request': 'Understanding your request...',
      'completed': 'Your playlist is ready!',
      'creating_playlist': 'Creating your playlist...',
      'enriching_artists': 'Learning the story behind these artists...',
      'enriching_tracks': 'Discovering hidden gems in your collection...',
      'searching_tracks': 'Searching for tracks...',
      'started': 'Getting started...',
      'thinking': 'Thinking about the best tracks...',
      'tool_call_complete': 'Done!',
      'tool_call_start': 'Processing...',
    };

    return fallbacks[context.eventType] || 'Working on it...';
  }
}
