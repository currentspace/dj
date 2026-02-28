/**
 * Zod schemas for authentication boundaries
 *
 * Validates token storage, auth URL responses, and token refresh responses.
 */

import {z} from 'zod'

// ===== Token Storage =====

export const TokenDataSchema = z.object({
  createdAt: z.number(),
  expiresAt: z.number().nullable(),
  token: z.string().min(1),
})

// ===== Auth URL Response =====

export const SpotifyAuthUrlResponseSchema = z.object({
  url: z.url(),
})

// ===== Token Refresh Response =====

export const TokenRefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
})

// ===== Type Exports =====

export type TokenData = z.infer<typeof TokenDataSchema>
export type SpotifyAuthUrlResponse = z.infer<typeof SpotifyAuthUrlResponseSchema>
export type TokenRefreshResponse = z.infer<typeof TokenRefreshResponseSchema>
