/**
 * developer.ts — Developer agent
 *
 * For MVP: reads design.md and produces a detailed implementation plan (build.md).
 * Does NOT run actual code — produces a markdown plan that a future cycle can
 * use as input to real Claude Code execution.
 *
 * TODO: Real Claude Code integration
 * Replace the runClaude() call with a Bun.spawn() that runs Claude Code CLI
 * in a project-specific working directory, captures file diffs, and commits
 * them to the project git repo. Return the commit SHA as part of the result.
 *
 * Example (stubbed):
 *   const proc = Bun.spawn(['claude', '--print', '--dangerously-skip-permissions'], {
 *     cwd: projectWorkdir,
 *     env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token },
 *     stdin: 'pipe',
 *     stdout: 'pipe',
 *     stderr: 'pipe',
 *   });
 */

import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { getArtifactByPhase } from "../db.js";
import { buildContextBlock, extractSummary, type AgentResult } from "./base.js";

export async function runDeveloper(projectId: string, taskDescription: string): Promise<AgentResult> {
  const systemPrompt = loadPrompt("developer");

  const designArtifact = getArtifactByPhase(projectId, "design");
  const specArtifact = getArtifactByPhase(projectId, "spec");

  const additionalContext = [
    specArtifact ? `\n\n## User Stories:\n${specArtifact.content}` : "",
    designArtifact ? `\n\n## Design Spec:\n${designArtifact.content}` : "",
  ].join("");

  const userPrompt = buildContextBlock(
    projectId,
    `${taskDescription}${additionalContext}\n\nProduce build.md: file structure, data shapes, key functions, component breakdown, API contract, and commit plan.\n\n[MVP NOTE: Produce a plan document, not actual code. Real CC integration is TODO.]`
  );

  const result = await runClaude({ systemPrompt, userPrompt });
  const content = result.content;
  const summary = extractSummary(content);

  // Stub: log where real CC integration would go
  console.log("[developer] TODO: Real Claude Code subprocess would run here");
  console.log("[developer] Would commit implementation to project git repo and return SHA");

  return { content, summary };
}
