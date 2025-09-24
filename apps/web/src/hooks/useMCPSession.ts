// Hook for MCP Session Management
import { useState, useCallback, useEffect } from 'react';

interface MCPSession {
  sessionToken: string;
  mcpServerUrl: string;
  userId?: string;
  displayName?: string;
}

export function useMCPSession() {
  const [session, setSession] = useState<MCPSession | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  /**
   * Initialize MCP session after Spotify login
   */
  const initializeSession = useCallback(async (spotifyToken: string) => {
    setIsInitializing(true);

    try {
      const response = await fetch('/api/mcp/session/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${spotifyToken}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to create MCP session');
      }

      const sessionData: MCPSession = await response.json();
      setSession(sessionData);

      // Store in sessionStorage for persistence during page refreshes
      sessionStorage.setItem('mcp_session', JSON.stringify(sessionData));

      console.log('MCP Session initialized:', {
        token: sessionData.sessionToken,
        url: sessionData.mcpServerUrl
      });

      return sessionData;
    } catch (error) {
      console.error('Failed to initialize MCP session:', error);
      throw error;
    } finally {
      setIsInitializing(false);
    }
  }, []);

  /**
   * Destroy session on logout
   */
  const destroySession = useCallback(async () => {
    if (!session) return;

    try {
      await fetch('/api/mcp/session/destroy', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.sessionToken}`
        }
      });
    } catch (error) {
      console.error('Failed to destroy MCP session:', error);
    } finally {
      setSession(null);
      sessionStorage.removeItem('mcp_session');
    }
  }, [session]);

  /**
   * Get MCP configuration for Claude
   */
  const getMCPConfig = useCallback(() => {
    if (!session) return null;

    return {
      servers: {
        spotify: {
          command: 'remote',
          url: session.mcpServerUrl,
          headers: {
            'Authorization': `Bearer ${session.sessionToken}`
          },
          env: {
            SESSION_TOKEN: session.sessionToken
          }
        }
      }
    };
  }, [session]);

  /**
   * Load session from storage on mount
   */
  useEffect(() => {
    const stored = sessionStorage.getItem('mcp_session');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSession(parsed);
      } catch (error) {
        console.error('Invalid stored MCP session');
        sessionStorage.removeItem('mcp_session');
      }
    }
  }, []);

  return {
    session,
    isInitializing,
    initializeSession,
    destroySession,
    getMCPConfig
  };
}