/**
 * documenter.ts — Documenter agent
 *
 * Reads all phase artifacts and produces/updates CLAUDE.md with decisions,
 * patterns, and client preferences. Also updates README.md.
 */

import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { listArtifacts, saveArtifact } from "../db.js";
import { buildContextBlock, extractSummary, emitAgentStarted, emitAgentCompleted, emitAgentFailed, type AgentResult } from "./base.js";

export async function runDocumenter(projectId: string, taskDescription: string, cycleId?: string): Promise<AgentResult> {
  const meta = { projectId, cycleId, agentRole: "documenter" };
  emitAgentStarted(meta, taskDescription);

  try {
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
    await saveArtifact(projectId, "review", "CLAUDE.md", content, cycleId);

    emitAgentCompleted(meta, { inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });
    return { content, summary };
  } catch (err) {
    emitAgentFailed(meta, err as Error);
    throw err;
  }
}
