// SSE streaming client for real-time chat responses
import type { StreamDebugData, StreamLogData, StreamToolData, StreamToolResult } from '@dj/shared-types';

export interface StreamCallbacks {
  onContent?: (content: string) => void;
  onDebug?: (data: StreamDebugData) => void;
  onDone?: () => void;
  onError?: (error: string) => void;
  onLog?: (level: 'error' | 'info' | 'warn', message: string) => void;
  onThinking?: (message: string) => void;
  onToolEnd?: (tool: string, result: unknown) => void;
  onToolStart?: (tool: string, args: Record<string, unknown>) => void;
}

export type StreamEvent =
  | { data: null; type: 'done'; }
  | { data: StreamDebugData; type: 'debug'; }
  | { data: StreamLogData; type: 'log'; }
  | { data: StreamToolData; type: 'tool_start'; }
  | { data: StreamToolResult; type: 'tool_end'; }
  | { data: string; type: 'content'; }
  | { data: string; type: 'error'; }
  | { data: string; type: 'thinking'; };

export class ChatStreamClient {
  private static readonly MAX_BUFFER_SIZE = 2 * 1024 * 1024; // 2MB safety cap
  private abortController: AbortController | null = null;

  close() {
    if (this.abortController) {
      this.abortController.abort('Client requested close');
      this.abortController = null;
    }
  }

  async streamMessage(
    message: string,
    conversationHistory: { content: string; role: 'assistant' | 'user'; }[],
    mode: 'analyze' | 'create' | 'edit',
    callbacks: StreamCallbacks,
    options?: { signal?: AbortSignal }
  ): Promise<{ close: () => void }> {
    // Get auth token
    const token = localStorage.getItem('spotify_token');
    if (!token) {
      callbacks.onError?.('Not authenticated');
      return { close: () => {} }; // Return no-op handle
    }

    // Close any existing connection
    this.close();

    // Use fetch with ReadableStream for better control
    await this.streamWithFetch(message, conversationHistory, mode, token, callbacks, options);

    // Return handle for cancellation
    return {
      close: () => this.close()
    };
  }

  private clearToken(): void {
    if (typeof window !== 'undefined' && 'localStorage' in window) {
      localStorage.removeItem('spotify_token');
    }
  }

  private handleEvent(event: StreamEvent, callbacks: StreamCallbacks) {
    try {
      switch (event.type) {
        case 'content':
          callbacks.onContent?.(event.data);
          break;
        case 'debug':
          // Log debug info in collapsed group for cleaner console
          console.groupCollapsed('[Server Debug]');
          console.warn(event.data);
          console.groupEnd();
          break;
        case 'done':
          callbacks.onDone?.();
          break;
        case 'error':
          callbacks.onError?.(event.data);
          break;
        case 'log': {
          // Log to browser console with better formatting
          const logColor = event.data.level === 'error' ? 'color: red' :
                          event.data.level === 'warn' ? 'color: orange' :
                          'color: blue';
          console.warn(`%c[Server ${event.data.level}]`, logColor, event.data.message);
          break;
        }
        case 'thinking':
          callbacks.onThinking?.(event.data);
          break;
        case 'tool_end':
          callbacks.onToolEnd?.(event.data.tool, event.data.result);
          break;
        case 'tool_start':
          callbacks.onToolStart?.(event.data.tool, event.data.args);
          break;
      }
    } catch (error) {
      console.error('[ChatStream] Error handling event:', event, error);
    }
  }

  private async streamWithFetch(
    message: string,
    conversationHistory: { content: string; role: 'assistant' | 'user'; }[],
    mode: 'analyze' | 'create' | 'edit',
    token: string,
    callbacks: StreamCallbacks,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    // Create abort controller for fetch
    this.abortController = new AbortController();
    let finished = false;

    // Link external abort signal if provided
    if (options?.signal) {
      options.signal.addEventListener('abort', () => this.abortController?.abort());
    }

    try {
      console.log('[ChatStream] Starting stream request to /api/chat-stream/message');
      console.log('[ChatStream] Request body:', { conversationHistory, message, mode });

      const response = await fetch('/api/chat-stream/message', {
        body: JSON.stringify({
          conversationHistory,
          message,
          mode,
        }),
        headers: {
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: this.abortController.signal,
      });

      console.log('[ChatStream] Response status:', response.status, response.statusText);
      console.log('[ChatStream] Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        // Special handling for 401 - clear token and notify
        if (response.status === 401) {
          console.error('[ChatStream] 401 Unauthorized - clearing token');
          this.clearToken();
          callbacks.onError?.('Authentication expired. Please log in again.');
          return;
        }

        // Try to get error details from response
        const errorText = await response.text().catch(() => '');
        console.error('[ChatStream] Error response:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.slice(0, 300)}` : ''}`);
      }

      // Validate content-type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        // Try to get error details if server sent JSON
        const errorText = await response.text().catch(() => '');
        try {
          const json = JSON.parse(errorText);
          throw new Error(json.error || json.message || JSON.stringify(json));
        } catch {
          throw new Error(`Unexpected content-type: ${contentType}${errorText ? `. Response: ${errorText.slice(0, 300)}` : ''}`);
        }
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Read the stream
      console.log('[ChatStream] Starting to read stream...');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let chunkCount = 0;

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
          // let eventType = 'message'; // Reserved for future use when we need event types
          const dataLines: string[] = [];
          // let eventId: string | undefined; // Reserved for future use when we need event IDs

          for (const line of lines) {
            // Skip comments (lines starting with ':')
            if (line.startsWith(':') || !line.trim()) continue;

            if (line.startsWith('event:')) {
              // eventType = line.slice(6).trim(); // Reserved for future use
              continue;
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            } else if (line.startsWith('id:')) {
              // eventId = line.slice(3).trim(); // Reserved for future use
              continue;
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
                console.log('[ChatStream] Parsed event:', event.type, event.data);

                // Check for done event
                if (event.type === 'done') {
                  if (!finished) {
                    callbacks.onDone?.();
                    finished = true;
                  }
                  return true; // Signal to stop processing
                }

                // Check for error event - terminate stream
                if (event.type === 'error') {
                  callbacks.onError?.(typeof event.data === 'string' ? event.data : 'Stream error');
                  finished = true;
                  this.abortController?.abort('Server error');
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
        chunkCount++;

        if (done) {
          // Process any remaining buffered data
          if (buffer.trim()) {
            processSSEEvents();
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        console.log(`[ChatStream] Chunk #${chunkCount} received (${chunk.length} bytes):`, chunk.slice(0, 100));
        buffer += chunk;

        // Safety cap on buffer size to prevent memory issues
        if (buffer.length > ChatStreamClient.MAX_BUFFER_SIZE) {
          console.warn('[ChatStream] Buffer size exceeded limit, truncating...');
          // Keep the last portion of the buffer
          buffer = buffer.slice(-ChatStreamClient.MAX_BUFFER_SIZE);
        }

        // Process complete events in the buffer
        if (processSSEEvents()) {
          // Done or error event received, stop processing
          break;
        }
      }

      // Call onDone if not already called
      if (!finished) {
        console.log('[ChatStream] Stream complete, calling onDone');
        callbacks.onDone?.();
      } else {
        console.log('[ChatStream] Stream already finished, skipping onDone');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Stream was intentionally aborted
        console.log('[ChatStream] Stream aborted');
        if (!finished) {
          callbacks.onError?.('Stream cancelled');
        }
        return;
      }
      console.error('[ChatStream] Stream error:', error);
      if (!finished) {
        callbacks.onError?.(error instanceof Error ? error.message : 'Stream failed');
      }
    } finally {
      this.abortController = null;
    }
  }
}

// Singleton instance
export const chatStreamClient = new ChatStreamClient();