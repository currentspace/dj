/**
 * ServiceLogger - Centralized logging for services with SSE streaming
 *
 * Replaces console.log throughout services to:
 * - Send formatted logs to client via SSE
 * - Log to server console for debugging
 * - Provide consistent formatting
 */

import type { StreamLogData } from '@dj/shared-types';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export class ServiceLogger {
  private sseWriter?: SSEWriter;
  private serviceName: string;

  constructor(serviceName: string, sseWriter?: SSEWriter) {
    this.serviceName = serviceName;
    this.sseWriter = sseWriter;
  }

  /**
   * Log an info message
   */
  info(message: string, data?: Record<string, any>): void {
    this.log('info', message, data);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: Record<string, any>): void {
    this.log('warn', message, data);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error | any, data?: Record<string, any>): void {
    const errorData = error instanceof Error
      ? { error: error.message, stack: error.stack, ...data }
      : { error: String(error), ...data };
    this.log('error', message, errorData);
  }

  /**
   * Log a debug message (only in development)
   */
  debug(message: string, data?: Record<string, any>): void {
    this.log('debug', message, data);
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, data?: Record<string, any>): void {
    // Format message with service name
    const formattedMessage = `[${this.serviceName}] ${message}`;

    // Always log to console
    const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (data && Object.keys(data).length > 0) {
      consoleMethod(formattedMessage, data);
    } else {
      consoleMethod(formattedMessage);
    }

    // Send to client via SSE if available
    if (this.sseWriter) {
      const logData: StreamLogData = {
        level,
        message: formattedMessage,
        ...(data && { data })
      };

      // Fire and forget - don't await to avoid blocking
      this.sseWriter.write({
        type: 'log',
        data: logData
      }).catch(err => {
        console.error('[ServiceLogger] Failed to send log via SSE:', err);
      });
    }
  }

  /**
   * Create a child logger with a sub-context
   */
  child(subContext: string): ServiceLogger {
    return new ServiceLogger(`${this.serviceName}:${subContext}`, this.sseWriter);
  }
}

// Simple interface for SSEWriter (to avoid circular dependency)
interface SSEWriter {
  write(event: { type: string; data: any }): Promise<void>;
}
