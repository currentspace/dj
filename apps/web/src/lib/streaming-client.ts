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
  private useEventSource = false; // Set to true to use EventSource instead of fetch

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

    if (this.useEventSource) {
      // EventSource approach - can't send POST body, would need different architecture
      // This would require a stateful session on the server or passing all data in URL
      callbacks.onError?.('EventSource mode not yet implemented');
      return;
    }

    // Use fetch with ReadableStream for better control
    await this.streamWithFetch(message, conversationHistory, mode, token, callbacks);
  }

  private async streamWithFetch(
    message: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    mode: 'analyze' | 'create' | 'edit',
    token: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    // Create abort controller for fetch
    this.abortController = new AbortController();

    try {
      const response = await fetch('/api/chat-stream/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
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

      // Validate content-type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        // Try to get error details if server sent JSON
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Unexpected content-type: ${contentType}. Response: ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Read the stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Helper to process complete SSE events (events are separated by blank lines)
      const processSSEEvents = (): boolean => {
        // Normalize CRLF to LF and split by double-newline (event boundary)
        const normalizedBuffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const events = normalizedBuffer.split('\n\n');

        // Keep the last incomplete event in the buffer
        buffer = events.pop() || '';

        for (const eventBlock of events) {
          if (!eventBlock.trim()) continue;

          // Parse the event block
          const lines = eventBlock.split('\n');
          let eventType = 'message';
          const dataLines: string[] = [];
          let eventId: string | undefined;

          for (const line of lines) {
            // Skip comments (lines starting with ':')
            if (line.startsWith(':') || !line.trim()) continue;

            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            } else if (line.startsWith('id:')) {
              eventId = line.slice(3).trim();
            }
          }

          // Process the collected data lines
          if (dataLines.length > 0) {
            const dataStr = dataLines.join('\n');

            // Handle heartbeat messages
            if (dataStr.trim() === '') {
              continue; // Skip empty data (heartbeats)
            }

            try {
              const parsed = JSON.parse(dataStr);

              // Handle our event format: {type: string, data: any}
              if (typeof parsed === 'object' && parsed && 'type' in parsed) {
                const event = parsed as StreamEvent;

                // Check for done event
                if (event.type === 'done') {
                  callbacks.onDone?.();
                  return true; // Signal to stop processing
                }

                // Handle the event
                this.handleEvent(event, callbacks);
              } else {
                // Fallback for non-standard events
                console.warn('Unexpected SSE event format:', parsed);
              }
            } catch (error) {
              console.error('Failed to parse SSE data:', error, dataStr);
            }
          }
        }

        return false; // Continue processing
      };

      // Read and process the stream
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining buffered data
          if (buffer.trim()) {
            processSSEEvents();
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete events in the buffer
        if (processSSEEvents()) {
          // Done event received, stop processing
          break;
        }
      }

      callbacks.onDone?.();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Stream was intentionally aborted
        console.log('[ChatStream] Stream aborted by client');
        return;
      }
      console.error('[ChatStream] Stream error:', error);
      callbacks.onError?.(error instanceof Error ? error.message : 'Stream failed');
    } finally {
      this.abortController = null;
    }
  }

  private handleEvent(event: StreamEvent, callbacks: StreamCallbacks) {
    try {
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
          // Log to browser console with better formatting
          const logColor = event.data.level === 'error' ? 'color: red' :
                          event.data.level === 'warn' ? 'color: orange' :
                          'color: blue';
          console.log(`%c[Server ${event.data.level}]`, logColor, event.data.message);
          break;
        case 'debug':
          // Log debug info in collapsed group for cleaner console
          console.groupCollapsed('[Server Debug]');
          console.log(event.data);
          console.groupEnd();
          break;
      }
    } catch (error) {
      console.error('[ChatStream] Error handling event:', event, error);
    }
  }

  close() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.abortController) {
      this.abortController.abort('Client requested close');
      this.abortController = null;
    }
  }
}

// Singleton instance
export const chatStreamClient = new ChatStreamClient();