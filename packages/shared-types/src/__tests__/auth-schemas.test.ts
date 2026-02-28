import {describe, expect, it} from 'vitest'

import {SpotifyAuthUrlResponseSchema, TokenDataSchema, TokenRefreshResponseSchema} from '../schemas/auth-schemas'

describe('Auth Schemas', () => {
  describe('TokenDataSchema', () => {
    it('validates complete token data', () => {
      const data = {createdAt: Date.now(), expiresAt: Date.now() + 3600000, token: 'BQxyz123'}
      expect(TokenDataSchema.safeParse(data).success).toBe(true)
    })

    it('allows null expiresAt', () => {
      const data = {createdAt: Date.now(), expiresAt: null, token: 'BQxyz123'}
      expect(TokenDataSchema.safeParse(data).success).toBe(true)
    })

    it('rejects empty token', () => {
      const data = {createdAt: Date.now(), expiresAt: null, token: ''}
      expect(TokenDataSchema.safeParse(data).success).toBe(false)
    })

    it('rejects missing fields', () => {
      expect(TokenDataSchema.safeParse({token: 'abc'}).success).toBe(false)
    })
  })

  describe('SpotifyAuthUrlResponseSchema', () => {
    it('validates auth URL response', () => {
      const data = {url: 'https://accounts.spotify.com/authorize?client_id=xyz'}
      expect(SpotifyAuthUrlResponseSchema.safeParse(data).success).toBe(true)
    })

    it('rejects non-URL string', () => {
      expect(SpotifyAuthUrlResponseSchema.safeParse({url: 'not-a-url'}).success).toBe(false)
    })

    it('rejects missing url', () => {
      expect(SpotifyAuthUrlResponseSchema.safeParse({}).success).toBe(false)
    })
  })

  describe('TokenRefreshResponseSchema', () => {
    it('validates token refresh response', () => {
      const data = {access_token: 'BQnewtoken', expires_in: 3600}
      expect(TokenRefreshResponseSchema.safeParse(data).success).toBe(true)
    })

    it('rejects non-positive expires_in', () => {
      expect(TokenRefreshResponseSchema.safeParse({access_token: 'abc', expires_in: 0}).success).toBe(false)
      expect(TokenRefreshResponseSchema.safeParse({access_token: 'abc', expires_in: -1}).success).toBe(false)
    })
  })
})
