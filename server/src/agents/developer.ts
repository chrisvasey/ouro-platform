/**
 * developer.ts — Developer agent
 *
 * For MVP: reads design.md and produces a detailed implementation plan (build.md).
 * Does NOT run actual code — produces a markdown plan that a future cycle can
 * use as input to real Claude Code execution.
 *
 * Uses a 4-step sequential micro-call pipeline so each Claude call stays under
 * the per-step timeout budget rather than sending one huge prompt and waiting
 * 5+ minutes for a response.
 *
 * Pipeline:
 *   1. Task decomposition  (~500 token input → numbered task list)
 *   2. Architecture decisions  (task list → data shapes, API contract, file tree)
 *   3. Implementation plan per task chunk  (groups of 3 tasks → impl notes)
 *   4. Assemble final build.md  (all outputs → complete artifact)
 *
 * TODO: Real Claude Code integration
 * Replace step 4 (or add a step 5) with a Bun.spawn() that runs Claude Code
 * CLI in a project-specific working directory, captures file diffs, and commits
 * them to the project git repo. Return the commit SHA as part of the result.
 */

import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { getArtifactByPhase } from "../db.js";
import { buildContextBlock, extractSummary, type AgentResult } from "./base.js";

/** Per-step timeout: 90 seconds. Each micro-call has its own independent budget. */
const STEP_TIMEOUT_MS = 90_000;

/**
 * Run a single Claude micro-call with one automatic retry on timeout.
 * If both attempts time out, returns an empty string and logs a warning so
 * the pipeline can continue with whatever partial data it has.
 */
async function runStep(opts: Parameters<typeof runClaude>[0]): Promise<string> {
  const attempt = async (): Promise<string> => {
    const result = await runClaude({ ...opts, timeoutMs: STEP_TIMEOUT_MS });
    return result.content;
  };

  try {
    return await attempt();
  } catch (err) {
    if ((err as { timeout?: boolean }).timeout) {
      console.warn("[developer] Step timed out — retrying once...");
      try {
        return await attempt();
      } catch {
        console.warn("[developer] Step timed out again — continuing with empty output");
        return "";
      }
    }
    throw err;
  }
}

/** Extract numbered task lines (e.g. "1. [file] — [task]") from free-form text */
function parseTaskLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\./.test(l));
}

/** Split an array into chunks of the given size */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Run the Developer agent.
 *
 * @param projectId       - ID of the project being built
 * @param taskDescription - High-level task from the loop orchestrator
 * @param onFeed          - Optional callback to post incremental progress messages
 *                          to the feed as each step completes. The loop passes a
 *                          function that writes to the DB and broadcasts over WS.
 */
export async function runDeveloper(
  projectId: string,
  taskDescription: string,
  onFeed?: (message: string) => void
): Promise<AgentResult> {
  const systemPrompt = loadPrompt("developer");

  const designArtifact = getArtifactByPhase(projectId, "design");
  const specArtifact = getArtifactByPhase(projectId, "spec");

  // Trim artifacts to keep per-step token counts manageable
  const specContent = (specArtifact?.content ?? "").slice(0, 2000);
  const designContent = (designArtifact?.content ?? "").slice(0, 2000);

  // Build the standard context block (project name, phase, CLAUDE.md, recent feed)
  // We use it as the system context but pass targeted user prompts per step.
  const contextBlock = buildContextBlock(projectId, taskDescription);

  // ─── Step 1: Task decomposition ─────────────────────────────────────────────
  console.log("[developer] Step 1: Task decomposition...");

  const step1Prompt = [
    contextBlock,
    "",
    "You are a senior developer. Read these user stories and design spec.",
    "Output ONLY a numbered task list — one line per task, in implementation order.",
    "No prose, no explanations. Format: `1. [component/file] — [what to build]`",
    "",
    specContent ? `## User Stories:\n${specContent}` : "(No spec available)",
    "",
    designContent ? `## Design Spec:\n${designContent}` : "(No design available)",
  ].join("\n");

  const taskList = await runStep({ systemPrompt, userPrompt: step1Prompt });
  const taskLines = parseTaskLines(taskList);
  const taskCount = taskLines.length > 0 ? taskLines.length : "several";
  onFeed?.(`[Developer → All] Task breakdown ready — ${taskCount} tasks identified`);
  console.log(`[developer] Step 1 complete — ${taskCount} tasks`);

  // ─── Step 2: Architecture decisions ─────────────────────────────────────────
  console.log("[developer] Step 2: Architecture decisions...");

  const step2Prompt = [
    contextBlock,
    "",
    "You are a senior developer. Given these tasks, define:",
    "(1) data shapes as TypeScript interfaces,",
    "(2) API contract as route list with method/path/body/response,",
    "(3) file structure as a tree.",
    "Be concise — bullet points only.",
    "",
    "## Tasks:",
    taskList || "(No tasks — use reasonable defaults based on project context)",
  ].join("\n");

  const architectureDoc = await runStep({ systemPrompt, userPrompt: step2Prompt });
  console.log("[developer] Step 2 complete");

  // ─── Step 3: Implementation plan per task chunk ──────────────────────────────
  console.log("[developer] Step 3: Implementation plan per task chunk...");

  // Fall back to a single synthetic chunk if step 1 returned no parseable lines
  const chunks =
    taskLines.length > 0 ? chunkArray(taskLines, 3) : [["(implement core application features)"]];

  const implementationNotes: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const startIdx = i * 3 + 1;
    const endIdx = startIdx + chunk.length - 1;

    const step3Prompt = [
      contextBlock,
      "",
      `You are a senior developer. For each of these ${chunk.length} task(s), write:`,
      "filename, function signature, 3-5 bullet points of what it does. No code. Be specific.",
      "",
      "## Tasks:",
      chunk.join("\n"),
      "",
      "## Architecture:",
      architectureDoc,
    ].join("\n");

    const notes = await runStep({ systemPrompt, userPrompt: step3Prompt });
    implementationNotes.push(notes);
    onFeed?.(`[Developer → All] Tasks ${startIdx}–${endIdx} planned`);
    console.log(`[developer] Step 3 chunk ${i + 1}/${chunks.length} complete`);
  }

  // ─── Step 4: Assemble build.md ───────────────────────────────────────────────
  console.log("[developer] Step 4: Assembling build.md...");

  const allNotes = implementationNotes.join("\n\n---\n\n");

  const step4Prompt = [
    contextBlock,
    "",
    "You are a senior developer. Assemble a complete build.md from these inputs.",
    "Include: ## Overview, ## Architecture (data shapes + API + file structure),",
    "## Implementation Plan (per component), ## Commit Plan (conventional commits in order).",
    "Be specific but concise.",
    "",
    "## Task List:",
    taskList,
    "",
    "## Architecture:",
    architectureDoc,
    "",
    "## Implementation Notes:",
    allNotes,
  ].join("\n");

  const buildMd = await runStep({ systemPrompt, userPrompt: step4Prompt });
  onFeed?.("[Developer → All] build.md assembled — implementation plan complete");
  console.log("[developer] Step 4 complete — build.md ready");

  const content =
    buildMd ||
    "# Build Plan\n\n(Developer agent timed out on all steps — see server logs for details.)";

  const summary = extractSummary(content);

  // Stub: log where real CC integration would go
  console.log("[developer] TODO: Real Claude Code subprocess would run here");
  console.log("[developer] Would commit implementation to project git repo and return SHA");

  return { content, summary };
}
