// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Evaluation Schemas
 *
 * Structured output schemas and runtime validators for agent-based security evaluation.
 * Used by the WebSocket evaluation server to validate Claude's structured output.
 */

/**
 * The structured output from an agent security evaluation session.
 */
export interface AgentSecurityDecision {
  confidence: number; // 0.0–1.0
  decision: "allow" | "ask" | "deny";
  investigated: string[]; // files/paths examined
  reasoning: string;
  suggested_rule?: {
    pattern: string;
    reason: string;
    type: "contains" | "prefix" | "regex";
  };
}

/**
 * JSON Schema for the initialize control_request jsonSchema field.
 * Enables schema-validated structured output from Claude Code.
 */
export const SECURITY_DECISION_SCHEMA: Record<string, unknown> = {
  properties: {
    confidence: { maximum: 1, minimum: 0, type: "number" },
    decision: { enum: ["allow", "deny", "ask"], type: "string" },
    investigated: { items: { type: "string" }, type: "array" },
    reasoning: { type: "string" },
    suggested_rule: {
      properties: {
        pattern: { type: "string" },
        reason: { type: "string" },
        type: { enum: ["prefix", "regex", "contains"], type: "string" },
      },
      required: ["type", "pattern", "reason"],
      type: "object",
    },
  },
  required: ["decision", "reasoning", "confidence"],
  type: "object",
};

/**
 * Meta-evaluation result for Phase 2.
 */
export interface MetaEvaluationResult {
  confidence: number;
  correct: boolean;
  original_decision: "allow" | "ask" | "deny";
  reasoning: string;
  suggested_decision: "allow" | "ask" | "deny";
}

/**
 * Runtime validator for AgentSecurityDecision.
 * Belt-and-suspenders — CLI validates via schema but we double-check.
 */
export function isValidSecurityDecision(
  value: unknown
): value is AgentSecurityDecision {
  if (value === null || typeof value !== "object") return false;

  const obj = value as Record<string, unknown>;

  // Required fields
  if (typeof obj.decision !== "string") return false;
  if (!["allow", "ask", "deny"].includes(obj.decision)) return false;

  if (typeof obj.reasoning !== "string") return false;

  if (typeof obj.confidence !== "number") return false;
  if (obj.confidence < 0 || obj.confidence > 1) return false;

  // investigated is required by schema but may be missing — default to []
  if (obj.investigated !== undefined) {
    if (!Array.isArray(obj.investigated)) return false;
    for (const item of obj.investigated) {
      if (typeof item !== "string") return false;
    }
  }

  // suggested_rule is optional
  if (obj.suggested_rule !== undefined) {
    if (obj.suggested_rule === null || typeof obj.suggested_rule !== "object")
      return false;
    const rule = obj.suggested_rule as Record<string, unknown>;
    if (typeof rule.type !== "string") return false;
    if (!["contains", "prefix", "regex"].includes(rule.type)) return false;
    if (typeof rule.pattern !== "string") return false;
    if (typeof rule.reason !== "string") return false;
  }

  return true;
}

/**
 * JSON Schema for meta-evaluation structured output (Phase 2).
 */
export const META_EVALUATION_SCHEMA: Record<string, unknown> = {
  properties: {
    confidence: { maximum: 1, minimum: 0, type: "number" },
    correct: { type: "boolean" },
    original_decision: { enum: ["allow", "deny", "ask"], type: "string" },
    reasoning: { type: "string" },
    suggested_decision: { enum: ["allow", "deny", "ask"], type: "string" },
  },
  required: [
    "original_decision",
    "correct",
    "suggested_decision",
    "reasoning",
    "confidence",
  ],
  type: "object",
};