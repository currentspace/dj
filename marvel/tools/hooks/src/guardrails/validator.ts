// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Guardrail Validator
 *
 * Validates actions against guardrails before execution.
 */

import { Guardrails, GuardrailViolation, ModuleBoundary, ToolCallParams } from './types.js';

/**
 * Default forbidden path patterns for DIRECT EDITING via Edit/Write tools.
 *
 * IMPORTANT: This controls tool-based file modifications, NOT git commits.
 *
 * Lock files (pnpm-lock.yaml) are forbidden from direct editing
 * because they are machine-generated. However, they MUST be committed
 * when modified by package manager commands (pnpm install, etc.).
 *
 * The guardrail prevents: Edit(file_path="pnpm-lock.yaml", ...)
 * The guardrail does NOT prevent: git add pnpm-lock.yaml
 */
const DEFAULT_FORBIDDEN_PATHS = [
  /node_modules/,
  /dist\//,
  /\.next\//,
  /coverage\//,
  /__pycache__/,
  // Lock files: forbidden to EDIT directly, committed after pnpm install
  /pnpm-lock\.yaml$/,
];

/**
 * Default sensitive path patterns
 */
const DEFAULT_SENSITIVE_PATHS = [
  /migrations\//,            // Database migrations
  /src\/app\/api\//,         // API routes
  /\.env/,                   // Environment files
];

/**
 * Default module boundaries
 */
const DEFAULT_BOUNDARIES: ModuleBoundary[] = [
  { cannotImportFrom: ['src/components/', 'src/app/'], from: 'src/lib/' },
  { cannotImportFrom: ['src/app/'], from: 'src/components/' },
];

/**
 * Check if path is forbidden
 */
export function isForbiddenPath(path: string, guardrails: Guardrails): boolean {
  const forbiddenPatterns = [...DEFAULT_FORBIDDEN_PATHS, ...(guardrails.forbiddenPaths || [])];

  return forbiddenPatterns.some((pattern) => pattern.test(path));
}

/**
 * Check if path is sensitive (requires verification)
 */
export function isSensitivePath(path: string, guardrails: Guardrails): boolean {
  const sensitivePatterns = [...DEFAULT_SENSITIVE_PATHS, ...(guardrails.sensitivePaths || [])];

  return sensitivePatterns.some((pattern) => pattern.test(path));
}

/**
 * Check if tool is allowed by guardrails
 */
export function isToolAllowed(tool: string, guardrails: Guardrails): boolean {
  // If no allowlist specified, all tools allowed
  if (!guardrails.allowedTools || guardrails.allowedTools.length === 0) {
    return true;
  }

  // Check if tool is in allowlist
  return guardrails.allowedTools.includes(tool);
}

/**
 * Suggest alternatives for guardrail violations
 */
export function suggestAlternatives(violation: GuardrailViolation): string[] {
  const alternatives: string[] = [];

  switch (violation.type) {
    case 'forbidden_path':
      if (violation.context?.path?.endsWith('pnpm-lock.yaml')) {
        alternatives.push('Use: pnpm install <package>, then commit the resulting lock file');
      }
      break;

    case 'module_boundary':
      alternatives.push('Move shared code to src/lib/');
      alternatives.push('Import from src/lib/ instead');
      alternatives.push('Refactor to respect boundaries');
      break;

    case 'sensitive_path':
      alternatives.push('Ensure verification plan covers this change');
      alternatives.push('Request additional review');
      break;

    case 'tool_not_allowed':
      alternatives.push('Check pack guardrails for allowed tools');
      alternatives.push('Use an alternative tool');
      alternatives.push('Request pack update to allow tool');
      break;
  }

  return alternatives;
}

/**
 * Validate tool call against guardrails
 *
 * @throws {GuardrailViolation} if validation fails
 */
export function validateToolCall(
  tool: string,
  params: ToolCallParams,
  guardrails: Guardrails,
): void {
  // 1. Check if tool is allowed
  if (!isToolAllowed(tool, guardrails)) {
    throw new GuardrailViolation(
      `Tool ${tool} not allowed by guardrails`,
      'tool_not_allowed',
      'error',
      {
        allowedTools: guardrails.allowedTools,
        reference: 'packs/tech-tools/guardrails.md#allowed-tools',
        tool,
      },
    );
  }

  // 2. Check if path is forbidden (for file operations)
  if ((tool === 'Edit' || tool === 'Write') && params.file_path) {
    const path = params.file_path;

    if (isForbiddenPath(path, guardrails)) {
      throw new GuardrailViolation(
        `Cannot modify ${path} - forbidden path`,
        'forbidden_path',
        'error',
        {
          forbiddenPatterns: [...DEFAULT_FORBIDDEN_PATHS, ...(guardrails.forbiddenPaths || [])],
          path,
          reference: 'packs/repo-architecture/guardrails.md#forbidden-edits',
          tool,
        },
      );
    }
  }

  // 3. Check Bash output redirection
  if (tool === 'Bash' && params.command) {
    const forbiddenTarget = checkBashOutputRedirection(params.command, guardrails);
    if (forbiddenTarget) {
      throw new GuardrailViolation(
        `Cannot redirect output to ${forbiddenTarget} - forbidden path`,
        'forbidden_path',
        'error',
        {
          command: params.command,
          path: forbiddenTarget,
          reference: 'packs/repo-architecture/guardrails.md#forbidden-edits',
          tool,
        },
      );
    }
  }

  // 4. Check Glob/Grep search paths
  if ((tool === 'Glob' || tool === 'Grep') && params.path) {
    if (checkSearchPath(params.path, guardrails)) {
      throw new GuardrailViolation(
        `Cannot search in ${params.path} - forbidden path`,
        'forbidden_path',
        'warning', // Warning, not error - searches are read-only
        {
          path: params.path,
          reference: 'packs/repo-architecture/guardrails.md#forbidden-paths',
          tool,
        },
      );
    }
  }

  // 5. Check module boundaries (for imports)
  if (tool === 'Edit') {
    const importInfo = parseImport(params);
    if (importInfo) {
      const { fromPath, importPath } = importInfo;
      if (violatesBoundaries(fromPath, importPath, guardrails)) {
        throw new GuardrailViolation(
          `Import from ${fromPath} to ${importPath} crosses module boundary`,
          'module_boundary',
          'error',
          {
            boundaries: [...DEFAULT_BOUNDARIES, ...(guardrails.boundaries || [])],
            from: fromPath,
            reference: 'packs/repo-architecture/guardrails.md#module-boundaries',
            to: importPath,
            tool,
          },
        );
      }
    }
  }
}

/**
 * Check if import violates module boundaries
 */
export function violatesBoundaries(
  fromPath: string,
  importPath: string,
  guardrails: Guardrails,
): boolean {
  const boundaries = [...DEFAULT_BOUNDARIES, ...(guardrails.boundaries || [])];

  for (const boundary of boundaries) {
    if (fromPath.includes(boundary.from)) {
      for (const forbidden of boundary.cannotImportFrom) {
        if (importPath.includes(forbidden)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if Bash command writes to forbidden path
 */
function checkBashOutputRedirection(command: string, guardrails: Guardrails): null | string {
  // Match output redirection patterns: >, >>, tee, etc.
  const redirectPatterns = [
    />\s*([^\s&|;]+)/g,  // > file
    />>\s*([^\s&|;]+)/g, // >> file
    /\btee\s+(?:-a\s+)?([^\s&|;]+)/g, // tee file or tee -a file
  ];

  for (const pattern of redirectPatterns) {
    let match: null | RegExpExecArray;
    while ((match = pattern.exec(command)) !== null) {
      // Get the last capture group (the file path)
      const targetPath = match[1];
      if (targetPath && isForbiddenPath(targetPath, guardrails)) {
        return targetPath;
      }
    }
  }

  return null;
}

/**
 * Check if search path is forbidden
 */
function checkSearchPath(path: string, guardrails: Guardrails): boolean {
  // Normalize path and check against forbidden patterns
  const normalizedPath = path.replace(/^\.\//, '');
  return isForbiddenPath(normalizedPath, guardrails);
}

/**
 * Parse import statement from edit parameters
 */
function parseImport(params: ToolCallParams): null | {
  fromPath: string;
  importPath: string;
} {
  const { new_string } = params;

  if (!new_string) {
    return null;
  }

  // Simple regex to detect import statements
  const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/;
  const match = importRegex.exec(new_string);

  if (!match) {
    return null;
  }

  return {
    fromPath: params.file_path || '',
    importPath: match[1],
  };
}