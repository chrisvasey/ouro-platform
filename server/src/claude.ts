/**
 * claude.ts — Claude CLI subprocess runner
 *
 * ⚠️  DO NOT REPLACE THIS WITH THE ANTHROPIC SDK.
 *
 * This server uses CLAUDE_CODE_OAUTH_TOKEN (an OAuth token from Claude Code),
 * NOT an Anthropic API key. The Anthropic SDK does not support OAuth tokens —
 * every attempt to use the SDK here results in:
 *   "401 OAuth authentication is currently not supported"
 *
 * The correct pattern (identical to ~/agent-runner) is:
 *   Bun.spawn(["claude", "-p", "--verbose", "--output-format", "stream-json", ...])
 *   with ANTHROPIC_API_KEY=<oauth_token> in the subprocess env.
 *   The Claude Code CLI accepts the OAuth token via ANTHROPIC_API_KEY.
 *
 * This has been confirmed working. Do not change it.
 */

export interface ClaudeRunOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Per-call timeout in ms. On expiry rejects with err.timeout = true. */
  timeoutMs?: number;
}

export interface ClaudeRunResult {
  content: string;
  /** True = real Claude output; false = mock fallback. */
  real: boolean;
  inputTokens?: number;
  outputTokens?: number;
  /** Cost in USD (0 for mock output). */
  costUsd: number;
  /** Tool use calls parsed from the response (empty for plain text output). */
  toolUses: Array<{ id: string; name: string; input: unknown }>;
}

/**
 * Run a one-shot Claude query via the CLI subprocess.
 *
 * Auth: CLAUDE_CODE_OAUTH_TOKEN or CLAUDE_OAUTH_TOKEN, passed as
 * ANTHROPIC_API_KEY to the subprocess (Claude CLI accepts it this way).
 */
export async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const token =
    process.env.CLAUDE_CODE_OAUTH_TOKEN ??
    process.env.CLAUDE_OAUTH_TOKEN ??
    process.env.ANTHROPIC_API_KEY;

  if (!token) {
    console.warn("[claude] No auth token — using mock output");
    return { content: mockOutput(opts.userPrompt), real: false, costUsd: 0, toolUses: [] };
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
        fullPrompt,
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

    const [raw] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text().catch(() => "");
      console.warn(`[claude] CLI exited ${proc.exitCode}: ${stderr.slice(0, 200)}`);
      return { content: mockOutput(opts.userPrompt), real: false, costUsd: 0, toolUses: [] };
    }

    let content = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let costUsd = 0;
    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];

    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const msg = JSON.parse(t);
        if (msg.type === "assistant" && msg.message?.content) {
          for (const b of msg.message.content) {
            if (b.type === "text") content += b.text;
            if (b.type === "tool_use") {
              toolUses.push({ id: b.id ?? "", name: b.name ?? "", input: b.input ?? {} });
            }
          }
        }
        if (msg.type === "result") {
          if (!content && msg.result) content = msg.result;
          if (msg.usage) {
            inputTokens = msg.usage.input_tokens;
            outputTokens = msg.usage.output_tokens;
          }
          if (typeof msg.cost_usd === "number") costUsd = msg.cost_usd;
        }
      } catch { /* non-JSON lines ignored */ }
    }

    if (!content) {
      console.warn("[claude] Empty CLI response — using mock output");
      return { content: mockOutput(opts.userPrompt), real: false, costUsd: 0, toolUses: [] };
    }

    return { content: content.trim(), real: true, inputTokens, outputTokens, costUsd, toolUses };
  };

  try {
    if (opts.timeoutMs) {
      const timer = new Promise<never>((_, reject) =>
        setTimeout(() => {
          const e = new Error(`Claude call timed out after ${opts.timeoutMs}ms`);
          (e as Error & { timeout: boolean }).timeout = true;
          reject(e);
        }, opts.timeoutMs)
      );
      return await Promise.race([execute(), timer]);
    }
    return await execute();
  } catch (err: unknown) {
    if ((err as { timeout?: boolean }).timeout) throw err;
    console.warn("[claude] CLI call failed:", (err as Error).message);
    return { content: mockOutput(opts.userPrompt), real: false, costUsd: 0, toolUses: [] };
  }
}

// ── Mock fallback ─────────────────────────────────────────────────────────────

function mockOutput(userPrompt: string): string {
  const phase = detectPhase(userPrompt);
  const mocks: Record<string, string> = {
    research: `# Research Report\n\n## Summary\nMock — CLAUDE_CODE_OAUTH_TOKEN not set or CLI unavailable.\n\n## Competitors\n- Devin, GPT-Engineer, SWE-Agent\n\n## Recommendations\n- Set CLAUDE_CODE_OAUTH_TOKEN for real output`,
    spec: `# Spec\n\n### US-001: Core Loop\nAs a client, I want the cycle to run automatically.\n\n**Acceptance Criteria:**\n- [ ] Cycle runs all 6 phases\n- [ ] Feed updates in real time\n- [ ] PM sends inbox summary`,
    design: `# Design Spec\n\n## User Flows\n1. User clicks Start Cycle → agents run → feed updates\n\n## Component Tree\n- App > TopBar > AgentPanel > FeedPanel > InboxPanel`,
    build: `# Build Plan\n\n## Tasks\n1. loop.ts — phase orchestrator\n2. agents/*.ts — 6 agent modules\n3. App.tsx — three-panel layout`,
    test: `# Test Report\nDate: ${new Date().toISOString().split("T")[0]}\nOverall status: FAIL\n\n> Mock — CLAUDE_CODE_OAUTH_TOKEN not set.`,
    review: `# Review\n\n## Summary\nMock cycle. Set CLAUDE_CODE_OAUTH_TOKEN for real output.`,
  };
  return mocks[phase] ?? `# Mock Output\nPhase: ${phase}\nSet CLAUDE_CODE_OAUTH_TOKEN to use real Claude.`;
}

function detectPhase(prompt: string): string {
  const m = prompt.match(/^Phase:\s*(\w+)/m);
  if (m) {
    const p = m[1].toLowerCase();
    if (["research", "spec", "design", "build", "test", "review"].includes(p)) return p;
  }
  const t = (prompt.split("TASK:").pop() ?? prompt).toLowerCase();
  if (t.includes("research")) return "research";
  if (t.includes("user stor") || t.includes("acceptance")) return "spec";
  if (t.includes("design") || t.includes("user flow")) return "design";
  if (t.includes("implement") || t.includes("file structure")) return "build";
  if (t.includes("test") || t.includes("playwright")) return "test";
  if (t.includes("claude.md") || t.includes("decisions")) return "review";
  return "research";
}
