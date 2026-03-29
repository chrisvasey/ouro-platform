/**
 * researcher.ts — Researcher agent
 *
 * Uses a 3-step sequential micro-call pipeline so each Claude call stays under
 * the per-step timeout budget rather than sending one huge prompt and timing out.
 *
 * Pipeline:
 *   1. Search planning  (project brief → 5 specific search queries)
 *   2. Web research     (3 sequential calls: competitors, UI/UX, technical)
 *   3. Synthesis        (all findings → structured research.md)
 */

import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { getProject } from "../db.js";
import { buildContextBlock, extractSummary, emitAgentStarted, emitAgentCompleted, emitAgentFailed, dispatchToolUses, type AgentResult } from "./base.js";

/** Per-step timeout: 150 seconds — web search is slower than build tasks. */
const STEP_TIMEOUT_MS = 210_000;

interface StepResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolUses: Array<{ id: string; name: string; input: unknown }>;
}

/**
 * Run a single Claude micro-call with one automatic retry on timeout.
 * If both attempts time out, returns an empty string so the pipeline can
 * continue with whatever partial data it has.
 */
async function runStep(opts: Parameters<typeof runClaude>[0], label: string): Promise<StepResult> {
  const attempt = async (): Promise<StepResult> => {
    const result = await runClaude({ ...opts, timeoutMs: STEP_TIMEOUT_MS });
    return {
      content: result.content,
      inputTokens: result.inputTokens ?? 0,
      outputTokens: result.outputTokens ?? 0,
      costUsd: result.costUsd,
      toolUses: result.toolUses,
    };
  };

  try {
    return await attempt();
  } catch (err) {
    if ((err as { timeout?: boolean }).timeout) {
      console.warn(`[researcher] ${label} timed out — retrying once...`);
      try {
        return await attempt();
      } catch {
        console.warn(`[researcher] ${label} timed out again — continuing with empty output`);
        return { content: "", inputTokens: 0, outputTokens: 0, costUsd: 0, toolUses: [] };
      }
    }
    throw err;
  }
}

/**
 * Run the Researcher agent.
 *
 * @param projectId       - ID of the project being researched
 * @param taskDescription - High-level task from the loop orchestrator
 * @param onFeed          - Optional callback to post incremental progress messages
 *                          to the feed as each step completes. The loop passes a
 *                          function that writes to the DB and broadcasts over WS.
 */
export async function runResearcher(
  projectId: string,
  taskDescription: string,
  onFeed?: (message: string) => void,
  cycleId?: string
): Promise<AgentResult> {
  const meta = { projectId, cycleId, agentRole: "researcher" };
  emitAgentStarted(meta, taskDescription);

  const systemPrompt = loadPrompt("researcher");

  const project = getProject(projectId);
  const projectName = project?.name ?? projectId;
  const projectDesc = project?.description ?? taskDescription;
  // Researcher only needs the project brief — not CLAUDE.md or feed history (keeps prompt small)
  const contextBlock = `Project: ${projectName}\nDescription: ${projectDesc}\nTask: ${taskDescription}`;

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  try {
    // ─── Step 1: Search planning ──────────────────────────────────────────────────
    console.log("[researcher] Step 1: Search planning...");
    onFeed?.(`[Researcher → All] Planning searches for ${projectName}...`);

    const step1Prompt = [
      contextBlock,
      "",
      "You are a research analyst. Given this project brief, output ONLY a numbered list of 5 specific search queries to run. No prose.",
      "",
      `Project: ${projectName}`,
      `Description: ${projectDesc}`,
    ].join("\n");

    const step1 = await runStep({ systemPrompt, userPrompt: step1Prompt }, "Step 1");
    totalInput += step1.inputTokens;
    totalOutput += step1.outputTokens;
    totalCost += step1.costUsd;
    await dispatchToolUses(projectId, step1.toolUses, "researcher", cycleId);
    console.log("[researcher] Step 1 complete");

    // ─── Step 2: Web research (3 sequential calls) ────────────────────────────────
    console.log("[researcher] Step 2: Web research...");

    const themes: Array<{ label: string; query: string }> = [
      {
        label: "competitors + existing solutions",
        query: `${projectName} competitors alternatives existing solutions`,
      },
      {
        label: "UI/UX patterns + design conventions",
        query: `${projectName} UI UX patterns design conventions best practices`,
      },
      {
        label: "technical patterns + relevant libraries",
        query: `${projectName} technical implementation patterns libraries frameworks`,
      },
    ];

    const searchResults: string[] = [];

    for (let i = 0; i < themes.length; i++) {
      const { label, query } = themes[i];
      const step2Prompt = [
        contextBlock,
        "",
        `Search the web for: ${query}. Return a concise bullet list of findings with URLs where possible.`,
      ].join("\n");

      const step2 = await runStep(
        { systemPrompt, userPrompt: step2Prompt },
        `Step 2 call ${i + 1}`
      );
      totalInput += step2.inputTokens;
      totalOutput += step2.outputTokens;
      totalCost += step2.costUsd;
      await dispatchToolUses(projectId, step2.toolUses, "researcher", cycleId);
      searchResults.push(`## ${label}\n${step2.content}`);

      const lineCount = step2.content.split("\n").filter((l) => l.trim().startsWith("-")).length;
      onFeed?.(
        `[Researcher → All] Searched: ${label} — ${lineCount > 0 ? lineCount : "several"} findings`
      );
      console.log(`[researcher] Step 2 call ${i + 1}/3 complete`);
    }

    // ─── Step 3: Synthesis ────────────────────────────────────────────────────────
    console.log("[researcher] Step 3: Synthesising findings...");
    onFeed?.(`[Researcher → All] Synthesising findings...`);

    const allFindings = searchResults.join("\n\n");

    const step3Prompt = [
      contextBlock,
      "",
      "You are a research analyst. Synthesise these web search results into a structured research.md report with sections:",
      "## Summary, ## Competitors, ## UI/UX Patterns, ## Technical Patterns, ## Risks & Recommendations.",
      "Be specific and actionable.",
      "",
      "## Search Plan:",
      step1.content,
      "",
      "## Search Results:",
      allFindings,
    ].join("\n");

    const step3 = await runStep({ systemPrompt, userPrompt: step3Prompt }, "Step 3");
    totalInput += step3.inputTokens;
    totalOutput += step3.outputTokens;
    totalCost += step3.costUsd;
    await dispatchToolUses(projectId, step3.toolUses, "researcher", cycleId);
    console.log("[researcher] Step 3 complete — research.md ready");

    const content =
      step3.content ||
      "# Research Report\n\n(Researcher agent timed out on all steps — see server logs for details.)";

    const summary = extractSummary(content);

    emitAgentCompleted(meta, { inputTokens: totalInput, outputTokens: totalOutput, costUsd: totalCost });
    return { content, summary };
  } catch (err) {
    emitAgentFailed(meta, err as Error);
    throw err;
  }
}
