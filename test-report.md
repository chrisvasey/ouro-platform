# Test Report
Cycle: 2026-03-28 — Cycle 8

> **Context:** The developer agent timed out on all steps this cycle and produced no implementation plan (`build.md` is empty). Testing is conducted against the current codebase state. All Cycle 8 story implementations appear to have been committed in prior cycles; this report verifies each acceptance criterion holds in the code as it stands.

---

## Coverage Summary

| Story | Title | Tests | Pass | Fail | Skip |
|-------|-------|-------|------|------|------|
| Story 1 | Migrate `claude.ts` to Anthropic SDK | 8 | 8 | 0 | 0 |
| Story 2 | Event Sourcing Infrastructure | 5 | 4 | 1 | 0 |
| Story 3 | Artifact Versioning | 6 | 5 | 1 | 0 |
| Story 4 | Agent Lifecycle Events | 5 | 5 | 0 | 0 |
| Story 5 | Phase and Human Input Events | 5 | 5 | 0 | 0 |
| **Total** | | **29** | **27** | **2** | **0** |

**Overall status: FAIL** — 2 failures. One is a spec/implementation discrepancy (column count); one is an async cleanup bug. No acceptance criteria failures that block runtime functionality.

---

## Test Results by Story

---

### Story 1: Migrate `claude.ts` to Anthropic SDK

| # | Test Case | Expected | Actual | Status | Notes |
|---|-----------|----------|--------|--------|-------|
| 1.1 | `@anthropic-ai/sdk` installed and imported | `import Anthropic from "@anthropic-ai/sdk"` | `claude.ts:17` ✓ | **PASS** | |
| 1.2 | `Bun.spawn` fully removed from `claude.ts` | No subprocess calls | No `Bun.spawn` in `claude.ts` | **PASS** | Only appears in `db.ts` for diff generation — correct scope |
| 1.3 | `ClaudeRunResult` exposes `inputTokens?` / `outputTokens?` | Both optional number fields | `claude.ts:45–47` ✓ | **PASS** | |
| 1.4 | `tools?` forwarded to `messages.create()` | Passed through when supplied | `claude.ts:95`: `if (opts.tools) params.tools = opts.tools` | **PASS** | |
| 1.5 | `thinkingBudget?` forwarded | Beta endpoint called with budget | `claude.ts:78–87`: `useThinking` flag, interleaved-thinking beta header set | **PASS** | Mutually exclusive with `tools` — thinking silently dropped when both supplied (no warning logged; minor) |
| 1.6 | `thinkingContent?` extracted from response | Thinking blocks concatenated into field | `claude.ts:106–108`: `block.type === "thinking"` handled | **PASS** | |
| 1.7 | Timeout fallback preserved | `Promise.race` with `.timeout = true` on reject | `claude.ts:126–139` ✓; timeout flag set at line 131 | **PASS** | |
| 1.8 | Mock fallback on missing auth or 401 | `{ real: false, content: mockOutput(...) }` | No-key guard `claude.ts:65–68`; `AuthenticationError` path `claude.ts:141–143` | **PASS** | ✓ Resolves GH#12. Note: `CLAUDE_CODE_OAUTH_TOKEN` is an OAuth token, not an Anthropic API key — will 401 in production. Masked by mock fallback. See GH#13. |

---

### Story 2: Event Sourcing Infrastructure

| # | Test Case | Expected | Actual | Status | Notes |
|---|-----------|----------|--------|--------|-------|
| 2.1 | `events` DDL present | `CREATE TABLE IF NOT EXISTS events` | `db.ts:123–133` ✓ | **PASS** | |
| 2.2 | Events table has 8 columns | 8 columns per spec AC | **7 columns**: `id, project_id, cycle_id, type, agent_role, payload, created_at` | **FAIL** | Off-by-one vs. spec. No 8th column present or planned in build notes. See GH#14. |
| 2.3 | `EventType` union exports 8 string literals | Exactly 8 event type values | `db.ts:562–570`: `phase_started`, `phase_completed`, `agent_started`, `agent_completed`, `agent_failed`, `error`, `human_input_requested`, `human_input_received` = 8 ✓ | **PASS** | |
| 2.4 | `insertEvent` and `getEvents` typed helpers | Accept typed params; return typed `Event` | `db.ts:608–636` ✓; 3 covering indexes added (exceeds spec) | **PASS** | |
| 2.5 | `'events'` in `--reset` list | Table dropped on `bun run src/db.ts --reset` | `db.ts:644`: `"events"` in tables array ✓ | **PASS** | |

---

### Story 3: Artifact Versioning

| # | Test Case | Expected | Actual | Status | Notes |
|---|-----------|----------|--------|--------|-------|
| 3.1 | Idempotent `ALTER TABLE` for all 3 columns | `try/catch` swallows "column exists" error | `db.ts:72–74`: all three wrapped in `try/catch` ✓ | **PASS** | |
| 3.2 | `saveArtifact` accepts `cycleId?` | Optional 5th param stored in `cycle_id` | `db.ts:374`: signature includes `cycleId?: string`; stored line 385 ✓ | **PASS** | |
| 3.3 | Lineage: `previous_version_id` set on v2+ | Queries previous row, stores its `id` | `db.ts:387–388`: `previous_version_id = existing.id` ✓ | **PASS** | |
| 3.4 | Unified diff via `Bun.spawn(['diff', '-u', ...])` | Diff text stored in `diff_from_previous` | `db.ts:400–412`: `Bun.spawn(["diff", "-u", tmpA, tmpB])`; exit code ≤1 accepted ✓ | **PASS** | |
| 3.5 | Diff generation is best-effort | Outer `try/catch` — diff null on any error | `db.ts:414–416`: outer catch sets diff to null ✓ | **PASS** | |
| 3.6 | Temp file cleanup in `finally` | Both `/tmp/ouro-diff-*` files removed | `db.ts:418–420`: cleanup present but **not awaited**; `Bun.file().exists()` returns `Promise<boolean>` (always truthy as object) — exists-check is dead code; `rm` runs unconditionally and fire-and-forget | **FAIL** | Practical impact low (`rm -f` on non-existent path is a no-op on Linux), but under high save frequency temp files accumulate. See GH#15. |
| 3.7 | `getArtifactHistory` query added | Returns all versions ascending | `db.ts:462–468`: `ORDER BY version ASC` ✓ | **PASS** | |

_Note: 3.6 rated FAIL on spec intent (defensive guard broken), not on observable runtime failure._

---

### Story 4: Agent Lifecycle Events

| # | Test Case | Expected | Actual | Status | Notes |
|---|-----------|----------|--------|--------|-------|
| 4.1 | `emitAgentStarted` exported from `base.ts` | Calls `insertEvent({ type: "agent_started", payload: { task } })` | `base.ts:23–31` ✓ | **PASS** | |
| 4.2 | `emitAgentCompleted` exported from `base.ts` | Accepts `{ inputTokens, outputTokens }`, emits `agent_completed` | `base.ts:33–44` ✓; token counts in payload | **PASS** | |
| 4.3 | `emitAgentFailed` exported from `base.ts` | Accepts `Error`, emits `agent_failed` with error message | `base.ts:46–54` ✓ | **PASS** | |
| 4.4 | All six agent runners wired with all three emitters | Every agent: started → try → completed / catch → failed | researcher ✓ · pm ✓ · designer ✓ · developer ✓ · tester ✓ · documenter ✓ — consistent try/catch pattern in all six | **PASS** | Token defaults to `0` when mock returns `undefined` — acceptable |
| 4.5 | `cycleId?` threaded from `loop.ts` through agents | Non-null `cycle_id` on all events | `loop.ts:211`: `cycleRecord.id` passed to `runAgentWithTimeout` → `runAgent` → each runner's `cycleId?` param | **PASS** | |

---

### Story 5: Phase and Human Input Events

| # | Test Case | Expected | Actual | Status | Notes |
|---|-----------|----------|--------|--------|-------|
| 5.1 | `phase_started` emitted at phase entry | `insertEvent` before agent call | `loop.ts:194` — first statement in `runPhaseStep` ✓ | **PASS** | |
| 5.2 | `phase_completed` emitted after artifact saved | `insertEvent` after `saveArtifact` resolves | `loop.ts:224` — after `saveArtifact` and feed post ✓ | **PASS** | |
| 5.3 | `error` event on phase failure | `insertEvent({ type: "error" })` in catch | `loop.ts:231` — in `runPhaseStep` catch block ✓ | **PASS** | Emitted per-phase (not top-level catch only). Spec OQ-2 assumed top-level only — per-phase is better coverage, no issue raised. |
| 5.4 | `human_input_requested` emitted at 3× retry escalation | `insertEvent` after `sendInboxMessage` | `loop.ts:312` ✓ | **PASS** | ✓ Resolves GH#1 (C2) |
| 5.5 | `human_input_received` emitted in inbox reply handler | `insertEvent` in `POST /api/projects/:id/inbox/:msgId/reply` | `index.ts:149` — after `replyToInboxMessage` and `markInboxRead` ✓ | **PASS** | ✓ Resolves GH#1 (C2) |

---

## Raised Issues

### GH#13: `CLAUDE_CODE_OAUTH_TOKEN` used as Anthropic SDK `apiKey` — silent 401 risk
**Severity:** Medium
**Steps to reproduce:** Start server with only `CLAUDE_CODE_OAUTH_TOKEN` set (no `ANTHROPIC_API_KEY`) → trigger any cycle.
**Expected:** Real Claude API responses.
**Actual:** SDK returns 401 `AuthenticationError` → falls back to deterministic mock. Users see plausible-looking mock output without any indication the API is not being used.
**Fix suggestion:** Log a distinct warning (separate from the generic mock fallback message) when `CLAUDE_CODE_OAUTH_TOKEN` is used as the API key, so operators know to set `ANTHROPIC_API_KEY`. Consider a startup check that prints an actionable error in non-dev environments. Confirmed risk from spec OQ-1.

---

### GH#14: `events` table has 7 columns; spec acceptance criterion says 8
**Severity:** Low
**Steps to reproduce:** Inspect `db.ts:123–133` — DDL defines 7 columns.
**Expected:** Story 2 AC: "events DDL with 8 columns."
**Actual:** 7 columns (`id, project_id, cycle_id, type, agent_role, payload, created_at`). No 8th column specified anywhere in the build notes.
**Fix suggestion:** Either (a) identify and add the missing column (candidates: `source TEXT` for event origin, `sequence INTEGER` for strict per-project ordering) and add an idempotent migration, or (b) update the spec to say "7 columns" if the 8th was dropped intentionally.

---

### GH#15: Temp file cleanup in `saveArtifact` is fire-and-forget
**Severity:** Low
**Steps to reproduce:** Inspect `db.ts:418–420`. `Bun.spawn(["rm", "-f", tmpA])` is not awaited; `Bun.file().exists()` guard is dead code (Promise object is always truthy).
**Expected:** Temp files `/tmp/ouro-diff-a-{id}` and `/tmp/ouro-diff-b-{id}` synchronously deleted in `finally`.
**Actual:** Cleanup is non-blocking; under high artifact-save frequency, temp files accumulate in `/tmp`.
**Fix suggestion:** Use `await Bun.file(tmpA).delete()` (if Bun supports it) or `await import("fs/promises").then(fs => fs.unlink(tmpA).catch(() => {}))`. Remove the broken `exists()` short-circuit.

---

### GH#16: Developer agent timed out — no build plan produced; Commit 8 (`costUsd`) not implemented
**Severity:** High
**Steps to reproduce:** Read `build.md` — contains only `(Developer agent timed out on all steps — see server logs for details.)`.
**Expected:** 7-commit implementation plan; Commit 8 adds `costUsd` to `ClaudeRunResult`, `emitAgentCompleted`, and all six agent runners.
**Actual:** `ClaudeRunResult` has no `costUsd` field. `emitAgentCompleted` payload contains only token counts. No agent passes cost. The C9 Budget Gate depends on this data.
**Fix suggestion:** Investigate and resolve the developer timeout root cause before Cycle 9. Commit 8 is a small, self-contained change and should be prioritised as Cycle 9's first commit.
