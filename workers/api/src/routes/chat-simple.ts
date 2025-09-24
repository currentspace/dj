import { Hono } from 'hono';
import type { Env } from '../index';
import { z } from 'zod';
import { ChatAnthropic } from '@langchain/anthropic';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { executeSpotifyTool } from '../lib/spotify-tools';

const chatRouter = new Hono<{ Bindings: Env }>();

// Request schema
const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).max(20).default([]),
  mode: z.enum(['analyze', 'create', 'edit']).default('analyze')
});

/**
 * Create LangChain tools directly from Spotify functions
 */
function createSpotifyTools(spotifyToken: string): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [
    new DynamicStructuredTool({
      name: 'search_spotify_tracks',
      description: 'Search for tracks on Spotify with optional audio feature filters',
      schema: z.object({
        query: z.string().describe('Search query (artist name, song name, etc.)'),
        limit: z.number().min(1).max(50).default(10).describe('Number of results'),
        filters: z.object({
          min_energy: z.number().min(0).max(1).optional(),
          max_energy: z.number().min(0).max(1).optional(),
          min_tempo: z.number().min(0).max(300).optional(),
          max_tempo: z.number().min(0).max(300).optional(),
          genre: z.string().optional()
        }).optional()
      }),
      func: async (args) => {
        const startTime = Date.now();
        console.log(`[Tool:search_spotify_tracks] Starting search for: "${args.query}" with limit=${args.limit}`);
        if (args.filters) {
          console.log(`[Tool:search_spotify_tracks] Applying filters:`, JSON.stringify(args.filters));
        }
        try {
          const result = await executeSpotifyTool('search_spotify_tracks', args, spotifyToken);
          const duration = Date.now() - startTime;
          console.log(`[Tool:search_spotify_tracks] Success: Found ${Array.isArray(result) ? result.length : 0} tracks in ${duration}ms`);
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`[Tool:search_spotify_tracks] Failed after ${duration}ms:`, error instanceof Error ? error.message : error);
          throw error;
        }
      }
    }),

    new DynamicStructuredTool({
      name: 'get_audio_features',
      description: 'Get detailed audio features for tracks (energy, danceability, tempo, etc.)',
      schema: z.object({
        track_ids: z.array(z.string()).max(100).describe('Array of Spotify track IDs')
      }),
      func: async (args) => {
        const startTime = Date.now();
        console.log(`[Tool:get_audio_features] Getting features for ${args.track_ids.length} track(s)`);
        console.log(`[Tool:get_audio_features] Track IDs: ${args.track_ids.slice(0, 5).join(', ')}${args.track_ids.length > 5 ? '...' : ''}`);
        try {
          const result = await executeSpotifyTool('get_audio_features', args, spotifyToken);
          const duration = Date.now() - startTime;
          const validFeatures = Array.isArray(result) ? result.filter(f => f !== null).length : 0;
          console.log(`[Tool:get_audio_features] Success: Retrieved ${validFeatures}/${args.track_ids.length} features in ${duration}ms`);
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`[Tool:get_audio_features] Failed after ${duration}ms:`, error instanceof Error ? error.message : error);
          throw error;
        }
      }
    }),

    new DynamicStructuredTool({
      name: 'get_recommendations',
      description: 'Get track recommendations based on seeds and target audio features',
      schema: z.object({
        seed_tracks: z.array(z.string()).max(5).optional().describe('Seed track IDs'),
        seed_artists: z.array(z.string()).max(5).optional().describe('Seed artist IDs'),
        seed_genres: z.array(z.string()).max(5).optional().describe('Seed genres'),
        target_energy: z.number().min(0).max(1).optional(),
        target_danceability: z.number().min(0).max(1).optional(),
        target_valence: z.number().min(0).max(1).optional(),
        limit: z.number().min(1).max(100).default(20)
      }),
      func: async (args) => {
        const startTime = Date.now();
        console.log(`[Tool:get_recommendations] Getting ${args.limit || 20} recommendations`);
        const seedInfo = [];
        if (args.seed_tracks?.length) seedInfo.push(`${args.seed_tracks.length} tracks`);
        if (args.seed_artists?.length) seedInfo.push(`${args.seed_artists.length} artists`);
        if (args.seed_genres?.length) seedInfo.push(`${args.seed_genres.length} genres`);
        if (seedInfo.length > 0) {
          console.log(`[Tool:get_recommendations] Seeds: ${seedInfo.join(', ')}`);
        }
        const targets = [];
        if (args.target_energy !== undefined) targets.push(`energy=${args.target_energy}`);
        if (args.target_danceability !== undefined) targets.push(`danceability=${args.target_danceability}`);
        if (args.target_valence !== undefined) targets.push(`valence=${args.target_valence}`);
        if (targets.length > 0) {
          console.log(`[Tool:get_recommendations] Targets: ${targets.join(', ')}`);
        }
        try {
          const result = await executeSpotifyTool('get_recommendations', args, spotifyToken);
          const duration = Date.now() - startTime;
          console.log(`[Tool:get_recommendations] Success: Found ${Array.isArray(result) ? result.length : 0} recommendations in ${duration}ms`);
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`[Tool:get_recommendations] Failed after ${duration}ms:`, error instanceof Error ? error.message : error);
          throw error;
        }
      }
    }),

    new DynamicStructuredTool({
      name: 'create_playlist',
      description: 'Create a new Spotify playlist and add tracks',
      schema: z.object({
        name: z.string().min(1).max(100).describe('Playlist name'),
        description: z.string().max(300).optional().describe('Playlist description'),
        public: z.boolean().default(false).describe('Make playlist public'),
        track_uris: z.array(z.string()).describe('Spotify track URIs (spotify:track:...)')
      }),
      func: async (args) => {
        const startTime = Date.now();
        console.log(`[Tool:create_playlist] Creating playlist: "${args.name}"`);
        console.log(`[Tool:create_playlist] Visibility: ${args.public ? 'public' : 'private'}`);
        console.log(`[Tool:create_playlist] Adding ${args.track_uris.length} track(s)`);
        if (args.description) {
          console.log(`[Tool:create_playlist] Description: "${args.description.substring(0, 100)}${args.description.length > 100 ? '...' : ''}"`);
        }
        try {
          const result = await executeSpotifyTool('create_playlist', args, spotifyToken);
          const duration = Date.now() - startTime;
          console.log(`[Tool:create_playlist] Success: Playlist created in ${duration}ms`);
          if (result && typeof result === 'object' && 'id' in result) {
            console.log(`[Tool:create_playlist] Playlist ID: ${result.id}`);
            console.log(`[Tool:create_playlist] Playlist URL: ${result.external_urls?.spotify || 'N/A'}`);
          }
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`[Tool:create_playlist] Failed after ${duration}ms:`, error instanceof Error ? error.message : error);
          throw error;
        }
      }
    }),

    new DynamicStructuredTool({
      name: 'modify_playlist',
      description: 'Add, remove, or reorder tracks in an existing playlist',
      schema: z.object({
        playlist_id: z.string().describe('Spotify playlist ID'),
        action: z.enum(['add', 'remove', 'reorder']).describe('Action to perform'),
        track_uris: z.array(z.string()).describe('Track URIs to add/remove/reorder'),
        position: z.number().optional().describe('Position for insertion (add/reorder)')
      }),
      func: async (args) => {
        const startTime = Date.now();
        console.log(`[Tool:modify_playlist] Action: ${args.action} on playlist ${args.playlist_id}`);
        console.log(`[Tool:modify_playlist] Affecting ${args.track_uris.length} track(s)`);
        if (args.position !== undefined) {
          console.log(`[Tool:modify_playlist] Position: ${args.position}`);
        }
        try {
          const result = await executeSpotifyTool('modify_playlist', args, spotifyToken);
          const duration = Date.now() - startTime;
          console.log(`[Tool:modify_playlist] Success: ${args.action} completed in ${duration}ms`);
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`[Tool:modify_playlist] Failed to ${args.action} after ${duration}ms:`, error instanceof Error ? error.message : error);
          throw error;
        }
      }
    }),

    new DynamicStructuredTool({
      name: 'analyze_playlist',
      description: 'Analyze an existing playlist to understand its characteristics',
      schema: z.object({
        playlist_id: z.string().describe('Spotify playlist ID to analyze'),
        include_recommendations: z.boolean().default(false).describe('Include AI recommendations')
      }),
      func: async (args) => {
        const startTime = Date.now();
        console.log(`[Tool:analyze_playlist] Analyzing playlist ${args.playlist_id}`);
        console.log(`[Tool:analyze_playlist] Include recommendations: ${args.include_recommendations || false}`);
        try {
          const result = await executeSpotifyTool('analyze_playlist', args, spotifyToken);
          const duration = Date.now() - startTime;
          if (result && typeof result === 'object') {
            console.log(`[Tool:analyze_playlist] Success: Analyzed "${result.playlist_name || 'Unknown'}" with ${result.total_tracks || 0} tracks in ${duration}ms`);
            if (result.audio_analysis) {
              console.log(`[Tool:analyze_playlist] Average energy: ${result.audio_analysis.avg_energy?.toFixed(2)}, valence: ${result.audio_analysis.avg_valence?.toFixed(2)}`);
            }
          } else {
            console.log(`[Tool:analyze_playlist] Success: Analysis completed in ${duration}ms`);
          }
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`[Tool:analyze_playlist] Failed after ${duration}ms:`, error instanceof Error ? error.message : error);
          throw error;
        }
      }
    })
  ];

  return tools;
}

/**
 * Simple chat endpoint with direct LangChain tool integration
 */
chatRouter.post('/message', async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  const startTime = Date.now();

  console.log(`[Chat:${requestId}] ${'='.repeat(50)}`);
  console.log(`[Chat:${requestId}] === NEW CHAT REQUEST ===`);
  console.log(`[Chat:${requestId}] Request ID: ${requestId}`);
  console.log(`[Chat:${requestId}] Timestamp: ${new Date().toISOString()}`);
  console.log(`[Chat:${requestId}] Origin: ${c.req.header('origin') || 'unknown'}`);

  try {
    // Parse request
    const body = await c.req.json();
    console.log(`[Chat:${requestId}] Request body size: ${JSON.stringify(body).length} bytes`);
    console.log(`[Chat:${requestId}] Parsing and validating request...`);
    const request = ChatRequestSchema.parse(body);
    console.log(`[Chat:${requestId}] Mode: ${request.mode}`);
    console.log(`[Chat:${requestId}] Message: "${request.message.substring(0, 100)}${request.message.length > 100 ? '...' : ''}"`);
    console.log(`[Chat:${requestId}] Conversation history: ${request.conversationHistory.length} messages`);

    // Get Spotify token from Authorization header
    const authorization = c.req.header('Authorization');
    if (!authorization) {
      console.error(`[Chat:${requestId}] No Authorization header provided`);
      return c.json({ error: 'Unauthorized - Missing Authorization header' }, 401);
    }
    if (!authorization.startsWith('Bearer ')) {
      console.error(`[Chat:${requestId}] Invalid Authorization header format: ${authorization.substring(0, 20)}...`);
      return c.json({ error: 'Unauthorized - Invalid Authorization format' }, 401);
    }

    const spotifyToken = authorization.replace('Bearer ', '');
    console.log(`[Chat:${requestId}] Spotify token: ${spotifyToken.substring(0, 10)}...`);

    // Create tools directly - no MCP, no conversion needed!
    const tools = createSpotifyTools(spotifyToken);
    console.log(`[Chat:${requestId}] Created ${tools.length} Spotify tools`);

    // Initialize Claude with tools and retry configuration
    console.log(`[Chat:${requestId}] === INITIALIZING CLAUDE CLIENT ===`);
    console.log(`[Chat:${requestId}] API Key: ${c.env.ANTHROPIC_API_KEY ? 'Present (' + c.env.ANTHROPIC_API_KEY.substring(0, 10) + '...)' : 'MISSING!'}`);

    const llm = new ChatAnthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.2,
      maxTokens: 2000,
      maxRetries: 2,  // Retry on failures
    });

    console.log(`[Chat:${requestId}] Claude client initialized with maxRetries: 2`);

    // For now, let's try without tools when getting errors
    const useTools = true; // Toggle this to test without tools

    // Bind tools to the model (or use base model)
    const modelWithTools = useTools ? llm.bindTools(tools) : llm;

    console.log(`[Chat:${requestId}] Tools bound to model: ${useTools ? 'Yes' : 'No (fallback mode)'}`);

    // System prompts based on mode
    const systemPrompts = {
      analyze: `You are an expert music analyst with access to Spotify tools.
When asked about music, tracks, or artists:
1. ALWAYS search for tracks first using search_spotify_tracks
2. Get audio features using get_audio_features for detailed analysis
3. Provide specific data-driven insights

Be conversational but accurate. Use the tools to get real data.`,

      create: `You are an expert DJ creating perfect playlists.
When creating playlists:
1. Search for tracks based on the user's request
2. Analyze audio features to ensure good flow
3. Use recommendations to expand the playlist
4. Create the playlist with create_playlist
5. Explain your song choices

Always use real Spotify data from the tools.`,

      edit: `You are a playlist curator who modifies existing playlists.
When editing playlists:
1. First analyze the playlist with analyze_playlist
2. Search for new tracks that fit the vibe
3. Check audio compatibility
4. Modify the playlist with modify_playlist
5. Explain your changes

Use tools to make informed decisions.`
    };

    // Build conversation messages
    const messages = [
      new SystemMessage(systemPrompts[request.mode]),
      ...request.conversationHistory.map((m) =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
      ),
      new HumanMessage(request.message)
    ];

    console.log(`[Chat:${requestId}] === PREPARING CLAUDE INVOCATION ===`);
    console.log(`[Chat:${requestId}] Total messages: ${messages.length}`);
    console.log(`[Chat:${requestId}] System prompt length: ${systemPrompts[request.mode].length} chars`);
    console.log(`[Chat:${requestId}] Available tools: ${tools.map(t => t.name).join(', ')}`);
    console.log(`[Chat:${requestId}] Model: claude-3-5-sonnet-20241022`);
    console.log(`[Chat:${requestId}] Temperature: 0.2, Max tokens: 2000`);

    let initialResponse;
    let retryCount = 0;
    const maxRetries = 3;

    // Retry logic for overload errors
    while (retryCount < maxRetries) {
      try {
        const invokeStartTime = Date.now();
        console.log(`[Chat:${requestId}] Attempt ${retryCount + 1}/${maxRetries}: Invoking Claude...`);

        // First invocation - Claude may call tools
        initialResponse = await modelWithTools.invoke(messages);

        const invokeDuration = Date.now() - invokeStartTime;
        console.log(`[Chat:${requestId}] ✅ Claude responded successfully in ${invokeDuration}ms`);
        console.log(`[Chat:${requestId}] Response type: ${typeof initialResponse}`);
        console.log(`[Chat:${requestId}] Has tool calls: ${!!(initialResponse?.tool_calls && initialResponse.tool_calls.length > 0)}`);
        if (initialResponse?.tool_calls) {
          console.log(`[Chat:${requestId}] Tool calls requested: ${initialResponse.tool_calls.map((tc: any) => tc.name).join(', ')}`);
        }
        break; // Success, exit retry loop
      } catch (invokeError) {
        const errorMessage = invokeError instanceof Error ? invokeError.message : String(invokeError);
        console.error(`[Chat:${requestId}] ❌ Attempt ${retryCount + 1} failed: ${errorMessage}`);

        // Log error details
        if (invokeError instanceof Error) {
          console.error(`[Chat:${requestId}] Error name: ${invokeError.name}`);
          console.error(`[Chat:${requestId}] Error stack: ${invokeError.stack?.split('\n').slice(0, 3).join('\n')}`);

          // Check for rate limit info in error
          if (errorMessage.includes('429')) {
            console.error(`[Chat:${requestId}] 🚫 RATE LIMIT HIT - This is an account/API key level limit`);
            console.error(`[Chat:${requestId}] This means YOUR account has exceeded its rate limits`);
          } else if (errorMessage.includes('529')) {
            console.error(`[Chat:${requestId}] 🌍 GLOBAL OVERLOAD - This affects ALL Anthropic users`);
            console.error(`[Chat:${requestId}] This is not specific to your account`);
          }
        }

        // Check if it's an overload error
        if (errorMessage.includes('529') || errorMessage.includes('overloaded')) {
          retryCount++;
          if (retryCount < maxRetries) {
            const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff
            console.log(`[Chat:${requestId}] 🔄 Anthropic overloaded (529), waiting ${backoffTime}ms before retry ${retryCount + 1}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, backoffTime));
            console.log(`[Chat:${requestId}] Resuming after backoff, attempting retry...`);
          } else {
            console.error(`[Chat:${requestId}] ❌ Max retries (${maxRetries}) exhausted for overload error`);
            throw invokeError;
          }
        } else if (errorMessage.includes('429') || errorMessage.includes('rate_limit')) {
          console.error(`[Chat:${requestId}] ⏳ Rate limit error detected, not retrying`);
          throw invokeError;
        } else {
          // Not a retryable error, throw immediately
          console.error(`[Chat:${requestId}] Non-retryable error, failing immediately`);
          throw invokeError;
        }
      }
    }

    if (!initialResponse) {
      console.error(`[Chat:${requestId}] ❌ No response received from Claude after all retries`);
      throw new Error('Failed to get response from Claude after retries');
    }

    console.log(`[Chat:${requestId}] === PROCESSING CLAUDE RESPONSE ===`);
    let finalResponse = initialResponse;

    // If Claude called tools, execute them and get final response
    if (initialResponse?.tool_calls && initialResponse.tool_calls.length > 0) {
      console.log(`[Chat:${requestId}] Claude called ${initialResponse.tool_calls.length} tool(s): ${initialResponse.tool_calls.map(tc => tc.name).join(', ')}`);

      console.log(`[Chat:${requestId}] === EXECUTING ${initialResponse.tool_calls.length} TOOL CALLS ===`);

      // Execute each tool call
      const toolResults = [];
      for (let i = 0; i < initialResponse.tool_calls.length; i++) {
        const toolCall = initialResponse.tool_calls[i];
        const toolStartTime = Date.now();
        console.log(`[Chat:${requestId}] [Tool ${i + 1}/${initialResponse.tool_calls.length}] Starting: ${toolCall.name}`);
        console.log(`[Chat:${requestId}] [Tool ${i + 1}/${initialResponse.tool_calls.length}] Arguments: ${JSON.stringify(toolCall.args).substring(0, 200)}`);

        const tool = tools.find(t => t.name === toolCall.name);
        if (!tool) {
          console.error(`[Chat:${requestId}] ❌ Tool '${toolCall.name}' not found in available tools: [${tools.map(t => t.name).join(', ')}]`);
          toolResults.push({
            tool_call_id: toolCall.id,
            output: `Error: Tool ${toolCall.name} not found`
          });
          continue;
        }

        try {
          const result = await tool.func(toolCall.args);
          const toolDuration = Date.now() - toolStartTime;

          // Log result summary
          let resultSummary = 'Unknown result';
          if (Array.isArray(result)) {
            resultSummary = `Array with ${result.length} items`;
          } else if (result && typeof result === 'object') {
            resultSummary = `Object with keys: ${Object.keys(result).slice(0, 5).join(', ')}`;
          } else {
            resultSummary = String(result).substring(0, 100);
          }

          console.log(`[Chat:${requestId}] ✅ [Tool ${i + 1}/${initialResponse.tool_calls.length}] ${toolCall.name} completed in ${toolDuration}ms`);
          console.log(`[Chat:${requestId}] [Tool ${i + 1}/${initialResponse.tool_calls.length}] Result: ${resultSummary}`);

          toolResults.push({
            tool_call_id: toolCall.id,
            output: result
          });
        } catch (error) {
          const toolDuration = Date.now() - toolStartTime;
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[Chat:${requestId}] ❌ [Tool ${i + 1}/${initialResponse.tool_calls.length}] ${toolCall.name} failed after ${toolDuration}ms`);
          console.error(`[Chat:${requestId}] [Tool ${i + 1}/${initialResponse.tool_calls.length}] Error: ${errorMessage}`);
          if (error instanceof Error && error.stack) {
            console.error(`[Chat:${requestId}] [Tool ${i + 1}/${initialResponse.tool_calls.length}] Stack:`, error.stack.split('\n').slice(0, 3).join('\n'));
          }
          toolResults.push({
            tool_call_id: toolCall.id,
            output: `Error: ${errorMessage}`
          });
        }
      }

      console.log(`[Chat:${requestId}] === ALL TOOL CALLS COMPLETE ===`);

      // Create tool response message
      const toolMessage = {
        role: 'tool' as const,
        content: toolResults.map(r =>
          `Tool ${r.tool_call_id} result: ${JSON.stringify(r.output)}`
        ).join('\n\n'),
        tool_call_id: initialResponse.tool_calls[0].id
      };

      // Get final response from Claude with tool results
      console.log(`[Chat:${requestId}] === GETTING FINAL RESPONSE FROM CLAUDE ===`);
      console.log(`[Chat:${requestId}] Sending ${toolResults.length} tool results back to Claude`);

      const finalStartTime = Date.now();
      finalResponse = await llm.invoke([
        ...messages,
        initialResponse,
        new SystemMessage(`Tool execution results:\n${toolMessage.content}`)
      ]);

      const finalDuration = Date.now() - finalStartTime;
      console.log(`[Chat:${requestId}] ✅ Final response received in ${finalDuration}ms`);
      console.log(`[Chat:${requestId}] Final response type: ${typeof finalResponse?.content}`);
      console.log(`[Chat:${requestId}] Final response length: ${typeof finalResponse?.content === 'string' ? finalResponse.content.length : 'N/A'} chars`);
    }

    // Extract response content with proper type guard
    let responseContent: string;
    if (typeof finalResponse?.content === 'string') {
      responseContent = finalResponse.content;
    } else if (Array.isArray(finalResponse?.content) && finalResponse.content.length > 0) {
      const firstContent = finalResponse.content[0];
      if (typeof firstContent === 'object' && 'text' in firstContent) {
        responseContent = firstContent.text;
      } else {
        responseContent = 'I encountered an issue processing your request.';
      }
    } else {
      responseContent = 'I encountered an issue processing your request.';
    }

    const duration = Date.now() - startTime;
    console.log(`[Chat:${requestId}] === REQUEST COMPLETE ===`);
    console.log(`[Chat:${requestId}] Total duration: ${duration}ms`);
    console.log(`[Chat:${requestId}] Response preview: "${responseContent.substring(0, 100)}${responseContent.length > 100 ? '...' : ''}"`);
    console.log(`[Chat:${requestId}] Conversation length: ${[...request.conversationHistory, { role: 'user', content: request.message }].length + 1} messages`);

    return c.json({
      message: responseContent,
      conversationHistory: [
        ...request.conversationHistory,
        { role: 'user' as const, content: request.message },
        { role: 'assistant' as const, content: responseContent }
      ],
      requestId,
      duration
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Chat:${requestId}] ${'='.repeat(50)}`);
    console.error(`[Chat:${requestId}] === REQUEST FAILED ===`);
    console.error(`[Chat:${requestId}] Duration: ${duration}ms`);
    console.error(`[Chat:${requestId}] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);

    // Detailed error logging
    if (error instanceof z.ZodError) {
      console.error(`[Chat:${requestId}] ❌ Request validation failed`);
      console.error(`[Chat:${requestId}] Validation errors:`);
      error.errors.forEach((e, i) => {
        console.error(`[Chat:${requestId}]   ${i + 1}. ${e.path.join('.')}: ${e.message}`);
      });
      return c.json({
        error: 'Invalid request format',
        details: error.errors,
        requestId,
        duration
      }, 400);
    }

    if (error instanceof Error) {
      console.error(`[Chat:${requestId}] ${error.name} after ${duration}ms: ${error.message}`);
      if (error.stack) {
        console.error(`[Chat:${requestId}] Stack trace:`, error.stack.split('\n').slice(0, 5).join('\n'));
      }

      // Check for specific error types
      if (error.message.includes('429') || error.message.includes('rate_limit')) {
        console.error(`[Chat:${requestId}] Rate limit error detected`);
        return c.json({
          error: 'Rate limit exceeded. Please try again in a few moments.',
          requestId,
          duration
        }, 429);
      }

      if (error.message.includes('529') || error.message.includes('overloaded')) {
        console.error(`[Chat:${requestId}] Anthropic service overloaded`);
        return c.json({
          error: 'The AI service is experiencing high demand right now. Please try again in a few moments - this usually resolves quickly.',
          errorType: 'ServiceOverloaded',
          retryable: true,
          suggestedWaitTime: 30,
          requestId,
          duration
        }, 503);
      }

      if (error.message.includes('Anthropic')) {
        console.error(`[Chat:${requestId}] Anthropic API error detected`);
        return c.json({
          error: 'AI service temporarily unavailable',
          requestId,
          duration
        }, 503);
      }

      if (error.message.includes('Spotify')) {
        console.error(`[Chat:${requestId}] Spotify API error detected`);
        return c.json({
          error: 'Music service temporarily unavailable',
          requestId,
          duration
        }, 503);
      }
    }

    console.error(`[Chat:${requestId}] ❌ Unexpected error:`, error);
    console.error(`[Chat:${requestId}] ${'='.repeat(50)}`);
    return c.json({
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
      errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      requestId,
      duration
    }, 500);
  }
});

/**
 * Health check endpoint
 */
chatRouter.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'chat-simple',
    timestamp: new Date().toISOString()
  });
});

export { chatRouter };