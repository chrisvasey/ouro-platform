# Design Specification

**Designer Agent** | Ouro Platform | 2026-03-28 | Cycle 8

> **Cycle 8 — Designer pass.** All five stories are server-only (SDK migration, event sourcing, artifact versioning, agent lifecycle events, phase/human-input events). No UI changes, no new API endpoints, no new components. The Cycle 7 design below remains the authoritative spec for Cycle 9+ UI implementation. Developer proceeds directly to Story 1.
>
> **Backend infrastructure unlocked for Cycle 9 UI:**
> - `inputTokens` / `outputTokens` / `costUsd` now flow from every `runClaude()` call → enables BudgetBar + AgentTokenSpend
> - `events` table populated with `agent_started`, `agent_completed`, `agent_failed`, `phase_started`, `phase_completed`, `human_input_requested`, `human_input_received` → enables CycleProgressBar, ThoughtLogPanel, AgentCard `last_action_at`
> - `artifacts.cycle_id`, `previous_version_id`, `diff_from_previous` columns available → enables ArtifactHistoryPanel + ArtifactDiffView
> - `getArtifactHistory()` helper ready for `GET /api/projects/:id/artifacts?phase=&filename=` endpoint (to be added in Cycle 9)

---

## User Flows

### Flow 0 — SDK Migration (Story 0)
*Backend only. No new UI surfaces, but unlocks UI data.*

1. Developer runs `bun add @anthropic-ai/sdk` in `server/`.
2. `claude.ts` is rewritten; `runClaude()` signature unchanged for all callers.
3. Return type expands to `ClaudeRunResult` with `inputTokens`, `outputTokens`, `costUsd`, `thinkingBlocks[]`, `toolUses[]`.
4. All `agents/*.ts` callers receive enriched result without modification.
5. Server starts without error; basic agent prompt returns text response.
6. Downstream: `thinkingBlocks` feeds ThoughtLogPanel; token fields feed BudgetBar and per-phase event payloads.

---

### Flow 1 — Events Table (Story 1)
*Backend only. No new UI surfaces.*

1. Migration creates `events` table; `insertEvent()` helper available.
2. Phase runner calls `insertEvent({ event_type: 'agent_started', ... })` at phase start.
3. Phase runner calls `insertEvent({ event_type: 'agent_completed', ... })` at phase end — payload includes `inputTokens`, `outputTokens`, `costUsd`.
4. On throw, runner calls `insertEvent({ event_type: 'agent_failed', payload: { error: err.message } })`.
5. On human input request, `insertEvent({ event_type: 'human_input_requested', ... })`.
6. On human reply, `insertEvent({ event_type: 'human_input_received', ... })`.
7. Application layer enforces insert-only — no UPDATE/DELETE paths exist.

---

### Flow 2 — Artifact Version History (Story 2)

**Happy path — user opens version history:**
1. User sees an artifact name in ArtifactDrawer (e.g. "spec.md").
2. User clicks the "History" icon button next to the artifact name.
3. ArtifactHistoryPanel slides in from right (`w-[720px]`), overlaying the page.
4. Panel fetches `GET /api/projects/:id/artifacts?phase=spec&filename=spec.md`.
5. Version list renders newest-first; first item is auto-selected.
6. Right pane shows full content of selected version; diff tab is disabled if no previous version exists.
7. User clicks an older version — right pane updates to show that version's content.
8. User clicks "Diff" tab — ArtifactDiffView renders unified diff against the immediately prior version.
9. User presses Escape or clicks backdrop — panel unmounts.

**Write path — agent produces a new version:**
1. Agent calls `save_artifact` tool with `{ phase, filename, content }`.
2. `saveArtifact()` checks if a prior row exists for `(project_id, phase, filename)`.
3. If prior row exists: increments `version`, sets `previous_version_id`, computes `diff_from_previous` via `diff.createPatch()`, inserts new row.
4. If no prior row: inserts with `version=1`, `previous_version_id=null`, `diff_from_previous=null`.
5. WS broadcasts `artifact_saved` event; ArtifactDrawer refreshes its list.

---

### Flow 3 — Token Tracking Display (Story 3)

1. Each `agent_completed` event payload contains `{ inputTokens, outputTokens, costUsd }`.
2. `GET /api/projects/:id/budget/today` sums all `costUsd` for today's events.
3. BudgetBar in TopBar updates on each WS `agent_completed` broadcast.
4. AgentCard shows last-phase token spend below the status badge.
5. CycleHistoryItem (in a future cycle history view) shows per-phase token breakdown.

---

### Flow 4 — Budget Gate (Story 4)

**Under 80%:**
1. BudgetBar renders in `text-gray-400` with label "$X.XX / $10.00".
2. No interruption to cycle.

**80–99%:**
1. BudgetBar colour shifts to `text-orange-500 font-medium`.
2. Warning banner appears below TopBar: "Budget 83% used — cycle may halt soon."
3. Cycle continues.

**≥100%:**
1. `loop.ts` budget check fires before next phase; sees spend ≥ limit.
2. Cycle halts; `insertEvent({ event_type: 'budget_exceeded' })`.
3. Blocking inbox message created (`blocks_cycle=1`): "Daily budget reached ($10.00). Approve to continue or adjust limit."
4. BlockerModal appears with "Halt" as default action, "Adjust limit" secondary.
5. BudgetBar turns `text-red-500 font-bold`.
6. Cycle resumes only after user resolves the blocker.

---

### Flow 5 — Self-Mod Approval (Story 5)

**Agent proposes a change to `/server/src/`:**
1. Agent calls `save_artifact` tool with a path under `SELF_MOD_PATHS`.
2. Gate intercepts; stores row in `proposed_changes` with `status='PENDING'`, full replacement content in `diff_content`.
3. Blocking inbox message created (`blocks_cycle=1`): "Agent proposed change to `server/src/agents/researcher.ts`. Review required."
4. Cycle pauses at phase boundary.
5. BlockerModal variant: ProposedChangeModal slides in with DiffView showing old vs new.
6. User clicks "Approve" — `proposed_changes.status` → `APPROVED`; file write executes; cycle resumes.
7. User clicks "Reject" — `proposed_changes.status` → `REJECTED`; feed message posted noting rejection; cycle resumes from next phase.

---

### Flow 6 — Blocking Inbox / Blocker Modal (Story 6)

1. Any inbox message with `blocks_cycle=1` triggers BlockerModal.
2. Modal renders as full-screen portal overlay; focus is trapped inside.
3. Escape key does NOT close the modal — user must take an explicit action.
4. Cycle polling (`waitForBlockerResolution`) blocks further phase execution.
5. User reads the message, optionally types a reply, clicks an action button ("Approve", "Adjust", "Stop Cycle").
6. Reply is saved; `blocks_cycle` resolved; modal unmounts; cycle resumes or halts based on intent.
7. If multiple `blocks_cycle=1` messages exist simultaneously, they are queued — resolve one at a time.

---

### Flow 7 — Cycle Retry / Saga (Story 7)
*Backend only. UI surfaces retry state via CycleProgressBar.*

1. Phase fails; runner retries up to `MAX_RETRIES=3`.
2. Each retry emits `insertEvent({ event_type: 'phase_retry', payload: { attempt, error } })`.
3. After 3 failures, creates blocking inbox message (`blocks_cycle=1`): "Phase `build` failed 3 times. Intervene or stop cycle."
4. CycleProgressBar shows the failed phase step with `retrying` badge, then `failed` badge on exhaustion.

---

### Flow 8 — Cycle Progress Tracker (Story 10)

1. TopBar contains CycleProgressBar showing current cycle phases in order.
2. Each phase node has state: `pending` | `active` | `complete` | `failed` | `retrying`.
3. Active phase pulses; complete phase shows checkmark; failed phase shows X in red.
4. When Commit 16 parallel phases land, `spec` and `design-draft` simultaneously show `active` with dual pulse.
5. Hovering a phase node shows tooltip: phase name, start time, duration (if complete), token spend (if complete).

---

### Flow 9 — Thought Log (Story 9)

1. ThoughtLogPanel is accessible from each AgentCard via an expand control ("Reasoning →").
2. Panel fetches latest thinking blocks from `GET /api/projects/:id/events?phase=build&event_type=agent_completed&limit=1`.
3. Thinking content is collapsed by default behind a "Claude's Reasoning (N blocks)" header.
4. User clicks to expand — content renders in monospace, read-only.
5. Tooltip on header: "Summarised reasoning returned by Claude Sonnet 4.6, not raw internal monologue."
6. If no thinking blocks exist (model returned none), shows: "No reasoning blocks for this phase."

---

### Flow 10 — Artifact Diff Viewer (Story 11)

1. In ArtifactHistoryPanel, user selects a version that has a previous version.
2. "Diff" tab becomes active (was disabled for version 1).
3. ArtifactDiffView renders unified diff from `diff_from_previous` using `react-diff-view/esm`.
4. Added lines highlighted `bg-green-900/40 text-green-300`; removed lines `bg-red-900/40 text-red-400`.
5. Chunk headers show file path + line range in `text-gray-500 text-xs`.
6. Toggle between "Content" and "Diff" tabs is instant (no refetch — data already in version object).

---

## Component Tree

```
App
├── TopBar
│   ├── ProjectSwitcher
│   ├── CycleProgressBar                      [NEW — Story 10]
│   └── BudgetBar                             [NEW — Story 4]
│
├── main layout (flex, h-screen)
│   ├── AgentPanel
│   │   └── AgentCard × 6                    [EXTENDED — Story 8/9]
│   │       ├── AgentStatusBadge
│   │       ├── AgentCurrentTask
│   │       ├── AgentTokenSpend              [NEW — Story 3]
│   │       └── ThoughtLogToggle             [NEW — Story 9]
│   │
│   ├── FeedPanel
│   │   └── FeedMessage × N
│   │
│   └── InboxPanel
│       └── InboxItem × N
│
├── ArtifactDrawer (right slide-in, existing)
│   ├── ArtifactDrawerHeader
│   ├── ArtifactTabBar                        [EXTENDED — adds History button]
│   └── ArtifactContent
│
├── ArtifactHistoryPanel (right drawer, NEW — Story 2/11)
│   ├── ArtifactHistoryHeader
│   ├── ArtifactVersionList
│   │   └── ArtifactVersionItem × N
│   └── ArtifactDetailPane
│       ├── [tab: Content] ArtifactContentView
│       └── [tab: Diff]    ArtifactDiffView   [NEW — Story 11]
│
├── BlockerModal (portal, existing + extended)
│   ├── BlockerMessage
│   ├── BlockerReplyInput
│   └── BlockerActionButtons
│       └── [variant: ProposedChange] ProposedChangeModal
│           ├── ProposedChangeDiffView        [NEW — Story 5]
│           └── ApproveRejectButtons
│
└── ThoughtLogPanel (inline expand, NEW — Story 9)
    ├── ThoughtLogHeader
    └── ThoughtBlock × N
```

---

## Layout & Responsive Behaviour

**Overall Shell**

```
┌─────────────────────────────────────────────────────────────────┐
│ TopBar  [ProjectSwitcher] [CycleProgressBar ──────] [BudgetBar] │  h-12
├────────────┬───────────────────────────────────┬────────────────┤
│ AgentPanel │         FeedPanel                 │  InboxPanel    │
│  w-56      │         flex-1                    │  w-72          │
│  flex-     │                                   │                │
│  shrink-0  │                                   │                │
│            │                                   │                │
└────────────┴───────────────────────────────────┴────────────────┘
```

- Root: `flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden`
- TopBar: `flex items-center px-4 gap-4 h-12 border-b border-gray-800 flex-shrink-0`
- Main area: `flex flex-1 min-h-0` (min-h-0 required for nested scroll containers)
- AgentPanel: `w-56 flex-shrink-0 border-r border-gray-800 overflow-y-auto`
- FeedPanel: `flex-1 overflow-y-auto`
- InboxPanel: `w-72 flex-shrink-0 border-l border-gray-800 overflow-y-auto`

**TopBar internal layout**

```
[ProjectSwitcher ~160px] [CycleProgressBar flex-1 max-w-lg] [spacer flex-1] [BudgetBar ~140px]
```

**ArtifactHistoryPanel** — slides in over main content, not over TopBar.

```
position: fixed; top: 48px (TopBar height); right: 0; bottom: 0;
width: 720px; z-index: 40;
border-left: 1px solid border-gray-800; background: bg-gray-950;
```

**BlockerModal / ProposedChangeModal** — full-screen portal.

```
position: fixed; inset: 0; z-index: 50;
background: bg-gray-950/80 backdrop-blur-sm;
```

**No responsive breakpoints** — this is a desktop-only dashboard. Minimum viewport: 1280px wide.

---

## Component Specs

---

### TopBar *(extended)*

- **Appearance:** `flex items-center px-4 h-12 border-b border-gray-800 gap-4 bg-gray-950`
- **Children:** ProjectSwitcher (existing) | CycleProgressBar | `flex-1` spacer | BudgetBar
- **State propagation:** BudgetBar and CycleProgressBar receive live data from App-level WS handler.

---

### BudgetBar *(new)*

- **Purpose:** Show today's spend vs daily limit at all times.
- **Appearance:** `flex items-center gap-2 text-sm tabular-nums`
- **Label format:** `$1.23 / $10.00` — always show two decimal places.
- **Colour states:**
  - `< 50%` → `text-gray-400`
  - `50–79%` → `text-amber-400`
  - `80–99%` → `text-orange-500 font-medium`
  - `≥ 100%` → `text-red-500 font-bold`
- **Warning banner:** when `≥ 80%`, a full-width banner appears immediately below TopBar:
  ```
  bg-orange-900/50 border-b border-orange-800 text-orange-300 text-xs px-4 py-1
  "Budget 83% used — cycle will halt at 100%"
  ```
  At `≥ 100%` banner becomes `bg-red-900/50 border-red-800 text-red-300`: "Budget limit reached. Cycle halted."
- **Data:** `GET /api/projects/:id/budget/today` → `{ spentUsd: number, limitUsd: number }`. Refetch on each `agent_completed` WS event.
- **Interactions:** Clicking BudgetBar opens InboxPanel (where the budget blocker lives). No inline editing.

---

### CycleProgressBar *(new)*

- **Purpose:** Show all phases of the current cycle as a horizontal step tracker.
- **Appearance:** `flex items-center gap-0 flex-1 max-w-lg`
- **Phase node:**
  ```
  [icon] — node is 28×28, rounded-full, text-xs
  ```
  - `pending`: `bg-gray-800 text-gray-500`
  - `active`: `bg-blue-600 text-blue-100 animate-pulse`
  - `complete`: `bg-green-700 text-green-100` + checkmark icon (✓)
  - `failed`: `bg-red-700 text-red-100` + X icon (✕)
  - `retrying`: `bg-amber-700 text-amber-100` + spinner icon; badge `"N/3"` in `text-[9px]` below node
- **Connector:** `flex-1 h-px bg-gray-800` between nodes; turns `bg-green-700` if both adjacent nodes complete.
- **Parallel phases (Cycle 2 DAG):** `spec` and `design-draft` share a row; rendered as two side-by-side nodes with a Y-connector. Stub as linear until Commit 16 parallel phases land — acceptable to render as sequential until then.
- **Tooltip on hover:** `bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 shadow-lg z-50`
  - Active/pending: `{Phase name} · not started` or `Started 2m ago`
  - Complete: `{Phase} · Done in 45s · $0.04`
  - Failed: `{Phase} · Failed after 3 retries`
- **Data:** derived from `cycles` table `phase_states` JSON column, updated via `phase_change` WS event.
- **Phase order rendered:** `research → spec → design-draft → design-final → build → test → review` (7 nodes).
- **Props:** `{ phaseStates: Record<string, 'pending' | 'active' | 'complete' | 'failed' | 'retrying'> }`

---

### AgentCard *(extended)*

- **Purpose:** Show status of one agent role in the sticky left rail.
- **Appearance:** `px-3 py-3 border-b border-gray-800/60`
- **Layout:**
  ```
  [RoleEmoji] [RoleName bold text-sm]        [StatusBadge]
              [current_task text-xs text-gray-400 truncate max-w-[130px]]
              [last_action_at text-xs text-gray-600]  [token-spend text-xs text-gray-600]
              [ThoughtLogToggle — only if thinkingBlocks exist]
  ```
- **StatusBadge colours:**
  - `idle` → `bg-gray-800 text-gray-500`
  - `thinking` → `bg-blue-900 text-blue-300 animate-pulse`
  - `blocked` → `bg-amber-900 text-amber-300`
  - `error` → `bg-red-900 text-red-300`
  - `complete` → `bg-green-900 text-green-300`
- **Token spend line:** format `1.2k tok · $0.03`; only visible when `lastPhaseTokens > 0`. Compute: `(inputTokens + outputTokens) / 1000` with one decimal, suffix `k`.
- **ThoughtLogToggle:** `text-gray-600 text-xs underline-offset-2 underline cursor-pointer hover:text-gray-400 mt-0.5 block`; label "Reasoning →". Only renders when `thinkingBlocks.length > 0` on the latest event for this agent's last phase.
- **New data fields on `Agent` type:** `current_task: string | null`, `last_action_at: string | null`, `last_phase_input_tokens: number`, `last_phase_output_tokens: number`, `last_phase_cost_usd: number`. All default to `null` / `0`.
- **Interactions:** clicking ThoughtLogToggle toggles ThoughtLogPanel inline below the card.

---

### ThoughtLogPanel *(new)*

- **Purpose:** Inline expandable panel showing Claude's reasoning blocks for the agent's last phase.
- **Appearance:** `bg-gray-900/60 border-t border-gray-800 px-3 py-2 text-xs`
- **Header:** `flex items-center justify-between mb-1`
  - Left: `"Claude's Reasoning (N blocks)"` in `text-gray-500 font-medium`
  - Right: `ⓘ` info icon (`text-gray-600 hover:text-gray-400 cursor-help`) with tooltip on hover: "Summarised thinking returned by Claude Sonnet 4.6 — not raw internal monologue."
- **Thought block:**
  - `font-mono text-gray-400 whitespace-pre-wrap break-words leading-relaxed text-[11px]`
  - Multiple blocks separated by `border-t border-gray-800/60 pt-2 mt-2`
- **States:**
  - `loading`: 3 skeleton lines `bg-gray-800 animate-pulse rounded h-2 mb-1 w-3/4`
  - `empty`: `text-gray-600 italic text-[11px] "No reasoning blocks for this phase."`
  - `populated`: renders blocks
  - `error`: `text-red-400 text-[11px] "Could not load reasoning."`
- **Data:** `GET /api/projects/:id/events?agent_role={role}&event_type=agent_completed&limit=1` — extract `payload.thinkingBlocks`.
- **Interactions:** read-only. Closed by clicking ThoughtLogToggle again (toggle).

---

### ArtifactHistoryPanel *(new)*

- **Purpose:** Fixed right drawer showing complete version history for a `(project_id, phase, filename)` tuple.
- **Appearance:** `fixed top-12 right-0 bottom-0 w-[720px] bg-gray-950 border-l border-gray-800 flex flex-col z-40`
- **Header:** `flex items-center justify-between px-4 h-11 border-b border-gray-800 flex-shrink-0`
  - Left: filename in `text-sm font-medium text-gray-200` + phase badge `bg-gray-800 text-gray-400 text-xs px-1.5 py-0.5 rounded ml-2`
  - Right: `×` close button `text-gray-500 hover:text-gray-200 text-lg leading-none`
- **Body layout:** `flex flex-1 min-h-0`
  - Left column: `ArtifactVersionList` — `w-48 flex-shrink-0 border-r border-gray-800 overflow-y-auto`
  - Right pane: `ArtifactDetailPane` — `flex-1 flex flex-col min-w-0 overflow-hidden`
- **States:**
  - `loading`: centred spinner `animate-spin text-gray-600` + 3 skeleton ArtifactVersionItems
  - `error`: `text-red-400 text-sm px-4 py-3 "Failed to load versions — close and reopen."`
  - `empty`: `text-gray-600 text-sm px-4 py-3 "No versions yet."`
  - `populated`: full list + detail pane
- **Backdrop:** `fixed inset-0 z-30 bg-transparent` behind panel (z-30 < panel z-40); click → `onClose()`.
- **Interactions:**
  - Mount → fetch versions; auto-select newest
  - Escape → `onClose()`
  - Backdrop click → `onClose()`
- **Props:** `{ projectId: string, phase: string, filename: string, onClose: () => void }`
- **Data:** `GET /api/projects/:id/artifacts?phase=&filename=` → `ArtifactVersion[]`

---

### ArtifactVersionList *(new)*

- **Purpose:** Scrollable ordered list of versions, newest first.
- **Appearance:** `flex flex-col overflow-y-auto h-full`
- **No header row** — panel header already names the file.
- **States:** `loading` (3 skeleton items with `animate-pulse`) | list of `ArtifactVersionItem`
- **Props:** `{ versions: ArtifactVersion[], selectedId: string | null, onSelect: (id: string) => void, loading: boolean }`

---

### ArtifactVersionItem *(new)*

- **Purpose:** Single row in version list.
- **Appearance:** `px-3 py-2.5 cursor-pointer border-b border-gray-800/60 select-none`
  - Version number: `text-xs font-medium` — `text-gray-200` if selected, `text-gray-500` otherwise. Format: `"v3"`
  - Agent role below: `text-[10px] text-gray-600 mt-0.5` — `"by designer"`
  - Timestamp: `text-[10px] text-gray-600` — relative, e.g. `"3m ago"`; absolute ISO on hover via `title` attribute
- **Selected state:** `bg-gray-800/60 border-l-2 border-blue-500`
- **Default state:** `border-l-2 border-transparent`
- **Hover state (unselected):** `hover:bg-gray-900`
- **Props:** `{ version: ArtifactVersion, isSelected: boolean, onClick: () => void }`

---

### ArtifactDetailPane *(new)*

- **Purpose:** Right side of ArtifactHistoryPanel — shows content or diff for selected version.
- **Appearance:** `flex flex-col flex-1 min-h-0`
- **Tab bar:** `flex border-b border-gray-800 flex-shrink-0 h-9 px-1`
  - Tab button: `px-3 h-full text-sm border-b-2 -mb-px`
  - Active: `border-blue-500 text-gray-200`
  - Inactive: `border-transparent text-gray-500 hover:text-gray-300`
  - Disabled: `border-transparent text-gray-700 cursor-not-allowed` + `title="No previous version to compare"` on "Diff" tab
- **Body:** `flex-1 overflow-y-auto`
  - Content tab → `ArtifactContentView`
  - Diff tab → `ArtifactDiffView`
- **Empty state** (no version selected): `flex items-center justify-center h-full text-gray-600 text-sm "Select a version"`
- **Props:** `{ version: ArtifactVersion | null }`

---

### ArtifactContentView *(new)*

- **Purpose:** Read-only raw content of an artifact version.
- **Appearance:** `px-4 py-3 font-mono text-xs text-gray-300 whitespace-pre-wrap break-words leading-relaxed`
- **No markdown rendering** — raw content only (preserves exact whitespace for debugging).
- **Props:** `{ content: string }`

---

### ArtifactDiffView *(new)*

- **Purpose:** Unified diff between selected version and its immediate predecessor.
- **Library:** `react-diff-view` imported from `react-diff-view/esm`. Use `parseDiff()` + `Diff` + `Hunk` components.
- **Appearance:**
  - Container: `overflow-x-auto bg-gray-950 font-mono text-xs`
  - Hunk header (`.diff-hunk-header`): `text-gray-600 bg-gray-900 px-3 py-0.5`
  - Added line (`.diff-code-insert`): `bg-green-900/30 text-green-300`
  - Removed line (`.diff-code-delete`): `bg-red-900/30 text-red-400`
  - Unchanged line (`.diff-code-normal`): `text-gray-500`
  - Line number gutter (`.diff-gutter`): `text-gray-700 text-right pr-2 select-none w-10 min-w-[2.5rem]`
- **Header line** above diff component: `text-gray-500 text-xs px-3 py-1.5 border-b border-gray-800` — `"Diff from v{N-1}"`
- **Unavailable state:** `text-gray-500 italic text-sm px-4 py-3 "Diff unavailable for this version."` — shown only when `diff` prop is null/empty despite version > 1.
- **Props:** `{ diff: string | null, previousVersionLabel: string }`
- **Implementation note:** `diff` prop is the raw unified diff string from `diff_from_previous` DB column, passed directly to `parseDiff()` from `react-diff-view/esm`.

---

### BlockerModal *(extended)*

- **Purpose:** Portal overlay that blocks all interaction until a `blocks_cycle=1` inbox message is resolved.
- **Appearance:** `fixed inset-0 z-50 flex items-center justify-center bg-gray-950/80 backdrop-blur-sm`
- **Dialog:** `bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 relative`
- **Queue counter** (top-right inside dialog, only when N > 1): `absolute top-3 right-3 text-gray-600 text-xs "1 of 3 blockers"`
- **Header:** `flex items-start gap-3`
  - Icon: `⚠` in `text-amber-400 text-xl flex-shrink-0`
  - Subject: `text-amber-400 font-semibold text-base leading-tight`
- **Body:** `text-gray-300 text-sm leading-relaxed mt-2`
- **Reply textarea:** `mt-4 w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none h-20 focus:outline-none focus:border-gray-500`
- **Action buttons:** `mt-4 flex gap-3 justify-end`
  - Primary: `bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm font-medium`
  - Destructive: `bg-red-900 hover:bg-red-800 text-red-300 px-4 py-1.5 rounded text-sm`
- **Escape key:** does NOT close — plays wiggle animation on dialog: `animate-[wiggle_0.3s_ease-in-out]`. Define in `tailwind.config.ts`:
  ```js
  keyframes: { wiggle: { '0%,100%': { transform: 'translateX(0)' }, '20%,60%': { transform: 'translateX(-6px)' }, '40%,80%': { transform: 'translateX(6px)' } } }
  ```
- **Focus trap:** Tab cycles only through textarea → buttons → textarea. Implemented with `useEffect` + `keydown` listener checking `document.activeElement`.
- **Queue:** if multiple `blocks_cycle=1` messages exist, render one at a time; no "next" button — must resolve current to advance.
- **Props:** `{ messages: InboxMessage[], onResolve: (msgId: string, reply: string, action: string) => void }`

---

### ProposedChangeModal *(new, BlockerModal variant)*

- **Purpose:** Extended BlockerModal for self-mod approval — adds diff viewer, wider dialog, explicit approve/reject/stop actions.
- **Dialog:** `max-w-3xl max-h-[80vh] flex flex-col` (wider and taller than standard BlockerModal)
- **Header:** `flex items-start gap-3 flex-shrink-0`
  - Icon: `🛡` or red shield SVG in `text-red-400 text-xl flex-shrink-0`
  - Title: `text-red-400 font-semibold text-base "Agent proposed a code change"`
  - Subheader: `text-gray-400 text-xs mt-0.5` — filepath, e.g. `server/src/agents/researcher.ts`
- **Diff area:** `flex-1 overflow-y-auto border border-gray-700 rounded mt-3 bg-gray-950 min-h-[200px]`
  - Uses `ArtifactDiffView` with `diff` from `proposed_changes.diff_content` processed through `diff.createPatch(filename, '', newContent)` on the server. If no prior content (new file), diff shows all lines as added.
- **Confirmation step for Approve:** clicking "Approve & Apply" mutates button to show inline confirmation:
  ```
  [text: "This will write to server source. Confirm?"]  [Confirm Approve btn] [Cancel btn]
  ```
  Single-click Reject and Stop Cycle have no second confirmation.
- **Action buttons:** `mt-4 flex gap-3 justify-end flex-shrink-0`
  - "Approve & Apply": `bg-green-700 hover:bg-green-600 text-white`
  - "Reject": `bg-gray-800 hover:bg-gray-700 text-gray-300`
  - "Stop Cycle": `bg-red-900 hover:bg-red-800 text-red-300`
- **Escape:** same wiggle, never dismisses.
- **Props:** `{ proposedChange: ProposedChange, message: InboxMessage, onResolve: (action: 'approve' | 'reject' | 'stop') => void }`

---

## Edge Cases & Empty States

1. **No projects exist** — ProjectSwitcher shows "No projects" as a disabled item + "New Project" button; main panels show centered empty state "Create a project to get started."

2. **Cycle not running** — CycleProgressBar renders all 7 nodes as `pending` in `text-gray-600`; Start Cycle button enabled. BudgetBar shows `$0.00 / $10.00`.

3. **Artifact with only one version** — "Diff" tab in ArtifactDetailPane is permanently `disabled` with `title="No previous version to compare"`. Clicking it has no effect. Version list shows single item, selected by default.

4. **`diff_from_previous` is null despite version > 1** — Should not occur under normal operation (server always computes on second+ version). If it does: ArtifactDiffView renders `text-gray-500 italic "Diff unavailable for this version."` — never crash.

5. **`diff_content` on proposed change is byte-for-byte identical to current file** — ProposedChangeModal shows `text-amber-400 text-sm "No changes detected in this proposal."` instead of diff. "Approve & Apply" button is disabled; only "Reject" and "Stop Cycle" are available.

6. **Multiple `blocks_cycle=1` messages simultaneously** — BlockerModal shows queue counter "Blocker 1 of N" top-right. User resolves one → next appears. No skipping, no batch-dismiss. If a ProposedChange is in the queue alongside a budget blocker, the ProposedChange (red, safety-critical) is always shown first — sort by severity.

7. **Budget blocker arrives while ProposedChangeModal is open** — ProposedChangeModal keeps focus. Budget blocker is appended to queue behind it.

8. **Phase fails on first attempt (research), no feed messages yet** — FeedPanel shows `text-gray-600 text-sm text-center py-12 "Waiting for agent activity..."`. AgentCard for researcher shows `error` badge. CycleProgressBar shows `failed` on `research` node.

9. **Thought log has no thinking blocks** — ThoughtLogToggle does not render at all on AgentCard. No link to an empty panel.

10. **ArtifactHistoryPanel open while a new version arrives** — `artifact_saved` WS event triggers refetch. New version item prepended to list. Currently-selected version stays selected (no auto-jump to newest). A subtle `text-blue-400 text-xs "New version available ↑"` indicator appears at top of version list.

11. **`GET /api/projects/:id/artifacts?phase=&filename=` returns 404 or network error** — Panel body shows `text-red-400 text-sm px-4 py-3 "Failed to load versions — try closing and reopening."`. Log error to console.

12. **ThoughtLogPanel fetch fails** — `text-red-400 text-[11px] "Could not load reasoning."` shown inline inside the toggle. AgentCard does not crash.

13. **Two phases simultaneously active (Commit 16 parallelism)** — CycleProgressBar renders both `spec` and `design-draft` nodes with `animate-pulse` simultaneously. Layout does not break; both nodes are equal-width. Until Commit 16 lands, stub as linear (no parallel visual).

14. **Viewport narrower than 1280px** — No responsive accommodation. Body clips and scrolls horizontally. Acceptable — desktop-only dashboard.

15. **Escape during ProposedChangeModal** — Wiggle animation, never dismiss. Self-mod changes cannot be accidentally closed.

16. **WS disconnect during active cycle** — TopBar shows `text-yellow-500 text-xs "Reconnecting..."` with a pulsing dot next to the project name. Data shown is stale until reconnect. On reconnect, `snapshot` WS event restores full state. Banner disappears automatically.

17. **Project has no active cycle** — AgentCard shows all agents as `idle`, `current_task` is empty. CycleProgressBar shows all nodes `pending`. BudgetBar shows today's total spend (may be non-zero from earlier cycles today).

18. **Very long `current_task` text on AgentCard** — `truncate max-w-[130px]` with `title` attribute showing full text on hover. Never wraps — AgentCard has fixed height.

---

## Design Decisions

1. **ArtifactHistoryPanel is a separate layer from ArtifactDrawer.** ArtifactDrawer shows the current artifact; ArtifactHistoryPanel is opened on demand via a "History" button. When both are open, ArtifactDrawer shifts left by 720px (`right-[720px]` when `historyPanelOpen` state is true in App). This avoids nesting complexity and keeps the two concerns separate.

2. **ProposedChangeModal is a variant of BlockerModal, not a separate modal system.** Both are `blocks_cycle=1` inbox messages. The modal selects the variant based on whether the inbox message has a `proposed_change_id` FK. Sharing focus-trap, queue, and Escape-shimmy logic across variants avoids duplication.

3. **Diff tab is disabled, not hidden, for version 1.** Hiding it makes the feature invisible. Disabling it with a tooltip teaches users the feature exists while correctly explaining why it is unavailable. A feature that users don't know exists is a feature that doesn't exist.

4. **Raw content in ArtifactContentView, no markdown rendering.** The history panel is for inspection and debugging. Markdown rendering introduces visual ambiguity and can mask subtle whitespace differences. Developers and agents examining prior versions want exact stored content.

5. **`react-diff-view/esm` over custom diff rendering.** The unified diff display has many edge cases. Using a proven library (40K weekly downloads, confirmed ESM support from v3.1.0+) avoids reinventing hunk parsing, line mapping, and edge-case handling.

6. **BudgetBar does not inline-edit the daily limit.** Changing the limit is a consequential action. It flows through the inbox reply + IntentGate path (`{ action: 'adjust_budget', newBudget: 15 }`). An inline edit field is too easy to accidentally trigger during triage.

7. **ThoughtLogToggle only renders when thinking blocks exist.** An always-visible "Reasoning" link that sometimes leads to nothing erodes user trust. Show the toggle only when there is guaranteed content to show.

8. **CycleProgressBar uses 7 nodes for the Cycle 2 DAG** (`research → spec → design-draft → design-final → build → test → review`). Parallel pair (`spec ‖ design-draft`) is a Commit 16 concern. Until then, render as linear. The component API accepts `phaseStates` as a Record — the visual layout can change without changing the interface.

9. **BlockerModal Escape shimmy, not dismissal.** Safety-critical modal must never be accidentally closed. The wiggle animation gives immediate tactile feedback while refusing the action. This matches LangGraph human-in-the-loop patterns and Devin's intervention flow.

10. **Relative timestamps everywhere, absolute on hover.** Dashboard timestamps are for scanning recency ("this happened 3m ago"), not for audit (absolute time). All relative timestamps use the existing `relativeTime()` utility from `client/src/utils.ts`. Absolute ISO time is available on hover via the `title` attribute — no extra UI needed.

11. **"Approve & Apply" requires a second click for ProposedChangeModal.** Self-modification of source code is irreversible within the session. A two-step confirm prevents misclicks. Reject and Stop Cycle are single-click — a rejected self-mod or a stopped cycle is recoverable.

12. **ArtifactHistoryPanel auto-selects newest version on open.** Users most commonly want to see the latest content before navigating to older versions. Defaulting to newest avoids an extra click in the common case while still showing the full history list for navigation.

---

*Design Specification — Designer Agent | Ouro Platform | 2026-03-28*
