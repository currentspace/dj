// Session Management for MCP Integration
import {customAlphabet} from 'nanoid'

// Generate secure session tokens
const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 32)

export interface Session {
  createdAt: number
  expiresAt: number
  id: string
  metadata?: {
    displayName?: string
    userEmail?: string
  }
  spotifyToken: string
  userId?: string
}

export class SessionManager {
  private kv: KVNamespace
  private memory: Map<string, Session>

  constructor(kv?: KVNamespace) {
    this.kv = kv!
    this.memory = new Map()
  }

  /**
   * Clean up expired sessions from memory
   */
  cleanupExpiredSessions(): void {
    const now = Date.now()
    for (const [token, session] of this.memory.entries()) {
      if (session.expiresAt < now) {
        this.memory.delete(token)
      }
    }
  }

  /**
   * Create a new session when user logs in
   */
  async createSession(spotifyToken: string, userId?: string): Promise<string> {
    const sessionToken = nanoid()
    const session: Session = {
      createdAt: Date.now(),
      expiresAt: Date.now() + 4 * 60 * 60 * 1000, // 4 hours
      id: sessionToken,
      spotifyToken,
      userId,
    }

    console.log(`[Session] Creating session ${sessionToken.substring(0, 8)}... for user ${userId ?? 'unknown'}`)

    // Store in memory for fast access
    this.memory.set(sessionToken, session)
    console.log(`[Session] Stored in memory cache (${this.memory.size} total sessions)`)

    // Store in KV for persistence (if available)
    if (this.kv) {
      try {
        await this.kv.put(
          `session:${sessionToken}`,
          JSON.stringify(session),
          {expirationTtl: 4 * 60 * 60}, // 4 hours TTL
        )
        console.log(`[Session] Stored in KV with 4-hour TTL`)
      } catch (error) {
        console.error(`[Session] Failed to store in KV:`, error)
      }
    } else {
      console.warn(`[Session] KV storage not available, using memory only`)
    }

    return sessionToken
  }

  /**
   * Destroy session on logout
   */
  async destroySession(sessionToken: string): Promise<void> {
    this.memory.delete(sessionToken)
    if (this.kv) {
      await this.kv.delete(`session:${sessionToken}`)
    }
  }

  /**
   * Refresh session expiration on activity
   */
  async touchSession(sessionToken: string): Promise<void> {
    const session = this.memory.get(sessionToken)
    if (session) {
      session.expiresAt = Date.now() + 4 * 60 * 60 * 1000

      if (this.kv) {
        await this.kv.put(`session:${sessionToken}`, JSON.stringify(session), {
          expirationTtl: 4 * 60 * 60,
        })
      }
    }
  }

  /**
   * Validate session and return Spotify token
   */
  async validateSession(sessionToken: string): Promise<null | string> {
    // Check memory first
    let session = this.memory.get(sessionToken)

    // Fall back to KV if not in memory
    if (!session && this.kv) {
      const stored = await this.kv.get(`session:${sessionToken}`)
      if (stored) {
        session = JSON.parse(stored) as Session
        // Cache in memory
        this.memory.set(sessionToken, session)
      }
    }

    if (!session) {
      return null
    }

    // Check expiration
    if (session.expiresAt < Date.now()) {
      await this.destroySession(sessionToken)
      return null
    }

    return session.spotifyToken
  }
}
