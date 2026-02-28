// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * MARVEL Hooks Type Definitions
 */

export interface ActivityEvent {
  data: Record<string, unknown>;
  timestamp: string;
  type: ActivityEventType;
}

export type ActivityEventType =
  | "capture"
  | "compaction"
  | "injection"
  | "notification"
  | "subagent_start"
  | "subagent_stop"
  | "task_completed"
  | "teammate_idle"
  | "tool_call"
  | "tool_failure";

// Enhanced lesson with source tracking
export interface EnhancedLesson {
  actionable: string;
  category: string;
  confidence: number;
  description: string;
  examples?: {
    after?: string;
    before?: string;
    file?: string;
  };
  id: string;
  recurrence: number;
  runId?: string;
  source: {
    reference?: string;
    type: "ci_failure" | "guardrail_violation" | "production_error" | "review_comment" | "user_guidance" | "verification_failure";
    userWords?: string;
  };
  timestamp: string;
  title: string;
}

// External rule format for allowlist/denylist
export interface ExternalRule {
  id: string;
  pattern: string;
  reason: string;
  type: "contains" | "prefix" | "regex";
}

// Guidance captured from user prompts
export interface Guidance {
  category?: string;
  confidence: number;
  content: string;
  id: string;
  preceding_file?: string;
  preceding_injections?: string[];
  // Before/after context: what was happening when the correction was made
  preceding_tool?: string;
  run_id: string;
  timestamp: string;
  type: GuidanceType;
}

export type GuidanceType =
  | "approval"
  | "clarification"
  | "correction"
  | "direction"
  | "rejection"
  | "task_end"
  | "task_start"
  | "unknown";

// Injection record for outcome tracking
export interface InjectionRecord {
  file: string;
  lessons_injected: string[];
  packs_injected: string[];
  timestamp: string;
}

// Lesson from lessons.jsonl
export interface Lesson {
  actionable: string;
  category: string;
  context?: string;
  correction_count?: number;
  description: string;
  injection_count?: number;
  last_injected?: string;
  run_id?: string;
  timestamp: string;
  title: string;
  // Utility tracking (populated by /marvel-health)
  utility_score?: number;
}

export interface LessonCandidate {
  confidence: number;
  guidance: Guidance;
  suggestedLesson: Lesson;
  suggestedPack: string;
}

// Per-lesson outcome stats from a session
export interface LessonOutcome {
  followed_by_correction: number;
  injected: number;
  lesson_title: string;
  pack: string;
}

// Loaded pack with metadata and lessons
export interface LoadedPack {
  guardrailsPath: string;
  lessons: Lesson[];
  loadedAt: number;
  metadata: PackMetadata;
}

// Pack metadata from pack.json
export interface PackMetadata {
  applies_to: {
    extensions: string[];
  };
  categories: string[];
  depends_on?: string[];
  description: string;
  excludes_paths?: string[];
  name: string;
  owner: string;
  references?: {
    code_paths?: string[];
    doc_links?: string[];
  };
  sensitive_paths?: string[];
  version: string;
}


// Pack relevance scoring result (detailed version for injection tracking)
export interface PackRelevance {
  packName: string;
  reasons: string[];
  score: number;
}

// Potential lesson extracted from guidance for reflection
export interface PotentialLesson {
  category: string;
  confidence: number;
  corrections: Guidance[];
  suggestedTitle: string;
}

export interface PromotionCandidate {
  firstSeen: string;
  frequency: number;
  lastSeen: string;
  rule: ExternalRule;
  source: "learned" | "suggestion";
}


export interface PromotionReport {
  domain: { candidates: LessonCandidate[]; totalGuidance: number };
  security: { candidates: PromotionCandidate[]; duplicates: number; unsafe: number };
}

// Relevance scoring result
export interface RelevanceScore {
  pack: string;
  score: number;
  signals: string[];
}

// Rule file structure
export interface RuleFile {
  rules: ExternalRule[];
}

// Run state for tracking session activity
export interface RunState {
  activePacks: string[];
  correctionCount: number;
  currentTask?: {
    description: string;
    filesInvolved: string[];
    startedAt: string;
  };
  endedAt?: string;
  endReason?: string;
  lastInjection?: {
    file: string;
    lessons: string[];
    packs: string[];
    relevanceScores: RelevanceScore[];
  };
  lastReflectionAt?: string;
  packInjectionCounts?: Record<string, number>;
  packVersions?: Record<string, string>;
  pendingLessons?: number;
  recentActivity: ActivityEvent[];
  runId: string;
  spec?: string;
  startedAt: string;
  toolCallCount: number;
}

// Promotion pipeline types

// LLM response with rule suggestions
export interface SecurityEvaluationResponse {
  decision: "allow" | "ask" | "deny";
  reason: string;
  source: "allowlist" | "denylist" | "error" | "learned" | "llm";
  suggestions?: {
    allow?: { pattern: string; reason: string }[];
    deny?: { pattern: string; reason: string }[];
  };
}

// Session statistics for reflection
export interface SessionStats {
  correctionCount: number;
  durationMinutes: number;
  filesInvolved: string[];
  tasksCompleted: number;
  toolCallCount: number;
}

// Tool call record for trace
export interface ToolCallRecord {
  duration_ms?: number;
  input_summary: string;
  output_summary?: string;
  sequence: number;
  success: boolean;
  timestamp: string;
  tool: string;
}