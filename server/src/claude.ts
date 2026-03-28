/**
 * claude.ts — Anthropic SDK message runner
 *
 * Calls the Anthropic Messages API via the official SDK rather than spawning
 * the `claude` CLI subprocess.  Auth is resolved in this order:
 *   1. ANTHROPIC_API_KEY env var  (preferred)
 *   2. CLAUDE_CODE_OAUTH_TOKEN env var (fallback)
 *
 * If neither is set, or if the API returns a 401 AuthenticationError, a
 * deterministic mock response is returned so the loop can keep running in
 * dev/test environments without a real key.
 *
 * Extended thinking is opt-in via `thinkingBudget`.  It is mutually exclusive
 * with `tools` — if both are supplied, thinking is silently dropped.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface ClaudeRunOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Max tokens to request. Defaults to 4096. */
  maxTokens?: number;
  /**
   * Per-call timeout in milliseconds. If the API call does not respond within
   * this window, runClaude rejects with an error whose `.timeout` property is
   * `true`. Callers can catch and retry.
   * Defaults to no timeout.
   */
  timeoutMs?: number;
  /** Optional tool definitions forwarded to `messages.create()`. */
  tools?: Anthropic.Tool[];
  /**
   * Enable extended thinking with this token budget.
   * Mutually exclusive with `tools` — thinking is dropped when both are set.
   */
  thinkingBudget?: number;
}

export interface ClaudeRunResult {
  content: string;
  /** True if we got real output from Claude; false if we used the mock fallback. */
  real: boolean;
  /** Input tokens consumed (from API usage). */
  inputTokens?: number;
  /** Output tokens consumed (from API usage). */
  outputTokens?: number;
  /** Concatenated thinking-block text (only present when extended thinking was used). */
  thinkingContent?: string;
}

const MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Run a one-shot Claude query via the Anthropic SDK.
 *
 * Auth order: ANTHROPIC_API_KEY → CLAUDE_CODE_OAUTH_TOKEN.
 * On AuthenticationError (401) or missing key → deterministic mock.
 * Timeout enforced via Promise.race against a setTimeout.
 */
export async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;

  if (!apiKey) {
    console.warn("[claude] No auth token found — using mock output");
    return { content: mockOutput(opts.userPrompt), real: false };
  }

  const execute = async (): Promise<ClaudeRunResult> => {
    const client = new Anthropic({ apiKey });

    // Thinking and tools are mutually exclusive; drop thinking when tools are set
    const useThinking = !!opts.thinkingBudget && !opts.tools;

    let response: Anthropic.Message;

    if (useThinking) {
      // Extended thinking — requires the interleaved-thinking beta header
      response = await (client.beta.messages.create as Function)({
        model: MODEL,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: opts.systemPrompt,
        messages: [{ role: "user", content: opts.userPrompt }],
        thinking: { type: "enabled", budget_tokens: opts.thinkingBudget },
        betas: ["interleaved-thinking-2025-05-14"],
      });
    } else {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: MODEL,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: opts.systemPrompt,
        messages: [{ role: "user", content: opts.userPrompt }],
      };
      if (opts.tools) params.tools = opts.tools;
      response = await client.messages.create(params);
    }

    // Extract text and (optional) thinking blocks from the response
    let content = "";
    let thinkingContent: string | undefined;

    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "thinking") {
        thinkingContent = (thinkingContent ?? "") + (block as { thinking: string }).thinking;
      }
    }

    if (!content) {
      console.warn("[claude] Empty response from API — using mock output");
      return { content: mockOutput(opts.userPrompt), real: false };
    }

    return {
      content: content.trim(),
      real: true,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      thinkingContent,
    };
  };

  try {
    if (opts.timeoutMs) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          const err = new Error(`Claude call timed out after ${opts.timeoutMs}ms`);
          (err as NodeJS.ErrnoException & { timeout: boolean }).timeout = true;
          reject(err);
        }, opts.timeoutMs);
      });
      return await Promise.race([execute(), timeoutPromise]);
    }
    return await execute();
  } catch (err) {
    // Re-throw timeout errors so callers can detect and retry
    if ((err as { timeout?: boolean }).timeout) throw err;
    // Authentication failure — log and fall back to mock
    if (err instanceof Anthropic.AuthenticationError) {
      console.warn("[claude] Authentication error (401) — using mock output");
      return { content: mockOutput(opts.userPrompt), real: false };
    }
    console.warn("[claude] API call failed:", (err as Error).message);
    return { content: mockOutput(opts.userPrompt), real: false };
  }
}

/**
 * Mock output generator — produces plausible-looking agent output so the loop
 * can run end-to-end without a real Claude token in dev/test environments.
 */
function mockOutput(userPrompt: string): string {
  const phase = detectPhase(userPrompt);

  const mocks: Record<string, string> = {
    research: `# Research Report

## Summary
Preliminary research for the Ouro platform self-improvement cycle. Ouro is a novel AI-orchestrated agency that uses specialised agents to autonomously build and improve software.

## Competitors
| Name | Description | Relevant |
|------|-------------|---------|
| Devin | AI software engineer | Yes — single-agent vs our multi-agent |
| GPT-Engineer | Code generation from spec | Yes — no feedback loop |
| SWE-Agent | GitHub issue resolver | Partial |

## OSS / Libraries
| Library | Purpose | Verdict |
|---------|---------|---------|
| Elysia | Bun HTTP framework | ✅ Already chosen |
| bun:sqlite | SQLite driver | ✅ Already chosen |
| Playwright | E2E testing | ✅ Use for tester agent |
| Tailwind CSS | UI styling | ✅ Already chosen |

## UI Patterns
- Dashboard split-panel layout (similar to Linear, Vercel)
- Real-time feed with websocket updates
- Inbox pattern for async human-in-the-loop

## Dev Patterns
- Monorepo (server + client workspaces)
- Serial phase loop with agent handoffs
- Artifact versioning for reproducibility

## Risks
1. Claude CLI unavailability in CI — mitigated by mock fallback
2. Long-running cycles blocking UI — mitigated by streaming feed updates

## Recommendations
- Implement WS feed broadcast before cycle runs so UI updates live
- Version artifacts so previous cycles are auditable
`,

    spec: `# Product Specification

## User Stories

### US-001: Project Management
As a client (Chris),
I want to create and manage projects,
So that I can track work across multiple software initiatives.

**Acceptance Criteria:**
- Can create a project with name and description
- Project appears in top-bar switcher
- Project shows current phase

### US-002: Real-time Feed
As a client,
I want to see a live feed of agent activity,
So that I can understand what the agents are doing without interrupting them.

**Acceptance Criteria:**
- Feed updates in real time via WebSocket
- Each message shows sender, recipient, timestamp, type
- Feed auto-scrolls to latest message

### US-003: Inbox Communication
As a client,
I want to receive and reply to inbox messages from agents,
So that I can provide input when needed without being constantly interrupted.

**Acceptance Criteria:**
- Unread count badge visible at all times
- Can expand message to read full body
- Can reply inline with textarea + send button

### US-004: Cycle Execution
As a client,
I want to start a cycle with a single click,
So that all agents run through their phases automatically.

**Acceptance Criteria:**
- "Start Cycle" button kicks off the 6-phase loop
- Each phase updates agent status (thinking → idle)
- PM sends inbox summary after cycle completes
`,

    design: `# Design Specification

## User Flows

### Start a Cycle
1. User lands on dashboard, sees project switcher in top bar
2. User selects project from dropdown
3. User clicks "Start Cycle" button
4. Button shows "Running..." state
5. Left panel: active agent status changes to "thinking" (pulsing blue)
6. Centre panel: feed messages appear as each agent completes
7. Right panel: inbox message appears after PM phase

### Reply to Inbox Message
1. User sees unread badge on right panel
2. User clicks message row to expand
3. Full message body shown
4. User types reply in textarea
5. User clicks Send
6. Message marked as read, reply saved

## Component Tree
\`\`\`
App
├── TopBar
│   ├── ProjectSwitcher (dropdown)
│   ├── PhaseBadge
│   └── StartCycleButton
├── AgentPanel (left)
│   └── AgentCard[]
│       ├── RoleIcon (emoji)
│       ├── StatusBadge
│       ├── LastActionText
│       └── CurrentTask
├── FeedPanel (centre)
│   └── FeedMessage[]
│       ├── SenderBadge
│       ├── RecipientLabel
│       ├── Timestamp
│       ├── Content
│       └── TypeBadge
└── InboxPanel (right)
    ├── UnreadBadge
    └── InboxItem[]
        ├── SenderLabel
        ├── Subject
        ├── Timestamp
        ├── ExpandedBody (conditional)
        └── ReplyForm (conditional)
\`\`\`

## Layout Specs
- Top bar: 48px height, full width, dark background
- Left panel: 240px fixed width
- Centre panel: flex-grow
- Right panel: 320px fixed width
- Dark theme: bg-gray-950, text-gray-100

## Component Specs

### AgentCard
- Appearance: rounded card, bg-gray-900, border border-gray-800
- Status badge: idle=gray, thinking=blue (animate-pulse), blocked=amber
- Shows: role emoji + name, status badge, last action text, current task

### FeedMessage
- Appearance: borderless row with subtle divider
- Sender in coloured chip (role colour)
- Timestamp: relative ("2m ago")
- Type badge: note=gray, handoff=blue, question=amber, decision=green, escalate=red
`,

    build: `# Implementation Plan

## File Structure
\`\`\`
server/
  src/
    index.ts        ← Elysia app, routes, WS
    db.ts           ← SQLite schema + typed queries
    loop.ts         ← Phase orchestrator
    claude.ts       ← Anthropic SDK runner
    prompts.ts      ← Load prompt files
    seed.ts         ← Seed data
    agents/
      pm.ts
      researcher.ts
      designer.ts
      developer.ts
      tester.ts
      documenter.ts
  prompts/
    *.md
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

### loop.ts
- \`runCycle(projectId)\` — iterates phases, calls each agent, saves artifacts, posts feed
- \`phaseToRole\` map: research→researcher, spec→pm, design→designer, build→developer, test→tester, review→documenter

### agents/*.ts
Each agent exports \`runAgent(projectId, task)\`:
1. Load system prompt from prompts.ts
2. Build context block (project info, CLAUDE.md, last 10 feed messages)
3. Call runClaude()
4. Return { content, summary }

### index.ts
WebSocket: on new feed_message, broadcast to all connected clients

## Conventional Commits Plan
- feat(db): add schema and typed queries
- feat(claude): add SDK runner with mock fallback
- feat(agents): add all 6 agent implementations
- feat(loop): add serial phase orchestrator
- feat(api): add all REST + WS routes
- feat(client): add three-panel React dashboard
- feat(seed): add seed data script
`,

    test: `# Test Report

## Cycle: 2024-01 — Ouro Platform MVP

### US-001: Project Management

| Test | Status | Notes |
|------|--------|-------|
| Create project via POST /api/projects | ✅ PASS | Returns project with id + slug |
| Project appears in GET /api/projects | ✅ PASS | |
| Project switcher updates on creation | ✅ PASS | WS broadcast triggers re-fetch |

### US-002: Real-time Feed

| Test | Status | Notes |
|------|--------|-------|
| WS /ws connects | ✅ PASS | |
| New feed message triggers WS broadcast | ✅ PASS | |
| Feed auto-scrolls to bottom | ✅ PASS | |

### US-003: Inbox

| Test | Status | Notes |
|------|--------|-------|
| POST /api/projects/:id/inbox/:msgId/reply saves reply | ✅ PASS | |
| Reply marks message as read | ✅ PASS | |
| Unread badge decrements | ⚠️ FAIL | Badge doesn't update until page refresh — see GH#1 |

### US-004: Cycle Execution

| Test | Status | Notes |
|------|--------|-------|
| POST /cycle/start kicks off loop | ✅ PASS | |
| All 6 phases run serially | ✅ PASS | |
| PM sends inbox message after cycle | ✅ PASS | |
| Agent status shown as 'thinking' during run | ✅ PASS | |

## Raised Issues

### GH#1: Unread badge doesn't update in real time
**Severity:** Medium
**Steps:** Send inbox message while client is connected → badge doesn't update
**Expected:** Badge increments immediately via WS
**Fix:** Broadcast inbox events over WS alongside feed events

> NOTE: This is a notional GitHub issue — real GH integration is TODO.
> [stub] Would run: gh issue create --title "Unread badge doesn't update in real time" --body "..."
`,

    review: `# Cycle Review & CLAUDE.md Update

## Summary

Cycle 1 complete. All 6 phases ran successfully. The Ouro MVP loop is functional:
research → spec → design → build → test → review.

## Decisions Made This Cycle
- Stack: Bun + Elysia + SQLite + React + Vite + Tailwind
- Architecture: monorepo (server workspace + client workspace)
- Agent model: serial phases, each agent reads previous artifacts
- Real-time: WebSocket broadcast on new feed_message
- Auth: none for MVP — single user (Chris)

## Patterns Established
- Context block format injected into every agent prompt
- Artifact versioning: each cycle increments version number
- Mock fallback: if Claude API unavailable, deterministic mock output returned
- Feed message types: handoff | question | decision | note | escalate

## Client Preferences Noted
- Dark theme
- Concise feed messages — agents should summarise, not dump full output
- Inbox only for things that genuinely need human input

## Next Cycle Priorities
1. Real Claude Code subprocess for developer agent
2. Real Playwright runs for tester agent
3. GitHub Issues integration for tester failures
4. WS broadcast for inbox events (fix GH#1)
5. Streaming output from Claude (SSE) so feed populates token-by-token
`,
  };

  return mocks[phase] ?? `# Agent Output\n\nTask completed successfully.\n\nPhase: ${phase}\n\nThis is mock output. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN to use real Claude.`;
}

function detectPhase(prompt: string): string {
  // Extract the "Phase:" line from the context block — this is the most reliable signal.
  // Scanning the full prompt is unreliable because feed messages from earlier phases
  // contain phase-related keywords that pollute detection.
  const phaseMatch = prompt.match(/^Phase:\s*(\w+)/m);
  if (phaseMatch) {
    const p = phaseMatch[1].toLowerCase();
    if (["research", "spec", "design", "build", "test", "review"].includes(p)) return p;
  }

  // Fallback: scan just the TASK section (after the context block ends)
  const taskSection = prompt.split("TASK:").pop() ?? prompt;
  const lower = taskSection.toLowerCase();
  if (lower.includes("research")) return "research";
  if (lower.includes("user stor") || lower.includes("acceptance criteria")) return "spec";
  if (lower.includes("design") || lower.includes("user flow")) return "design";
  if (lower.includes("implement") || lower.includes("file structure")) return "build";
  if (lower.includes("test report") || lower.includes("playwright")) return "test";
  if (lower.includes("claude.md") || lower.includes("decisions made")) return "review";
  return "research";
}
