// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * MARVEL Hooks Logging
 *
 * Structured JSONL logging for hooks and daemon diagnostics.
 */

import * as fs from "fs";
import * as path from "path";

import { findMarvelRoot, findRunDir, getTempDir } from "./paths.js";
import { redactSensitive } from "./redact.js";

export interface LogContext {
  command?: string;
  daemonId?: string;
  durationMs?: number;
  filePath?: string;
  hookType?: string;
  operation?: "append" | "mkdir" | "parse" | "read" | "write";
  pattern?: string;
  requestId?: string;
  runId?: string;
  sessionId?: string;
  toolName?: string;
}

interface LogEntry {
  context?: LogContext;
  error?: LogError;
  level: LogLevel;
  message: string;
  timestamp: string;
}

interface LogError {
  message: string;
  name?: string;
  stack?: string;
}

type LogLevel = "debug" | "error" | "info" | "warn";

const MAX_VALUE_LENGTH = 300;
const DEBUG_ENABLED =
  process.env.MARVEL_DEBUG === "1" || process.env.MARVEL_DEBUG === "true";

let cachedLogPath: null | string | undefined;

export function buildHookContext(
  hookType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: any,
  extra?: Partial<LogContext>
): LogContext {
  const rawToolInput = input?.tool_input;
  const toolInput =
    rawToolInput && typeof rawToolInput === "object"
      ? (rawToolInput as Record<string, unknown>)
      : undefined;

  const filePath =
    extractToolString(toolInput, "file_path") ||
    extractToolString(toolInput, "path") ||
    extractToolString(toolInput, "file");

  const command = extractToolString(toolInput, "command");
  const pattern = extractToolString(toolInput, "pattern");

  const sessionId =
    (typeof input?.session_id === "string" ? input.session_id : undefined) ||
    process.env.MARVEL_SESSION_ID;
  const toolName =
    typeof input?.tool_name === "string" ? input.tool_name : undefined;

  const context: LogContext = {
    command: command ? summarizeValue(redactSensitive(command)) : undefined,
    filePath: filePath ? summarizeValue(filePath) : undefined,
    hookType,
    pattern: pattern ? summarizeValue(pattern) : undefined,
    requestId: process.env.MARVEL_REQUEST_ID,
    runId: process.env.MARVEL_RUN_ID,
    sessionId,
    toolName,
    ...extra,
  };

  return context;
}

export function generateRequestId(): string {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `req_${timePart}_${randomPart}`;
}

export function logDebug(message: string, context?: LogContext): void {
  if (!DEBUG_ENABLED) {
    return;
  }
  writeLog({
    context,
    level: "debug",
    message,
    timestamp: new Date().toISOString(),
  });
}

export function logError(
  message: string,
  error?: unknown,
  context?: LogContext
): void {
  const errorInfo: LogError | undefined =
    error === undefined
      ? undefined
      : error instanceof Error
      ? { message: error.message, name: error.name, stack: error.stack }
      : { message: String(error) };

  writeLog({
    context,
    error: errorInfo,
    level: "error",
    message,
    timestamp: new Date().toISOString(),
  });
}

export function logInfo(message: string, context?: LogContext): void {
  if (!DEBUG_ENABLED) {
    return;
  }
  writeLog({
    context,
    level: "info",
    message,
    timestamp: new Date().toISOString(),
  });
}

export function logWarn(message: string, context?: LogContext): void {
  writeLog({
    context,
    level: "warn",
    message,
    timestamp: new Date().toISOString(),
  });
}

function extractToolString(
  toolInput: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!toolInput) {
    return undefined;
  }
  const value = toolInput[key];
  return typeof value === "string" ? value : undefined;
}

function resolveLogPath(): null | string {
  if (cachedLogPath !== undefined) {
    return cachedLogPath;
  }

  const envPath = process.env.MARVEL_LOG_PATH;
  if (envPath) {
    cachedLogPath = envPath;
    return envPath;
  }

  const sessionId = process.env.MARVEL_SESSION_ID;
  if (sessionId) {
    cachedLogPath = path.join(getTempDir(), `hooks-${sessionId}.log`);
    return cachedLogPath;
  }

  const runDir = findRunDir();
  if (runDir) {
    cachedLogPath = path.join(runDir, "hooks.log");
    return cachedLogPath;
  }

  const marvelRoot = findMarvelRoot();
  if (marvelRoot) {
    cachedLogPath = path.join(marvelRoot, "hooks.log");
    return cachedLogPath;
  }

  cachedLogPath = null;
  return null;
}

function summarizeValue(value: string): string {
  if (value.length <= MAX_VALUE_LENGTH) {
    return value;
  }
  return value.slice(0, MAX_VALUE_LENGTH - 3) + "...";
}

function writeLog(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  const logPath = resolveLogPath();

  if (logPath) {
    try {
      fs.mkdirSync(path.dirname(logPath), { mode: 0o700, recursive: true });
      fs.appendFileSync(logPath, line + "\n");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[marvel-logger] Failed to write log file: ${message}\n`
      );
    }
  }

  process.stderr.write(line + "\n");
}