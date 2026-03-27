/**
 * tester.ts — Tester agent
 *
 * For MVP: reads user stories and the build plan, produces a test report
 * (test-report.md) with PASS/FAIL ratings per acceptance criterion.
 * Does NOT run real Playwright — produces a notional test report.
 *
 * TODO: Real Playwright integration
 * Replace the runClaude() call with actual Playwright browser automation:
 *   const { chromium } = await import('playwright')
 *   const browser = await chromium.launch()
 *   const page = await browser.newPage()
 *   await page.goto('http://localhost:3000')
 *   // ... run E2E tests, capture screenshots of failures
 *   await browser.close()
 *
 * TODO: Real GitHub Issues integration
 * For each FAIL, raise a real GH issue:
 *   exec(`gh issue create --title "${title}" --body "${body}"`)
 */

import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { getArtifactByPhase, postFeedMessage } from "../db.js";
import { buildContextBlock, extractSummary, type AgentResult } from "./base.js";

export async function runTester(projectId: string, taskDescription: string): Promise<AgentResult> {
  const systemPrompt = loadPrompt("tester");

  const specArtifact = getArtifactByPhase(projectId, "spec");
  const buildArtifact = getArtifactByPhase(projectId, "build");

  const additionalContext = [
    specArtifact ? `\n\n## User Stories:\n${specArtifact.content}` : "",
    buildArtifact ? `\n\n## Implementation Plan:\n${buildArtifact.content}` : "",
  ].join("");

  const userPrompt = buildContextBlock(
    projectId,
    `${taskDescription}${additionalContext}\n\nProduce test-report.md with test results per story and any raised issues.\n\n[MVP NOTE: Produce a notional test report — real Playwright integration is TODO.]`
  );

  const result = await runClaude({ systemPrompt, userPrompt });
  const content = result.content;
  const summary = extractSummary(content);

  // Stub: log where real GH Issues integration would go
  console.log("[tester] TODO: Real Playwright tests would run here");
  console.log("[tester] TODO: Real GitHub Issues would be raised for failures");

  // Post a stub feed note about GH issues
  postFeedMessage(
    projectId,
    "tester",
    "all",
    "[stub] Would raise GH issues for any FAIL items in test report. Real GitHub integration is TODO.",
    "note"
  );

  return { content, summary };
}
