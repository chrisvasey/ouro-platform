/**
 * developer.ts — Developer agent
 *
 * Reads the design.md artifact and produces a real implementation plan or code
 * via a direct Claude CLI subprocess call. Falls back to mock output when
 * CLAUDE_CODE_OAUTH_TOKEN is not set (dev / CI environments without a token).
 *
 * Subprocess pattern mirrors ~/agent-runner/src/worker.ts:
 *   - Bun.spawn(['claude', '--print', '--dangerously-skip-permissions'])
 *   - Auth token injected via CLAUDE_CODE_OAUTH_TOKEN env var
 *   - Full prompt written to stdin; response read from stdout
 */

import { loadPrompt } from "../prompts.js";
import { getArtifactByPhase } from "../db.js";
import { buildContextBlock, extractSummary, type AgentResult } from "./base.js";

const MOCK_PLAN = `# Implementation Plan

## File Structure
\`\`\`
server/
  src/
    index.ts        ← Elysia app, routes, WS
    db.ts           ← SQLite schema + typed queries
    loop.ts         ← Phase orchestrator
    claude.ts       ← Claude CLI subprocess runner
    prompts.ts      ← Load prompt files
    agents/
      developer.ts  ← Direct Claude CLI subprocess (this file)
client/
  src/
    App.tsx
    components/
      TopBar.tsx
      AgentPanel.tsx
      FeedPanel.tsx
      InboxPanel.tsx
\`\`\`

## Key Functions

- \`runDeveloper()\` — spawns Claude CLI with design.md as task input
- \`runCycle()\` — serial 6-phase orchestrator

## Note

Mock output — set \`CLAUDE_CODE_OAUTH_TOKEN\` to receive a real implementation plan from Claude.`;

export async function runDeveloper(projectId: string, taskDescription: string): Promise<AgentResult> {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY;

  if (!token) {
    console.warn("[developer] No CLAUDE_CODE_OAUTH_TOKEN found — using mock output");
    return { content: MOCK_PLAN, summary: "Mock implementation plan (no auth token available)" };
  }

  const systemPrompt = loadPrompt("developer");

  const designArtifact = getArtifactByPhase(projectId, "design");
  const specArtifact = getArtifactByPhase(projectId, "spec");

  const additionalContext = [
    specArtifact ? `\n\n## User Stories:\n${specArtifact.content}` : "",
    designArtifact ? `\n\n## Design Spec:\n${designArtifact.content}` : "",
  ].join("");

  const task = `${taskDescription}${additionalContext}\n\nProduce build.md: file structure, data shapes, key functions, component breakdown, API contract, and commit plan.`;

  const fullPrompt = `${systemPrompt}\n\n${buildContextBlock(projectId, task)}`;

  try {
    const proc = Bun.spawn(
      ["claude", "--print", "--dangerously-skip-permissions"],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          CLAUDE_CODE_OAUTH_TOKEN: token,
        },
      }
    );

    proc.stdin.write(fullPrompt);
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.warn(`[developer] Claude CLI exited with code ${exitCode}: ${stderr.slice(0, 200)}`);
      return { content: MOCK_PLAN, summary: "Mock implementation plan (CLI error)" };
    }

    const content = stdout.trim();
    if (!content) {
      console.warn("[developer] Empty response from Claude CLI — using mock output");
      return { content: MOCK_PLAN, summary: "Mock implementation plan (empty response)" };
    }

    console.log("[developer] Real Claude CLI response received");
    return { content, summary: extractSummary(content) };
  } catch (err) {
    console.warn("[developer] Failed to spawn Claude CLI:", (err as Error).message);
    return { content: MOCK_PLAN, summary: "Mock implementation plan (spawn error)" };
  }
}
