/**
 * claude.ts — Claude CLI subprocess runner
 *
 * Spawns the `claude` CLI with `-p --output-format stream-json`, pipes the
 * prompt via stdin, and collects the streamed JSON response.
 *
 * Auth: CLAUDE_CODE_OAUTH_TOKEN (OAuth token from Claude Code, same as
 * agent-runner). Passed as ANTHROPIC_API_KEY env var to the subprocess —
 * the Claude CLI accepts either.
 *
 * If the CLI is unavailable or the token is missing, falls back to
 * deterministic mock output so the loop keeps running in dev/test.
 */

export interface ClaudeRunOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Max output tokens. Defaults to 4096. */
  maxTokens?: number;
  /**
   * Per-call timeout in milliseconds. On expiry, rejects with an error whose
   * `.timeout` property is `true` so callers can catch and retry.
   */
  timeoutMs?: number;
}

export interface ClaudeRunResult {
  content: string;
  /** True when real Claude output was returned; false for mock fallback. */
  real: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Run a one-shot Claude query via the CLI subprocess.
 *
 * The full prompt (system + user) is written to stdin. The CLI streams
 * newline-delimited JSON; we collect `assistant` message blocks and the
 * final `result` block, then return the concatenated text.
 */
export async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const token =
    process.env.CLAUDE_CODE_OAUTH_TOKEN ??
    process.env.CLAUDE_OAUTH_TOKEN ??
    process.env.ANTHROPIC_API_KEY;

  if (!token) {
    console.warn("[claude] No auth token found — using mock output");
    return { content: mockOutput(opts.userPrompt), real: false };
  }

  const execute = async (): Promise<ClaudeRunResult> => {
    const fullPrompt = `${opts.systemPrompt}\n\n${opts.userPrompt}`;

    const proc = Bun.spawn(
      [
        "claude",
        "-p",
        "--verbose",
        "--output-format", "stream-json",
        "--permission-mode", "bypassPermissions",
        fullPrompt,  // prompt passed as final CLI argument (same as agent-runner)
      ],
      {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: token,
          CLAUDE_CODE_OAUTH_TOKEN: token,
        },
      }
    );

    // Collect stdout — use Bun.readableStreamToText for reliable buffering
    const [raw] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    // Parse newline-delimited JSON stream
    let content = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);

        // stream-json format: assistant messages
        if (msg.type === "assistant" && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === "text") content += block.text;
          }
        }

        // Final result block — may also carry text + usage
        if (msg.type === "result") {
          if (msg.result && typeof msg.result === "string") {
            // result block sometimes has the full text
            if (!content) content = msg.result;
          }
          if (msg.usage) {
            inputTokens = msg.usage.input_tokens;
            outputTokens = msg.usage.output_tokens;
          }
        }

        // Older stream format: direct text blocks
        if (msg.type === "text" && typeof msg.text === "string") {
          content += msg.text;
        }
      } catch {
        // Non-JSON lines (e.g. debug output) — ignore
      }
    }

    // Fallback: if stream-json gave us nothing, use raw stdout
    if (!content && raw.trim()) {
      content = raw.trim();
    }

    if (!content) {
      console.warn("[claude] Empty response from CLI — using mock output");
      return { content: mockOutput(opts.userPrompt), real: false };
    }

    return { content: content.trim(), real: true, inputTokens, outputTokens };
  };

  try {
    if (opts.timeoutMs) {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => {
          const err = new Error(`Claude call timed out after ${opts.timeoutMs}ms`);
          (err as Error & { timeout: boolean }).timeout = true;
          reject(err);
        }, opts.timeoutMs)
      );
      return await Promise.race([execute(), timeoutPromise]);
    }
    return await execute();
  } catch (err: unknown) {
    if ((err as { timeout?: boolean }).timeout) throw err;
    console.warn("[claude] CLI call failed:", (err as Error).message);
    return { content: mockOutput(opts.userPrompt), real: false };
  }
}

// ── Mock fallback ────────────────────────────────────────────────────────────

function mockOutput(userPrompt: string): string {
  const phase = detectPhase(userPrompt);
  const mocks: Record<string, string> = {
    research: `# Research Report\n\n## Summary\nMock research output — set CLAUDE_CODE_OAUTH_TOKEN to enable real Claude.\n\n## Competitors\n- Devin: single-agent AI engineer\n- GPT-Engineer: spec-to-code, no feedback loop\n\n## Recommendations\n- Implement streaming feed updates\n- Version artifacts per cycle`,
    spec: `# Spec\n\n### US-001: Core Loop\nAs a client, I want agents to run automatically, so I don't have to manage them.\n\n**Acceptance Criteria:**\n- [ ] Cycle runs all 6 phases\n- [ ] Feed updates in real time\n- [ ] PM sends inbox summary`,
    design: `# Design Spec\n\n## User Flows\n1. User clicks Start Cycle\n2. Agents progress through phases\n3. Feed updates live\n\n## Component Tree\n- App > TopBar > AgentPanel > FeedPanel > InboxPanel`,
    build: `# Build Plan\n\n## Tasks\n1. server/src/loop.ts — phase orchestrator\n2. server/src/agents/*.ts — 6 agent modules\n3. client/src/App.tsx — three-panel layout`,
    test: `# Test Report\nDate: ${new Date().toISOString().split("T")[0]}\nOverall status: FAIL\n\n> Note: Mock output — set CLAUDE_CODE_OAUTH_TOKEN to enable real Playwright tests.`,
    review: `# Review\n\n## Summary\nMock cycle complete. Set CLAUDE_CODE_OAUTH_TOKEN to enable real agent output.\n\n## Decisions\n- Stack: Bun + Elysia + SQLite + React`,
  };
  return (
    mocks[phase] ??
    `# Agent Output\n\nMock output for phase: ${phase}.\nSet CLAUDE_CODE_OAUTH_TOKEN to use real Claude.`
  );
}

function detectPhase(prompt: string): string {
  const m = prompt.match(/^Phase:\s*(\w+)/m);
  if (m) {
    const p = m[1].toLowerCase();
    if (["research", "spec", "design", "build", "test", "review"].includes(p)) return p;
  }
  const task = prompt.split("TASK:").pop() ?? prompt;
  const l = task.toLowerCase();
  if (l.includes("research")) return "research";
  if (l.includes("user stor") || l.includes("acceptance")) return "spec";
  if (l.includes("design") || l.includes("user flow")) return "design";
  if (l.includes("implement") || l.includes("file structure")) return "build";
  if (l.includes("test") || l.includes("playwright")) return "test";
  if (l.includes("claude.md") || l.includes("decisions")) return "review";
  return "research";
}
