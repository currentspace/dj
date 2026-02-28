// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * SDK Type Re-exports
 *
 * Type-only re-exports from @anthropic-ai/claude-agent-sdk.
 * Zero runtime cost — ensures our hooks match what Claude Code sends/expects.
 */

export type {
  // Base input (common fields: session_id, transcript_path, cwd, permission_mode?)
  BaseHookInput,

  // Hook event discriminator
  HookEvent,

  // Discriminated union of all hook inputs
  HookInput,

  NotificationHookInput,
  PermissionRequestHookInput,
  PermissionRequestHookSpecificOutput,
  PostToolUseFailureHookInput,
  PostToolUseFailureHookSpecificOutput,
  PostToolUseHookInput,
  PostToolUseHookSpecificOutput,
  PreCompactHookInput,
  // Individual hook input types
  PreToolUseHookInput,
  // Hook-specific output types (nested in hookSpecificOutput)
  PreToolUseHookSpecificOutput,
  SessionEndHookInput,
  SessionStartHookInput,
  SessionStartHookSpecificOutput,
  StopHookInput,

  SubagentStartHookInput,

  SubagentStopHookInput,
  // Sync hook output (the shape we return from handlers)
  SyncHookJSONOutput,
  TaskCompletedHookInput,
  TeammateIdleHookInput,
  UserPromptSubmitHookInput,
  UserPromptSubmitHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";