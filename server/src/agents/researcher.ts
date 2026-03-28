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
import { buildContextBlock, extractSummary, type AgentResult } from "./base.js";

/** Per-step timeout: 150 seconds — web search is slower than build tasks. */
const STEP_TIMEOUT_MS = 150_000;

/**
 * Run a single Claude micro-call with one automatic retry on timeout.
 * If both attempts time out, returns an empty string so the pipeline can
 * continue with whatever partial data it has.
 */
async function runStep(opts: Parameters<typeof runClaude>[0], label: string): Promise<string> {
  const attempt = async (): Promise<string> => {
    const result = await runClaude({ ...opts, timeoutMs: STEP_TIMEOUT_MS });
    return result.content;
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
        return "";
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
  onFeed?: (message: string) => void
): Promise<AgentResult> {
  const systemPrompt = loadPrompt("researcher");

  const project = getProject(projectId);
  const projectName = project?.name ?? projectId;
  const projectDesc = project?.description ?? taskDescription;
  // Researcher only needs the project brief — not CLAUDE.md or feed history (keeps prompt small)
  const contextBlock = `Project: ${projectName}\nDescription: ${projectDesc}\nTask: ${taskDescription}`;

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

  const searchPlan = await runStep({ systemPrompt, userPrompt: step1Prompt }, "Step 1");
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

    const findings = await runStep(
      { systemPrompt, userPrompt: step2Prompt },
      `Step 2 call ${i + 1}`
    );
    searchResults.push(`## ${label}\n${findings}`);

    const lineCount = findings.split("\n").filter((l) => l.trim().startsWith("-")).length;
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
    searchPlan,
    "",
    "## Search Results:",
    allFindings,
  ].join("\n");

  const researchMd = await runStep({ systemPrompt, userPrompt: step3Prompt }, "Step 3");
  console.log("[researcher] Step 3 complete — research.md ready");

  const content =
    researchMd ||
    "# Research Report\n\n(Researcher agent timed out on all steps — see server logs for details.)";

  const summary = extractSummary(content);

  return { content, summary };
}
