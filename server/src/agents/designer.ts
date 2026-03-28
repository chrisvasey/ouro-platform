/**
 * designer.ts — Designer agent
 *
 * Reads user stories and research, produces design.md with user flows,
 * component tree, layout specs, and component specs.
 */

import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { getArtifactByPhase } from "../db.js";
import { buildContextBlock, extractSummary, type AgentResult } from "./base.js";

export async function runDesigner(projectId: string, taskDescription: string): Promise<AgentResult> {
  const systemPrompt = loadPrompt("designer");

  // Inject previous phase artifacts so the Designer has full context
  const researchArtifact = getArtifactByPhase(projectId, "research");
  const specArtifact = getArtifactByPhase(projectId, "spec");

  const additionalContext = [
    researchArtifact ? `\n\n## Research (from Researcher):\n${researchArtifact.content}` : "",
    specArtifact ? `\n\n## User Stories (from PM):\n${specArtifact.content}` : "",
  ].join("");

  const userPrompt = buildContextBlock(
    projectId,
    `${taskDescription}${additionalContext}\n\nProduce design.md with user flows, component tree, layout specs, component specs, and edge cases.`
  );

  const result = await runClaude({ systemPrompt, userPrompt, timeoutMs: 90_000 });
  const content = result.content;
  const summary = extractSummary(content);

  return { content, summary };
}
