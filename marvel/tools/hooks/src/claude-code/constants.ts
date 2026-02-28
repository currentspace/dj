// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Claude Code Constants
 *
 * Central registry of all assumptions about Claude Code.
 * When Claude Code updates, check the changelog and update the tracked
 * version below, then audit all constants for compatibility.
 */

/**
 * Tracked Claude Code version
 * Update this when upgrading Claude Code compatibility
 */
export const CLAUDE_CODE_VERSION = {
  full: '2.1.38',
  major: 2,
  minor: 1,
  patch: 38,
  releaseDate: '2026-02-01',
} as const;

/**
 * Tool names as they appear in Claude Code tool calls
 * If Claude Code renames a tool, update here
 */
export const TOOL_NAMES = {
  askUserQuestion: 'AskUserQuestion',
  // Execution
  bash: 'Bash',
  edit: 'Edit',

  enterPlanMode: 'EnterPlanMode',
  exitPlanMode: 'ExitPlanMode',

  glob: 'Glob',

  // Search operations
  grep: 'Grep',
  // Notebook
  notebookEdit: 'NotebookEdit',

  // File operations
  read: 'Read',
  // Other
  skill: 'Skill',
  task: 'Task',
  // Task management
  taskCreate: 'TaskCreate',
  taskGet: 'TaskGet',
  taskList: 'TaskList',
  taskOutput: 'TaskOutput',

  taskStop: 'TaskStop',
  taskUpdate: 'TaskUpdate',
  // Web operations
  webFetch: 'WebFetch',
  webSearch: 'WebSearch',

  write: 'Write',
} as const;

/**
 * Tool parameter names
 * If Claude Code changes parameter names, update here
 */
export const TOOL_PARAMS = {
  // Bash tool
  bash: {
    command: 'command',
    description: 'description',
    runInBackground: 'run_in_background',
    timeout: 'timeout',
  },

  // Edit tool
  edit: {
    filePath: 'file_path',
    newString: 'new_string',
    oldString: 'old_string',
    replaceAll: 'replace_all',
  },

  // Glob tool
  glob: {
    path: 'path',
    pattern: 'pattern',
  },

  // Grep tool
  grep: {
    glob: 'glob',
    outputMode: 'output_mode',
    path: 'path',
    pattern: 'pattern',
  },

  // Read tool
  read: {
    filePath: 'file_path',
    limit: 'limit',
    offset: 'offset',
  },

  // Write tool
  write: {
    content: 'content',
    filePath: 'file_path',
  },
} as const;

/**
 * Hook types supported by Claude Code
 * If Claude Code adds/removes hook types, update here
 */
export const HOOK_TYPES = {
  notification: 'Notification',
  permissionRequest: 'PermissionRequest',
  postToolUse: 'PostToolUse',
  postToolUseFailure: 'PostToolUseFailure',
  preCompact: 'PreCompact',
  preToolUse: 'PreToolUse',
  sessionEnd: 'SessionEnd',
  sessionStart: 'SessionStart',
  stop: 'Stop',
  subagentStart: 'SubagentStart',
  subagentStop: 'SubagentStop',
  taskCompleted: 'TaskCompleted',
  teammateIdle: 'TeammateIdle',
  userPromptSubmit: 'UserPromptSubmit',
} as const;

/**
 * Hook input/output format expectations
 */
export const HOOK_FORMAT = {
  // Expected fields in hook input
  inputFields: {
    sessionId: 'sessionId',
    tool: 'tool',
    toolInput: 'toolInput',
  },
  // Hook receives JSON on stdin
  inputFormat: 'json',
  // Expected fields in hook output
  outputFields: {
    decision: 'decision', // 'allow' | 'block' | 'modify'
    modifiedInput: 'modifiedInput',
    reason: 'reason',
  },
  // Hook returns JSON on stdout
  outputFormat: 'json',
} as const;

/**
 * Agent types available via Task tool
 * If Claude Code renames/removes agents, update here
 */
export const AGENT_TYPES = {
  explore: 'Explore',
  generalPurpose: 'general-purpose',
  plan: 'Plan',
  // Note: These are built-in agent names
} as const;

/**
 * Permission format in settings.json
 */
export const PERMISSION_FORMAT = {
  // Example: 'Bash(pnpm:*)', 'Read(/tmp/**)'
  examples: ['Bash(pnpm:*)', 'Bash(git:*)', 'Read(/tmp/**)', 'WebFetch(domain:github.com)'],
  // Permission patterns use this format
  pattern: 'Tool(pattern:*)',
} as const;

/**
 * Settings.json structure expectations
 */
export const SETTINGS_STRUCTURE = {
  hooks: 'hooks',
  // Top-level keys
  permissions: 'permissions',

  // Permission sub-keys
  permissionsAllow: 'allow',
  permissionsDeny: 'deny',
} as const;

/**
 * Token budget expectations
 */
export const TOKEN_BUDGET = {
  // Approximate context window
  contextWindow: 200000,
  // Recommended MARVEL overhead
  marvelOverhead: 5000,
  // Approximate Claude Code system prompt size
  systemPromptTokens: 15000,
} as const;

/**
 * Get all hook types as an array
 */
export function getAllHookTypes(): string[] {
  return Object.values(HOOK_TYPES);
}

/**
 * Get all tool names as an array
 */
export function getAllToolNames(): string[] {
  return Object.values(TOOL_NAMES);
}

/**
 * Check if a string is a known hook type
 */
export function isKnownHookType(type: string): boolean {
  return getAllHookTypes().includes(type);
}

/**
 * Check if a string is a known tool name
 */
export function isKnownTool(name: string): boolean {
  return getAllToolNames().includes(name);
}