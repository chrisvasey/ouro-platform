# Ouro Platform — Cycle 5 Spec
**PM:** Ouro PM Agent | **Date:** 2026-03-28 | **Cycle:** 5

---

## Context

Four cycles. Zero committed code. The blocker is structural: `server/src/claude.ts` spawns `claude --print` as a subprocess, which cannot accept `tools`, return `usage` data, or expose `thinking` blocks. Every story that depends on those capabilities (thought log, token budget, structured tool use) has been architecturally impossible from the start.

This cycle has one job: fix the foundation.

---

## User Stories

### C5-1 — Migrate `claude.ts` to Anthropic SDK [CRITICAL BLOCKER]

**As a** developer on Ouro,
**I want** `claude.ts` to call the Anthropic API via `@anthropic-ai/sdk` directly,
**So that** tool use, token tracking, and extended thinking are available to all agents.

**Acceptance Criteria:**
- [ ] `@anthropic-ai/sdk` added to `server/package.json` and installed
- [ ] `runClaude()` calls `anthropic.messages.create()` — no `Bun.spawn('claude', ...)` remaining
- [ ] `ClaudeRunResult` exposes `inputTokens: number` and `outputTokens: number` from `usage`
- [ ] `ClaudeRunOptions` accepts optional `tools?: Anthropic.Tool[]` — forwarded to API call as-is
- [ ] `ClaudeRunOptions` accepts optional `thinkingBudget?: number` — if set, adds `{type: 'enabled', budget_tokens: N}` to the API call and sets `betas: ['interleaved-thinking-2025-05-14']`
- [ ] Thinking blocks extracted from response and returned as `thinkingContent?: string` in result
- [ ] `timeoutMs` behaviour preserved: rejects with `(err as {timeout: boolean}).timeout = true`
- [ ] Mock fallback preserved: if `ANTHROPIC_API_KEY` absent, return `{ content: mockOutput(...), real: false }`
- [ ] All existing agent callers compile without changes (`content` and `real` fields unchanged in interface)
- [ ] `CLAUDE_CODE_OAUTH_TOKEN` still accepted as auth token (fallback to `ANTHROPIC_API_KEY`)
- [ ] `bun run typecheck` passes with no new errors

**Resolves:** GH#12 (C4), GH#7 (C2) becomes actionable, GH#2 (C2) becomes actionable

---

## Downstream Stories — Unblocked by C5-1 (Defer to Cycle 6+)

These stories were specified in Cycle 2 but are blocked until C5-1 lands. Do not implement in Cycle 5.

### C6-1 — Token Budget Tracking (unblocks after C5-1)

**As a** client (Chris),
**I want** each agent run to record token consumption,
**So that** Ouro can enforce a daily spend cap and warn me before I hit it.

**Acceptance Criteria:**
- [ ] `runClaude()` returns `inputTokens` + `outputTokens` (provided by C5-1)
- [ ] Each agent saves token counts to the `events` table alongside its output
- [ ] A budget helper computes daily spend: `(inputTokens × $3 + outputTokens × $15) / 1_000_000`
- [ ] At >80% of daily budget: warning banner visible in UI
- [ ] At ≥100% of daily budget: cycle halts + blocking inbox message sent to Chris
- [ ] Default budget: **$5/project/day** (research recommends $5, not the $10 previously assumed — see Open Questions)

### C6-2 — Thought Log via Extended Thinking (unblocks after C5-1)

**As a** client,
**I want** to read the agent's internal reasoning (extended thinking),
**So that** I can audit why an agent made a particular decision.

**Acceptance Criteria:**
- [ ] `thinkingBudget` set in agent calls where reasoning transparency matters (researcher, PM, developer)
- [ ] Thinking content stored as a separate artifact field or `events` row
- [ ] UI: collapsed "Thought log" section on each agent card, expandable on click
- [ ] Resolves GH#2 (C2): empty thought log no longer possible once SDK sets beta header correctly

### C6-3 — Structured Tool Use for Agents (unblocks after C5-1)

**As a** developer agent,
**I want** to call tools (read_file, write_file, run_tests) via structured API tool use,
**So that** I can reliably produce and apply code changes without free-form text parsing.

**Acceptance Criteria:**
- [ ] `AGENT_TOOLS` constant defined with typed `Anthropic.Tool[]` definitions
- [ ] `runClaude()` forwards `tools` to API (provided by C5-1)
- [ ] Agent runner parses `tool_use` blocks from response and dispatches to handler functions
- [ ] Self-mod gate applied before any `write_file` tool call (resolves GH#4 C2)
- [ ] Resolves GH#7 (C2): tool definitions now registered and active

---

## Phase Summary

Cycles 1–4 produced research, specs, design, and build plans — but zero committed code. The root cause, identified definitively in Cycle 4's review, is that `claude.ts` uses a subprocess that cannot support the APIs the build plan depends on. Cycle 5 descopes to a single story (C5-1) that unblocks everything else. If C5-1 ships, Cycle 6 can immediately begin the 16-commit build plan with a working foundation.

---

## Open Questions

1. **Token budget default:** Research recommends **$5/project/day** (not the $10 assumed in CLAUDE.md). Confirm before C6-1 is built. _Assumption if no reply: use $5._

2. **Auth token precedence:** Current code tries `CLAUDE_CODE_OAUTH_TOKEN` first, then `ANTHROPIC_API_KEY`. SDK migration should preserve this. Is the OAuth token a valid Anthropic API key (i.e., can it be passed as `apiKey` to the SDK)? _Assumption if no reply: try both; if OAuth token doesn't work as SDK apiKey, fall back to mock._

3. **Self-mod gate for `prompts/` directory:** CLAUDE.md notes this is an open question. Not blocking Cycle 5, but needed before C6-3 lands. _Decision needed by Cycle 6._

---

## Next Phase

Designer will produce no new UI specs for Cycle 5 (no UI changes). Developer should proceed directly to C5-1 implementation: install `@anthropic-ai/sdk`, rewrite `runClaude()`, and submit a single commit `fix(claude): migrate to anthropic sdk`.
