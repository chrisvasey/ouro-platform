/**
 * researcher.ts — Researcher agent
 *
 * Searches the web (via Claude's knowledge) for competitors, OSS options,
 * UI patterns, and dev patterns. Produces research.md.
 *
 * TODO: Add real web search via a tool-enabled Claude call when extended
 *       tool use is available in the Claude CLI.
 */

import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { buildContextBlock, extractSummary, type AgentResult } from "./base.js";

export async function runResearcher(projectId: string, taskDescription: string): Promise<AgentResult> {
  const systemPrompt = loadPrompt("researcher");
  const userPrompt = buildContextBlock(
    projectId,
    `${taskDescription}\n\nProduce a structured research.md covering competitors, OSS libraries, UI patterns, dev patterns, risks, and recommendations.`
  );

  const result = await runClaude({ systemPrompt, userPrompt });
  const content = result.content;
  const summary = extractSummary(content);

  return { content, summary };
}
