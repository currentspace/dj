import { Hono } from 'hono';
import { z } from 'zod';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import type { Env } from '../index';
import { safeParse } from '../lib/guards';
import {
  GeneratedPlaylistSchema,
  SpotifySearchResponseSchema,
  PlaylistTrackSchema,
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
4. Format playlist responses as JSON with this exact structure:
{
  "type": "playlist",
  "name": "Playlist Name",
  "description": "Brief description",
  "tracks": [
    {"name": "Song Name", "artist": "Artist Name", "query": "artist song name"}
  ]
}

5. For regular conversation (not playlist generation), respond normally without JSON

Examples:
- User: "I need something upbeat" → Ask about genre, occasion, or specific energy level
- User: "90s rock for working out" → Generate playlist immediately
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

const ANALYZE_SYSTEM_PROMPT = `You are an expert music analyst and DJ who helps users understand and discuss their playlists. You have deep knowledge of music history, genres, artists, eras, and musical characteristics.

Your role is to:
1. Analyze playlists and describe their musical characteristics
2. Discuss the vibe, era, genre, and mood of playlists
3. Explain musical patterns and connections between songs
4. Suggest similar songs that would fit the playlist's style
5. Have engaging conversations about music and musical taste

When analyzing playlists, consider:
- Genre and subgenres represented
- Era/decade patterns
- Musical characteristics (tempo, energy, mood)
- Artist patterns and influences
- Thematic connections
- Production styles and sounds

For song recommendations, provide specific suggestions formatted as JSON:
{
  "type": "recommendation",
  "reasoning": "Brief explanation of why these songs fit",
  "tracks": [
    {"name": "Song Name", "artist": "Artist Name", "query": "artist song name"}
  ]
}

Be conversational, knowledgeable, and passionate about music. Help users discover new aspects of their musical taste.

Examples:
- User: "Describe this playlist" → Analyze genres, eras, moods, and overall vibe
- User: "What era is this from?" → Identify time periods and explain musical characteristics
- User: "Recommend similar songs" → Suggest tracks that match the playlist's style
- User: "What's the vibe of this playlist?" → Describe mood, energy, and atmosphere`;

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

    // Initialize Langchain ChatAnthropic
    const chat = new ChatAnthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
      model: 'claude-3-haiku-20240307',
      temperature: 0.7,
      maxTokens: 1000,
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
    if (mode === 'analyze' && playlistTracks.length > 0) {
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

      const contextMessage = `Here are the current tracks in this playlist:\n\n${trackList}\n\nUser question: ${message}`;
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
            // Enrich tracks with Spotify data
            const enrichedTracks = await enrichTracksWithSpotify(
              validatedPlaylist.tracks,
              token
            );

            playlist = enrichedTracks;

            // Remove JSON from message
            cleanMessage = assistantMessage.replace(jsonMatch[0], '').trim();
            if (!cleanMessage) {
              cleanMessage = `I've created "${actionData.name}" for you! ${actionData.description}`;
            }
          }
        } else if (actionData.type === 'recommendation') {
          // Handle song recommendations
          const { reasoning, tracks } = actionData;

          if (tracks && tracks.length > 0) {
            // Enrich tracks with Spotify data
            const enrichedTracks = await enrichTracksWithSpotify(tracks, token);

            // Remove JSON from message and add reasoning
            cleanMessage = assistantMessage.replace(jsonMatch[0], '').trim();
            if (!cleanMessage) {
              cleanMessage = `${reasoning}\n\nHere are some recommendations that would fit perfectly:`;
            }

            // Add track suggestions to the message
            const trackSuggestions = enrichedTracks
              .map((track, index) => `${index + 1}. "${track.name}" by ${track.artist}`)
              .join('\n');

            cleanMessage += `\n\n${trackSuggestions}`;

            if (enrichedTracks.some(track => track.spotifyUri)) {
              cleanMessage += `\n\nWould you like me to add any of these to your playlist?`;
            }
          }
        } else if (actionData.type === 'modify' && selectedPlaylistId && token) {
          // Handle playlist modification
          const { action, tracks } = actionData;

          if (tracks && tracks.length > 0) {
            // Enrich tracks with Spotify data
            const enrichedTracks = await enrichTracksWithSpotify(tracks, token);
            const trackUris = enrichedTracks
              .filter(track => track.spotifyUri)
              .map(track => track.spotifyUri as string);

            if (trackUris.length > 0) {
              // Call playlist modification API directly
              const modifyRequest = {
                playlistId: selectedPlaylistId,
                action,
                trackUris
              };

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
              } else {
                cleanMessage = `I found the tracks but couldn't ${action} them to your playlist. Please try again.`;
              }
            } else {
              cleanMessage = `I couldn't find those tracks on Spotify. Could you be more specific?`;
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

// Helper function to enrich tracks with Spotify data
async function enrichTracksWithSpotify(
  tracks: { name: string; artist: string; query: string }[],
  token: string
): Promise<PlaylistTrack[]> {
  return Promise.all(
    tracks.map(async (track): Promise<PlaylistTrack> => {
      try {
        const searchResponse = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(track.query)}&type=track&limit=1`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        if (searchResponse.ok) {
          const responseData = await searchResponse.json();
          const searchData = safeParse(SpotifySearchResponseSchema, responseData);

          if (searchData && searchData.tracks?.items && searchData.tracks.items.length > 0) {
            const spotifyTrack = searchData.tracks.items[0];
            return {
              ...track,
              spotifyId: spotifyTrack.id,
              spotifyUri: spotifyTrack.uri,
              preview_url: spotifyTrack.preview_url,
              external_url: spotifyTrack.external_urls?.spotify
            };
          }
        }
      } catch (error) {
        console.error(`Failed to search for track: ${track.query}`, error);
      }

      return track;
    })
  );
}

export { chatRouter };