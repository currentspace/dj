// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Session State Module
 *
 * Tracks pre-commit requirements and command history for a session.
 * Persists to /tmp for resilience across daemon restarts.
 *
 * Pre-commit requirements:
 * - lint: pnpm lint / eslint passed
 * - test: pnpm test / vitest / jest passed
 * - build: pnpm build:all passed (bare `pnpm build` does NOT count)
 * - typecheck: pnpm typecheck / tsc passed
 */

import * as fs from "fs";

import type { LogContext } from "./logger.js";

import { logDebug, logWarn } from "./logger.js";
import { getTempDir } from "./paths.js";

// Pre-commit status tracking
export interface PreCommitStatus {
  buildPassed: boolean;
  buildTimestamp?: string;
  lintPassed: boolean;
  lintTimestamp?: string;
  testPassed: boolean;
  testTimestamp?: string;
  typecheckPassed: boolean;
  typecheckTimestamp?: string;
}

// Session state persisted to disk
export interface SessionState {
  lastUpdated: string;
  preCommit: PreCommitStatus;
  sessionId: string;
  startedAt: string;
}

// Patterns for detecting pre-commit commands
// Matches both single-package (pnpm lint) and workspace-wide (pnpm lint:all) variants
export const PRECOMMIT_PATTERNS = {
  build: /^pnpm\s+(build:(all|web|backend|shared))\b/,
  lint: /^pnpm\s+(lint(:all)?|eslint|run\s+lint(:all)?)\b/,
  test: /^pnpm\s+(test|vitest|jest|run\s+test)\b/,
  typecheck: /^pnpm\s+(typecheck(:all)?|tsc|run\s+typecheck(:all)?)\b/,
} as const;

/**
 * Check if merge requirements are met.
 * Merge requires everything pre-commit requires PLUS passing tests.
 * Called before gh pr merge, gh api .../merge, or /done merge phase.
 */
export interface MergeCheckResult {
  message: string;
  missing: PreCommitCheckType[];
  ready: boolean;
}

/**
 * Check if pre-commit requirements are met.
 * Returns status and a message if requirements are not met.
 */
export interface PreCommitCheckResult {
  message: string;
  missing: PreCommitCheckType[];
  ready: boolean;
}

export type PreCommitCheckType = keyof typeof PRECOMMIT_PATTERNS;

export function checkMergeRequirements(context?: LogContext): MergeCheckResult {
  const state = loadSessionState(context);
  const missing: PreCommitCheckType[] = [];

  if (!state.preCommit.lintPassed) {
    missing.push("lint");
  }
  if (!state.preCommit.typecheckPassed) {
    missing.push("typecheck");
  }
  if (!state.preCommit.testPassed) {
    missing.push("test");
  }

  // Build is optional but recommended

  if (missing.length === 0) {
    return {
      message: "All merge requirements met (lint, typecheck, tests passed)",
      missing: [],
      ready: true,
    };
  }

  return {
    message: `Merge requirements not met. Please run: ${missing.map((m) => `pnpm ${m === "test" ? "test:run" : `${m}:all`}`).join(", ")} before merging.`,
    missing,
    ready: false,
  };
}

export function checkPreCommitRequirements(context?: LogContext): PreCommitCheckResult {
  const state = loadSessionState(context);
  const missing: PreCommitCheckType[] = [];

  // Check which requirements are missing
  if (!state.preCommit.lintPassed) {
    missing.push("lint");
  }
  if (!state.preCommit.typecheckPassed) {
    missing.push("typecheck");
  }

  // Build is optional but recommended
  // Tests are required before merge (see checkMergeRequirements)

  if (missing.length === 0) {
    return {
      message: "All pre-commit requirements met",
      missing: [],
      ready: true,
    };
  }

  return {
    message: `Pre-commit requirements not met. Please run: ${missing.map((m) => `pnpm ${m}:all`).join(", ")} before committing.`,
    missing,
    ready: false,
  };
}

/**
 * Detect which pre-commit check a command represents.
 */
export function detectPreCommitCheck(command: string): null | PreCommitCheckType {
  const trimmed = command.trim();

  for (const [checkType, pattern] of Object.entries(PRECOMMIT_PATTERNS)) {
    if (pattern.test(trimmed)) {
      return checkType as PreCommitCheckType;
    }
  }

  return null;
}

/**
 * Get current pre-commit status for debugging/display.
 */
export function getPreCommitStatus(context?: LogContext): PreCommitStatus {
  const state = loadSessionState(context);
  return state.preCommit;
}

/**
 * Invalidate specific pre-commit checks (e.g., when code files are edited).
 */
export function invalidatePreCommitChecks(
  checks: PreCommitCheckType[],
  context?: LogContext
): void {
  const state = loadSessionState(context);
  for (const check of checks) {
    switch (check) {
      case "lint":
        state.preCommit.lintPassed = false;
        state.preCommit.lintTimestamp = undefined;
        break;
      case "test":
        state.preCommit.testPassed = false;
        state.preCommit.testTimestamp = undefined;
        break;
      case "typecheck":
        state.preCommit.typecheckPassed = false;
        state.preCommit.typecheckTimestamp = undefined;
        break;
    }
  }
  saveSessionState(state, context);
  logDebug(`Invalidated pre-commit checks: ${checks.join(", ")}`, context);
}

/**
 * Load session state from disk.
 */
export function loadSessionState(context?: LogContext): SessionState {
  const sessionId = context?.sessionId || process.env.CLAUDE_SESSION_ID || "unknown";
  const stateFile = getStateFilePath(sessionId);

  try {
    if (fs.existsSync(stateFile)) {
      const content = fs.readFileSync(stateFile, "utf-8");
      const state = JSON.parse(content) as SessionState;

      // Validate session ID matches
      if (state.sessionId === sessionId) {
        logDebug(`Loaded session state: ${JSON.stringify(state.preCommit)}`, context);
        return state;
      }
      // Different session, create fresh state
      logDebug("Session ID mismatch, creating fresh state", context);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to load session state: ${message}`, context);
  }

  // Return fresh state
  return {
    lastUpdated: new Date().toISOString(),
    preCommit: {
      buildPassed: false,
      lintPassed: false,
      testPassed: false,
      typecheckPassed: false,
    },
    sessionId,
    startedAt: new Date().toISOString(),
  };
}

/**
 * Record a successful pre-commit check command.
 * Called from PostToolUse when a command succeeds.
 *
 * @param command - The command that was executed
 * @param context - Logging context
 * @returns The check type that was recorded, or null if not a pre-commit check
 */
export function recordPreCommitSuccess(
  command: string,
  context?: LogContext
): null | PreCommitCheckType {
  const checkType = detectPreCommitCheck(command);
  if (!checkType) {
    return null;
  }

  const state = loadSessionState(context);
  const timestamp = new Date().toISOString();

  // Update the appropriate flag
  switch (checkType) {
    case "build":
      state.preCommit.buildPassed = true;
      state.preCommit.buildTimestamp = timestamp;
      break;
    case "lint":
      state.preCommit.lintPassed = true;
      state.preCommit.lintTimestamp = timestamp;
      break;
    case "test":
      state.preCommit.testPassed = true;
      state.preCommit.testTimestamp = timestamp;
      break;
    case "typecheck":
      state.preCommit.typecheckPassed = true;
      state.preCommit.typecheckTimestamp = timestamp;
      break;
  }

  saveSessionState(state, context);
  logDebug(`Recorded pre-commit success: ${checkType}`, context);

  return checkType;
}

/**
 * Reset pre-commit status (e.g., after a commit).
 */
export function resetPreCommitStatus(context?: LogContext): void {
  const state = loadSessionState(context);
  state.preCommit = {
    buildPassed: false,
    lintPassed: false,
    testPassed: false,
    typecheckPassed: false,
  };
  saveSessionState(state, context);
  logDebug("Reset pre-commit status", context);
}

/**
 * Save session state to disk.
 */
export function saveSessionState(state: SessionState, context?: LogContext): boolean {
  try {
    ensureStateDir();
    const sessionId = context?.sessionId || process.env.CLAUDE_SESSION_ID;
    const stateFile = getStateFilePath(sessionId);
    state.lastUpdated = new Date().toISOString();
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
    logDebug("Saved session state", context);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to save session state: ${message}`, context);
    return false;
  }
}

/**
 * Ensure the state directory exists.
 */
function ensureStateDir(): void {
  const stateDir = getTempDir();
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { mode: 0o700, recursive: true });
  }
}

/**
 * Get the session state file path.
 * Uses /tmp with session ID for cross-daemon persistence.
 * Prefers the explicit sessionId parameter over process.env to avoid
 * corruption when multiple async handlers interleave.
 */
function getStateFilePath(sessionId?: string): string {
  const sid = sessionId || process.env.CLAUDE_SESSION_ID || "unknown";
  const tmpDir = getTempDir();
  return `${tmpDir}/session-${sid}.json`;
}