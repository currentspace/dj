// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Claude Code Settings Schema Types
 *
 * TypeScript types that match Claude Code's hook configuration schema.
 * These provide compile-time safety when generating or validating settings.json.
 *
 * Reference: https://code.claude.com/docs/en/hooks
 */

import type { HookEvent } from "../sdk-types.js";

// Agent hook handler - multi-turn LLM with tool access
export interface AgentHookHandler extends BaseHookHandler {
  model?: string;
  prompt: string;
  type: "agent";
}

// Full settings.json schema
export interface ClaudeSettings {
  disableAllHooks?: boolean;
  hooks?: HooksConfiguration;
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  plansDirectory?: string;
}

// Command hook handler - executes a shell command
export interface CommandHookHandler extends BaseHookHandler {
  async?: boolean;
  command: string;
  type: "command";
}

// Re-export SDK's HookEvent as HookEventType for backward compatibility
export type HookEventType = HookEvent;

export type HookHandler = AgentHookHandler | CommandHookHandler | PromptHookHandler;

// Hook handler types
export type HookHandlerType = "agent" | "command" | "prompt";

// Full hooks configuration
export interface HooksConfiguration {
  Notification?: MatcherGroup[];
  PermissionRequest?: MatcherGroup[];
  PostToolUse?: MatcherGroup[];
  PostToolUseFailure?: MatcherGroup[];
  PreCompact?: MatcherGroup[];
  PreToolUse?: MatcherGroup[];
  SessionEnd?: MatcherGroup[];
  SessionStart?: MatcherGroup[];
  Stop?: MatcherGroup[];
  SubagentStart?: MatcherGroup[];
  SubagentStop?: MatcherGroup[];
  TaskCompleted?: MatcherGroup[];
  TeammateIdle?: MatcherGroup[];
  UserPromptSubmit?: MatcherGroup[];
}

/**
 * Matcher group - defines when hooks fire
 *
 * IMPORTANT: The `matcher` field is a REGEX STRING, not an object.
 * - Use "Edit|Write|Read" to match multiple tools
 * - Use "Bash" to match a single tool
 * - Use "mcp__.*" to match all MCP tools
 * - Omit matcher or use "*" to match all occurrences
 */
export interface MatcherGroup {
  hooks: HookHandler[];
  /**
   * Regex pattern string to filter when hooks fire.
   * What it filters depends on the event type:
   * - PreToolUse/PostToolUse: tool name
   * - SessionStart: startup reason
   * - Notification: notification type
   *
   * MUST be a string, not an object like {"tools": [...]}
   */
  matcher?: string;
}

// Notification matcher values
export type NotificationMatcher =
  | "auth_success"
  | "elicitation_dialog"
  | "idle_prompt"
  | "permission_prompt";

// PreCompact matcher values
export type PreCompactMatcher = "auto" | "manual";

// Prompt hook handler - single-turn LLM evaluation
export interface PromptHookHandler extends BaseHookHandler {
  model?: string;
  prompt: string;
  type: "prompt";
}

// SessionEnd matcher values
export type SessionEndMatcher =
  | "bypass_permissions_disabled"
  | "clear"
  | "logout"
  | "other"
  | "prompt_input_exit";

// SessionStart matcher values
export type SessionStartMatcher = "clear" | "compact" | "resume" | "startup";

// Tool names that can be matched in PreToolUse/PostToolUse
export type ToolName =
  | "Bash"
  | "Edit"
  | "Glob"
  | "Grep"
  | "NotebookEdit"
  | "Read"
  | "Task"
  | "WebFetch"
  | "WebSearch"
  | "Write"
  | string; // MCP tools follow pattern mcp__<server>__<tool>

// Validation result
export interface ValidationResult {
  errors: string[];
  valid: boolean;
  warnings: string[];
}

// Base fields common to all hook handlers
interface BaseHookHandler {
  statusMessage?: string;
  timeout?: number;
}

// Helper type to ensure hook events are valid
export const VALID_HOOK_EVENTS: readonly HookEventType[] = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "PreCompact",
  "SessionEnd",
  "TeammateIdle",
  "TaskCompleted",
] as const;

// Events that don't support matchers
export const MATCHERLESS_EVENTS: readonly HookEventType[] = [
  "UserPromptSubmit",
  "Stop",
  "TeammateIdle",
  "TaskCompleted",
] as const;

// Valid handler types
export const VALID_HANDLER_TYPES: readonly HookHandlerType[] = [
  "command",
  "prompt",
  "agent",
] as const;