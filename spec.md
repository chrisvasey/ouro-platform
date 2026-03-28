# Ouro Platform — Cycle 5 Spec
**PM:** Ouro PM Agent | **Date:** 2026-03-28 | **Cycle:** 5

---

## Context

Four cycles. Zero committed code. The root cause is confirmed: `server/src/claude.ts` spawns `claude --print` as a subprocess. A subprocess cannot accept `tools`, return `usage` data, or expose `thinking` blocks — making Stories 3 (thought log), 9 (token budget), and 14 (structured tool use) architecturally impossible until the migration lands.

Research confirms `@anthropic-ai/sdk` is the correct replacement, noting `.stream()` with event listeners as the standard streaming pattern. Everything else is deferred.

This cycle ships two stories: one critical (SDK migration), one trivial (WAL mode). Both must land as committed code.

---

## User Stories

### C5-1 — Migrate `claude.ts` to Anthropic SDK [CRITICAL — blocks everything]

**As a** developer on Ouro,
**I want** `runClaude()` to call the Anthropic API via `@anthropic-ai/sdk` directly,
**So that** tool use, token tracking, extended thinking, and real streaming are available to all agents.

**Acceptance Criteria:**
- [ ] `@anthropic-ai/sdk` added to `server/package.json` and installed via `bun install`
- [ ] `runClaude()` calls `client.messages.create()` — no `Bun.spawn('claude', ...)` remaining
- [ ] `ClaudeRunResult` exposes `inputTokens: number` and `outputTokens: number` from `usage`
- [ ] `ClaudeRunOptions` accepts optional `tools?: Anthropic.Tool[]` — forwarded to the API call as-is
- [ ] `ClaudeRunOptions` accepts optional `thinkingBudget?: number` — if set, adds `{type: 'enabled', budget_tokens: N}` to the request and sets `betas: ['interleaved-thinking-2025-05-14']`
- [ ] Thinking blocks extracted from response and returned as `thinkingContent?: string` in result
- [ ] `timeoutMs` behaviour preserved: rejects with an error whose `.timeout` property is `true`
- [ ] Mock fallback preserved: if no API key found, return `{ content: mockOutput(prompt), real: false, inputTokens: 0, outputTokens: 0 }`
- [ ] Auth: try `CLAUDE_CODE_OAUTH_TOKEN` first as the SDK `apiKey`, fall back to `ANTHROPIC_API_KEY`; if neither present use mock
- [ ] All existing agent callers compile without changes — `content` and `real` fields remain in the result interface
- [ ] `bun run typecheck` passes with zero new errors

**Resolves:** GH#12 (C4), unblocks GH#7 (C2) and GH#2 (C2)

---

### C5-2 — Enable SQLite WAL Mode [TRIVIAL — must ship before parallel phases]

**As a** developer on Ouro,
**I want** `bun:sqlite` to run in WAL journal mode,
**So that** concurrent writes from parallel phases (spec ‖ design-draft) do not cause serialisation errors.

**Acceptance Criteria:**
- [ ] `PRAGMA journal_mode=WAL` added to `server/src/db.ts` immediately after the database is opened
- [ ] `bun run typecheck` continues to pass
- [ ] No existing tests break

**Note:** This is a single-line change. It is a prerequisite for the parallel Phase DAG (C6+) and carries no implementation risk.

---

## Downstream Stories — Deferred to Cycle 6+

These stories were specified in Cycle 2. Do not implement them in Cycle 5. They are listed here so the developer understands what C5-1 unlocks.

### C6-1 — Token Budget Tracking *(unblocks after C5-1)*

**As a** client (Chris),
**I want** each agent run to record token consumption,
**So that** Ouro can enforce a daily spend cap and warn me before I hit it.

**Acceptance Criteria:**
- [ ] Each agent saves `inputTokens` + `outputTokens` (from C5-1 result) to the `events` table
- [ ] Budget helper computes daily spend: `(inputTokens × $3 + outputTokens × $15) / 1_000_000`
- [ ] At >80% of daily budget: warning banner shown in UI
- [ ] At ≥100% of daily budget: cycle halts + blocking inbox message sent to Chris
- [ ] Default budget: **$5/project/day** (see Open Questions)

### C6-2 — Thought Log via Extended Thinking *(unblocks after C5-1)*

**As a** client,
**I want** to read the agent's internal reasoning,
**So that** I can audit why an agent made a particular decision.

**Acceptance Criteria:**
- [ ] `thinkingBudget` set on researcher, PM, and developer agent calls
- [ ] Thinking content stored as a separate field or `events` row
- [ ] UI: collapsed "Thought log" section on each agent card, expandable on click
- [ ] Startup assertion logs a warning if no thinking blocks are received within first agent call (resolves GH#2)

### C6-3 — Structured Tool Use for Agents *(unblocks after C5-1)*

**As a** developer agent,
**I want** to call tools (`read_file`, `write_file`, `run_tests`) via structured API tool use,
**So that** I can reliably produce and apply code changes without free-form text parsing.

**Acceptance Criteria:**
- [ ] `AGENT_TOOLS` constant defined with typed `Anthropic.Tool[]` definitions
- [ ] `runClaude()` forwards `tools` to API (provided by C5-1)
- [ ] Agent runner parses `tool_use` blocks from response and dispatches to handler functions
- [ ] Self-mod gate applied before any `write_file` tool call (resolves GH#4 C2)
- [ ] Resolves GH#7 (C2)

---

## Phase Summary

Cycles 1–4 have produced research, specs, design, and build plans with zero committed code. The root cause — confirmed in Cycle 4's review — is `claude.ts` running a subprocess that lacks the APIs the build plan depends on. Cycle 5 descopes aggressively: two stories, both deliverable in a single commit session. Research confirms `@anthropic-ai/sdk` is the correct dependency and that streaming via `.stream()` with event listeners is the SDK-standard pattern. If C5-1 and C5-2 ship as committed code, Cycle 6 begins the 16-commit plan with a working foundation.

---

## Open Questions

1. **Token budget default:** Research recommends **$5/project/day** (down from $10 assumed in CLAUDE.md). Confirm before C6-1 is built. _Assumption if no reply: use $5._

2. **`CLAUDE_CODE_OAUTH_TOKEN` as SDK `apiKey`:** Current code passes this token to the Claude CLI. The SDK requires an Anthropic API key. If the OAuth token is not a valid Anthropic API key, the mock fallback will activate instead of erroring. _Assumption: try it; if SDK rejects it, fall back to mock rather than crashing._

3. **Self-mod gate scope for `prompts/` directory:** CLAUDE.md lists this as open. Not blocking Cycle 5 — decision needed before C6-3 lands.

---

## Next Phase

Designer has no UI work for Cycle 5. Developer should proceed directly to C5-1 then C5-2: install `@anthropic-ai/sdk`, rewrite `runClaude()`, add WAL pragma to `db.ts`, and ship as a single commit `fix(claude): migrate to anthropic sdk, enable wal mode`.
