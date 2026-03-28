# Ouro Platform — Cycle 8 Spec
**PM:** Ouro PM Agent | **Date:** 2026-03-28 | **Cycle:** 8

---

## Context

Eight cycles. Zero committed code. The root cause has been identified and confirmed across Cycles 4–7: `server/src/claude.ts` spawns `claude --print` as a subprocess. A subprocess cannot accept `tools`, return `usage` data, or expose `thinking` blocks — making token budget tracking, structured tool use, and thought logs architecturally impossible until the migration lands.

Cycle 8 expands scope beyond the minimal Cycle 5 spec. The build plan (Cycle 5 plan, still valid) specifies a server-only, 7-commit implementation path that ships four epics in a single session: SDK migration, event sourcing, artifact versioning, and agent lifecycle telemetry. No UI changes. No new API endpoints. Pure backend, fully defined, no design work required.

If we don't ship this cycle, the pattern continues indefinitely.

---

## User Stories

### Story 1 — Migrate `claude.ts` to Anthropic SDK [CRITICAL — blocks everything]

**As a** developer on Ouro,
**I want** `runClaude()` to call the Anthropic API via `@anthropic-ai/sdk` directly,
**So that** tool use, token tracking, extended thinking, and real streaming are available to all agents.

**Acceptance Criteria:**
- [ ] `@anthropic-ai/sdk` added to `server/package.json`; `bun install` succeeds
- [ ] `runClaude()` calls `client.messages.create()` — no `Bun.spawn('claude', ...)` remaining
- [ ] `ClaudeRunResult` exposes `inputTokens: number` and `outputTokens: number` from `usage`
- [ ] `ClaudeRunOptions` accepts optional `tools?: Anthropic.Tool[]` — forwarded to the API call
- [ ] `ClaudeRunOptions` accepts optional `thinkingBudget?: number` — if set, adds `{ type: 'enabled', budget_tokens: N }` to the request and sets `betas: ['interleaved-thinking-2025-05-14']`
- [ ] Thinking blocks extracted from response; returned as `thinkingContent?: string` in result
- [ ] `timeoutMs` behaviour preserved: rejects with an error whose `.timeout` property is `true`
- [ ] Mock fallback preserved: if no API key, return `{ content: mockOutput(prompt), real: false, inputTokens: 0, outputTokens: 0 }`
- [ ] Auth: try `CLAUDE_CODE_OAUTH_TOKEN` first, fall back to `ANTHROPIC_API_KEY`; if neither present, use mock
- [ ] All existing agent callers compile without changes — `content` and `real` remain in the result interface
- [ ] `bun run typecheck` passes with zero new errors

**Resolves:** GH#12 (C4). Unblocks GH#7 (C2) and GH#2 (C2).
**Commits:** 1 (deps) + 2 (rewrite)

---

### Story 2 — Event Sourcing Infrastructure

**As a** developer on Ouro,
**I want** a typed `events` table with `insertEvent` and `getEvents` helpers,
**So that** every agent action and phase transition is captured in an append-only audit log.

**Acceptance Criteria:**
- [ ] `CREATE TABLE IF NOT EXISTS events` DDL added to `db.ts` with columns: `id TEXT PRIMARY KEY`, `project_id TEXT NOT NULL`, `cycle_id TEXT`, `phase TEXT`, `agent_role TEXT`, `event_type TEXT NOT NULL`, `payload TEXT NOT NULL DEFAULT '{}'`, `created_at INTEGER NOT NULL`
- [ ] `EventType` union exported: `'agent_started' | 'agent_completed' | 'agent_failed' | 'phase_started' | 'phase_completed' | 'human_input_requested' | 'human_input_received' | 'error'`
- [ ] `insertEvent(params: InsertEventParams): Event` — generates `id` via `crypto.randomUUID()`, `created_at` via `Date.now()`, serialises `payload` with `JSON.stringify`, returns constructed `Event` without a re-query
- [ ] `getEvents(projectId: string, cycleId?: string): Event[]` — when `cycleId` provided, scopes query; otherwise returns full project history; ordered `ASC` by `created_at`
- [ ] `'events'` added to the `--reset` table list in `db.ts`
- [ ] `bun run typecheck` passes

**Commits:** 3

---

### Story 3 — Artifact Versioning

**As a** developer on Ouro,
**I want** each artifact saved with version lineage and a computed diff from its predecessor,
**So that** the full evolution of every generated file is traceable.

**Acceptance Criteria:**
- [ ] Idempotent migrations added to `db.ts`: `ALTER TABLE artifacts ADD COLUMN cycle_id TEXT`, `previous_version_id TEXT`, `diff_from_previous TEXT` (each wrapped in `try { … } catch {}`)
- [ ] `Artifact` interface updated with three new nullable fields: `cycle_id: string | null`, `previous_version_id: string | null`, `diff_from_previous: string | null`
- [ ] `saveArtifact` accepts optional `cycleId?: string` as a fifth param
- [ ] When `version > 1`, `saveArtifact` fetches the prior row and sets `previous_version_id`
- [ ] Unified diff computed via `Bun.spawn(['diff', '-u', tmpA, tmpB])` using temp files; on any diff error, logs a warning and sets `diff_from_previous = null` (best-effort, never throws)
- [ ] `getArtifactHistory(projectId: string, phase: string, filename: string): Artifact[]` added — queries `WHERE project_id=? AND phase=? AND filename=? ORDER BY version DESC`
- [ ] All existing `saveArtifact` call sites in `loop.ts` updated to pass `cycleRecord.id` as fifth param
- [ ] `bun run typecheck` passes

**Commits:** 4

---

### Story 4 — Agent Lifecycle Events

**As a** developer on Ouro,
**I want** each agent to emit `agent_started`, `agent_completed`, and `agent_failed` events,
**So that** the event log captures real-time agent activity and per-agent token spend.

**Acceptance Criteria:**
- [ ] `emitAgentStarted`, `emitAgentCompleted`, `emitAgentFailed` exported from `agents/base.ts`
- [ ] `emitAgentStarted` fires as the **first statement** inside each `runXxx()` function, before any prompt building; payload includes `task` truncated to 200 chars
- [ ] `emitAgentCompleted` fires immediately before `return result`; payload includes `inputTokens` and `outputTokens` from the `ClaudeRunResult`
- [ ] `emitAgentFailed` fires inside `catch` **before** re-throw; payload includes `error` message truncated to 500 chars
- [ ] All six agent runners (`pm.ts`, `researcher.ts`, `designer.ts`, `developer.ts`, `tester.ts`, `documenter.ts`) updated
- [ ] Each `runXxx()` accepts optional `cycleId?: string` as a new final param, threaded from `loop.ts`
- [ ] `bun run typecheck` passes

**Commits:** 5

---

### Story 5 — Phase and Human Input Events

**As a** developer on Ouro,
**I want** phase transitions and human input requests/receipts recorded in the event log,
**So that** the cycle timeline is fully reconstructible from the `events` table alone.

**Acceptance Criteria:**
- [ ] `phase_started` emitted at the very top of `runPhaseStep` in `loop.ts`, before `setProjectPhase`; timestamp reflects true phase wall-clock start
- [ ] `phase_completed` emitted in the `try` block after `postFeedMessage` succeeds; **not** emitted on error
- [ ] `human_input_requested` emitted in `loop.ts` at the `retryCount >= 3` escalation block, immediately after `sendInboxMessage`; payload includes the inbox message `id` for cross-linking
- [ ] `human_input_received` emitted in `index.ts` inside `POST /api/projects/:id/inbox/:msgId/reply` after `replyToInboxMessage` succeeds; `cycle_id`, `phase`, `agent_role` all `null`
- [ ] `insertEvent` added to the existing `db.js` import in `index.ts`
- [ ] `cycleRecord.id` passed to `runAgent()` calls in `loop.ts` (enabling Story 4's `cycleId` param)
- [ ] `bun run typecheck` passes

**Resolves:** GH#1 (C2) — `human_input_requested`, `human_input_received` now have call sites.
**Commits:** 6 (`loop.ts`) + 7 (`index.ts`)

---

## Deferred — Cycle 9+

These stories depend on the infrastructure above. Do not implement in Cycle 8.

| Story | Depends On | Epic |
|---|---|---|
| C9-1: Token Budget Gate (warn + halt) | Stories 1, 4 | Safety Gates |
| C9-2: Thought Log (extended thinking UI) | Story 1 | UI Transparency |
| C9-3: Structured Tool Use / AGENT_TOOLS | Story 1 | Agent Capability |
| C9-4: Self-Mod Gate Guard (freeform fallback) | Story 3 | Safety Gates |
| C9-5: Blocking Inbox / BlockerModal UI | Story 5 | Safety Gates |
| C9-6: Cycle Progress Bar | Story 5 | UI Transparency |
| C9-7: Agent Rail (last_action_at, current_task) | Story 4 | UI Transparency |
| C9-8: Artifact Diff Viewer | Story 3 | UI Transparency |

---

## Phase Summary

Cycle 8 scopes to five stories covering a clean server-only implementation: SDK migration, event sourcing table, artifact versioning columns, agent lifecycle event emitters, and phase/human-input event emitters. This is the 7-commit Cycle 5 build plan, unchanged. No UI work. No new HTTP endpoints. No design phase required — the designer should pass this cycle. The developer can begin immediately on Story 1 and work sequentially through Story 5. If all five stories land as committed code, Cycle 9 begins safety gates and UI transparency with a working telemetry foundation underneath them.

---

## Open Questions

1. **`CLAUDE_CODE_OAUTH_TOKEN` as SDK `apiKey`:** The OAuth token may be rejected by the SDK with a 401. Assumption: try it; if the SDK rejects it, activate mock fallback rather than crashing the cycle. _Action: confirm in Story 1's implementation — if it fails, add a console warning to distinguish "no key" from "bad key"._

2. **`error` EventType call site (GH#1 C2):** `EventType` includes `'error'` but the 7-commit plan has no explicit emit for it. Should it fire from each agent's `catch` block (duplicate of `agent_failed`?) or from a centralised `loop.ts` handler only? _Assumption if no reply: emit it only from the `loop.ts` top-level catch, not from individual agents._

3. **Token accumulation per cycle:** `inputTokens`/`outputTokens` are available after Story 1. Should Story 4 also write cumulative totals to the `cycles` table row, or leave that entirely to the budget gate story (C9-1)? _Assumption: defer to C9-1 — avoid writing schema that might change._

4. **WAL mode:** Confirmed already present at `db.ts:9`. No action required. But: if the tester confirms WAL is absent, add `PRAGMA journal_mode=WAL` immediately after `new Database(...)` as a zero-risk single-line fix before Story 2.

---

## Next Phase

No UI changes in Cycle 8 — Designer should skip this cycle and the Developer should proceed directly to Story 1 using the Cycle 5 build plan's Task-by-Task implementation notes.
