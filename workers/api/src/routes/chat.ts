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
  conversationHistory: z.array(ChatMessageSchema).optional().default([])
});

const ChatResponseSchema = z.object({
  message: z.string(),
  playlist: z.object({
    name: z.string(),
    description: z.string(),
    tracks: z.array(PlaylistTrackSchema)
  }).optional(),
  conversationHistory: z.array(ChatMessageSchema)
});

type ChatResponse = z.infer<typeof ChatResponseSchema>;

// System prompt for the DJ assistant
const SYSTEM_PROMPT = `You are an expert DJ and music curator with deep knowledge of all genres, artists, and musical history. Your job is to help users create the perfect playlists through natural conversation.

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

chatRouter.post('/message', async (c) => {
  try {
    const requestBody = await c.req.json();
    const request = safeParse(ChatRequestSchema, requestBody);

    if (!request) {
      return c.json({ error: 'Invalid chat request' }, 400);
    }

    const { message, conversationHistory = [] } = request;
    const token = c.req.header('Authorization')?.replace('Bearer ', '');

    // Initialize Langchain ChatAnthropic
    const chat = new ChatAnthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
      model: 'claude-3-haiku-20240307',
      temperature: 0.7,
      maxTokens: 1000,
    });

    // Build conversation messages
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      ...conversationHistory.map(msg =>
        msg.role === 'user'
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content)
      ),
      new HumanMessage(message)
    ];

    // Get response from Claude
    const response = await chat.invoke(messages);
    const assistantMessage = response.content as string;

    // Check if response contains a playlist
    let playlist: PlaylistTrack[] | undefined;
    let cleanMessage = assistantMessage;

    try {
      // Look for JSON in the response
      const jsonMatch = assistantMessage.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0];
        const playlistData = JSON.parse(jsonStr);

        if (playlistData.type === 'playlist') {
          const validatedPlaylist = safeParse(GeneratedPlaylistSchema, {
            name: playlistData.name,
            description: playlistData.description,
            tracks: playlistData.tracks
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
              cleanMessage = `I've created "${playlistData.name}" for you! ${playlistData.description}`;
            }
          }
        }
      }
    } catch (error) {
      // If JSON parsing fails, just continue with the regular message
      console.log('No valid playlist JSON found in response');
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
      })
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