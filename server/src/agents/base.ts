/**
 * base.ts — shared agent utilities
 *
 * Every agent uses the same context-block format so Claude has consistent
 * project context injected at the start of every prompt.
 */

import { getProject, getArtifactByFilename, getFeedMessages, insertEvent, saveArtifact, postFeedMessage, sendInboxMessage } from "../db.js";
import type { ClaudeRunResult } from "../claude.js";

export interface AgentResult {
  /** Full markdown content to save as artifact */
  content: string;
  /** Short summary (1–3 sentences) to post to the feed */
  summary: string;
}

export interface AgentEventMeta {
  projectId: string;
  cycleId?: string;
  agentRole: string;
}

export function emitAgentStarted(meta: AgentEventMeta, task: string): void {
  insertEvent({
    projectId: meta.projectId,
    cycleId: meta.cycleId,
    type: "agent_started",
    agentRole: meta.agentRole,
    payload: { task },
  });
}

export function emitAgentCompleted(
  meta: AgentEventMeta,
  tokens: { inputTokens: number; outputTokens: number; costUsd: number }
): void {
  insertEvent({
    projectId: meta.projectId,
    cycleId: meta.cycleId,
    type: "agent_completed",
    agentRole: meta.agentRole,
    payload: { inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens, costUsd: tokens.costUsd },
    tokenCount: tokens.inputTokens + tokens.outputTokens,
    costUsd: tokens.costUsd,
  });
}

export async function dispatchToolUses(
  projectId: string,
  toolUses: ClaudeRunResult["toolUses"],
  agentRole: string,
  cycleId?: string
): Promise<void> {
  for (const { name, input } of toolUses) {
    const inp = input as Record<string, unknown>;
    if (name === "save_artifact") {
      await saveArtifact(projectId, inp.phase as string, inp.filename as string, inp.content as string, cycleId);
    } else if (name === "post_feed_message") {
      postFeedMessage(projectId, agentRole, inp.recipient as string, inp.content as string, inp.message_type as string);
    } else if (name === "request_human_input") {
      sendInboxMessage(projectId, agentRole, inp.subject as string, inp.body as string, 1);
    } else {
      console.warn("[base] unknown tool use:", name);
    }
  }
}

export function emitAgentFailed(meta: AgentEventMeta, err: Error): void {
  insertEvent({
    projectId: meta.projectId,
    cycleId: meta.cycleId,
    type: "agent_failed",
    agentRole: meta.agentRole,
    payload: { error: err.message },
  });
}

/**
 * Build the standard context block injected into every agent prompt.
 * Keeps agents informed about the project state without duplicating logic.
 */
export function buildContextBlock(projectId: string, taskDescription: string): string {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // CLAUDE.md is the preferences/decisions artifact maintained by the Documenter
  const claudeMd = getArtifactByFilename(projectId, "CLAUDE.md");
  const claudeMdContent = claudeMd ? claudeMd.content : "(No CLAUDE.md yet — use reasonable defaults)";

  // Last 10 feed messages (oldest first for chronological reading)
  const feedMessages = getFeedMessages(projectId, 5).reverse();
  const feedLines = feedMessages
    .map((m) => `[${m.sender_role} → ${m.recipient}] (${m.message_type}) ${m.content.slice(0, 120)}`)
    .join("\n");

  return `--- PROJECT CONTEXT ---
Project: ${project.name}
Description: ${project.description ?? "(No description provided)"}
Phase: ${project.current_phase ?? "not set"}

CLAUDE.md:
${claudeMdContent}

Recent feed messages (last 10):
${feedLines || "(No feed messages yet)"}
--- END CONTEXT ---

TASK: ${taskDescription}`;
}

/**
 * Extract a short summary from a longer markdown document.
 * Tries to find the first paragraph; falls back to the first 250 chars.
 */
export function extractSummary(content: string, maxLength = 250): string {
  // Strip markdown headings, find first non-empty paragraph
  const lines = content.split("\n");
  let inContent = false;
  const paragraphLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      if (inContent && paragraphLines.length > 0) break;
      continue;
    }
    inContent = true;
    paragraphLines.push(trimmed);
    if (paragraphLines.join(" ").length >= maxLength) break;
  }

  const summary = paragraphLines.join(" ");
  if (!summary) return content.slice(0, maxLength).replace(/\n/g, " ");
  return summary.length > maxLength ? summary.slice(0, maxLength) + "…" : summary;
}
