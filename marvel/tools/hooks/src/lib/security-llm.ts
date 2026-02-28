// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Security LLM Client
 *
 * Uses `claude -p` for one-shot security analysis of ambiguous commands.
 * Implements fail-open behavior: on error, returns "allow" to fall back to native permissions.
 */

import * as fs from "fs";
import * as path from "path";

import type { PermissionRequestHookSpecificOutput, SyncHookJSONOutput } from "../sdk-types.js";
import type { LogContext } from "./logger.js";

import { logDebug, logWarn } from "./logger.js";
import { getSecurityDir } from "./paths.js";
import { redactSensitive } from "./redact.js";

const MODEL = "haiku";

// Response type for the analyzeWithLlm function
export interface LlmAnalysisResult {
  decision: "allow" | "ask" | "deny";
  reason: string;
  suggestedRule?: { pattern: string; reason: string; type: "contains" | "prefix" | "regex"; };
  suggestions?: {
    allow?: { pattern: string; reason: string }[];
    deny?: { pattern: string; reason: string }[];
  };
}

/**
 * Create an "allow" decision response.
 * SDK allow has no message field — only updatedInput and updatedPermissions.
 */
export function allow(): SyncHookJSONOutput {
  const decision: PermissionRequestHookSpecificOutput = {
    decision: {
      behavior: "allow",
    },
    hookEventName: "PermissionRequest",
  };
  return { hookSpecificOutput: decision };
}

/**
 * Return empty output to let Claude Code ask the user.
 * In the SDK, there is no "ask" behavior — returning {} means no decision was made.
 */
export function askUser(_message?: string): SyncHookJSONOutput {
  return {};
}

/**
 * Create a "deny" decision response.
 */
export function deny(reason: string): SyncHookJSONOutput {
  const decision: PermissionRequestHookSpecificOutput = {
    decision: {
      behavior: "deny",
      message: reason,
    },
    hookEventName: "PermissionRequest",
  };
  return { hookSpecificOutput: decision };
}

/**
 * Escape special characters for safe inclusion in prompt.
 * Prevents prompt injection by neutralizing control sequences.
 */
export function escapeForPrompt(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Log a security decision for batch analysis.
 * Enables reviewing decisions over time to improve rules and prompts.
 */
export function logDecision(
  command: string,
  description: string | undefined,
  decision: "allow" | "ask" | "deny",
  reasoning: string,
  durationMs: number,
  context?: LogContext
): void {
  const decisionsPath = path.join(getSecurityDir(), "decisions.jsonl");

  // Ensure directory exists
  const dir = path.dirname(decisionsPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    }
  } catch {
    logWarn(`Failed to create decisions directory: ${dir}`, context);
    return;
  }

  const entry = {
    command: redactSensitive(command),
    decision,
    description: description ? redactSensitive(description) : null,
    durationMs,
    model: MODEL,
    reasoning,
    timestamp: new Date().toISOString(),
  };

  try {
    fs.appendFileSync(decisionsPath, JSON.stringify(entry) + "\n", { mode: 0o600 });
    logDebug(`Logged security decision: ${decision}`, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to log decision: ${message}`, context);
  }
}

/**
 * Log a rule suggestion to the suggestions file.
 * This allows humans to review and potentially add rules.
 */
export function logSuggestion(
  command: string,
  suggestions: LlmAnalysisResult["suggestions"],
  context?: LogContext
): void {
  if (!suggestions) return;

  const suggestionsPath = path.join(getSecurityDir(), "suggestions.jsonl");

  // Ensure directory exists
  const dir = path.dirname(suggestionsPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    }
  } catch {
    logWarn(`Failed to create suggestions directory: ${dir}`, context);
    return;
  }

  const entry = {
    command: redactSensitive(command),
    suggestions,
    timestamp: new Date().toISOString(),
  };

  try {
    fs.appendFileSync(suggestionsPath, JSON.stringify(entry) + "\n", { mode: 0o600 });
    logDebug("Logged rule suggestion", context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to log suggestion: ${message}`, context);
  }
}