// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Tool Preferences
 *
 * Rules for preferred tools/commands.
 * When a non-preferred tool is detected, a warning is injected.
 */

export interface ToolPreference {
  message: string;
  pattern: RegExp;
  suggestion: string;
}

export const TOOL_PREFERENCES: ToolPreference[] = [
  {
    message: "Use 'pnpm dlx' instead of 'npx' (project uses pnpm)",
    pattern: /^npx\s+/,
    suggestion: "pnpm dlx",
  },
  {
    message: "Use 'pnpm' instead of 'npm' for package operations",
    pattern: /^npm\s+(install|i|add|remove|uninstall)\b/,
    suggestion: "pnpm",
  },
  {
    message: "Use 'pnpm run' instead of 'npm run'",
    pattern: /^npm\s+run\b/,
    suggestion: "pnpm run",
  },
  {
    message: "Use 'pnpm' instead of 'yarn' for package operations",
    pattern: /^yarn\s+(add|install|remove)\b/,
    suggestion: "pnpm",
  },
  {
    message: "Use 'uv run python' instead of 'python' directly",
    pattern: /^python\s/,
    suggestion: "uv run python",
  },
  {
    message: "Use 'uv run python' instead of 'python3' directly",
    pattern: /^python3\s/,
    suggestion: "uv run python",
  },
  {
    message: "Use 'uv pip' instead of 'pip' directly",
    pattern: /^pip\s/,
    suggestion: "uv pip",
  },
  {
    message: "Use 'uv pip' instead of 'pip3' directly",
    pattern: /^pip3\s/,
    suggestion: "uv pip",
  },
];

/**
 * Check if a command uses a non-preferred tool.
 * Returns the matching preference if found, null otherwise.
 */
export function checkToolPreference(command: string): null | ToolPreference {
  const trimmed = command.trim();
  for (const pref of TOOL_PREFERENCES) {
    if (pref.pattern.test(trimmed)) {
      return pref;
    }
  }
  return null;
}