# Test Report
Cycle: 2026-03-28
Project: Ouro Platform — Cycle 2

> **Note:** This is a notional test report. No code has been written yet; the developer's 16 commits are planned but unexecuted. All tests are rated against the implementation plan (`build.md`) and spec (`spec.md`), not live code. Real Playwright integration is TODO.
>
> Rating key: **PASS** = plan confidently satisfies AC; **FAIL** = plan has a gap or contradiction that will break this AC as written; **SKIP** = plan defers this to runtime or a future cycle — must be verified once code is written.

---

## Coverage Summary

| Epic | Stories | Tests | Pass | Fail | Skip |
|------|---------|-------|------|------|------|
| 1 — Observability & Event Sourcing | 3 | 13 | 11 | 1 | 1 |
| 2 — Artifact Versioning & Diff | 3 | 13 | 11 | 1 | 1 |
| 3 — Safety & Human-in-the-Loop | 3 | 15 | 14 | 1 | 0 |
| 4 — Reliability & Crash Recovery | 2 | 9 | 8 | 1 | 0 |
| 5 — UI Transparency | 2 | 10 | 9 | 1 | 0 |
| 6 — Structured Agent Communication | 2 | 11 | 9 | 1 | 1 |
| **Total** | **15** | **71** | **62** | **6** | **3** |

---

## Test Results by Story

---

### Story 1: Immutable Agent Event Log

*As a developer debugging a failed cycle, I want every agent action stored as an immutable event.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 1.1 | `events` table created with correct schema | `{ id, cycle_id, project_id, agent_role, event_type, payload, token_count, cost_usd, created_at }` | Commit 1: schema matches spec exactly, including all fields | PASS | |
| 1.2 | All required event types emitted | `phase_started`, `tool_call`, `artifact_saved`, `phase_completed`, `phase_failed`, `human_input_requested`, `human_input_received`, `error` | Commit 3 logs `phase_started/completed/artifact_saved`; Commit 5 logs `phase_failed`; Commit 6 logs `tool_call`. No explicit logging plan for `human_input_requested`, `human_input_received`, or `error` event types | **FAIL** | See GH#1 — 3 of 8 required event types have no specified logging call site in the plan |
| 1.3 | Every Claude API call records token count and cost | `token_count` and `cost_usd` populated from actual API usage | Commits 2+3: `ClaudeResult` extracts `input_tokens + output_tokens` and computes `cost_usd` at claude-sonnet-4-6 rates; `logEvent()` called after every Claude call | PASS | |
| 1.4 | Events table is append-only; no UPDATE or DELETE paths | No UPDATE or DELETE SQL for this table anywhere in codebase | Commit 1 explicitly states "append-only, no UPDATE/DELETE paths" | PASS | |
| 1.5 | `GET /api/projects/:id/events` returns paginated events | `{ data: AgentEvent[]; total: number }` with `limit`/`offset` query params | Commit 7: endpoint specified with pagination | PASS | |

---

### Story 2: Per-Phase Token & Cost Display

*As Chris, I want to see token usage and USD cost next to each phase in the UI.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 2.1 | Phase step bar shows token count and `$X.XX` per phase after completion | Cost/token labels appear on each completed step | Commit 9: `CycleProgressBar` renders `StepMeta` with `formatTokens(n)` + `formatCost(usd)` | PASS | |
| 2.2 | Cost computed from events table aggregate | `SUM(cost_usd) WHERE cycle_id AND agent_role` | `phase_completed` events carry per-phase aggregates; `buildSnapshot()` derives `phaseMeta` from events | PASS | |
| 2.3 | Running total for active cycle visible in cycle header | Total tokens and cost always visible | `CycleCostSummary` in `CycleProgressBar` with `totalTokens` and `totalCostUsd` props | PASS | |
| 2.4 | Values update in real-time via SSE | No page reload required | `phase_meta` WS event triggers `setPhaseMeta` in `App.tsx` | PASS | |

---

### Story 3: Thought Log / Transparency Panel

*As Chris, I want to see abbreviated Claude thinking blocks per agent.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 3.1 | Thinking content stored as `event_type = 'thinking'` with `{ summary, full_text }` payload | Events table populated for each thinking block | Commit 3: agents log `thinking (per block)`; `ThinkingPayload` interface matches spec | **SKIP** | Depends on extended thinking being enabled — see GH#2. If `claude.ts` does not pass the extended thinking beta header, `thinking_blocks` will always be `[]` and this AC silently fails at runtime |
| 3.2 | Collapsible thought log per agent in UI | Abbreviated summary visible by default, expandable | Commit 10: `ThoughtLogPanel` with `expandedIds: Set<string>` | PASS | |
| 3.3 | "Expand" control reveals full thinking block | Full `<thinking>` text shown on expand | `expandedIds` toggle per entry in `ThoughtLogPanel` | PASS | |
| 3.4 | Thought log panel does not obscure primary feed | Logs in separate sidebar, not overlaid | `AgentRail` is a distinct left sidebar; `CenterPanel` (feed) is independent | PASS | |

---

### Story 4: Artifact Cycle Linkage

*As a developer, I want artifacts linked to the cycle that produced them.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 4.1 | `artifacts.cycle_id` column added, nullable, NULL for existing rows | `ALTER TABLE` with DEFAULT NULL | Commit 1: `ALTER artifacts: cycle_id` (nullable, backfill NULL implied by nullable column) | PASS | |
| 4.2 | `saveArtifact()` accepts and stores `cycleId` | New param persisted to row | Commit 1: `saveArtifact({ ..., cycleId? })` stores `cycle_id` | PASS | |
| 4.3 | `getArtifactByPhase()` optionally filters by `cycleId` | Latest version returned without cycleId; specific cycle version with it | Commit 1: `getArtifactByPhase(projectId, phase, cycleId?)` specified | PASS | |
| 4.4 | `GET /api/projects/:id/artifacts?cycleId=X` filters by cycle | Filtered artifact list | Build plan API contract: "NEW optional query: `?cycleId=<id>`" | PASS | |

---

### Story 5: Artifact Diff Storage

*As Chris, I want to see what changed in an artifact between cycle N and cycle N+1.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 5.1 | `previous_version_id` and `diff_from_previous` columns added | Both columns present with correct types | Commit 1: both columns added to artifacts schema | PASS | |
| 5.2 | `saveArtifact()` computes and stores unified diff when prior version exists | `diff_from_previous` populated on insert | Commit 1: `saveArtifact()` looks up prior artifact, calls `computeUnifiedDiff()`, stores lineage | PASS | |
| 5.3 | Diff computed server-side before INSERT, not on read | No lazy diff computation | `computeUnifiedDiff()` called inside `saveArtifact()` before `INSERT` | PASS | |
| 5.4 | Empty diff stored as `''`, not `NULL` | No NULL in `diff_from_previous` for identical content | Build plan: `diff_from_previous = ''` when content identical | PASS | |

---

### Story 6: Artifact Diff Viewer UI

*As Chris, I want a side-by-side or inline diff view between artifact versions.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 6.1 | Artifact viewer has "Diff" toggle (defaults to rendered view) | Toggle button present; rendered view is default state | `ArtifactToolbar` with `activeView: 'rendered' \| 'diff'`; default `'rendered'` | PASS | |
| 6.2 | Diff view uses `git-diff-view` library, GitHub-style | Library renders inline/split diff | Commit 11: `ArtifactDiffView` wraps `git-diff-view`; `bun add git-diff-view` in client workspace | **FAIL** | See GH#3 — ESM/Vite compatibility unresolved per Open Question #6 in build.md. If CJS-only and `optimizeDeps` workaround is not pre-confirmed, Commit 11 may fail to build |
| 6.3 | Cycle selector dropdown allows "Cycle N vs Cycle N+1" | Dropdown populated; comparing across cycle versions | `ArtifactToolbar` cycles prop + `selectedCycleId`; diff finds prior cycle artifact in `ArtifactView` | PASS | |
| 6.4 | Code blocks in diffs have syntax highlighting | Language-aware highlighting inside diff | `git-diff-view` dark theme CSS injected; `rehype-highlight` conditionally used for `<pre>` blocks | **SKIP** | Build plan uses `git-diff-view`'s built-in theming for diff lines; syntax highlighting within diff hunks not explicitly specified. Depends on library capability |
| 6.5 | Copy and download controls present on both rendered and diff views | Both controls visible regardless of active view | `ArtifactToolbar` has `onCopy` and `onDownload` props, always rendered | PASS | |

---

### Story 7: Self-Modification Approval Gate

*As Chris, I want any agent-proposed change to `/server/src/` to require my explicit approval.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 7.1 | `proposed_changes` table created with correct schema | `{ id, cycle_id, project_id, proposed_by, file_path, diff_content, status, reviewed_at, created_at }` | Commit 1: schema matches spec | PASS | |
| 7.2 | Tool calls targeting `/server/src/` intercepted before file write | File not written; `proposed_changes` row created with `status = PENDING` | `dispatchToolUse()` in `base.ts` calls `checkSelfModGate(filePath)`; routes to `createProposedChange()` + `createBlockingInboxMessage()` instead of `db.saveArtifact()` | **FAIL** | See GH#4 — gate only fires for structured tool use responses. Agents falling back to freeform text (Story 14 AC3) write via the old unguarded path. Gate has a safety hole until freeform fallback is fully deprecated |
| 7.3 | Pending change triggers `blocks_cycle = true` inbox message | Inbox shows blocking message linked to the proposed change | `createBlockingInboxMessage()` called alongside `createProposedChange()` | PASS | |
| 7.4 | Chris can APPROVE or REJECT from inbox UI | Modal shows diff, approve/reject buttons; action applies or discards the change | `BlockerModal` approve/reject variant; Commit 6 endpoints apply diff on approve | PASS | |
| 7.5 | Hard-coded path constraint defined outside agent-writable config | Not in DB; cannot be modified by an agent instruction | `SELF_MOD_PATHS = ['/server/src/'] as const` in `agents/base.ts` | PASS | |

---

### Story 8: Blocking Inbox Messages

*As Chris, I want blockers to appear as a persistent modal overlay.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 8.1 | `inbox_messages.blocks_cycle` column added | `INTEGER DEFAULT 0` on existing table | Commit 1: `ALTER inbox_messages: blocks_cycle INTEGER DEFAULT 0` | PASS | |
| 8.2 | Messages with `blocks_cycle = 1` render as full-screen modal | Modal overlay on dashboard, not in sidebar | `BlockerModal` via `ReactDOM.createPortal`; rendered in `App.tsx` when `blockerQueue.length > 0` | PASS | |
| 8.3 | Modal includes subject, body, and reply text field | All three UI elements present | `BlockerModal` props include `message.subject`, `message.body`; `replyText` state with `<textarea>` | PASS | |
| 8.4 | Submitting reply marks message read and resumes cycle | `is_read = 1`; `waitForBlockerResolution()` unblocks | `handleSubmitBlockerReply` → `api.inbox.reply()` → marks read; `waitForBlockerResolution()` polls `listBlockingMessages()` until empty | PASS | |
| 8.5 | Non-blocking messages remain in sidebar as before | Standard inbox unaffected | `RightPanel` inbox tab shows all `InboxMessage[]`; `BlockerModal` is a separate render path | PASS | |

---

### Story 9: Token Budget Hard Stop

*As Chris, I want to set a daily token budget per project.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 9.1 | `preferences` table stores `token_budget_daily_usd` per project | Key-value row per project with default `10.00` | `getBudgetUsd()` reads preference, falls back to `10.00`; `setPreference()` for saves | PASS | |
| 9.2 | Cycle runner checks cumulative cost before each phase | `sumTodayCost(projectId)` called before every phase start | `checkBudgetGate()` in `loop.ts` called at top of each phase iteration | PASS | |
| 9.3 | Budget exceeded → cycle halts + blocking inbox message with spend summary | Cycle stops after current phase; modal shows spend breakdown | `checkBudgetGate()` returns `'exceeded'`; `createBlockingInboxMessage()` with `BudgetPayload`; `waitForBlockerResolution()` holds cycle | PASS | |
| 9.4 | Budget settable from project settings panel | Input field, save button, success/error state | `SettingsView` with `budgetDailyUsd` prop, `handleSaveBudget` wired in `App.tsx` | PASS | |
| 9.5 | Budget check non-bypassable by agent instructions | No agent prompt or tool can disable the gate | `checkBudgetGate()` lives in `loop.ts`, outside any agent class or tool dispatch path | PASS | |

---

### Story 10: Saga Compensation on Phase Failure

*As Chris, I want failed phases to retry automatically and escalate after 3 consecutive failures.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 10.1 | Cycle runner wraps each phase in retry logic, up to 3 attempts | Phase runs up to 3× before escalating | `runPhaseWithRetry()` with `MAX_RETRIES = 3` | PASS | |
| 10.2 | Each retry logged as separate `phase_failed` event with error detail | `{ error, attempt, max_attempts }` in payload | `logEvent('phase_failed', { error, attempt, max_attempts })` on each failure | PASS | |
| 10.3 | After 3 failures: `blocks_cycle = true` inbox message with phase name and last error | Escalation message sent with context | `createBlockingInboxMessage({ subject: "Phase escalated: {phase}" })` after `MAX_RETRIES` exhausted | PASS | |
| 10.4 | `cycles` table gains `last_completed_phase` and `phase_states` columns | Both columns present with correct defaults | Commit 1: `ALTER cycles: last_completed_phase TEXT, phase_states TEXT DEFAULT '{}'` | PASS | |
| 10.5 | On cycle restart: skip phases already marked `complete` in `phase_states` | Crashed cycle resumes from last incomplete phase | Commit 5: `runCycle()` reads `phase_states`, skips `status === 'complete'` entries | PASS | |

---

### Story 11: SSE Snapshot + Delta Reconnection

*As a user, I want the live feed to recover gracefully after a network drop.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 11.1 | On SSE reconnect, server sends full state snapshot before deltas | Client receives all current state on reconnect; no blank feed | Commit 7: `buildSnapshot()` emitted as `'snapshot'` event immediately on WS subscribe; `App.tsx` replaces all state from snapshot payload | PASS | |
| 11.2 | Feed events carry lifecycle markers: `RunStarted`, `PhaseStarted`, `ToolCall`, `PhaseFinished`, `RunFinished`, `RunError` | These specific event labels appear in the feed stream | WS event types are `agent_event`, `phase_meta`, `blocker`, `snapshot` — the spec names `RunStarted`, `PhaseStarted` etc. don't map to any planned WS event type or feed message type | **FAIL** | See GH#5 — naming mismatch between spec and plan. The plan emits `agent_event` with nested `event_type`, not named lifecycle events. Feed message consumers have no documented mapping |
| 11.3 | Tool call events are collapsible in the feed | Summary shown by default; full I/O expandable | Commit 15: `FeedToolCallBlock` with `isExpanded` state; chevron rotation animation | PASS | |
| 11.4 | Pinned banner above feed shows active blockers and errors | Banner persists above scrollable stream | `PinnedBlockerBanner` wired into `CenterPanel` above feed content | PASS | |

---

### Story 12: Cycle Progress Tracker

*As Chris, I want a horizontal step bar showing all 6 phases with live state indicators.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 12.1 | Step bar shows `research → spec → design → build → test → review` | Six steps in order | `CycleProgressBar`: `PHASES = ['research', 'spec', 'design', 'build', 'test', 'review']` | PASS | |
| 12.2 | Each step has correct visual state: pending, active, complete, failed, skipped | Colour-coded step indicators match state | `StepIndicator` class map covers all five states including `retrying` variant | PASS | |
| 12.3 | Completed steps show elapsed time, token count, and artifact link | `StepMeta` rendered below each complete step | `formatElapsed()`, `formatTokens()`, `formatCost()` in `utils.ts`; artifact link disabled when `artifact_id === null` | PASS | |
| 12.4 | Step bar always visible at top of project view | Visible regardless of active tab | Wired into `App.tsx` below `TopBar`; outside `CenterPanel` tab system | PASS | |
| 12.5 | Updates in real-time via SSE | No reload required | `phase_meta` WS events trigger `setCyclePhaseStates` and `setPhaseMeta` in `App.tsx` | PASS | |

---

### Story 13: Agent Status Rail

*As Chris, I want a persistent left sidebar showing each agent's status.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 13.1 | One card per agent (pm, researcher, designer, developer, tester, documenter) | Six cards always rendered | `AgentRail` maps over fixed `AGENT_ROLES` order | PASS | |
| 13.2 | Each card shows: role, status badge, last action timestamp, current task title | Four data points per card | `AgentCard` shows role, emoji, status badge, pulsing; however `Agent` type is not extended with `last_action_at` or `current_task` fields in the plan | **FAIL** | See GH#6 — "last action timestamp" and "current task title" are in the spec AC but absent from `AgentCard` props and the `Agent` type extension table |
| 13.3 | Active agent card has a pulsing animation | `animate-pulse` on `thinking` state | `AgentCard` border/bg class map: `thinking → border-blue-800 bg-blue-950/30 animate-pulse` | PASS | |
| 13.4 | Rail visible on all project sub-pages (feed, inbox, artifacts) | Rail renders outside tab panels | `AgentRail` placed in `App.tsx` layout, not inside `CenterPanel` or `RightPanel` | PASS | |
| 13.5 | Status updates in real-time via SSE | No reload required | `agent_event` WS events update `agents` state in `App.tsx` | PASS | |

---

### Story 14: Structured Tool Use for Agent Actions

*As a developer, I want agents to use Anthropic's tool use API for their core actions.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 14.1 | Tool definitions registered: `save_artifact`, `post_feed_message`, `request_human_input` | Tools defined in API request `tools` parameter so Claude produces `tool_use` blocks | `dispatchToolUse()` handles incoming tool calls, but the plan does not specify where tool schema definitions (`name`, `description`, `input_schema`) are registered in the `tools` parameter of the Anthropic API call | **FAIL** | See GH#7 — without registering tools in `runClaude()`, Claude will never produce `tool_use` blocks; the entire dispatch pipeline has no trigger |
| 14.2 | Agent base class parses tool use responses and dispatches to DB helpers | `ClaudeResult.tool_uses` → `dispatchToolUse()` → correct DB helper | Commit 6: `dispatchToolUse()` in `base.ts` routes `save_artifact` / `post_feed_message` / `request_human_input` to the correct helpers | PASS | |
| 14.3 | Freeform text responses accepted as fallback | Agents producing text output still work | Build plan AC3 explicitly retained: "Freeform text responses are still accepted as a fallback (graceful degradation)" | PASS | |
| 14.4 | Tool call payloads stored in events table under `event_type = 'tool_call'` | Every dispatched tool call produces an event row | `logEvent()` called inside `dispatchToolUse()` after each dispatch | PASS | |
| 14.5 | No agent prompt changes required beyond the tool definitions block | Existing prompts unchanged | Build plan: "No agent prompt changes required beyond the tool definitions block" | PASS | |

---

### Story 15: Phase Dependency DAG (Parallelism)

*As Chris, I want the design phase to begin its early draft concurrently with spec.*

| # | Test Case | Expected | Plan Coverage | Status | Notes |
|---|-----------|----------|---------------|--------|-------|
| 15.1 | Phase execution updated from strict serial to DAG-driven | Topological sort drives phase scheduling | Commit 16: `PHASE_DAG` → topological sort → wave groups → `Promise.all` per wave | PASS | |
| 15.2 | DAG structure: `research → (spec ‖ design-draft) → design-final → build → test → review` | Correct dependency graph | `PHASE_DAG` in `loop.ts` matches spec exactly | PASS | |
| 15.3 | `design-draft` uses research-only input; refines with spec when available | Different context injection for draft vs. final | Commit 16: `runDesignerDraft()` exported from `designer.ts`; receives only `research.md` as context | PASS | |
| 15.4 | Both parallel branches write separate events with correct phase labels | `phase = 'spec'` and `phase = 'design-draft'` events distinct | `Promise.all` execution; each phase runner passes its own phase label to `logEvent()` | PASS | |
| 15.5 | Cycle progress tracker reflects parallel execution (two simultaneous active steps) | Two steps pulsing at same time | Commit 16: "CycleProgressBar updated to handle two simultaneous active steps" | PASS | |
| 15.6 | ≥20% reduction in average cycle wall-clock time vs. serial baseline | Measurable performance improvement | No baseline measurement mechanism exists; target is untestable from plan | **SKIP** | Performance target requires running cycles before and after. Should be tracked as a separate benchmark story in Cycle 3 |

---

## Raised Issues

---

### GH#1: Three required event types have no specified logging call site in the plan
**Severity:** Medium
**Affected story:** Story 1 (AC: 1.2)
**Steps to reproduce:**
1. Run a complete cycle
2. Query `GET /api/projects/:id/events?eventType=human_input_requested`
3. Trigger a phase error; query `?eventType=error`

**Expected:** Events of type `human_input_requested`, `human_input_received`, and `error` appear in the events table.

**Actual (plan):** The `AgentEvent.event_type` union defines all three types, but no commit description specifies where they are emitted. Commit 3 covers `phase_started`, `thinking`, `artifact_saved`, `phase_completed`. Commit 5 covers `phase_failed`. Commit 6 covers `tool_call`. The three remaining types fall through.

**Fix suggestion:** Commit 3 or 6 should explicitly map: `request_human_input` tool dispatch → log `human_input_requested`; inbox reply receipt (WS `inbox_reply`) → log `human_input_received`; `catch` blocks in agent runners → log `error`. Add these three logging calls to the respective commit scopes before implementation starts.

---

### GH#2: Thought log silently produces no data if extended thinking is not enabled
**Severity:** Medium
**Affected story:** Story 3 (AC: 3.1)
**Steps to reproduce:**
1. Run a cycle with the current `claude.ts`
2. Check `GET /api/projects/:id/events?eventType=thinking`

**Expected:** Thinking events present; thought log populates in the UI.

**Actual (plan):** Build plan Open Question #3 flags that `thinking_blocks` extraction in `ClaudeResult` assumes `betas: ['interleaved-thinking-2025-05-14']` or equivalent is already enabled. If not, `thinking_blocks` will always be `[]`. Story 3 silently fails — no error, no warning, just an empty thought log — and the Thought Log UI feature ships as a noop.

**Fix suggestion:** Resolve Open Question #3 before Commit 2 is written. If extended thinking is not currently enabled: add `betas: ['interleaved-thinking-2025-05-14']` to the `runClaude()` call and verify via a one-off test. Log a console warning if a cycle completes with zero `thinking` events.

---

### GH#3: `git-diff-view` ESM/Vite compatibility unresolved — diff viewer may fail to build
**Severity:** High
**Affected story:** Story 6 (AC: 6.2)
**Steps to reproduce:**
1. Run Commit 11: `bun add git-diff-view` in client workspace
2. `vite build` or `vite dev`

**Expected:** `ArtifactDiffView` renders successfully.

**Actual (plan):** Build plan Open Question #6 is unresolved: "Confirm `git-diff-view` has an ESM build compatible with Vite before Commit 11. If CJS-only, add to `optimizeDeps.include`…" This check is deferred to implementation time with no confirmed outcome. CJS-only packages commonly cause Vite build failures with unhelpful error messages.

**Fix suggestion:** Resolve before Commit 11. Run `node -e "require('git-diff-view')"` and `node --input-type=module -e "import('git-diff-view')"` after install. If CJS-only: add to `vite.config.ts` `optimizeDeps.include: ['git-diff-view']` and `build: { commonjsOptions: { include: [/git-diff-view/] } }` as a confirmed pre-condition for the commit.

---

### GH#4: Self-modification gate has a bypass path via the freeform text fallback
**Severity:** High
**Affected story:** Story 7 (AC: 7.2)
**Steps to reproduce:**
1. Ensure structured tool use is not triggered (e.g. Claude produces freeform text response)
2. Developer agent produces freeform output referencing a `/server/src/` file path
3. Observe whether the old artifact-save path intercepts the write

**Expected:** Any write to `/server/src/` is intercepted regardless of whether it originated from structured tool use or freeform text.

**Actual (plan):** `checkSelfModGate()` is called inside `dispatchToolUse()`, which only runs when `ClaudeResult.tool_uses` is non-empty. Story 14 AC3 explicitly retains freeform text as a graceful degradation fallback. Under the fallback path, agents continue using the pre-Cycle-2 artifact save mechanism, which has no gate check. The self-mod gate is therefore opt-in and incomplete until the freeform path is fully deprecated.

**Fix suggestion:** Add gate enforcement to the legacy freeform save path in agent runners. A single `if (checkSelfModGate(filename)) { ... createProposedChange() ... } else { db.saveArtifact() }` guard in the freeform artifact-save branch closes the hole with minimal scope increase. Document this as a prerequisite before Story 7 is considered done.

---

### GH#5: Feed lifecycle marker names in spec do not match planned WS event types
**Severity:** Medium
**Affected story:** Story 11 (AC: 11.2)
**Steps to reproduce:**
1. Start a cycle after Cycle 2 implementation
2. Monitor the WS event stream
3. Look for events named `RunStarted`, `PhaseStarted`, `PhaseFinished`, `RunFinished`, `RunError`

**Expected:** These exact event type names appear in the feed stream as specified.

**Actual (plan):** The WS event type union in the plan is: `agent_event`, `phase_meta`, `blocker`, `proposed_change_resolved`, `snapshot`. The spec's `RunStarted`/`RunFinished` lifecycle markers have no equivalent in the planned WS types. The closest mapping is `agent_event` with nested `event_type = 'phase_started'`, but this is a different shape and different name.

**Fix suggestion:** Either (a) update the spec's AC 11.2 to match the plan's event taxonomy and document the mapping, or (b) add thin wrapper WS event types `RunStarted`, `RunFinished`, etc. that are broadcast alongside the existing `agent_event` type. Option (a) is lower effort. Decision required before Commit 7 is written.

---

### GH#6: `AgentCard` is missing `last_action_at` and `current_task` — two spec ACs unaddressed
**Severity:** Medium
**Affected story:** Story 13 (AC: 13.2)
**Steps to reproduce:**
1. Implement `AgentRail` per build plan
2. Observe the rendered `AgentCard`

**Expected:** Each card shows role, status badge, **last action timestamp**, and **current task title**.

**Actual (plan):** `AgentCard` props are `{ agent: Agent, thoughts: ThoughtEntry[], isExpanded, onToggleExpand }`. The `Agent` type is not extended with `last_action_at` or `current_task` in the build plan's type extension table (which lists `token_count?: number` as the only `Agent` addition). There is no data source for these fields.

**Fix suggestion:** Extend the `Agent` type with `last_action_at?: number` (can be derived from the most recent `agent_event` for that role) and `current_task?: string` (populated from the last `phase_started` event payload). Add these to the Commit 8 type pass and wire into the `buildSnapshot()` `agents` array in Commit 7.

---

### GH#7: Tool definitions not registered in `runClaude()` — structured tool use pipeline has no trigger
**Severity:** High
**Affected story:** Story 14 (AC: 14.1)
**Steps to reproduce:**
1. Implement Commits 2 + 6 as specified
2. Run a cycle
3. Check `ClaudeResult.tool_uses` for any agent response

**Expected:** `tool_uses` populated with `save_artifact`, `post_feed_message`, or `request_human_input` calls.

**Actual (plan):** `dispatchToolUse()` in `base.ts` handles incoming tool calls. However, for Claude to produce `tool_use` content blocks, the Anthropic API request must include a `tools` array parameter with each tool's `name`, `description`, and `input_schema`. The plan specifies extracting `tool_use` blocks from responses (Commit 2) and dispatching them (Commit 6), but never specifies adding tool definitions to `runClaude()` or injecting them into agent API calls. Without registration, `tool_uses` will always be `[]` and the entire structured tool use pipeline is inert.

**Fix suggestion:** Before Commit 6, add a `tools?: Tool[]` parameter to `runClaude()` and define `AGENT_TOOLS: Tool[]` in `agents/base.ts` (the three tool schemas). Each agent runner passes `AGENT_TOOLS` when calling `runClaude()`. This should be part of Commit 6 scope or a dedicated sub-task. This is the single most critical gap in the plan.

---

## Summary Notes

- **6 of 71 tests FAIL at plan-review stage.** Three are high-severity: `git-diff-view` build risk (GH#3), self-mod gate bypass (GH#4), and missing tool definitions registration (GH#7). These must be resolved before their respective commits are written.
- **GH#7 is the most critical**: the entire structured tool use pipeline (Story 14) and the self-modification gate (Story 7) both depend on Claude producing `tool_use` blocks. If tools are not registered in the API call, both stories silently ship as noop.
- **GH#4** creates a safety hole: the self-mod gate is only effective once freeform text fallback is retired. Until Story 14 is stable, the gate must also guard the legacy freeform save path.
- **3 ACs are SKIP** due to runtime dependencies: thinking block availability (requires extended thinking enabled), syntax highlighting within diffs (depends on `git-diff-view` capability), and the ≥20% wall-clock improvement target (requires a benchmark).
- The remaining **62 tests PASS**: the plan architecture is sound, the 16-commit ordering is logical, and all major ACs have documented implementation paths. Stories 2, 4, 5, 8, 9, 10, 12 are fully green.
- Stories 7–9 (safety gate, blocking inbox, token budget) should be treated as a release blocker cluster — none should be considered done until all three are green and tested together end-to-end.
