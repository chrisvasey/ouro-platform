/**
 * designer.ts — Designer agent
 *
 * Reads user stories and research, produces design.md via a 3-step pipeline:
 *   1. User flow mapping (what the user does, step by step)
 *   2. Component breakdown (tree, states, interactions)
 *   3. Assembly (full design.md with layout specs + edge cases)
 *
 * Each step has a 120s timeout. onFeed posts progress to the live feed.
 */

import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { getArtifactByPhase } from "../db.js";
import { buildContextBlock, extractSummary, type AgentResult } from "./base.js";

const STEP_TIMEOUT_MS = 120_000;

export async function runDesigner(
  projectId: string,
  taskDescription: string,
  onFeed?: (msg: string) => void
): Promise<AgentResult> {
  const systemPrompt = loadPrompt("designer");

  const researchArtifact = getArtifactByPhase(projectId, "research");
  const specArtifact     = getArtifactByPhase(projectId, "spec");

  const researchText = researchArtifact
    ? `## Research:\n${researchArtifact.content.slice(0, 3000)}`
    : "";
  const specText = specArtifact
    ? `## User Stories:\n${specArtifact.content.slice(0, 3000)}`
    : "";

  const briefContext = `Project: ${taskDescription}\n\n${specText}\n\n${researchText}`;

  // ── Step 1: User flow mapping ────────────────────────────────────────────
  onFeed?.("[Designer → All] Mapping user flows...");
  let flows = "";
  try {
    const r = await runClaude({
      systemPrompt,
      userPrompt: `${briefContext}\n\nOutput ONLY user flows as numbered step-by-step sequences. One flow per user story. No prose, no components yet. Format:\n\nFlow: [Story title]\n1. User does X\n2. System responds Y\n...`,
      timeoutMs: STEP_TIMEOUT_MS,
    });
    flows = r.content;
    onFeed?.(`[Designer → All] User flows mapped — ${flows.split("\n").filter(l => l.match(/^\d+\./) ).length} steps across all flows`);
  } catch (e: any) {
    onFeed?.("[Designer → All] Flow mapping timed out — using story titles as flows");
    flows = specText || "No user stories available.";
  }

  // ── Step 2: Component breakdown ──────────────────────────────────────────
  onFeed?.("[Designer → All] Breaking down components...");
  let components = "";
  try {
    const r = await runClaude({
      systemPrompt,
      userPrompt: `Given these user flows:\n${flows.slice(0, 2000)}\n\nOutput ONLY a component tree and per-component spec. Format:\n\n## Component Tree\n- RootComponent\n  - ChildComponent (props: x, y)\n\n## Component Specs\n### ComponentName\n- Purpose: ...\n- States: default | loading | error\n- Interactions: click → ...\n\nNo prose. Be specific and terse.`,
      timeoutMs: STEP_TIMEOUT_MS,
    });
    components = r.content;
    onFeed?.("[Designer → All] Component breakdown done");
  } catch (e: any) {
    onFeed?.("[Designer → All] Component step timed out — using minimal spec");
    components = "## Component Tree\n- App\n  - MainView\n\n(Timed out — minimal spec)";
  }

  // ── Step 3: Assemble design.md ───────────────────────────────────────────
  onFeed?.("[Designer → All] Assembling design.md...");
  let designMd = "";
  try {
    const r = await runClaude({
      systemPrompt,
      userPrompt: `Assemble a complete design.md from these inputs.\n\nUser Flows:\n${flows.slice(0, 1500)}\n\nComponents:\n${components.slice(0, 1500)}\n\nProject context:\n${briefContext.slice(0, 1000)}\n\nOutput design.md with:\n## User Flows\n## Component Tree\n## Layout & Responsive Behaviour\n## Component Specs\n## Edge Cases & Empty States\n## Design Decisions\n\nBe specific enough that a developer can implement without asking questions.`,
      timeoutMs: STEP_TIMEOUT_MS,
    });
    designMd = r.content;
  } catch (e: any) {
    // Assemble from parts if final call times out
    designMd = `# Design Spec\n\n## User Flows\n${flows}\n\n## Components\n${components}\n\n*(Final assembly timed out — see above sections)*`;
  }

  onFeed?.("[Designer → Dev] design.md ready — handing off to Developer");

  const summary = extractSummary(designMd);
  return { content: designMd, summary };
}
