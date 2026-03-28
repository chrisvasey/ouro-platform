# Spec: Ouro Platform — Cycle 3

*Prepared by: PM agent | Date: 2026-03-28*

> **Carry-forward note:** Cycle 2's 15 stories were never implemented. This Cycle 3 spec carries them forward with targeted corrections for the 7 plan-review failures (GH#1–GH#7) and updates to three invalid technical assumptions identified by Cycle 3 research. Stories not affected by those corrections are reproduced verbatim. All open questions from the Cycle 2 build plan are now closed.

---

## Closed Questions (from Cycle 2 build.md)

| # | Question | Resolution |
|---|----------|-----------|
| 1 | `diff` package for `computeUnifiedDiff()` | **Use `diff` npm package** — `diff.createPatch(filename, oldStr, newStr)`. Run `bun add diff` in server workspace. |
| 2 | `applyUnifiedDiff` in Commit 6 | **Store full replacement content** in `proposed_changes.diff_content` (not a patch). Apply by writing the full content directly. Simplest path for MVP. |
| 3 | Thinking blocks in `runClaude()` | **Adaptive thinking confirmed** — do NOT set `betas: ['interleaved-thinking-2025-05-14']` (deprecated, ignored). Pass `thinking: { type: 'enabled', budget_tokens: 8000 }` in request body. `thinking`-type content blocks will be present in response. |
| 4 | `design-draft` / `design-final` split | **No new prompt files needed** — abbreviated context injection in `loop.ts`. `design-draft` receives only research artifact; `design-final` receives spec + draft. |
| 5 | Inbox reply → cycle unblock coupling | **Acceptable for MVP** — implicit coupling via `is_read = 1` query. Flag for Cycle 4 hardening (explicit resume signal). |
| 6 | `git-diff-view` Vite compatibility | **Resolved by library switch** — replace with `react-diff-view`. Import from `react-diff-view/esm` for confirmed Vite/ESM compatibility. No Vite config changes needed. |

---

## User Stories

### Epic 1 — Observability & Event Sourcing

**Story 1: Immutable Agent Event Log**

*As a developer debugging a failed cycle, I want every agent action stored as an immutable event, so that I can reconstruct exactly what happened, in what order, and at what cost.*

Acceptance criteria:
- [ ] `events` table created: `{ id, cycle_id, project_id, agent_role, event_type, payload (JSON), token_count, cost_usd, created_at }`
- [ ] Event types emitted: `phase_started`, `tool_call`, `artifact_saved`, `phase_completed`, `phase_failed`, `human_input_requested`, `human_input_received`, `error`
- [ ] **Each of `human_input_requested`, `human_input_received`, and `error` has an explicit `logEvent()` call site in the codebase** — not just defined in the type union (fixes GH#1)
- [ ] Every Claude API call records actual `token_count` and computed `cost_usd` to the events table
- [ ] Events are append-only; no UPDATE or DELETE paths exist for this table
- [ ] `GET /api/projects/:id/events` endpoint returns paginated events for a project

---

**Story 2: Per-Phase Token & Cost Display**

*As Chris, I want to see token usage and USD cost next to each phase in the UI, so that I can understand the cost/value of each cycle and avoid billing surprises.*

Acceptance criteria:
- [ ] Phase step bar shows token count and `$X.XX` cost label per phase after completion
- [ ] Cost is computed from events table aggregate: `SUM(cost_usd) WHERE cycle_id AND agent_role`
- [ ] Running total for the active cycle visible in the cycle header
- [ ] Values update in real-time via SSE/WS (no page reload required)
- [ ] Token cost display uses progressive colour ramp: `<50% → text-gray-400`, `50–79% → text-amber-400`, `80–99% → text-orange-500 font-medium`, `≥100% → text-red-500 font-bold`

---

**Story 3: Thought Log / Transparency Panel**

*As Chris, I want to see Claude's summarised reasoning per agent, so that I understand why an agent made a decision without having to read full artifacts.*

> **Updated from Cycle 2:** Adaptive thinking is now confirmed. The `interleaved-thinking-2025-05-14` beta header is deprecated and must not be used. Thinking blocks contain model-summarised reasoning, not raw internal monologue. UI copy updated accordingly. (Resolves GH#2.)

Acceptance criteria:
- [ ] `runClaude()` passes `thinking: { type: 'enabled', budget_tokens: 8000 }` in the API request body — **no beta header**
- [ ] `ClaudeResult.thinking_blocks` is populated from `type='thinking'` content blocks in the API response
- [ ] Thinking content stored in `events` table as `event_type = 'thinking'` with payload `{ summary: string, full_text: string }`
- [ ] Panel label reads **"Claude's Reasoning"** (not "Thought Log") with tooltip: "Summarised by the model — not raw internal thoughts."
- [ ] Collapsible thought log per agent in the UI, showing abbreviated summary by default
- [ ] "Expand" control reveals full thinking block text
- [ ] Thought log panel does not obscure the primary feed
- [ ] When `tool_choice` forces a specific tool (see Story 14), extended thinking is disabled for that call — do not pass `thinking` parameter in that case

---

### Epic 2 — Artifact Versioning & Diff

**Story 4: Artifact Cycle Linkage**

*As a developer, I want artifacts linked to the cycle that produced them, so that I can query "what did the PM produce in cycle 3" and compare it to cycle 2.*

Acceptance criteria:
- [ ] `artifacts` table gains `cycle_id TEXT` column (nullable, existing rows backfilled as NULL)
- [ ] `saveArtifact()` accepts and stores `cycleId`
- [ ] `getArtifactByPhase()` optionally accepts `cycleId` to fetch a specific cycle's version
- [ ] `GET /api/projects/:id/artifacts?cycleId=X` filters by cycle

---

**Story 5: Artifact Diff Storage**

*As Chris, I want to see what changed in an artifact between cycle N and cycle N+1, so that I can judge whether Ouro is improving.*

Acceptance criteria:
- [ ] `artifacts` table gains `previous_version_id TEXT` and `diff_from_previous TEXT` (unified diff string)
- [ ] On each `saveArtifact()` call, if a prior version exists: compute unified diff using `diff.createPatch(filename, oldContent, newContent)` from the `diff` npm package and store it
- [ ] `diff` package installed in server workspace: `bun add diff`
- [ ] Diff computed server-side before INSERT, not on read
- [ ] Empty diff (no change) stored as empty string `''`, not NULL

---

**Story 6: Artifact Diff Viewer UI**

*As Chris, I want a side-by-side or inline diff view between artifact versions, so that I can quickly scan what the agents changed.*

> **Updated from Cycle 2:** `git-diff-view` ESM/Vite compatibility was unconfirmed (GH#3). Replaced with `react-diff-view`, which has confirmed ESM support via `react-diff-view/esm` subpath from v3.1.0+. (Resolves GH#3.)

Acceptance criteria:
- [ ] Artifact viewer panel has a "Diff" toggle button (defaults to rendered view)
- [ ] Diff view uses **`react-diff-view`** library (not `git-diff-view`) — installed as `bun add react-diff-view` in client workspace
- [ ] Import from `react-diff-view/esm` for Vite/ESM compatibility — no Vite config changes required
- [ ] Input: unified diff string from `artifacts.diff_from_previous` (produced by `diff.createPatch()`)
- [ ] Cycle selector dropdown allows choosing "Cycle N vs Cycle N-1"
- [ ] Diff button disabled when only 1 cycle exists, with tooltip "Available from cycle 2 onwards"
- [ ] Code blocks within diffs have syntax highlighting
- [ ] Copy and download controls present on both rendered and diff views

---

### Epic 3 — Safety & Human-in-the-Loop

**Story 7: Self-Modification Approval Gate**

*As Chris, I want any agent-proposed change to `/server/src/` to require my explicit approval before any file is written, so that Ouro cannot modify itself without my consent.*

> **Updated from Cycle 2:** The legacy `saveArtifact()` path in each agent runner is a bypass vector (GH#4). Explicit guard added to ACs. Full replacement content stored in `diff_content` (not a patch) for MVP simplicity.

Acceptance criteria:
- [ ] `proposed_changes` table created: `{ id, cycle_id, project_id, proposed_by, file_path, diff_content, status (PENDING/APPROVED/REJECTED), reviewed_at, created_at }`
- [ ] `diff_content` stores the **full replacement file content** (not a diff patch) — applied by writing directly to disk on approval
- [ ] Any `save_artifact` tool call targeting a path under `/server/src/` is intercepted and written to `proposed_changes` with `status = PENDING` instead of being executed
- [ ] **Every direct `db.saveArtifact()` call in `agents/*.ts` that could target `/server/src/` is also guarded by `checkSelfModGate()` before execution** — the freeform text fallback path is not a bypass (fixes GH#4)
- [ ] Pending proposed change triggers a `blocks_cycle = true` inbox message to Chris
- [ ] Chris can APPROVE or REJECT from the inbox UI; approved changes write the stored `diff_content` to disk
- [ ] Hard-coded path constraint (`SELF_MOD_PATHS`) is defined in `agents/base.ts` — not in DB, not agent-writable

---

**Story 8: Blocking Inbox Messages**

*As Chris, I want blockers to appear as a persistent modal overlay — not buried in the feed — so that I never miss a decision that is stalling an active cycle.*

Acceptance criteria:
- [ ] `inbox_messages` table gains `blocks_cycle INTEGER DEFAULT 0` column
- [ ] Messages with `blocks_cycle = 1` render as a full-screen modal overlay on the dashboard
- [ ] Modal includes subject, body, and a reply text field (for `human_input` type)
- [ ] Submitting a reply marks the message as read and resumes the cycle
- [ ] `Escape` key does **not** dismiss the modal — the cycle is halted until explicitly resolved
- [ ] Clicking the backdrop does **not** dismiss the modal
- [ ] Focus is trapped within the dialog (Tab/Shift-Tab cycles within focusable elements)
- [ ] Non-blocking inbox messages remain in the sidebar as before

---

**Story 9: Token Budget Hard Stop**

*As Chris, I want to set a daily token budget per project, so that a runaway cycle cannot generate unexpected costs.*

Acceptance criteria:
- [ ] `preferences` table used to store `token_budget_daily_usd` per project (default: `$10.00`)
- [ ] Cycle runner calls `checkBudgetGate()` before each phase using `sumTodayCost(projectId)` vs `getBudgetUsd(projectId)`
- [ ] >80% spent: broadcast `phase_meta` with `budget_warning: true`; cycle continues
- [ ] ≥100% spent: cycle halts, posts `blocks_cycle = true` inbox message with spend summary; cycle does not advance until resolved
- [ ] Budget can be set from the project settings panel in the UI (`GET`/`PUT /api/projects/:id/preferences/budget`)
- [ ] Budget check is non-bypassable by agent instructions
- [ ] **Note:** A phase that runs over budget completes before being halted — the check occurs at phase boundaries, not mid-phase. This is by design and documented in the settings UI.

---

**Story 16: IntentGate Extension to Blocker Resolution**

*As Chris, I want my replies to blockers to be understood structurally rather than treated as raw text, so that the cycle runner can act on my intent immediately without further parsing ambiguity.*

> **New in Cycle 3** — based on research recommendation #5. The existing `extractIntent()` function (shipped in Commit `14e5621`) should be extended to cover blocker replies. This gives the cycle runner a typed action to respond to instead of relying on `is_read` state alone.

Acceptance criteria:
- [ ] `extractIntent()` is called on every inbox reply to a `blocks_cycle = 1` message
- [ ] For budget blocker replies, intent shape: `{ action: 'approve' | 'adjust_budget' | 'stop_cycle', newBudget?: number }`
- [ ] For phase-escalation blocker replies, intent shape: `{ action: 'retry' | 'stop_cycle' | 'skip_phase' }`
- [ ] For self-mod approval, the explicit APPROVE/REJECT button actions are used — `extractIntent()` not required (button state is unambiguous)
- [ ] `waitForBlockerResolution()` reads the resolved intent and returns a typed result to the caller (not just `'resolved'`)
- [ ] The cycle runner branches on the intent: `adjust_budget` updates the preference and continues; `stop_cycle` halts; `retry` re-queues the phase
- [ ] `reply_intent_json` column (already in schema from Commit `14e5621`) used to store the parsed intent

---

### Epic 4 — Reliability & Crash Recovery

**Story 10: Saga Compensation on Phase Failure**

*As Chris, I want failed phases to retry automatically and escalate to my inbox after 3 consecutive failures — not silently stop — so that I always know when a cycle is stuck.*

Acceptance criteria:
- [ ] Cycle runner wraps each phase in `runPhaseWithRetry()`: up to `MAX_RETRIES = 3` attempts before escalating
- [ ] Each retry logged as a separate `phase_failed` event with error detail and attempt count
- [ ] `phase_meta` WS event broadcast with `retry_count` on each retry; step bar shows `retry N/3` in amber
- [ ] After 3 failures: send `blocks_cycle = true` inbox message with phase name and last error
- [ ] `cycles` table gains `last_completed_phase TEXT` and `phase_states TEXT DEFAULT '{}'` for crash recovery
- [ ] On cycle restart after crash: skip phases already recorded as `complete` in `phase_states`
- [ ] `updateCyclePhaseState()` called on each phase completion/failure

---

**Story 11: SSE Snapshot + Delta Reconnection**

*As a user, I want the live feed to recover gracefully after a network drop, so that I never see a blank feed after reconnecting.*

> **Updated from Cycle 2:** Lifecycle marker names aligned with WS event taxonomy (fixes GH#5). `RunStarted` → `phase_started`; `PhaseStarted` → `phase_started`; `PhaseFinished` → `phase_completed`; `RunFinished` → `phase_completed` on final phase; `RunError` → `error`. All names match the `AgentEvent.event_type` enum — no separate lifecycle enum.

Acceptance criteria:
- [ ] On WS reconnect, server sends a full `snapshot` event before resuming deltas
- [ ] Feed lifecycle is communicated via `agent_event` WS events using the existing `event_type` values: `phase_started`, `phase_completed`, `phase_failed`, `error` — **no separate lifecycle marker enum**
- [ ] Tool call events in the feed are collapsible (summary shown by default, expandable for full I/O)
- [ ] Pinned banner area above feed shows active blockers and errors (separate from scrollable stream)
- [ ] On reconnect: `ReconnectBanner` shows "Reconnected" for 2 seconds then auto-dismisses
- [ ] Client state after reconnect is identical to fresh-load state (no duplicates, no missing events)

---

### Epic 5 — UI Transparency

**Story 12: Cycle Progress Tracker**

*As Chris, I want a horizontal step bar showing all 6 phases with live state indicators, so that I can tell at a glance how far through a cycle Ouro is.*

Acceptance criteria:
- [ ] Step bar shows: `research → spec → design → build → test → review`
- [ ] Each step has state: `pending` (grey), `active` (pulsing blue), `complete` (green ✓), `failed` (red ✗), `retrying` (pulsing amber with `retry N/3` sub-label), `skipped` (grey /)
- [ ] Completed steps show: time elapsed, token count, link to artifact (↗)
- [ ] Step bar is always visible at the top of the project view, regardless of active tab
- [ ] Updates in real-time via WS without page reload
- [ ] When phase DAG parallelism is active (Story 15), two steps can pulse simultaneously — bar handles this from day one

---

**Story 13: Agent Status Rail**

*As Chris, I want a persistent left sidebar showing each agent's status, so that I can see who is active and what they're doing at any moment.*

> **Updated from Cycle 2:** `AgentCard` was missing `last_action_at` and `current_task` display (GH#6). These fields are now explicit ACs. `Agent` type extended accordingly.

Acceptance criteria:
- [ ] One card per agent (pm, researcher, designer, developer, tester, documenter)
- [ ] Each card shows: role emoji + name, status badge (`idle` / `thinking` / `done` / `blocked`), **last action timestamp**, **current task title** (truncated to one line)
- [ ] **`Agent` type extended with `last_action_at: number | null` and `current_task: string | null`** — populated from events table on each phase tick (fixes GH#6)
- [ ] **`Agent` type extended with `last_phase_token_count: number`** — shown as token badge in card footer
- [ ] Active agent card has a pulsing animation
- [ ] Rail is visible on all project sub-pages (feed, inbox, artifacts)
- [ ] Status updates in real-time via WS

---

### Epic 6 — Structured Agent Communication

**Story 14: Structured Tool Use for Agent Actions**

*As a developer, I want agents to use Anthropic's tool use API for their core actions rather than freeform text, so that agent intent is explicit and context pressure is reduced.*

> **Updated from Cycle 2:** The entire tool pipeline was inert because `AGENT_TOOLS` was not registered in `runClaude()` (GH#7). Also: when extended thinking is enabled, `tool_choice` cannot force a specific tool — only `auto` or `none` are valid. `dispatchToolUse()` must handle text-only responses gracefully.

Acceptance criteria:
- [ ] Tools defined: `save_artifact(filename, content)`, `post_feed_message(message, recipient)`, `request_human_input(subject, body, blocks_cycle)`
- [ ] **`AGENT_TOOLS` array registered as `tools` parameter in every `runClaude()` call** — the tool pipeline is active from the first build (fixes GH#7)
- [ ] Tool schema uses Anthropic's `InputSchema` format with `type: 'object'`, `properties`, and `required` fields
- [ ] When extended thinking is enabled for a call, `tool_choice` is `{ type: 'auto' }` — never `{ type: 'tool', name: '...' }` (API constraint)
- [ ] Agent base class `dispatchToolUse()` parses tool use blocks and dispatches to DB helpers
- [ ] **`dispatchToolUse()` handles the case where Claude returns a text response instead of a tool call** — freeform text is accepted as graceful degradation and does NOT bypass the self-mod gate
- [ ] Tool call payloads stored in events table under `event_type = 'tool_call'`
- [ ] Optional: evaluate `advanced-tool-use-2025-11-20` beta header for Tool Use Examples on `save_artifact`, `post_feed_message`, `request_human_input` — improves agent accuracy; not required for MVP

---

**Story 15: Phase Dependency DAG (Parallelism)**

*As Chris, I want the design phase to begin its early draft concurrently with the spec phase, so that cycle wall-clock time is reduced.*

Acceptance criteria:
- [ ] Phase execution model updated from strict serial to dependency-graph-driven
- [ ] DAG defined in `loop.ts`: `research → (spec ‖ design-draft) → design-final → build → test → review`
- [ ] Implemented using `Promise.all()` per dependency wave — **no BullMQ or Redis required**
- [ ] `design-draft` runner receives only `research.md` as context artifact
- [ ] `design-final` runner receives both `spec.md` and the draft design as context artifacts
- [ ] Both parallel branches write separate events with correct `phase` labels
- [ ] Cycle progress tracker renders both parallel steps as active simultaneously (two pulsing steps)
- [ ] Target: ≥20% reduction in average cycle wall-clock time vs. serial baseline

---

## Phase Summary

Cycle 3 spec is a corrected carry-forward of Cycle 2's 15 stories. Three invalid technical assumptions have been resolved: adaptive thinking uses no beta header (Story 3), `react-diff-view` replaces `git-diff-view` (Story 6), and `AGENT_TOOLS` must be registered in `runClaude()` before the tool pipeline is functional (Story 14). Four remaining plan-review failures are addressed through explicit acceptance criteria additions: `human_input_requested`/`error` logging call sites (Story 1), lifecycle marker name alignment with the WS event taxonomy (Story 11), `last_action_at`/`current_task` on Agent type (Story 13), and legacy `saveArtifact()` path guard (Story 7). One new story (Story 16) extends the IntentGate pattern to blocker resolution, giving the cycle runner typed intent from user replies. All six open questions from the Cycle 2 build plan are now closed.

---

## Open Questions

1. **Self-mod gate scope:** The `proposed_changes` gate covers `/server/src/` writes. Should it also intercept writes to `prompts/` and `prompt_versions` table entries? Extending scope broadens Story 7 significantly but closes a meaningful self-improvement vector. No decision needed before Commit 1, but Chris should weigh in before Commit 6.

2. **Mastra integration:** Research recommends evaluating `@mastra/core@1.4.0` for researcher agent memory before Commit 3 ships. This is an optional enhancement — if Chris wants persistent cross-cycle researcher context, Mastra is the right path. If not, the events table provides sufficient context recovery for MVP. Decision required before Commit 3.

---

## Next Phase

The Designer should review the updated component specs for Story 3 (ThoughtLogPanel copy changes), Story 6 (react-diff-view theming vars), and Story 16 (no new UI surface needed — IntentGate is server-side only), then confirm design.md requires no structural changes before the developer begins Commit 1.
