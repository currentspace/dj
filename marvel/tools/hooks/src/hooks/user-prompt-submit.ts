// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * UserPromptSubmit Hook
 *
 * Captures user guidance (corrections, directions) for learning.
 */

import * as path from "path";

import type { SyncHookJSONOutput, UserPromptSubmitHookInput } from "../sdk-types.js";
import type { Guidance, RunState } from "../types.js";

import { safeAppendFile, safeReadJson, safeWriteJson } from "../lib/file-ops.js";
import { detectCategory, detectGuidanceType } from "../lib/guidance.js";
import { buildHookContext, logDebug } from "../lib/logger.js";
import { compileMarvelStatus } from "../lib/marvel-status.js";
import { findRunDir } from "../lib/paths.js";
import { redactSensitive } from "../lib/redact.js";

const STATUS_PATTERN = /^\/?\s*marvel[\s-]+(status|info|health)\s*$/i;

// Patterns for detecting corrections
const CORRECTION_PATTERNS = [
  /^no[,.]?\s/i,
  /^don'?t\s/i,
  /^instead[,.]?\s/i,
  /^actually[,.]?\s/i,
  /^not\s.*[,.]?\s(use|do)/i,
  /^wrong/i,
  /^that'?s\s+not/i,
  /should\s+(not|never)\s/i,
  /shouldn'?t\s/i,
  /that\s+won'?t\s+work/i,
  /wrong\s+approach/i,
  /too\s+shallow/i,
  /more\s+robust/i,
  /that'?s\s+not\s+what/i,
  /^use\s+/i,
  /misunderstand/i,
  /^(the|this)\s+is\s+(wrong|incorrect)/i,
];

export async function handleUserPromptSubmit(
  input: UserPromptSubmitHookInput
): Promise<SyncHookJSONOutput> {
  const context = buildHookContext("user-prompt-submit", input);
  const prompt = input.prompt;
  if (!prompt || prompt.length < 3) {
    return {};
  }

  if (STATUS_PATTERN.test(prompt.trim())) {
    return compileMarvelStatus(context);
  }

  const runDir = findRunDir();
  if (!runDir) {
    logDebug("Run directory not found, skipping hook", context);
    return {};
  }

  const guidanceType = detectGuidanceType(prompt, CORRECTION_PATTERNS);

  // Only capture corrections and directions
  if (guidanceType !== "correction" && guidanceType !== "direction") {
    return {};
  }

  // Read run state to get lastInjection for before/after context
  const runJsonPath = path.join(runDir, "run.json");
  const runState = safeReadJson<RunState>(runJsonPath, context);

  // Contextual boost: short messages right after a tool call are more likely corrections
  let confidence = guidanceType === "correction" ? 0.8 : 0.6;
  if (guidanceType === "correction" && prompt.length < 50 && runState?.lastInjection) {
    confidence = 0.9;
  }

  const guidance: Guidance = {
    category: detectCategory(prompt),
    confidence,
    content: redactSensitive(prompt),
    id: generateGuidanceId(),
    preceding_file: runState?.lastInjection?.file,
    preceding_injections: runState?.lastInjection?.packs,
    // Capture preceding context from the most recent injection
    preceding_tool: runState?.lastInjection ? "Edit" : undefined,
    run_id: path.basename(runDir),
    timestamp: new Date().toISOString(),
    type: guidanceType,
  };

  // Append to guidance.jsonl
  const guidancePath = path.join(runDir, "guidance.jsonl");
  if (!safeAppendFile(guidancePath, JSON.stringify(guidance) + "\n", context)) {
    return {};
  }

  // Update run state correction count if it's a correction
  if (guidanceType === "correction") {
    if (runState) {
      runState.correctionCount = (runState.correctionCount || 0) + 1;
      runState.recentActivity = runState.recentActivity || [];
      runState.recentActivity.push({
        data: { category: guidance.category, guidanceType },
        timestamp: guidance.timestamp,
        type: "capture",
      });
      // Keep only last 20 activities
      if (runState.recentActivity.length > 20) {
        runState.recentActivity = runState.recentActivity.slice(-20);
      }
      safeWriteJson(runJsonPath, runState, context);
    }
  }

  return {};
}

function generateGuidanceId(): string {
  return `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}