/**
 * base.ts — shared agent utilities
 *
 * Every agent uses the same context-block format so Claude has consistent
 * project context injected at the start of every prompt.
 */

import { getProject, getArtifactByFilename, getFeedMessages } from "../db.js";

export interface AgentResult {
  /** Full markdown content to save as artifact */
  content: string;
  /** Short summary (1–3 sentences) to post to the feed */
  summary: string;
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
  const feedMessages = getFeedMessages(projectId, 10).reverse();
  const feedLines = feedMessages
    .map((m) => `[${m.sender_role} → ${m.recipient}] (${m.message_type}) ${m.content.slice(0, 300)}`)
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
