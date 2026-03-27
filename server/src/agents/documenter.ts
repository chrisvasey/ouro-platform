/**
 * documenter.ts — Documenter agent
 *
 * Reads all phase artifacts and produces/updates CLAUDE.md with decisions,
 * patterns, and client preferences. Also updates README.md.
 */

import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { getArtifactByPhase, listArtifacts, saveArtifact } from "../db.js";
import { buildContextBlock, extractSummary, type AgentResult } from "./base.js";

export async function runDocumenter(projectId: string, taskDescription: string): Promise<AgentResult> {
  const systemPrompt = loadPrompt("documenter");

  // Give the Documenter all artifacts from this cycle
  const artifacts = listArtifacts(projectId);
  const artifactsSummary = artifacts
    .map((a) => `### ${a.filename} (phase: ${a.phase}, v${a.version})\n${a.content.slice(0, 500)}...`)
    .join("\n\n");

  const userPrompt = buildContextBlock(
    projectId,
    `${taskDescription}\n\n## All Current Artifacts:\n${artifactsSummary}\n\nUpdate CLAUDE.md with decisions made this cycle, patterns established, and any client preferences. Keep it under 500 words.`
  );

  const result = await runClaude({ systemPrompt, userPrompt });
  const content = result.content;
  const summary = extractSummary(content);

  // Save the output as CLAUDE.md (Documenter owns this file)
  saveArtifact(projectId, "review", "CLAUDE.md", content);

  return { content, summary };
}
