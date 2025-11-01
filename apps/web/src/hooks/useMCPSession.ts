// Hook for MCP Session Management
import { useCallback, useEffect, useState } from 'react';

interface MCPSession {
  displayName?: string;
  mcpServerUrl: string;
  sessionToken: string;
  userId?: string;
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
        headers: {
          'Authorization': `Bearer ${spotifyToken}`
        },
        method: 'POST'
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
        headers: {
          'Authorization': `Bearer ${session.sessionToken}`
        },
        method: 'POST'
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
          env: {
            SESSION_TOKEN: session.sessionToken
          },
          headers: {
            'Authorization': `Bearer ${session.sessionToken}`
          },
          url: session.mcpServerUrl
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
    destroySession,
    getMCPConfig,
    initializeSession,
    isInitializing,
    session
  };
}