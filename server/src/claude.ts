/**
 * claude.ts — Anthropic SDK runner
 *
 * Uses the @anthropic-ai/sdk to call Claude directly via messages.create().
 * Auth: ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN / CLAUDE_OAUTH_TOKEN).
 *
 * Falls back to deterministic mock output when the token is missing or the
 * call fails, so the loop keeps running in dev/test.
 */

import Anthropic from "@anthropic-ai/sdk";

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ThinkingBlock {
  thinking: string;
  signature: string;
}

export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

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
  /** Tool definitions forwarded to messages.create(). Defaults to []. */
  tools?: Anthropic.Tool[];
}

export interface ClaudeRunResult {
  content: string;
  /** True when real Claude output was returned; false for mock fallback. */
  real: boolean;
  inputTokens?: number;
  outputTokens?: number;
  /** Total cost in USD: (inputTokens * $3 + outputTokens * $15) / 1_000_000 */
  costUsd: number;
  /** Thinking blocks from the model (non-empty only with thinking beta enabled). */
  thinkingBlocks: ThinkingBlock[];
  /** Tool-use requests returned by the model. */
  toolUses: ToolUse[];
}

// ── Pricing constants (claude-sonnet-4-5) ────────────────────────────────────

const INPUT_PRICE_PER_MTOK  = 3;   // $3  per million input tokens
const OUTPUT_PRICE_PER_MTOK = 15;  // $15 per million output tokens
const DEFAULT_MAX_TOKENS    = 4096;

// ── Tool definitions ─────────────────────────────────────────────────────────

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "save_artifact",
    description: "Save a markdown artifact for the current phase.",
    input_schema: {
      type: "object",
      properties: {
        phase:    { type: "string" },
        filename: { type: "string" },
        content:  { type: "string" },
      },
      required: ["phase", "filename", "content"],
    },
  },
  {
    name: "post_feed_message",
    description: "Post a message to the shared project feed.",
    input_schema: {
      type: "object",
      properties: {
        recipient:    { type: "string" },
        content:      { type: "string" },
        message_type: { type: "string" },
      },
      required: ["recipient", "content", "message_type"],
    },
  },
  {
    name: "request_human_input",
    description: "Send a blocking inbox message requesting human input. Pauses the cycle.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        body:    { type: "string" },
      },
      required: ["subject", "body"],
    },
  },
];

// ── Main runner ───────────────────────────────────────────────────────────────

/**
 * Run a one-shot Claude query via the Anthropic SDK.
 *
 * Maps response content blocks:
 *   text      → ClaudeRunResult.content
 *   thinking  → ClaudeRunResult.thinkingBlocks
 *   tool_use  → ClaudeRunResult.toolUses
 *
 * Token usage is read from response.usage and converted to costUsd.
 */
export async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const apiKey =
    process.env.ANTHROPIC_API_KEY;
  const oauthToken =
    process.env.CLAUDE_CODE_OAUTH_TOKEN ??
    process.env.CLAUDE_OAUTH_TOKEN;

  if (!apiKey && !oauthToken) {
    console.warn("[claude] No auth token found — using mock output");
    return mockResult(opts.userPrompt);
  }

  const execute = async (): Promise<ClaudeRunResult> => {
    // OAuth tokens (sk-ant-oat01-*) must use authToken/Bearer auth.
    // Standard API keys (sk-ant-api03-*) use apiKey/X-Api-Key auth.
    const isOAuth = !apiKey && !!oauthToken;
    const client = isOAuth
      ? new Anthropic({ apiKey: null, authToken: oauthToken })
      : new Anthropic({ apiKey: apiKey! });

    const createParams: Anthropic.MessageCreateParamsNonStreaming = {
      model: "claude-sonnet-4-5",
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: opts.systemPrompt,
      messages: [{ role: "user", content: opts.userPrompt }],
    };

    if (opts.tools && opts.tools.length > 0) {
      createParams.tools = opts.tools;
    }

    const response = await client.messages.create(createParams);

    let content = "";
    const thinkingBlocks: ThinkingBlock[] = [];
    const toolUses: ToolUse[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
      } else if ((block as { type: string }).type === "thinking") {
        // thinking blocks require the interleaved-thinking beta header
        const tb = block as unknown as { thinking: string; signature: string };
        thinkingBlocks.push({ thinking: tb.thinking, signature: tb.signature ?? "" });
      }
    }

    const inputTokens  = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUsd = (inputTokens * INPUT_PRICE_PER_MTOK + outputTokens * OUTPUT_PRICE_PER_MTOK) / 1_000_000;

    if (!content && toolUses.length === 0) {
      console.warn("[claude] Empty response from SDK — using mock output");
      return mockResult(opts.userPrompt);
    }

    return {
      content: content.trim(),
      real: true,
      inputTokens,
      outputTokens,
      costUsd,
      thinkingBlocks,
      toolUses,
    };
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
    console.warn("[claude] SDK call failed:", (err as Error).message);
    return mockResult(opts.userPrompt);
  }
}

// ── Mock fallback ─────────────────────────────────────────────────────────────

function mockResult(userPrompt: string): ClaudeRunResult {
  return {
    content: mockOutput(userPrompt),
    real: false,
    costUsd: 0,
    thinkingBlocks: [],
    toolUses: [],
  };
}

function mockOutput(userPrompt: string): string {
  const phase = detectPhase(userPrompt);
  const mocks: Record<string, string> = {
    research: `# Research Report\n\n## Summary\nMock research output — set ANTHROPIC_API_KEY to enable real Claude.\n\n## Competitors\n- Devin: single-agent AI engineer\n- GPT-Engineer: spec-to-code, no feedback loop\n\n## Recommendations\n- Implement streaming feed updates\n- Version artifacts per cycle`,
    spec: `# Spec\n\n### US-001: Core Loop\nAs a client, I want agents to run automatically, so I don't have to manage them.\n\n**Acceptance Criteria:**\n- [ ] Cycle runs all 6 phases\n- [ ] Feed updates in real time\n- [ ] PM sends inbox summary`,
    design: `# Design Spec\n\n## User Flows\n1. User clicks Start Cycle\n2. Agents progress through phases\n3. Feed updates live\n\n## Component Tree\n- App > TopBar > AgentPanel > FeedPanel > InboxPanel`,
    build: `# Build Plan\n\n## Tasks\n1. server/src/loop.ts — phase orchestrator\n2. server/src/agents/*.ts — 6 agent modules\n3. client/src/App.tsx — three-panel layout`,
    test: `# Test Report\nDate: ${new Date().toISOString().split("T")[0]}\nOverall status: FAIL\n\n> Note: Mock output — set ANTHROPIC_API_KEY to enable real Playwright tests.`,
    review: `# Review\n\n## Summary\nMock cycle complete. Set ANTHROPIC_API_KEY to enable real agent output.\n\n## Decisions\n- Stack: Bun + Elysia + SQLite + React`,
  };
  return (
    mocks[phase] ??
    `# Agent Output\n\nMock output for phase: ${phase}.\nSet ANTHROPIC_API_KEY to use real Claude.`
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
