/**
 * Authentication API contracts
 * Spotify OAuth flow with PKCE and token management
 */

import { createRoute, z } from "@hono/zod-openapi";

/**
 * GET /api/spotify/auth-url
 * Returns Spotify OAuth authorization URL with PKCE
 * Sets secure HttpOnly cookie with code_verifier
 */
export const getSpotifyAuthUrl = createRoute({
  description: "Get Spotify OAuth authorization URL (PKCE flow)",
  method: "get",
  path: "/api/spotify/auth-url",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            url: z.string().url(),
          }),
        },
      },
      description:
        "OAuth URL generated successfully. Code verifier stored in secure cookie.",
    },
    500: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "Server error",
    },
  },
  tags: ["Auth"],
});

/**
 * GET /api/spotify/callback
 * OAuth callback handler - exchanges code for token
 * Redirects back to frontend with token
 */
export const handleSpotifyCallback = createRoute({
  description:
    "Handle OAuth callback and exchange code for token (server-side)",
  method: "get",
  path: "/api/spotify/callback",
  request: {
    query: z.object({
      code: z.string().optional(),
      error: z.string().optional(),
      state: z.string().optional(),
    }),
  },
  responses: {
    302: {
      description: "Redirect to frontend with token or error",
    },
  },
  tags: ["Auth"],
});

/**
 * POST /api/spotify/token
 * Exchange authorization code for access token (alternative flow)
 */
export const exchangeSpotifyToken = createRoute({
  description: "Exchange authorization code for Spotify access token",
  method: "post",
  path: "/api/spotify/token",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            code: z.string().min(1),
            codeVerifier: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            access_token: z.string(),
            expires_in: z.number(),
            refresh_token: z.string().optional(),
            scope: z.string(),
            token_type: z.literal("Bearer"),
          }),
        },
      },
      description: "Token exchanged successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
            error_description: z.string().optional(),
          }),
        },
      },
      description: "Invalid request",
    },
  },
  tags: ["Auth"],
});

/**
 * POST /api/spotify/search
 * Search Spotify catalog
 */
export const searchSpotify = createRoute({
  description: "Search Spotify for tracks, albums, or artists",
  method: "post",
  path: "/api/spotify/search",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            query: z.string().min(1),
            type: z.enum(["track", "album", "artist"]).default("track"),
          }),
        },
      },
    },
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            tracks: z
              .object({
                items: z.array(z.any()), // Use SpotifyTrackSchema from shared-types
              })
              .optional(),
          }),
        },
      },
      description: "Search results",
    },
    400: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "Invalid request",
    },
    401: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "Unauthorized",
    },
  },
  tags: ["Spotify"],
});
