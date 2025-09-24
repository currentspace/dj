// SSE streaming client for real-time chat responses
import type { StreamToolData, StreamToolResult, StreamDebugData, StreamLogData } from '@dj/shared-types';

export type StreamEvent =
  | { type: 'thinking'; data: string }
  | { type: 'tool_start'; data: StreamToolData }
  | { type: 'tool_end'; data: StreamToolResult }
  | { type: 'content'; data: string }
  | { type: 'error'; data: string }
  | { type: 'done'; data: null }
  | { type: 'log'; data: StreamLogData }
  | { type: 'debug'; data: StreamDebugData };

export interface StreamCallbacks {
  onThinking?: (message: string) => void;
  onToolStart?: (tool: string, args: Record<string, unknown>) => void;
  onToolEnd?: (tool: string, result: unknown) => void;
  onContent?: (content: string) => void;
  onError?: (error: string) => void;
  onDone?: () => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
  onDebug?: (data: StreamDebugData) => void;
}

export class ChatStreamClient {
  private eventSource: EventSource | null = null;
  private abortController: AbortController | null = null;

  async streamMessage(
    message: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    mode: 'analyze' | 'create' | 'edit',
    callbacks: StreamCallbacks
  ): Promise<void> {
    // Get auth token
    const token = localStorage.getItem('spotify_token');
    if (!token) {
      callbacks.onError?.('Not authenticated');
      return;
    }

    // Close any existing connection
    this.close();

    // Create abort controller for fetch
    this.abortController = new AbortController();

    try {
      const response = await fetch('/api/chat-stream/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          message,
          conversationHistory,
          mode,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Read the stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              callbacks.onDone?.();
              return;
            }

            try {
              const event: StreamEvent = JSON.parse(data);
              this.handleEvent(event, callbacks);
            } catch (error) {
              console.error('Failed to parse SSE event:', data);
            }
          }
        }
      }

      callbacks.onDone?.();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Stream was intentionally aborted
        return;
      }
      callbacks.onError?.(error instanceof Error ? error.message : 'Stream failed');
    }
  }

  private handleEvent(event: StreamEvent, callbacks: StreamCallbacks) {
    switch (event.type) {
      case 'thinking':
        callbacks.onThinking?.(event.data);
        break;
      case 'tool_start':
        callbacks.onToolStart?.(event.data.tool, event.data.args);
        break;
      case 'tool_end':
        callbacks.onToolEnd?.(event.data.tool, event.data.result);
        break;
      case 'content':
        callbacks.onContent?.(event.data);
        break;
      case 'error':
        callbacks.onError?.(event.data);
        break;
      case 'done':
        callbacks.onDone?.();
        break;
      case 'log':
        // Log to browser console instead of UI
        console.log(`[Server ${event.data.level}]`, event.data.message);
        break;
      case 'debug':
        // Log to browser console instead of UI
        console.log('[Server Debug]', event.data);
        break;
    }
  }

  close() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

// Singleton instance
export const chatStreamClient = new ChatStreamClient();