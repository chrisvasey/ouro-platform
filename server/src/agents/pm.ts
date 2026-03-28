/**
 * pm.ts — Product Manager agent
 *
 * Reads the project brief and produces a spec document with user stories.
 * Also sends inbox summaries to the client after key decisions.
 */

import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { sendInboxMessage } from "../db.js";
import { buildContextBlock, extractSummary, emitAgentStarted, emitAgentCompleted, emitAgentFailed, type AgentResult } from "./base.js";

export async function runPM(projectId: string, taskDescription: string, cycleId?: string): Promise<AgentResult> {
  const meta = { projectId, cycleId, agentRole: "pm" };
  emitAgentStarted(meta, taskDescription);

  try {
    const systemPrompt = loadPrompt("pm");
    const userPrompt = buildContextBlock(projectId, taskDescription);

    const result = await runClaude({ systemPrompt, userPrompt });

    const content = result.content;
    const summary = extractSummary(content);

    // PM always sends an inbox message when it completes a phase
    sendInboxMessage(
      projectId,
      "pm",
      "Spec phase complete — user stories ready",
      `The PM has completed the spec phase.\n\n${summary}\n\n---\nFull spec saved as artifact. Reply with any changes before the Designer starts.`
    );

    emitAgentCompleted(meta, { inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });
    return { content, summary };
  } catch (err) {
    emitAgentFailed(meta, err as Error);
    throw err;
  }
}
