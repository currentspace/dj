import { Hono } from 'hono';
import { z } from 'zod';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import type { Env } from '../index';
import { safeParse, isSuccessResponse } from '../lib/guards';
import {
  GeneratedPlaylistSchema,
  SpotifySearchResponseSchema,
  PlaylistTrackSchema,
  SpotifyUserSchema,
  SpotifyPlaylistSchema,
  type PlaylistTrack
} from '../lib/schemas';

const chatRouter = new Hono<{ Bindings: Env }>();

// Chat message schemas
const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string()
});

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(1000),
  conversationHistory: z.array(ChatMessageSchema).optional().default([]),
  selectedPlaylistId: z.string().optional(),
  playlistTracks: z.array(z.any()).optional().default([]),
  mode: z.enum(['create', 'edit', 'analyze']).optional().default('create')
});

const ChatResponseSchema = z.object({
  message: z.string(),
  playlist: z.object({
    name: z.string(),
    description: z.string(),
    tracks: z.array(PlaylistTrackSchema)
  }).optional(),
  playlistModified: z.boolean().optional(),
  conversationHistory: z.array(ChatMessageSchema)
});

type ChatResponse = z.infer<typeof ChatResponseSchema>;

// System prompts for different modes
const CREATE_SYSTEM_PROMPT = `You are an expert DJ and music curator with deep knowledge of all genres, artists, and musical history. Your job is to help users create the perfect playlists through natural conversation.

Guidelines:
1. Ask clarifying questions about mood, genre, occasion, energy level, decade, or specific artists
2. Be conversational and enthusiastic about music
3. When you have enough information, generate a playlist with 10-15 tracks
4. Make thoughtful, diverse suggestions across all music - from mainstream hits to indie gems, from classics to deep cuts, from well-known artists to emerging talent
5. Don't worry about availability - suggest the BEST tracks that fit the mood and request, regardless of how popular or obscure they might be
6. The system will automatically check Spotify availability and find alternatives if needed

Format playlist responses as JSON with this exact structure:
{
  "type": "playlist",
  "name": "Playlist Name",
  "description": "Brief description",
  "tracks": [
    {"name": "Song Name", "artist": "Artist Name", "query": "artist song name"}
  ]
}

For regular conversation (not playlist generation), respond normally without JSON

Examples:
- User: "I need something upbeat" → Ask about genre, occasion, or specific energy level
- User: "90s rock for working out" → Generate playlist with the best 90s rock tracks that fit workout energy
- User: "Something chill" → Ask about specific mood, genre preferences, or setting`;

const EDIT_SYSTEM_PROMPT = `You are an expert DJ and music curator helping users modify their existing Spotify playlists. Your job is to add or remove songs based on their requests.

Guidelines:
1. Listen for requests to add or remove specific songs, artists, or types of music
2. Be conversational and ask clarifying questions when needed
3. When ready to modify the playlist, format your response as JSON with this exact structure:

For adding songs:
{
  "type": "modify",
  "action": "add",
  "tracks": [
    {"name": "Song Name", "artist": "Artist Name", "query": "artist song name"}
  ]
}

For removing songs (you'll need to know what's currently in the playlist):
{
  "type": "modify",
  "action": "remove",
  "tracks": [
    {"name": "Song Name", "artist": "Artist Name", "query": "artist song name"}
  ]
}

4. For regular conversation (not playlist modification), respond normally without JSON

Examples:
- User: "Add some Taylor Swift songs" → Ask which Taylor Swift songs or generate suggestions
- User: "Remove all the slow songs" → You'll need to know current playlist contents
- User: "Add something more upbeat" → Ask for clarification and suggest specific tracks`;

const ANALYZE_SYSTEM_PROMPT = `You are an expert music analyst and DJ with access to Spotify's comprehensive music intelligence. You leverage detailed audio analysis, recommendation algorithms, and deep knowledge of music to help users understand and curate their playlists.

Your capabilities powered by Spotify data:
1. **Audio Features Analysis**: Energy, danceability, tempo, valence (mood), acousticness, instrumentalness, speechiness, key, mode
2. **Smart Recommendations**: Spotify's ML-based recommendations using playlist characteristics as seeds
3. **Related Artists Discovery**: Find similar artists based on Spotify's analysis of listening patterns
4. **Genre Intelligence**: Access to Spotify's comprehensive genre seeds and classifications
5. **Playlist DNA**: Understand the musical signature of playlists through aggregated audio features

INTERACTIVE COMMANDS you can help with:
- "Analyze this playlist" → Deep dive into audio features, patterns, and Spotify insights
- "Make it more [upbeat/chill/danceable]" → Use audio features to suggest targeted modifications
- "Remove outliers" → Identify tracks that don't match the playlist's audio signature
- "Find the perfect transition" → Suggest tracks with matching tempo/key for smooth flow
- "Add variety" → Recommend tracks that complement while expanding the sonic palette
- "What's missing?" → Analyze gaps in energy, mood, or genre coverage
- "Create a sister playlist" → Generate a new playlist with similar audio DNA

When analyzing, you have access to:
- **Detailed Audio Analysis**: Energy (0-1), Danceability (0-1), Tempo (BPM), Valence (happiness), etc.
- **Spotify Recommendations**: ML-generated tracks that match the playlist's characteristics
- **Related Artists**: Artists that Spotify identifies as similar based on user behavior
- **Available Genres**: Full list of Spotify's genre seeds for targeted recommendations

When recommending tracks, suggest the BEST possible songs - Spotify's algorithm combines audio analysis with collaborative filtering, ensuring recommendations are both sonically compatible AND culturally relevant.

For song recommendations, provide specific suggestions formatted as JSON:
{
  "type": "recommendation",
  "reasoning": "Brief explanation of why these songs fit based on audio analysis",
  "tracks": [
    {"name": "Song Name", "artist": "Artist Name", "query": "artist song name"}
  ]
}

For creating new playlists based on the current playlist's theme, format as JSON:
{
  "type": "playlist",
  "name": "Playlist Name",
  "description": "Brief description explaining connection to original playlist and audio characteristics",
  "tracks": [
    {"name": "Song Name", "artist": "Artist Name", "query": "artist song name"}
  ]
}

Be conversational, knowledgeable, and passionate about music. Use the detailed analysis data to provide insights users couldn't get elsewhere.

Examples:
- User: "Describe this playlist" → Analyze using audio features, genres, eras, and overall vibe
- User: "Make it more upbeat" → Suggest higher energy tracks that fit the style
- User: "Remove songs that don't fit" → Identify outliers based on audio characteristics
- User: "Create a new playlist based on this theme" → Generate with complementary audio profiles
- User: "What's missing from this playlist?" → Suggest gaps in energy, mood, or style progression`;

chatRouter.post('/message', async (c) => {
  try {
    const requestBody = await c.req.json();
    const request = safeParse(ChatRequestSchema, requestBody);

    if (!request) {
      return c.json({ error: 'Invalid chat request' }, 400);
    }

    const { message, conversationHistory = [], selectedPlaylistId, playlistTracks = [], mode = 'create' } = request;
    const token = c.req.header('Authorization')?.replace('Bearer ', '');

    // Choose system prompt based on mode
    let systemPrompt = CREATE_SYSTEM_PROMPT;
    if (mode === 'edit') {
      systemPrompt = EDIT_SYSTEM_PROMPT;
    } else if (mode === 'analyze') {
      systemPrompt = ANALYZE_SYSTEM_PROMPT;
    }

    // Initialize Langchain ChatAnthropic with latest Sonnet 4
    const chat = new ChatAnthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTokens: 2000, // Increased for more detailed analysis
    });

    // Build conversation messages
    const messages = [
      new SystemMessage(systemPrompt),
      ...conversationHistory.map(msg =>
        msg.role === 'user'
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content)
      ),
    ];

    // Add playlist context for analyze mode
    if (mode === 'analyze' && playlistTracks.length > 0 && token) {
      const trackList = playlistTracks
        .slice(0, 50) // Limit to first 50 tracks to avoid token limits
        .map((item: any) => {
          const track = item.track;
          if (track) {
            return `"${track.name}" by ${track.artists?.map((a: any) => a.name).join(', ')}`;
          }
          return null;
        })
        .filter(Boolean)
        .join('\n');

      // Get detailed audio analysis
      const audioAnalysis = await analyzePlaylistCharacteristics(playlistTracks, token);

      // Calculate audio feature averages for recommendations
      const trackIds = playlistTracks
        .filter(item => item.track && item.track.id)
        .map(item => item.track.id)
        .slice(0, 100);

      const audioFeatures = trackIds.length > 0
        ? await getSpotifyAudioFeatures(trackIds, token)
        : [];

      const audioFeatureSummary = audioFeatures.length > 0 ? {
        avgEnergy: audioFeatures.reduce((sum, f) => sum + (f?.energy || 0), 0) / audioFeatures.length,
        avgDanceability: audioFeatures.reduce((sum, f) => sum + (f?.danceability || 0), 0) / audioFeatures.length,
        avgValence: audioFeatures.reduce((sum, f) => sum + (f?.valence || 0), 0) / audioFeatures.length,
      } : {};

      // Get enhanced analysis using Spotify's recommendation API
      const enhancedAnalysis = await enhanceRecommendationsWithSpotify(
        playlistTracks,
        audioFeatureSummary,
        token
      );

      const contextMessage = `Here are the current tracks in this playlist:\n\n${trackList}\n\n${audioAnalysis}\n\n${enhancedAnalysis}\n\nUser question: ${message}`;
      messages.push(new HumanMessage(contextMessage));
    } else {
      messages.push(new HumanMessage(message));
    }


    // Get response from Claude
    const response = await chat.invoke(messages);
    const assistantMessage = response.content as string;

    // Check if response contains a playlist or modification command
    let playlist: PlaylistTrack[] | undefined;
    let playlistModified = false;
    let cleanMessage = assistantMessage;

    try {
      // Look for JSON in the response
      const jsonMatch = assistantMessage.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0];
        const actionData = JSON.parse(jsonStr);

        if (actionData.type === 'playlist') {
          // Handle playlist creation (original functionality)
          const validatedPlaylist = safeParse(GeneratedPlaylistSchema, {
            name: actionData.name,
            description: actionData.description,
            tracks: actionData.tracks
          });

          if (validatedPlaylist && token) {
            // Enrich tracks with Spotify data and find alternatives
            const { enrichedTracks, searchResults } = await enrichTracksWithSpotify(
              validatedPlaylist.tracks,
              token
            );

            // Filter out tracks that couldn't be found on Spotify
            const availableTracks = enrichedTracks.filter(track => track.spotifyUri);
            const exactMatches = searchResults.filter(result => result.isExactMatch && result.found !== 'Not found on Spotify').length;
            const alternatives = searchResults.filter(result => !result.isExactMatch && result.found !== 'Not found on Spotify').length;
            const notFound = searchResults.filter(result => result.found === 'Not found on Spotify' || result.found === 'Search failed').length;

            if (availableTracks.length === 0) {
              cleanMessage = `I couldn't find any of those tracks on Spotify. Here are the search results:\n\n${searchResults.map(r => `• ${r.original} → ${r.found}`).join('\n')}\n\nLet me suggest some similar tracks that are available instead.`;
            } else {
              // Actually save the playlist to Spotify
              try {
                const savedPlaylistResult = await savePlaylistToSpotify({
                  name: validatedPlaylist.name,
                  description: validatedPlaylist.description,
                  tracks: availableTracks
                }, token);

                if (savedPlaylistResult.success) {
                  playlist = availableTracks;
                  playlistModified = true;

                  // Remove JSON from message and include playlist URL
                  cleanMessage = assistantMessage.replace(jsonMatch[0], '').trim();
                  if (!cleanMessage) {
                    cleanMessage = `I've created "${actionData.name}" for you! ${actionData.description}`;
                  }

                  if (savedPlaylistResult.playlistUrl) {
                    cleanMessage += `\n\n🎵 [Open playlist in Spotify](${savedPlaylistResult.playlistUrl})`;
                  }

                  // Provide detailed feedback about search results
                  cleanMessage += `\n\n**Track Search Results:**`;
                  if (exactMatches > 0) {
                    cleanMessage += `\n✅ Found ${exactMatches} exact matches`;
                  }
                  if (alternatives > 0) {
                    cleanMessage += `\n🔄 Found ${alternatives} similar alternatives`;
                  }
                  if (notFound > 0) {
                    cleanMessage += `\n❌ ${notFound} tracks not available on Spotify`;
                  }

                  // Show some specific examples if there were substitutions
                  const substitutions = searchResults.filter(r => !r.isExactMatch && r.found !== 'Not found on Spotify');
                  if (substitutions.length > 0 && substitutions.length <= 3) {
                    cleanMessage += `\n\n**Substitutions made:**`;
                    substitutions.forEach(sub => {
                      cleanMessage += `\n• ${sub.original} → ${sub.found}`;
                    });
                  }
                } else {
                  cleanMessage = `I found the tracks but couldn't save the playlist to your Spotify account. Please try again.`;
                }
              } catch (error) {
                console.error('Failed to save playlist to Spotify:', error);
                cleanMessage = `I found the tracks but couldn't save the playlist to your Spotify account. Please try again.`;
              }
            }
          }
        } else if (actionData.type === 'recommendation') {
          // Handle song recommendations
          const { reasoning, tracks } = actionData;

          if (tracks && tracks.length > 0 && token) {
            // Enrich tracks with Spotify data
            const { enrichedTracks, searchResults } = await enrichTracksWithSpotify(tracks, token);

            // Remove JSON from message and add reasoning
            cleanMessage = assistantMessage.replace(jsonMatch[0], '').trim();
            if (!cleanMessage) {
              cleanMessage = `${reasoning}\n\nHere are some recommendations that would fit perfectly:`;
            }

            // Add track suggestions to the message, showing what was actually found
            const availableTracks = enrichedTracks.filter(track => track.spotifyUri);
            if (availableTracks.length > 0) {
              const trackSuggestions = availableTracks
                .map((track, index) => `${index + 1}. "${track.name}" by ${track.artist}`)
                .join('\n');

              cleanMessage += `\n\n${trackSuggestions}`;
              cleanMessage += `\n\nWould you like me to add any of these to your playlist?`;

              // Show substitutions if any were made
              const substitutions = searchResults.filter(r => !r.isExactMatch && r.found !== 'Not found on Spotify');
              if (substitutions.length > 0) {
                cleanMessage += `\n\n*Note: Some recommendations were substituted with similar available tracks.*`;
              }
            } else {
              cleanMessage += `\n\nI couldn't find those specific tracks on Spotify. Let me suggest some similar tracks that are available.`;
            }
          }
        } else if (actionData.type === 'modify' && selectedPlaylistId && token) {
          // Handle playlist modification
          const { action, tracks } = actionData;

          if (tracks && tracks.length > 0) {
            // Enrich tracks with Spotify data
            const { enrichedTracks, searchResults } = await enrichTracksWithSpotify(tracks, token);
            const trackUris = enrichedTracks
              .filter(track => track.spotifyUri)
              .map(track => track.spotifyUri as string);

            if (trackUris.length > 0) {
              // Make internal request to modify endpoint
              const modifyResponse = await fetch('https://api.spotify.com/v1/playlists/' + selectedPlaylistId + '/tracks', {
                method: action === 'add' ? 'POST' : 'DELETE',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(
                  action === 'add'
                    ? { uris: trackUris }
                    : { tracks: trackUris.map(uri => ({ uri })) }
                )
              });

              if (modifyResponse.ok) {
                playlistModified = true;
                cleanMessage = assistantMessage.replace(jsonMatch[0], '').trim();
                if (!cleanMessage) {
                  cleanMessage = `I've ${action === 'add' ? 'added' : 'removed'} ${trackUris.length} track${trackUris.length !== 1 ? 's' : ''} ${action === 'add' ? 'to' : 'from'} your playlist!`;
                }

                // Show what was actually added/removed
                const alternatives = searchResults.filter(r => !r.isExactMatch && r.found !== 'Not found on Spotify');
                if (alternatives.length > 0) {
                  cleanMessage += `\n\n*Some tracks were substituted with similar available alternatives.*`;
                }
              } else {
                cleanMessage = `I found the tracks but couldn't ${action} them to your playlist. Please try again.`;
              }
            } else {
              cleanMessage = `I couldn't find those tracks on Spotify. Here's what I searched for:\n\n${searchResults.map(r => `• ${r.original} → ${r.found}`).join('\n')}`;
            }
          }
        }
      }
    } catch (error) {
      // If JSON parsing fails, just continue with the regular message
      console.log('No valid action JSON found in response');
    }

    // Update conversation history
    const newHistory = [
      ...conversationHistory,
      { role: 'user' as const, content: message },
      { role: 'assistant' as const, content: cleanMessage }
    ];

    const chatResponse: ChatResponse = {
      message: cleanMessage,
      conversationHistory: newHistory,
      ...(playlist && {
        playlist: {
          name: playlist[0]?.name || 'Generated Playlist',
          description: 'AI-generated playlist based on our conversation',
          tracks: playlist
        }
      }),
      playlistModified
    };

    return c.json(chatResponse);

  } catch (error) {
    console.error('Chat error:', error);
    const message = error instanceof Error ? error.message : 'Chat failed';
    return c.json({ error: message }, 500);
  }
});

// Helper function to get Spotify audio features for tracks
async function getSpotifyAudioFeatures(
  trackIds: string[],
  token: string
): Promise<any[]> {
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/audio-features?ids=${trackIds.join(',')}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json() as { audio_features?: any[] };
      return data.audio_features || [];
    }
  } catch (error) {
    console.error('Failed to get audio features:', error);
  }
  return [];
}

// Helper function to analyze playlist characteristics using audio features
async function analyzePlaylistCharacteristics(
  playlistTracks: any[],
  token: string
): Promise<string> {
  const trackIds = playlistTracks
    .filter(item => item.track && item.track.id)
    .map(item => item.track.id)
    .slice(0, 100); // Spotify API limit

  if (trackIds.length === 0) {
    return '';
  }

  const audioFeatures = await getSpotifyAudioFeatures(trackIds, token);

  if (audioFeatures.length === 0) {
    return '';
  }

  // Calculate averages
  const validFeatures = audioFeatures.filter(f => f !== null);
  const avgEnergy = validFeatures.reduce((sum, f) => sum + f.energy, 0) / validFeatures.length;
  const avgDanceability = validFeatures.reduce((sum, f) => sum + f.danceability, 0) / validFeatures.length;
  const avgValence = validFeatures.reduce((sum, f) => sum + f.valence, 0) / validFeatures.length;
  const avgTempo = validFeatures.reduce((sum, f) => sum + f.tempo, 0) / validFeatures.length;
  const avgAcousticness = validFeatures.reduce((sum, f) => sum + f.acousticness, 0) / validFeatures.length;
  const avgInstrumentalness = validFeatures.reduce((sum, f) => sum + f.instrumentalness, 0) / validFeatures.length;

  // Analyze key and mode distribution
  const modes = validFeatures.map(f => f.mode);
  const majorKeys = modes.filter(m => m === 1).length;
  const minorKeys = modes.filter(m => m === 0).length;

  return `
DETAILED AUDIO ANALYSIS:
- Energy Level: ${(avgEnergy * 100).toFixed(1)}% (${avgEnergy > 0.7 ? 'High Energy' : avgEnergy > 0.4 ? 'Medium Energy' : 'Low Energy'})
- Danceability: ${(avgDanceability * 100).toFixed(1)}% (${avgDanceability > 0.7 ? 'Very Danceable' : avgDanceability > 0.5 ? 'Moderately Danceable' : 'Less Danceable'})
- Mood (Valence): ${(avgValence * 100).toFixed(1)}% (${avgValence > 0.6 ? 'Positive/Happy' : avgValence > 0.4 ? 'Neutral' : 'Melancholic/Sad'})
- Average Tempo: ${avgTempo.toFixed(0)} BPM (${avgTempo > 140 ? 'Fast' : avgTempo > 100 ? 'Moderate' : 'Slow'})
- Acousticness: ${(avgAcousticness * 100).toFixed(1)}% (${avgAcousticness > 0.5 ? 'Acoustic-leaning' : 'Electronic-leaning'})
- Instrumentalness: ${(avgInstrumentalness * 100).toFixed(1)}% (${avgInstrumentalness > 0.5 ? 'Many Instrumentals' : 'Mostly Vocal Tracks'})
- Key Distribution: ${majorKeys} major keys, ${minorKeys} minor keys
- Total Analyzed Tracks: ${validFeatures.length}
  `;
}

// Helper function to search Spotify catalog for tracks
async function searchSpotifyTracks(
  query: string,
  token: string,
  limit: number = 10
): Promise<{ tracks: any[]; hasResults: boolean }> {
  try {
    const searchResponse = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (searchResponse.ok) {
      const responseData = await searchResponse.json();
      const searchData = safeParse(SpotifySearchResponseSchema, responseData);

      if (searchData && searchData.tracks?.items) {
        return {
          tracks: searchData.tracks.items,
          hasResults: searchData.tracks.items.length > 0
        };
      }
    }
  } catch (error) {
    console.error(`Failed to search Spotify for: ${query}`, error);
  }

  return { tracks: [], hasResults: false };
}

// Helper function to get Spotify recommendations based on playlist
async function getSpotifyRecommendations(
  seedTracks: string[],
  seedArtists: string[],
  audioFeatures: any,
  token: string
): Promise<any[]> {
  try {
    // Limit seeds per Spotify API requirements
    const limitedTracks = seedTracks.slice(0, 2);
    const limitedArtists = seedArtists.slice(0, 2);

    // Build recommendation parameters based on audio features
    const params = new URLSearchParams({
      seed_tracks: limitedTracks.join(','),
      seed_artists: limitedArtists.join(','),
      limit: '20',
      // Target the playlist's average characteristics
      target_energy: audioFeatures.avgEnergy?.toFixed(2) || '0.5',
      target_danceability: audioFeatures.avgDanceability?.toFixed(2) || '0.5',
      target_valence: audioFeatures.avgValence?.toFixed(2) || '0.5',
      // Add some variety with min/max ranges
      min_popularity: '30',
      max_popularity: '100'
    });

    const response = await fetch(
      `https://api.spotify.com/v1/recommendations?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.tracks || [];
    }
  } catch (error) {
    console.error('Failed to get Spotify recommendations:', error);
  }
  return [];
}

// Helper function to get related artists from Spotify
async function getSpotifyRelatedArtists(
  artistId: string,
  token: string
): Promise<any[]> {
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/artists/${artistId}/related-artists`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.artists || [];
    }
  } catch (error) {
    console.error('Failed to get related artists:', error);
  }
  return [];
}

// Helper function to get available genre seeds from Spotify
async function getSpotifyGenreSeeds(token: string): Promise<string[]> {
  try {
    const response = await fetch(
      'https://api.spotify.com/v1/recommendations/available-genre-seeds',
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.genres || [];
    }
  } catch (error) {
    console.error('Failed to get genre seeds:', error);
  }
  return [];
}

// Enhanced function using only Spotify APIs for recommendations
async function enhanceRecommendationsWithSpotify(
  playlistTracks: any[],
  audioFeatures: any,
  token: string
): Promise<string> {
  if (playlistTracks.length === 0) {
    return '';
  }

  // Extract track and artist IDs
  const trackIds = playlistTracks
    .map(item => item.track?.id)
    .filter(Boolean)
    .slice(0, 5);

  const artistIds = [...new Set(
    playlistTracks
      .map(item => item.track?.artists?.[0]?.id)
      .filter(Boolean)
      .slice(0, 3)
  )];

  let enhancedAnalysis = '';

  // Get Spotify recommendations
  const recommendations = await getSpotifyRecommendations(
    trackIds,
    artistIds,
    audioFeatures,
    token
  );

  // Get related artists for the top artists
  const relatedArtistsPromises = artistIds.slice(0, 2).map(id =>
    getSpotifyRelatedArtists(id, token)
  );
  const relatedArtistsResults = await Promise.all(relatedArtistsPromises);
  const allRelatedArtists = [...new Set(
    relatedArtistsResults.flat().map(artist => artist.name).slice(0, 10)
  )];

  // Get available genres
  const genreSeeds = await getSpotifyGenreSeeds(token);

  if (recommendations.length > 0 || allRelatedArtists.length > 0) {
    enhancedAnalysis += `
SPOTIFY RECOMMENDATIONS & INSIGHTS:
- Recommended Tracks: ${recommendations.slice(0, 5).map(t => `"${t.name}" by ${t.artists[0].name}`).join(', ')}
- Related Artists to Explore: ${allRelatedArtists.slice(0, 8).join(', ')}
- Available Genre Seeds: ${genreSeeds.slice(0, 10).join(', ')}
- Playlist Seeds: ${trackIds.length} tracks, ${artistIds.length} artists analyzed
    `;
  }

  return enhancedAnalysis;
}

// Helper function to enrich tracks with Spotify data and find alternatives
async function enrichTracksWithSpotify(
  tracks: { name: string; artist: string; query: string }[],
  token: string
): Promise<{ enrichedTracks: PlaylistTrack[]; searchResults: { original: string; found: string; isExactMatch: boolean }[] }> {
  const searchResults: { original: string; found: string; isExactMatch: boolean }[] = [];

  const enrichedTracks = await Promise.all(
    tracks.map(async (track): Promise<PlaylistTrack> => {
      try {
        // First, try the exact query
        let searchResult = await searchSpotifyTracks(track.query, token, 3);
        let isExactMatch = true;

        // If no exact match, try variations
        if (!searchResult.hasResults) {
          isExactMatch = false;

          // Try alternative queries in order of preference
          const alternativeQueries = [
            `${track.artist} ${track.name}`,  // Different formatting
            track.artist,                      // Just artist (for similar tracks)
            track.name,                        // Just song name (for covers)
            track.name.split(' ').slice(0, 3).join(' '), // First few words of song
          ];

          for (const altQuery of alternativeQueries) {
            searchResult = await searchSpotifyTracks(altQuery, token, 5);
            if (searchResult.hasResults) {
              break;
            }
          }
        }

        if (searchResult.hasResults && searchResult.tracks.length > 0) {
          const spotifyTrack = searchResult.tracks[0];
          const foundTrack = `${spotifyTrack.name} by ${spotifyTrack.artists?.map((a: any) => a.name).join(', ')}`;

          searchResults.push({
            original: `${track.name} by ${track.artist}`,
            found: foundTrack,
            isExactMatch
          });

          return {
            ...track,
            // Update with actual found track info
            name: spotifyTrack.name,
            artist: spotifyTrack.artists?.map((a: any) => a.name).join(', ') || track.artist,
            spotifyId: spotifyTrack.id,
            spotifyUri: spotifyTrack.uri,
            preview_url: spotifyTrack.preview_url,
            external_url: spotifyTrack.external_urls?.spotify
          };
        } else {
          searchResults.push({
            original: `${track.name} by ${track.artist}`,
            found: 'Not found on Spotify',
            isExactMatch: false
          });
        }
      } catch (error) {
        console.error(`Failed to search for track: ${track.query}`, error);
        searchResults.push({
          original: `${track.name} by ${track.artist}`,
          found: 'Search failed',
          isExactMatch: false
        });
      }

      return track;
    })
  );

  return { enrichedTracks, searchResults };
}

// Helper function to save playlist to Spotify
async function savePlaylistToSpotify(
  playlist: { name: string; description: string; tracks: PlaylistTrack[] },
  token: string
): Promise<{ success: boolean; playlistId?: string; playlistUrl?: string }> {
  try {
    // Get user ID
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!isSuccessResponse(userResponse)) {
      throw new Error('Failed to get user profile');
    }

    const responseData = await userResponse.json();
    const userData = safeParse(SpotifyUserSchema, responseData);

    if (!userData) {
      throw new Error('Invalid user data from Spotify');
    }

    const userId = userData.id;

    // Create playlist
    const createResponse = await fetch(
      `https://api.spotify.com/v1/users/${userId}/playlists`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: playlist.name,
          description: playlist.description,
          public: false
        })
      }
    );

    if (!isSuccessResponse(createResponse)) {
      throw new Error('Failed to create playlist');
    }

    const createResponseData = await createResponse.json();
    const createdPlaylist = safeParse(SpotifyPlaylistSchema, createResponseData);

    if (!createdPlaylist) {
      throw new Error('Invalid playlist creation response from Spotify');
    }

    // Add tracks to playlist
    const trackUris = playlist.tracks
      .filter((track: PlaylistTrack): track is PlaylistTrack & { spotifyUri: string } =>
        Boolean(track.spotifyUri)
      )
      .map((track: PlaylistTrack & { spotifyUri: string }) => track.spotifyUri);

    if (trackUris.length > 0) {
      const addTracksResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${createdPlaylist.id}/tracks`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            uris: trackUris
          })
        }
      );

      if (!addTracksResponse.ok) {
        throw new Error('Failed to add tracks to playlist');
      }
    }

    return {
      success: true,
      playlistId: createdPlaylist.id,
      playlistUrl: createdPlaylist.external_urls?.spotify
    };
  } catch (error) {
    console.error('Save playlist error:', error);
    return { success: false };
  }
}

export { chatRouter };