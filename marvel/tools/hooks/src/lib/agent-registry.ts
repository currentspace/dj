// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Agent Registry
 *
 * In-daemon tracking of subagent lifecycle across compaction boundaries.
 * Session-scoped Maps keyed by session_id → agent_id → AgentEntry.
 *
 * The daemon is per-project and persists across compaction, so this
 * in-memory state survives context compaction. The PreCompact hook
 * serializes it to a temp file as a fallback for daemon restarts.
 */

import { type LogContext, logDebug } from "./logger.js";

// ── Types ────────────────────────────────────────────────────────────

export interface AgentEntry {
  agentType: string;
  completedTime?: string;
  errorMessage: null | string;
  id: string;
  launchTime: string;
  resultSummary: null | string;
  sessionId: string;
  status: "completed" | "errored" | "running";
  transcriptPath?: string;
}

export interface SerializedAgentState {
  agents: AgentEntry[];
  sessionId: string;
  teamState: null | TeamState;
  timestamp: string;
  version: 1;
}

export interface TeamMember {
  firstSeen: string;
  teammateName: string;
  teamName: string;
}

export interface TeamState {
  members: TeamMember[];
  name: string;
}

// ── Registry State ───────────────────────────────────────────────────

/** Session → (AgentId → AgentEntry) */
const agentsBySession = new Map<string, Map<string, AgentEntry>>();

/** Session → (TeammateName → TeamMember) */
const teamBySession = new Map<string, Map<string, TeamMember>>();

// ── TTL Cleanup ──────────────────────────────────────────────────────

const TTL_MS = 60 * 60 * 1000; // 1 hour
let cleanupTimer: null | ReturnType<typeof setInterval> = null;

/**
 * Reset all state. Used in tests.
 */
export function _resetForTesting(): void {
  agentsBySession.clear();
  teamBySession.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// ── Agent Operations ─────────────────────────────────────────────────

export function clearSession(sessionId: string, context?: LogContext): void {
  const agentCount = agentsBySession.get(sessionId)?.size ?? 0;
  const teamCount = teamBySession.get(sessionId)?.size ?? 0;
  agentsBySession.delete(sessionId);
  teamBySession.delete(sessionId);
  if (agentCount > 0 || teamCount > 0) {
    logDebug(`Session cleared: ${agentCount} agents, ${teamCount} teammates`, context);
  }
}

export function completeAgent(
  sessionId: string,
  agentId: string,
  transcriptPath?: string,
  context?: LogContext,
): void {
  const sessionAgents = agentsBySession.get(sessionId);
  if (!sessionAgents) return;

  const entry = sessionAgents.get(agentId);
  if (!entry) return;

  entry.status = "completed";
  entry.completedTime = new Date().toISOString();
  if (transcriptPath) {
    entry.transcriptPath = transcriptPath;
  }

  logDebug(`Agent completed: ${agentId}`, context);
}

export function errorAgent(
  sessionId: string,
  agentId: string,
  errorMessage: string,
  context?: LogContext,
): void {
  const sessionAgents = agentsBySession.get(sessionId);
  if (!sessionAgents) return;

  const entry = sessionAgents.get(agentId);
  if (!entry) return;

  entry.status = "errored";
  entry.completedTime = new Date().toISOString();
  entry.errorMessage = errorMessage;

  logDebug(`Agent errored: ${agentId}: ${errorMessage}`, context);
}

// ── Query Operations ─────────────────────────────────────────────────

export function getSessionAgents(sessionId: string): AgentEntry[] {
  const sessionAgents = agentsBySession.get(sessionId);
  if (!sessionAgents) return [];
  return Array.from(sessionAgents.values());
}

export function getTeamState(sessionId: string): null | TeamState {
  const sessionTeam = teamBySession.get(sessionId);
  if (!sessionTeam || sessionTeam.size === 0) return null;

  const members = Array.from(sessionTeam.values());
  // Use the most common team name
  const teamName = members[0].teamName;

  return { members, name: teamName };
}

// ── Team Operations ──────────────────────────────────────────────────

export function hasSessionAgents(sessionId: string): boolean {
  const sessionAgents = agentsBySession.get(sessionId);
  return sessionAgents !== undefined && sessionAgents.size > 0;
}

export function registerAgent(
  sessionId: string,
  agentId: string,
  agentType: string,
  context?: LogContext,
): void {
  startCleanupTimer();

  let sessionAgents = agentsBySession.get(sessionId);
  if (!sessionAgents) {
    sessionAgents = new Map();
    agentsBySession.set(sessionId, sessionAgents);
  }

  const entry: AgentEntry = {
    agentType,
    errorMessage: null,
    id: agentId,
    launchTime: new Date().toISOString(),
    resultSummary: null,
    sessionId,
    status: "running",
  };

  sessionAgents.set(agentId, entry);
  logDebug(`Agent registered: ${agentId} (${agentType})`, context);
}

// ── Serialization ────────────────────────────────────────────────────

export function serializeForSession(sessionId: string): SerializedAgentState {
  return {
    agents: getSessionAgents(sessionId),
    sessionId,
    teamState: getTeamState(sessionId),
    timestamp: new Date().toISOString(),
    version: 1,
  };
}

// ── Cleanup ──────────────────────────────────────────────────────────

export function trackTeammate(
  sessionId: string,
  teammateName: string,
  teamName: string,
  context?: LogContext,
): void {
  let sessionTeam = teamBySession.get(sessionId);
  if (!sessionTeam) {
    sessionTeam = new Map();
    teamBySession.set(sessionId, sessionTeam);
  }

  if (!sessionTeam.has(teammateName)) {
    sessionTeam.set(teammateName, {
      firstSeen: new Date().toISOString(),
      teammateName,
      teamName,
    });
    logDebug(`Teammate tracked: ${teammateName} (team: ${teamName})`, context);
  }
}

function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - TTL_MS;
    for (const [sessionId, agents] of agentsBySession) {
      for (const [agentId, entry] of agents) {
        const entryTime = new Date(entry.completedTime ?? entry.launchTime).getTime();
        if (entryTime < cutoff) {
          agents.delete(agentId);
        }
      }
      if (agents.size === 0) {
        agentsBySession.delete(sessionId);
        teamBySession.delete(sessionId);
      }
    }
  }, 5 * 60 * 1000); // Sweep every 5 minutes
  // Unref so this timer doesn't prevent process exit
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}
