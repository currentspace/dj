// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Guardrail Types
 *
 * Type definitions for MARVEL guardrails and validation.
 */

/**
 * Guardrail configuration
 */
export interface Guardrails {
  allowedTools?: string[];
  boundaries?: ModuleBoundary[];
  forbiddenPaths?: RegExp[];
  sensitivePaths?: RegExp[];
}

/**
 * Module boundary definition
 */
export interface ModuleBoundary {
  cannotImportFrom: string[];
  from: string;
}

/**
 * Tool call parameters (simplified)
 */
export interface ToolCallParams {
  [key: string]: unknown;
  command?: string; // For Bash tool
  file_path?: string;
  new_string?: string;
  old_string?: string;
  path?: string; // For Glob/Grep tools
  pattern?: string; // For Grep tool
}

/**
 * Guardrail violation severity
 */
export type ViolationSeverity = 'critical' | 'error' | 'warning';

/**
 * Guardrail violation type
 */
export type ViolationType =
  | 'forbidden_path'
  | 'module_boundary'
  | 'sensitive_path'
  | 'tool_not_allowed';

/**
 * Guardrail violation error
 */
export class GuardrailViolation extends Error {
  constructor(
    message: string,
    public readonly type: ViolationType,
    public readonly severity: ViolationSeverity = 'error',
    public readonly context?: {
      allowedTools?: string[];
      boundaries?: ModuleBoundary[];
      command?: string;
      forbiddenPatterns?: RegExp[];
      from?: string;
      path?: string;
      reference?: string;
      to?: string;
      tool?: string;
    },
  ) {
    super(message);
    this.name = 'GuardrailViolation';
  }
}