/**
 * Zod schemas for Server-Sent Events (SSE) streaming
 * Provides type-safe parsing for real-time chat events
 */

import { z } from 'zod'

// ===== Debug Data =====

export const StreamDebugDataSchema = z.record(z.unknown())

// ===== Log Data =====

export const StreamLogDataSchema = z.object({
  level: z.enum(['error', 'info', 'warn']),
  message: z.string(),
})

// ===== Tool Data =====

export const StreamToolDataSchema = z.object({
  args: z.record(z.unknown()),
  tool: z.string(),
})

export const StreamToolResultSchema = z.object({
  result: z.unknown(),
  tool: z.string(),
})

// ===== Event Types =====

export const StreamContentEventSchema = z.object({
  data: z.string(),
  type: z.literal('content'),
})

export const StreamThinkingEventSchema = z.object({
  data: z.string(),
  type: z.literal('thinking'),
})

export const StreamToolStartEventSchema = z.object({
  data: StreamToolDataSchema,
  type: z.literal('tool_start'),
})

export const StreamToolEndEventSchema = z.object({
  data: StreamToolResultSchema,
  type: z.literal('tool_end'),
})

export const StreamLogEventSchema = z.object({
  data: StreamLogDataSchema,
  type: z.literal('log'),
})

export const StreamDebugEventSchema = z.object({
  data: StreamDebugDataSchema,
  type: z.literal('debug'),
})

export const StreamErrorEventSchema = z.object({
  data: z.string(),
  type: z.literal('error'),
})

export const StreamDoneEventSchema = z.object({
  data: z.null(),
  type: z.literal('done'),
})

// ===== Union of All Events =====

export const StreamEventSchema = z.discriminatedUnion('type', [
  StreamContentEventSchema,
  StreamThinkingEventSchema,
  StreamToolStartEventSchema,
  StreamToolEndEventSchema,
  StreamLogEventSchema,
  StreamDebugEventSchema,
  StreamErrorEventSchema,
  StreamDoneEventSchema,
])

// ===== Type Exports =====

export type StreamDebugData = z.infer<typeof StreamDebugDataSchema>
export type StreamLogData = z.infer<typeof StreamLogDataSchema>
export type StreamToolData = z.infer<typeof StreamToolDataSchema>
export type StreamToolResult = z.infer<typeof StreamToolResultSchema>

export type StreamContentEvent = z.infer<typeof StreamContentEventSchema>
export type StreamThinkingEvent = z.infer<typeof StreamThinkingEventSchema>
export type StreamToolStartEvent = z.infer<typeof StreamToolStartEventSchema>
export type StreamToolEndEvent = z.infer<typeof StreamToolEndEventSchema>
export type StreamLogEvent = z.infer<typeof StreamLogEventSchema>
export type StreamDebugEvent = z.infer<typeof StreamDebugEventSchema>
export type StreamErrorEvent = z.infer<typeof StreamErrorEventSchema>
export type StreamDoneEvent = z.infer<typeof StreamDoneEventSchema>

export type StreamEvent = z.infer<typeof StreamEventSchema>
