// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * External Rules Loader
 *
 * Loads allowlist/denylist rules from marvel/security/ directory.
 * Falls back to hardcoded defaults if files are missing.
 */

import * as fs from "fs";
import * as path from "path";

import type { ExternalRule, RuleFile } from "../types.js";
import type { LogContext } from "./logger.js";

import { getAllSegments } from "./command-parser.js";
import { logDebug, logWarn } from "./logger.js";
import { findSecurityDir } from "./paths.js";

// Hardcoded fallback rules if external files are missing
const DEFAULT_ALLOW_RULES: ExternalRule[] = [
  { id: "allow-git-status", pattern: "git status", reason: "Read-only git operation", type: "prefix" },
  { id: "allow-git-diff", pattern: "git diff", reason: "Read-only git operation", type: "prefix" },
  { id: "allow-git-log", pattern: "git log", reason: "Read-only git operation", type: "prefix" },
  { id: "allow-git-branch", pattern: "git branch", reason: "Read-only git operation", type: "prefix" },
  { id: "allow-git-show", pattern: "git show", reason: "Read-only git operation", type: "prefix" },
  { id: "allow-pnpm-safe", pattern: "^pnpm\\s+(install|dev|build|lint|test|run|typecheck)\\b", reason: "Safe pnpm dev operations", type: "regex" },
  { id: "allow-npm-safe", pattern: "^npm\\s+(run|test|start)\\b", reason: "Safe npm dev operations", type: "regex" },
  { id: "allow-ls", pattern: "ls", reason: "Read-only directory listing", type: "prefix" },
  { id: "allow-pwd", pattern: "pwd", reason: "Print working directory", type: "prefix" },
  { id: "allow-echo", pattern: "echo ", reason: "Print to stdout", type: "prefix" },
  { id: "allow-which", pattern: "which ", reason: "Locate command", type: "prefix" },
  { id: "allow-cat", pattern: "cat ", reason: "Read file contents", type: "prefix" },
  { id: "allow-head", pattern: "head ", reason: "Read file head", type: "prefix" },
  { id: "allow-tail", pattern: "tail ", reason: "Read file tail", type: "prefix" },
  { id: "allow-wc", pattern: "wc ", reason: "Word count", type: "prefix" },
];

const DEFAULT_DENY_RULES: ExternalRule[] = [
  // Package manager enforcement - use pnpm/uv instead
  { id: "deny-npx", pattern: "npx ", reason: "Project uses pnpm - use 'pnpm exec' or 'pnpm dlx' instead of npx", type: "prefix" },
  { id: "deny-npm-install", pattern: "^npm\\s+(install|i|add|ci)\\b", reason: "Project uses pnpm - use 'pnpm install' or 'pnpm add' instead", type: "regex" },
  { id: "deny-yarn", pattern: "^yarn\\s+(install|add)\\b", reason: "Project uses pnpm - use 'pnpm install' or 'pnpm add' instead", type: "regex" },

  // Python environment enforcement - use uv per CLAUDE.md
  { id: "deny-python-direct", pattern: "^python3?\\s", reason: "Use 'uv run python' per CLAUDE.md", type: "regex" },
  { id: "deny-pip-direct", pattern: "^pip3?\\s", reason: "Use 'uv pip' per CLAUDE.md", type: "regex" },

  // rm - destructive file removal
  // Use (?:\s+\S+)*\s+ instead of .*\s+ to prevent ReDoS from overlapping quantifiers
  { id: "deny-rm-rf-root", pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|\\-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\\s+/(?!Users|home|tmp)", reason: "Destructive: removes root filesystem paths", type: "regex" },
  { id: "deny-rm-rf-slash", pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/\\s*$", reason: "Destructive: removes root filesystem", type: "regex" },
  { id: "deny-rm-rf-home", pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+~/?\\s*$", reason: "Destructive: removes entire home directory", type: "regex" },
  { id: "deny-rm-rf-star", pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/\\*", reason: "Destructive: removes all root level directories", type: "regex" },
  { id: "deny-rm-system-dirs", pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/(etc|var|usr|bin|sbin|lib|boot|sys|proc)\\b", reason: "Destructive: removes system directories", type: "regex" },
  { id: "deny-rm-no-preserve-root", pattern: "--no-preserve-root", reason: "Destructive: bypasses rm safety", type: "contains" },

  // chmod - dangerous permission changes
  // Use -[a-zA-Z]+ (not *) inside ()* to prevent nested zero-length match (exponential ReDoS)
  { id: "deny-chmod-777", pattern: "chmod\\s+(-[a-zA-Z]+\\s+)*777", reason: "Insecure permissions: world-writable", type: "regex" },
  { id: "deny-chmod-666", pattern: "chmod\\s+(-[a-zA-Z]+\\s+)*666", reason: "Insecure permissions: world-writable files", type: "regex" },
  { id: "deny-chmod-recursive-system", pattern: "chmod\\s+(-[a-zA-Z]*R[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/(etc|var|usr|bin|sbin|lib)", reason: "Destructive: recursive chmod on system dirs", type: "regex" },

  // chown - dangerous ownership changes
  { id: "deny-chown-recursive-system", pattern: "chown\\s+(-[a-zA-Z]*R[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/(etc|var|usr|bin|sbin|lib)", reason: "Destructive: recursive chown on system dirs", type: "regex" },
  { id: "deny-chown-root", pattern: "chown\\s+(-[a-zA-Z]*R[a-zA-Z]*|--recursive)(?:\\s+\\S+)*\\s+/\\s*$", reason: "Destructive: chown on root", type: "regex" },

  // Remote code execution
  // Use [^|]* instead of .* before pipe to prevent backtracking
  { id: "deny-curl-pipe-bash", pattern: "curl[^|]*\\|\\s*(bash|sh|zsh|python|perl|ruby)", reason: "Remote code execution via curl pipe", type: "regex" },
  { id: "deny-wget-pipe-bash", pattern: "wget[^|]*\\|\\s*(bash|sh|zsh|python|perl|ruby)", reason: "Remote code execution via wget pipe", type: "regex" },
  { id: "deny-curl-pipe-sudo", pattern: "curl[^|]*\\|\\s*sudo", reason: "Remote code execution with elevated privileges", type: "regex" },

  // Disk/filesystem operations
  { id: "deny-dd-of-dev", pattern: "dd\\s+[^ ]*of=/dev/", reason: "Destructive: writes to device", type: "regex" },
  { id: "deny-mkfs", pattern: "mkfs", reason: "Destructive: formats filesystem", type: "prefix" },
  { id: "deny-format", pattern: "format ", reason: "Destructive: formats disk", type: "prefix" },
  { id: "deny-fdisk", pattern: "fdisk", reason: "Destructive: disk partitioning", type: "prefix" },
  { id: "deny-parted", pattern: "parted", reason: "Destructive: disk partitioning", type: "prefix" },

  // System control
  { id: "deny-shutdown", pattern: "shutdown", reason: "System shutdown", type: "prefix" },
  { id: "deny-reboot", pattern: "reboot", reason: "System reboot", type: "prefix" },
  { id: "deny-init-0", pattern: "init 0", reason: "System shutdown", type: "contains" },
  { id: "deny-init-6", pattern: "init 6", reason: "System reboot", type: "contains" },
  { id: "deny-systemctl-disable", pattern: "systemctl\\s+(disable|mask)\\s+(sshd|networking|network|firewalld|iptables)", reason: "Disabling critical services", type: "regex" },

  // sudo with dangerous commands (catch-all for above with sudo prefix)
  { id: "deny-sudo-rm-rf", pattern: "sudo\\s+rm\\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)", reason: "Elevated destructive file removal", type: "regex" },
];

/**
 * Load allowlist rules.
 * Returns external rules if available, otherwise hardcoded defaults.
 */
export function loadAllowRules(context: LogContext): ExternalRule[] {
  const securityDir = findSecurityDir();
  if (securityDir) {
    const allowlistPath = path.join(securityDir, "allowlist.json");
    const externalRules = loadRulesFromFile(allowlistPath, context);
    if (externalRules !== null) {
      return externalRules;
    }
  }

  logDebug("Using default allowlist rules", context);
  return DEFAULT_ALLOW_RULES;
}

/**
 * Load denylist rules.
 * Returns external rules if available, otherwise hardcoded defaults.
 */
export function loadDenyRules(context: LogContext): ExternalRule[] {
  const securityDir = findSecurityDir();
  if (securityDir) {
    const denylistPath = path.join(securityDir, "denylist.json");
    const externalRules = loadRulesFromFile(denylistPath, context);
    if (externalRules !== null) {
      return externalRules;
    }
  }

  logDebug("Using default denylist rules", context);
  return DEFAULT_DENY_RULES;
}

/**
 * Check if a command matches any allowlist rule.
 * Returns the matching rule if found, null otherwise.
 * Falls back to normalized command matching (strips cd prefix, redirections, echo suffix),
 * then to individual segment matching for compound commands.
 */
export function matchesAllowlist(
  command: string,
  context: LogContext
): ExternalRule | null {
  const rules = loadAllowRules(context);
  const segments = getAllSegments(command);

  // Compound commands (multiple segments joined by &&, ;, ||, |) must have
  // ALL segments match the allowlist. This prevents bypass via e.g.
  // "rm -rf / && git status" where "git status" alone would match.
  if (segments.length > 1) {
    let allMatch = true;
    let lastRule: ExternalRule | null = null;
    for (const segment of segments) {
      let matched = false;
      for (const rule of rules) {
        if (matchesRule(segment.raw, rule)) {
          matched = true;
          lastRule = rule;
          break;
        }
      }
      if (!matched) {
        allMatch = false;
        break;
      }
    }
    if (allMatch && lastRule) {
      logDebug(`All segments match allowlist (last rule: ${lastRule.id})`, context);
      return lastRule;
    }
    return null;
  }

  // Single command — try full command first
  for (const rule of rules) {
    if (matchesRule(command, rule)) {
      logDebug(`Command matches allowlist rule: ${rule.id}`, context);
      return rule;
    }
  }

  // Try normalized command (strip cd prefix, redirections, echo suffix)
  const normalized = normalizeCommand(command);
  if (normalized !== command.trim()) {
    for (const rule of rules) {
      if (matchesRule(normalized, rule)) {
        logDebug(`Normalized command matches allowlist rule: ${rule.id} (original: ${command.slice(0, 60)})`, context);
        return rule;
      }
    }
  }

  return null;
}

/**
 * Check if a command matches any denylist rule.
 * Checks the full raw command, then each individual segment of compound commands.
 * If ANY segment matches, the whole command is denied.
 * Returns the matching rule if found, null otherwise.
 */
export function matchesDenylist(
  command: string,
  context: LogContext
): ExternalRule | null {
  const rules = loadDenyRules(context);

  // Check full raw command
  for (const rule of rules) {
    if (matchesRule(command, rule)) {
      logDebug(`Command matches denylist rule: ${rule.id}`, context);
      return rule;
    }
  }

  // Check each segment individually for compound commands
  const segments = getAllSegments(command);
  if (segments.length > 1) {
    for (const segment of segments) {
      for (const rule of rules) {
        if (matchesRule(segment.raw, rule)) {
          logDebug(`Segment matches denylist rule: ${rule.id} (segment: ${segment.raw.slice(0, 60)})`, context);
          return rule;
        }
      }
    }
  }

  return null;
}

/**
 * Load rules from an external JSON file.
 */
function loadRulesFromFile(filePath: string, context: LogContext): ExternalRule[] | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as RuleFile;

    if (!parsed.rules || !Array.isArray(parsed.rules)) {
      logWarn(`Invalid rule file format: ${filePath}`, context);
      return null;
    }

    // Validate rules
    const validRules = parsed.rules.filter((rule) => {
      if (!rule.id || !rule.type || !rule.pattern || !rule.reason) {
        logWarn(`Invalid rule missing required fields: ${JSON.stringify(rule)}`, context);
        return false;
      }
      if (!["contains", "prefix", "regex"].includes(rule.type)) {
        logWarn(`Invalid rule type "${rule.type}" for rule ${rule.id}`, context);
        return false;
      }
      return true;
    });

    logDebug(`Loaded ${validRules.length} rules from ${filePath}`, context);
    return validRules;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to load rules from ${filePath}: ${message}`, context);
    return null;
  }
}

/**
 * Check if a command matches a single rule.
 */
function matchesRule(command: string, rule: ExternalRule): boolean {
  const trimmed = command.trim();

  switch (rule.type) {
    case "contains":
      return trimmed.includes(rule.pattern);

    case "prefix":
      return trimmed.startsWith(rule.pattern);

    case "regex":
      try {
        const regex = new RegExp(rule.pattern);
        return regex.test(trimmed);
      } catch {
        // Invalid regex, treat as no match
        return false;
      }

    default:
      return false;
  }
}

/**
 * Normalize a compound command for allowlist matching.
 * Strips safe shell constructs to expose the primary command.
 */
function normalizeCommand(command: string): string {
  let normalized = command.trim();

  // Strip leading `cd /path &&` or `cd /path;`
  normalized = normalized.replace(/^cd\s+\S+\s*(?:&&|;)\s*/, "");

  // Strip leading VAR=value env assignments (e.g., LOG=1 FOO=bar grep ...)
  normalized = normalized.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
  // Also strip VAR=value && (with explicit &&)
  normalized = normalized.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s*&&\s*)+/, "");

  // Strip trailing shell redirections (2>/dev/null, >/dev/null 2>&1, etc.)
  // Use [ \t] instead of \s to avoid ReDoS from \s matching \r\n overlapping with .*
  normalized = normalized.replace(/[ \t]+\d*>[ \t]*\/dev\/null(?:[ \t]+2>&1)?$/, "");
  normalized = normalized.replace(/[ \t]+2>&1[ \t]*$/, "");

  // Strip trailing `; echo "..."` or `; echo $?` status checks
  normalized = normalized.replace(/[ \t]*;[ \t]*echo[ \t]+.*$/, "");

  // Strip pnpm workspace filter flags: --filter <pkg>, -F <pkg>, --filter=<pkg>
  normalized = normalized.replace(/^(pnpm)\s+(?:--filter(?:=|\s+)\S+|-F\s+\S+)\s+/, "$1 ");

  return normalized.trim();
}