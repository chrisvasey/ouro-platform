# Implementation Plan — Cycle 5

## Current State Assessment

### Already complete (no commits needed)
- **Tasks 1–2:** `@anthropic-ai/sdk` present in `server/package.json`; `runClaude` already calls `anthropic.messages.create()`
- **Tasks 4–5:** `ClaudeRunResult` already has `inputTokens`, `outputTokens`, `thinkingContent?`; `parseResponse()` already exists
- **Tasks 7–10:** `events` table, indexes, `insertEvent()`, `getEventsPage()` all present in `server/src/db.ts`

### Also already complete (verified in code)
- **Tasks 11–12:** `GET /api/projects/:id/events` and `PUT /api/projects/:id/preferences` routes present in `index.ts`
- **Tasks 13–14:** `buildWsSnapshotPayload` helper exists; snapshot emitted on subscribe in WS `message` handler
- **Task 18:** `useWebSocket.ts` implemented with backoff `[250,500,1000,2000]ms`, reconnecting state, `send()` guard

### Gaps requiring commits
- **Task 6:** `betas: ['interleaved-thinking-2025-05-14']` missing from `buildCreateParams` when `thinkingBudget` set
- **Task 13 (partial):** `buildWsSnapshotPayload` missing `phaseStates`, `blockerQueue`, and `feedEvents` rename
- **Tasks 15–16:** `react-diff-view` / `react-markdown` / `diff` not in `client/package.json`; CSS import missing
- **Tasks 17–32:** All new client types, hooks, and components

---

## File Structure

```
server/src/
  claude.ts          ← modify: thinkingBudget rename + betas header
  index.ts           ← modify: events route, prefs PUT, WS snapshot

client/
  package.json       ← modify: add react-diff-view
  src/
    index.css        ← modify: import react-diff-view stylesheet
    types.ts         ← modify: add all Cycle 5 types
    hooks/
      useWebSocket.ts          ← new
      useSnapshot.ts           ← new
    components/
      AppState/index.ts        ← new
      ConnectionStatus/index.ts ← new
      InboxBadge/index.ts      ← new
      TopBar.tsx               ← modify: ConnectionStatus + InboxBadge
      CycleProgressBar/index.ts ← new
      AgentRail/index.ts        ← new
      FeedPanel.tsx             ← modify: FeedToolCallBlock
      BlockerModal/index.ts     ← new
      ArtifactView/index.ts     ← new
      ReconnectBanner/index.ts  ← new
      PinnedBlockerBanner/index.ts ← new
      SettingsView/index.ts     ← new
    App.tsx                    ← modify: wrap AppStateProvider, swap panels
```

---

## Data Shapes

```typescript
// ── claude.ts ──────────────────────────────────────────────────────────────
export interface ClaudeRunOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  tools?: Anthropic.Tool[];
  thinkingBudget?: number;   // renamed from enableThinking; min 1024
}

// ── client/src/types.ts ────────────────────────────────────────────────────
export type AgentRole = 'pm' | 'researcher' | 'designer' | 'developer' | 'tester' | 'documenter';
export type AgentStatus = 'idle' | 'thinking' | 'blocked';
export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
export type PhaseStatus = 'pending' | 'running' | 'complete' | 'error' | 'skipped';

export interface Agent {
  id: string;
  project_id: string;
  role: AgentRole;
  status: AgentStatus;
  current_task: string | null;
  last_action_at: number | null;
}

export interface PhaseState {
  phase: string;
  status: PhaseStatus;
  started_at: number | null;
  ended_at: number | null;
  retry_count: number;
  artifact_id: string | null;
}

export interface PhaseMeta {
  cycleId: string;
  phase: string;
  status: PhaseStatus;
  startedAt: number | null;
  endedAt: number | null;
  retryCount: number;
  artifactId: string | null;
}

export interface Cycle {
  id: string;
  project_id: string;
  status: 'running' | 'complete' | 'stopped' | 'error';
  started_at: number;
  ended_at: number | null;
  phase_outcomes: PhaseOutcome[];
}

export interface FeedEvent {
  id: string;
  project_id: string;
  cycle_id: string | null;
  agent_role: AgentRole | null;
  event_type: string;
  payload: Record<string, unknown>;
  token_count: number;
  cost_usd: number;
  created_at: number;
}

export interface ThoughtEntry {
  id: string;
  agentRole: AgentRole;
  thinking: string;
  created_at: number;
}

export type WsMessage =
  | { event: 'connected'; data: { clientCount: number } }
  | { event: 'subscribed'; data: { projectId: string } }
  | { event: 'snapshot'; projectId: string; data: SnapshotPayload }
  | { event: 'agent_event'; projectId: string; data: FeedEvent }
  | { event: 'phase_meta'; projectId: string; data: PhaseMeta }
  | { event: 'blocker'; projectId: string; data: InboxMessage }
  | { event: 'proposed_change_resolved'; projectId: string; data: { id: string; resolution: 'applied' | 'rejected' } }
  // legacy events (existing broadcasts kept for compatibility)
  | { event: 'feed_message'; projectId: string; data: FeedMessage }
  | { event: 'inbox_message'; projectId: string; data: InboxMessage }
  | { event: 'agent_status'; projectId: string; data: { role: string; status: string; current_task?: string | null } }
  | { event: 'phase_change'; projectId: string; data: { phase: string } }
  | { event: 'cycle_update'; projectId: string; data: { cycleId: string; status: string } };

export interface SnapshotPayload {
  cycle: Cycle | null;
  agents: Agent[];
  feedEvents: FeedEvent[];      // last 50, newest-first
  inbox: InboxMessage[];
  phaseStates: PhaseState[];
}

export interface AppState {
  wsStatus: WsStatus;
  hydrated: boolean;
  cycle: Cycle | null;
  agents: Agent[];
  feedEvents: FeedEvent[];
  inbox: InboxMessage[];
  phaseStates: PhaseState[];
  blockerQueue: InboxMessage[];
}

export interface Banner {
  id: string;
  type: 'blocker' | 'budget_warning' | 'budget_halt';
  message: string;
  priority: number;
}
```

---

## Key Functions

### `server/src/claude.ts` — 1 change only

**`buildCreateParams(opts: ClaudeRunOptions)`**
- Remove `enableThinking` boolean branch
- Add: `if opts.thinkingBudget && !opts.tools?.length` → spread `thinking: { type: 'enabled', budget_tokens: opts.thinkingBudget }` and `betas: ['interleaved-thinking-2025-05-14']`
- Guard: if both `tools` and `thinkingBudget` set → `console.warn` and drop thinkingBudget
- Note: `betas` may require `as any` cast — check `@anthropic-ai/sdk@0.80` types

### `server/src/index.ts`

**`buildWsSnapshotPayload(projectId: string): SnapshotPayload`**
- `cycle` = `listCycles(projectId)[0] ?? null`
- `agents` = `getAgentsForProject(projectId)`
- `feedEvents` = `getEventsPage(projectId, { limit: 50 }).events`
- `inbox` = `getInboxMessages(projectId)`
- `phaseStates` = derive from `cycle.phase_outcomes` (map to `PhaseState[]`; fill pending for remaining phases)
- Returns typed `SnapshotPayload`

**`GET /api/projects/:id/events`**
- Params: `limit` (1–200, default 50), `offset` (default 0), `cycleId?`
- 404 if `!getProject(id)`
- Returns `getEventsPage(id, { cycleId, limit, offset })`

**`PUT /api/projects/:id/preferences`**
- Body: `{ budget_daily_usd: number }`
- Validate: must be `> 0` finite number; return `400 { message: 'budget_daily_usd must be a positive number' }` otherwise
- `setPreference(id, 'budget_daily_usd', String(budget_daily_usd))`
- Returns `{ ok: true }`

**WS `message` handler — subscribe branch**
- Existing: sets `client.projectId = msg.projectId`
- Add after: send snapshot immediately — `ws.send(JSON.stringify({ event: 'snapshot', projectId: msg.projectId, data: buildWsSnapshotPayload(msg.projectId) }))`

### `client/src/hooks/useWebSocket.ts`

```typescript
function useWebSocket(url: string): { status: WsStatus; send: (msg: string) => void }
```
- State: `status: WsStatus` (init `'connecting'`)
- On open: set `'open'`, reset backoff index
- On close/error: set `'reconnecting'`, schedule reconnect with backoff `[250,500,1000,2000][min(attempt,3)]ms`
- `send()`: guard — no-op if `status !== 'open'`; calls `ws.current.send(msg)`
- Cleanup: `ws.current?.close()` + `clearTimeout` on unmount

### `client/src/hooks/useSnapshot.ts`

```typescript
type Action =
  | { type: 'SNAPSHOT'; payload: SnapshotPayload }
  | { type: 'AGENT_EVENT'; payload: FeedEvent }
  | { type: 'PHASE_META'; payload: PhaseMeta }
  | { type: 'BLOCKER'; payload: InboxMessage }
  | { type: 'PROPOSED_CHANGE_RESOLVED'; payload: { id: string } };

function useSnapshot(): [AppState, Dispatch<Action>]
```
- Pre-snapshot ring buffer: `useRef<Action[]>([])` — collect up to 50 non-SNAPSHOT actions before `hydrated`
- `SNAPSHOT`: set all state fields, `hydrated: true`, replay buffered actions
- `AGENT_EVENT`: prepend to `feedEvents`; dedupe by id; trim to 200
- `PHASE_META`: upsert `phaseStates` by `phase` field
- `BLOCKER`: append to `blockerQueue` (dedupe by id)
- `PROPOSED_CHANGE_RESOLVED`: remove from `blockerQueue` by id

### `client/src/components/AppState/index.ts`

**`AppStateProvider({ children })`**
- Composes `useWebSocket(WS_URL)` and `useSnapshot()`
- Routes WS messages to dispatch: `agent_event→AGENT_EVENT`, `snapshot→SNAPSHOT`, `phase_meta→PHASE_META`, `blocker→BLOCKER`, `proposed_change_resolved→PROPOSED_CHANGE_RESOLVED`
- Sends `{ type: 'subscribe', projectId }` via `send()` when project changes
- Exposes `{ ...appState, wsStatus, send }` via context

**`useAppState()`**
- Reads context; throws `Error('useAppState must be used inside AppStateProvider')` if null

---

## Component Breakdown

### `ConnectionStatus`
- Props: none (reads `useAppState().wsStatus`)
- Dot colours: open=`bg-green-500`, reconnecting=`bg-amber-500`, connecting=`bg-gray-400`, closed=`bg-red-500`
- Label: `hidden xl:block text-xs text-gray-400`

### `InboxBadge`
- Props: none (reads `useAppState()`)
- `count = inbox.filter(m => !m.is_read).length`
- Hidden when `count === 0`
- Pill: amber ring when `blockerQueue.length > 0`, else blue; text: `count > 99 ? '99+' : count`

### `CycleProgressBar`
- Props: `{ phaseStates: PhaseState[], cycle: Cycle | null, budgetDailyUsd: number, totalSpendUsd: number }`
- 7 phase steps; step states → icon: pending=circle, running=spinner, complete=check, error=X, skipped=dash
- Retry badge: `retry_count > 0` → amber `⟳N` label
- Artifact link: `artifact_id` → `↗` opens ArtifactView at that phase
- `CycleCostSummary`: `$X.XX / $Y.YY`; text-amber-400 if spend > 80% budget

### `AgentRail`
- Props: none (reads `useAppState().agents`)
- 6 `AgentCard`s in a vertical list
- **AgentCard** state styles:
  - `idle`: `border-gray-800 bg-gray-900`
  - `thinking`: `border-blue-500 bg-blue-950 ring-1 ring-blue-500`
  - `blocked`: `border-amber-500 bg-amber-950 ring-1 ring-amber-500`
- `current_task` row: `text-gray-400 text-xs truncate`; hidden if null
- Footer: relative time via `formatDistanceToNow` (or inline `Date.now() - last_action_at`)
- `ThoughtLogPanel`: collapsible `<details>`; list of thoughts for this role filtered from `feedEvents` where `event_type === 'thinking'`; each entry has expand toggle

### `FeedPanel.tsx` (modify)
- Add `FeedToolCallBlock` component inline:
  - Only renders when `event.event_type === 'tool_call'`
  - Header: `▶ tool: {event.payload.tool}` (clickable)
  - Expanded: `<pre>{JSON.stringify(event.payload, null, 2)}</pre>`
  - Expand state: `useState<Set<string>>` keyed by event id

### `BlockerModal`
- Mounts via `ReactDOM.createPortal(…, document.body)`
- Only renders when `blockerQueue.length > 0`
- Shows first item in queue; counter: `Blocker 1 of {blockerQueue.length}`
- Sections: reply `<textarea>` (always visible), diff view (if `payload.diff_content`), spend table (if `payload.spend`)
- Escape / backdrop click: no-op (user must reply or skip explicitly)
- Focus trap: `useEffect` focuses first focusable child on mount
- Submit: `POST /api/projects/:id/inbox/:msgId/reply` → on success dispatch `PROPOSED_CHANGE_RESOLVED`
- Submitting state: button shows spinner, textarea disabled

### `ArtifactView`
- Props: `{ projectId: string, initialPhase?: string, onClose: () => void }`
- Phase tabs: `['research','spec','design','build','test','review']` — active tab = selected phase
- `CycleSelector`: `<select>` populated from cycle history; default = latest
- `ViewToggle`: "Rendered" | "Diff" segmented control
- Rendered mode: `<ReactMarkdown>` (add `react-markdown` dep) or `<pre>` fallback
- Diff mode: `parseDiff(artifact.diff_from_previous)` + `<Diff>/<Hunk>` from `react-diff-view/esm`; "No previous version" if null
- Real-time flash: 500ms `ring-2 ring-blue-400` transition on `artifact.updated_at` change
- Copy: `navigator.clipboard.writeText(content)`
- Download: `<a href={objectUrl} download={filename}>`

### `ReconnectBanner`
- Internal state: `phase: 'reconnecting' | 'success' | 'hidden'`
- Mounts on `wsStatus === 'reconnecting'` → show amber banner
- Transitions to `'success'` on `wsStatus === 'open'` → show green "Reconnected" for 2s → `'hidden'`

### `PinnedBlockerBanner`
- Reads `banners: Banner[]` derived in `AppStateProvider`:
  - One banner per `blockerQueue` item (type=`'blocker'`, priority=100)
  - Budget >80%: type=`'budget_warning'`, priority=50
  - Budget ≥100%: type=`'budget_halt'`, priority=90
- Renders max 3; sorted by priority desc; overflow: `"and {N} more…"` row
- Blocker banners: amber; budget_warning: amber; budget_halt: red

### `SettingsView`
- Props: `{ projectId: string }`
- Budget input: `<input type="number" min="0.01" step="0.01">`; "Save" → `PUT /api/projects/:id/preferences`; 2s green flash on 200; red text on 400 response
- Self-mod section: `<code>SELF_MOD_PATHS = ['/server/src/']</code>` display-only text

### `App.tsx` (modify)
- Wrap with `<AppStateProvider projectId={selectedProject?.id}>`
- Replace ad-hoc WS/fetch state with `useAppState()`
- `<AgentPanel>` → `<AgentRail>`
- `<ArtifactDrawer>` → `<ArtifactView>`
- Add `<ReconnectBanner>` + `<PinnedBlockerBanner>` at top of root div
- Add `<BlockerModal projectId={selectedProject?.id}>` always mounted
- `<SettingsView>` wired to settings tab if present

---

## API Contract

| Method | Path | Body | Response | Errors |
|--------|------|------|----------|--------|
| `GET` | `/api/projects/:id/events` | — | `{ events: DbEvent[], total: number }` | 404 project not found |
| `PUT` | `/api/projects/:id/preferences` | `{ budget_daily_usd: number }` | `{ ok: true }` | 400 invalid value, 404 project |

Query params for GET events: `limit` (1–200, default 50), `offset` (default 0), `cycleId` (optional UUID string).

All existing routes are unchanged.

---

## Commit Plan

```
Commit 1 — fix(claude): rename enableThinking→thinkingBudget, add interleaved-thinking beta header
  server/src/claude.ts

Commit 2 — feat(api): events route, preferences PUT, buildWsSnapshotPayload, snapshot-on-subscribe
  server/src/index.ts

Commit 3 — feat(client): add react-diff-view + react-markdown deps, import base CSS
  client/package.json
  client/src/index.css

Commit 4 — feat(client): add Cycle 5 type definitions
  client/src/types.ts

Commit 5 — feat(client): useWebSocket and useSnapshot hooks
  client/src/hooks/useWebSocket.ts
  client/src/hooks/useSnapshot.ts

Commit 6 — feat(client): AppStateProvider, ConnectionStatus, InboxBadge
  client/src/components/AppState/index.ts
  client/src/components/ConnectionStatus/index.ts
  client/src/components/InboxBadge/index.ts

Commit 7 — feat(client): CycleProgressBar and AgentRail
  client/src/components/CycleProgressBar/index.ts
  client/src/components/AgentRail/index.ts

Commit 8 — feat(client): TopBar — wire ConnectionStatus + InboxBadge
  client/src/components/TopBar.tsx

Commit 9 — feat(client): FeedToolCallBlock in FeedPanel
  client/src/components/FeedPanel.tsx

Commit 10 — feat(client): BlockerModal and ArtifactView
  client/src/components/BlockerModal/index.ts
  client/src/components/ArtifactView/index.ts

Commit 11 — feat(client): ReconnectBanner, PinnedBlockerBanner, SettingsView
  client/src/components/ReconnectBanner/index.ts
  client/src/components/PinnedBlockerBanner/index.ts
  client/src/components/SettingsView/index.ts

Commit 12 — feat(client): wire AppStateProvider and new components into App
  client/src/App.tsx
```

---

## Open Questions

1. **`react-diff-view` ESM compat (GH#3):** Verify `react-diff-view/esm/index.js` exists in the installed package under Vite 5 before Commit 3. If not resolvable, fall back to `diff` + `<pre>` renderer and defer ArtifactDiffView.

2. **Snapshot on subscribe vs connect:** Snapshot emitted inside the `message` handler on subscribe receipt, not in `open` — because `projectId` is not known at connect time.

3. **`betas` field type on SDK params:** `Anthropic.MessageCreateParamsNonStreaming` may not include `betas` in `@anthropic-ai/sdk@0.80`. May need `(params as any).betas = [...]` or use `client.beta.messages.create(...)`. Verify before Commit 1.

4. **`Banner[]` derivation:** Derive inside `AppStateProvider` as a `useMemo`: one banner per `blockerQueue` item + one if `totalSpendUsd / budgetDailyUsd >= 0.8`. Budget pref loaded via `GET /api/projects/:id/preferences` (not yet a route — add to Commit 2 or defer).

5. **`react-markdown` dependency:** `ArtifactView` rendered mode needs markdown rendering. Add `react-markdown` to `client/package.json` in Commit 3 alongside `react-diff-view`, or use `<pre>` fallback for MVP.

---

## Task Implementation Notes (Tasks 13–15)

### Task 13 — `server/src/claude.ts` — Update module JSDoc

**File:** `server/src/claude.ts`

**Target:** Module-level JSDoc block at the top of the file (documentation-only, no implementation change)

**What it does:**
- Replace any opening line that references `Bun.spawn`, `claude --print`, or "CLI subprocess runner" with a line clearly stating "Anthropic SDK runner" — the summary must accurately reflect that the module calls the Anthropic Messages API via `@anthropic-ai/sdk`, not a shell process
- Remove every sentence in the block that mentions subprocess spawning, `stdout` parsing, process exit codes, or `Promise.race` timeout — none of those concepts apply to the SDK call path
- Document auth lookup order explicitly in the JSDoc: `ANTHROPIC_API_KEY` (primary env var checked first) → `CLAUDE_CODE_OAUTH_TOKEN` (fallback); note that the OAuth token may be rejected by the API with a 401, in which case the module falls through to the mock path automatically
- Retain the mock-fallback sentence: state that the module returns deterministic mock output when no valid token is present, so the agent loop can run end-to-end in dev/test without a real API key
- No changes to any function-level JSDoc, exported interfaces, or implementation — this task touches only the four-to-six-line file-header comment block

---

### Task 14 — `server/src/db.ts` — Append `events` table to schema

**File:** `server/src/db.ts`

**Target:** New `db.run(...)` call appended immediately after the closing backtick of the `cycles` table block

**What it does:**
- Append `db.run(\`CREATE TABLE IF NOT EXISTS events (...)\`)` after the `cycles` DDL, keeping the established top-to-bottom table declaration order; use `CREATE TABLE IF NOT EXISTS` so the statement is idempotent and safe to re-execute on every server start without a migration guard
- Column set: `id TEXT PRIMARY KEY`, `project_id TEXT NOT NULL`, `cycle_id TEXT` (nullable — events may be written before a cycle record exists), `agent_role TEXT` (nullable — system-level events carry no agent), `event_type TEXT NOT NULL`, `payload TEXT NOT NULL DEFAULT '{}'`, `token_count INTEGER NOT NULL DEFAULT 0`, `cost_usd REAL NOT NULL DEFAULT 0`, `created_at INTEGER NOT NULL`
- Add three indexes in separate `try { db.run(...) } catch {}` blocks that silently no-op if the index already exists: `idx_events_project_cycle ON events(project_id, cycle_id)` for cycle-scoped queries, `idx_events_project_type ON events(project_id, event_type)` for type-filter queries, `idx_events_created ON events(created_at DESC)` for reverse-chronological pagination
- Extend the `tables` array in the `--reset` CLI block at the bottom of the file to include `'events'` so `bun run src/db.ts --reset` drops the table cleanly alongside all others
- Do not add an `ALTER TABLE` migration block — Cycle 5 assumes a fresh DB via `--reset`; existing DBs with no `events` table will create it on next start via the `IF NOT EXISTS` guard

---

### Task 15 — `server/src/db.ts` — Export `EventType`, `InsertEventParams`, `Event` types

**File:** `server/src/db.ts`

**Target:** Type/interface export block placed in the `// ─── Events ───` section, above the DDL `db.run` calls

**What it does:**
- Export `EventType` as a string-literal union covering all lifecycle milestones emitted by the loop and agents: `'phase_start' | 'phase_complete' | 'phase_failed' | 'agent_step_completed' | 'tool_call' | 'artifact_save' | 'human_input_requested' | 'human_input_received' | 'thinking' | 'error'`; this union is the sole source of truth constraining the `event_type` column at the TypeScript layer
- Export `InsertEventParams` interface with required fields only (no `id` or `created_at` — both are assigned inside `insertEvent`): `project_id: string`, `cycle_id: string | null`, `agent_role: AgentRole | null` (reuses the existing `AgentRole` const-union already defined in this file), `event_type: EventType`, `payload: Record<string, unknown>`, `token_count: number`, `cost_usd: number`
- Export `Event` as the caller-facing parsed interface where `payload` is typed `Record<string, unknown>` (already JSON-parsed before being returned); this is distinct from the internal `DbEvent` row interface where `payload` is `string` (raw SQLite TEXT as stored on disk)
- Keep `DbEvent` as an internal interface used only within `db.ts` for the `db.query<DbEvent, ...>()` type parameter — callers receive `Event[]` from helper functions, never the raw `DbEvent` row; `DbEvent` need not be exported
- Place all three exports at the top of the `// ─── Events ───` section (before the `db.run` DDL calls), matching the convention established by every other section in the file where interface/type definitions precede the helper functions that use them

---

## Task Implementation Notes (Tasks 31–33)

### Task 31 — `client/src/components/AgentRail/index.ts`

---

**`AgentRail(): JSX.Element`**

- Reads `agents: Record<AgentRole, Agent>` and `hydrated: boolean` from `useAppState()`; iterates over the canonical role order `['pm','researcher','designer','developer','tester','documenter']` to render one `AgentCard` per slot, ensuring consistent visual ordering regardless of DB insertion order
- Renders a `w-64 flex-shrink-0 border-r border-gray-800 overflow-y-auto p-2` outer container with a `h-9 px-3 border-b border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center` header labelled "Agents"
- When `!hydrated`, renders 6 `h-[74px] rounded-lg border border-gray-800 bg-gray-900 animate-pulse` skeleton divs instead of real cards — prevents blank flash while the WS snapshot is in flight
- Derives `thoughts` for each card by filtering `useAppState().events` for `e.agent_role === role && e.event_type === 'thinking'`, mapping each to `ThoughtEntry` (`id`, `summary = payload.thinking?.slice(0,100)`, `fullText = payload.thinking`, `created_at`); passes the resulting array as the `thoughts` prop to each `AgentCard`

---

**`AgentCard({ agent, thoughts }: { agent: Agent; thoughts: ThoughtEntry[] }): JSX.Element`**

- Selects border + bg classes via a lookup on `agent.status`: `thinking → 'border-blue-800 bg-blue-950/30'`, `blocked → 'border-amber-800 bg-amber-950/20'`, `idle → 'border-gray-800 bg-gray-900'`; outer wrapper is `rounded-lg p-3 border transition-colors duration-150 cursor-pointer select-none`
- Renders a `flex items-center justify-between mb-1` header row: left side is the role emoji (`text-base`) + role label (`text-xs font-medium text-gray-300`); right side is `StatusBadge` receiving `agent.status`; click on the header row toggles `expanded` state when `thoughts.length > 0`
- Renders a `current_task` paragraph (`text-xs text-gray-500 leading-snug truncate mt-1`) only when `agent.status === 'thinking' && agent.current_task != null`; sets `title={agent.current_task}` on the `<p>` element so browsers show the full string on hover when it overflows
- Renders a `flex items-center justify-between mt-1.5` footer row: left is `AgentLastActionTime` — `relativeTime(agent.last_action_at)` in `text-[10px] text-gray-600`; right is `AgentTokenBadge` — `text-[9px] bg-gray-800 text-gray-600 px-1 py-0.5 rounded` showing `agent.last_phase_token_count` formatted as `1.2K` — rendered only when `last_phase_token_count > 0`
- Conditionally renders `ThoughtLogToggle` at card bottom only when `thoughts.length > 0`; below toggle renders `ThoughtLogPanel` when local `expanded` state is `true`; manages `expanded: boolean` via `useState(false)`, toggled by clicking either the header row or the toggle button

---

**`StatusBadge({ status }: { status: AgentStatus }): JSX.Element`**

- Renders `flex items-center gap-1 text-[10px]` span containing a `w-1.5 h-1.5 rounded-full` dot and a label string
- Dot colour map: `thinking → bg-blue-400 animate-pulse`, `blocked → bg-amber-400`, `idle → bg-gray-600`, `done → bg-green-500`; label colour map mirrors dot: `text-blue-400`, `text-amber-400`, `text-gray-500`, `text-green-500`
- Display-only component; no click handlers, no state

---

**`ThoughtLogToggle({ expanded, count, onToggle }: { expanded: boolean; count: number; onToggle: () => void }): JSX.Element`**

- Renders a `<button>` with classes `flex items-center justify-center w-full pt-1.5 mt-1.5 border-t border-gray-800 text-[10px] text-gray-600 hover:text-gray-400 transition-colors`
- Label when `expanded === false`: `∨ Reasoning (${count})`; label when `expanded === true`: `∧ Hide reasoning`
- Sets `title="Summarised by the model — not raw internal thoughts."` on the `<button>` element for a browser-native tooltip; calls `onToggle()` on click

---

**`ThoughtLogPanel({ thoughts }: { thoughts: ThoughtEntry[] }): JSX.Element`**

- Renders `mt-2` outer div with a `text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5` heading "Claude's Reasoning" and a `space-y-1.5 max-h-48 overflow-y-auto` scroll container
- Manages `expandedIds: Set<string>` via `useState(new Set<string>())`; toggling one entry's ID in the set does not affect others — no accordion restriction
- Each `ThoughtEntry` renders in a `py-1.5 border-b border-gray-900 last:border-0` container: summary text (`text-xs text-gray-400 leading-snug`), timestamp (`text-[10px] text-gray-600 mt-0.5`), and an expand/collapse `<button>` (`text-[10px] text-blue-400 hover:text-blue-300 mt-0.5`) labelled "Expand" / "Collapse"
- When an entry is expanded, renders the full text block immediately below the expand button: `font-mono text-xs text-gray-500 bg-gray-950/60 p-2 rounded mt-1 max-h-36 overflow-y-auto`; shows the raw `entry.fullText` string with no further truncation

---

### Task 32 — `client/src/components/FeedPanel.tsx`

---

**`FeedToolCallBlock({ toolName, args }: { toolName: string; args: Record<string, unknown> }): JSX.Element`**

- Manages `expanded: boolean` local state initialised to `false`; each block rendered on the page has its own independent expand state — no accordion; the only interaction is clicking anywhere on the header row to toggle `expanded`
- Renders a `mt-2 border border-gray-800 rounded overflow-hidden` outer container with two children: a header row (always visible) and a detail section (conditional on `expanded`)
- Header row: `flex items-center gap-2 px-3 py-1.5 bg-gray-900 cursor-pointer hover:bg-gray-800 transition-colors` containing `⚙` (`text-gray-500 text-xs`), tool name (`font-mono text-xs text-gray-400`), args preview (`text-xs text-gray-600 truncate flex-1` — first 50 chars of `JSON.stringify(args)`), and a `>` chevron (`text-gray-600 text-xs transition-transform duration-150`) that applies `rotate-90` when `expanded`
- Detail section (rendered only when `expanded`): `px-3 py-2 text-[11px] font-mono text-gray-500 bg-gray-950 max-h-56 overflow-y-auto` containing `JSON.stringify(args, null, 2)` in a `<pre>` tag — max-height prevents oversized payloads from pushing content off-screen
- Integration point in `FeedMessageRow`: detect `message.message_type === 'tool_call'` and parse `toolName` + `args` from `message.content` (JSON string with `{ tool: string, args: Record<string, unknown> }` shape); render `<FeedToolCallBlock>` instead of the existing markdown `FeedMessageContent` block for this message type; the `FeedTypeBadge` entry `tool_call → 'bg-gray-800 text-gray-500 border border-gray-700'` is already defined in the `TYPE_COLOUR` map

---

### Task 33 — `client/src/components/BlockerModal/index.ts`

---

**`BlockerModal(): JSX.Element | null`**

- Reads `blockerQueue: InboxMessage[]` and `sendWs` from `useAppState()`; returns `null` immediately when `blockerQueue.length === 0` so no DOM node exists in steady state
- Creates the portal via `ReactDOM.createPortal(<BlockerModalBackdrop ... />, document.body)` — rendering into `document.body` outside the `#root` subtree ensures the modal sits above all Tailwind `z-*` stacking contexts used by the main layout
- Shows `blockerQueue[0]` (lowest `created_at` first — the server must insert with `created_at = Date.now()`); passes `queueLength={blockerQueue.length}` and `queuePosition={1}` to the dialog; after a successful resolution the server emits `proposed_change_resolved` which triggers `PROPOSED_CHANGE_RESOLVED` in `useSnapshot`, removing the item from the queue and automatically revealing the next
- On submit actions calls `sendWs({ type: 'inbox_reply', id: message.id, reply })` (human_input), `sendWs({ type: 'inbox_approve', id: message.id })` (proposed_changes), or `sendWs({ type: 'inbox_reject', id: message.id })` (proposed_changes / budget_exceeded); all side effects are driven by the returned server WS event, not local state removal

---

**`BlockerModalDialog({ message, queueLength, queuePosition, onSubmitReply, onApprove, onReject }: BlockerModalDialogProps): JSX.Element`**

- Manages three local state fields: `reply: string` (controlled textarea value), `submitting: boolean` (disables all action buttons and replaces button text with a 12 px inline spinner), `error: string | null` (shown below the actions row as `text-xs text-red-400`); on submission error, sets `error` and resets `submitting` — modal stays open and all buttons re-enable
- Attaches `onKeyDown` to the backdrop `div` intercepting `e.key === 'Escape'` and calling `e.preventDefault()` to suppress default browser behaviour; the backdrop `onClick` handler calls `e.stopPropagation()` only — clicking outside the dialog has no effect
- Implements focus trap on mount via `useEffect`: queries the dialog `div` ref for all focusable elements (`button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`), calls `.focus()` on the first, and intercepts `Tab` / `Shift-Tab` to wrap from last to first and vice versa; effect cleanup removes the keydown listener
- Conditionally renders three section variants based on `message.message_type`: `human_input` → `BlockerReplyArea` (textarea + helper text) + `BlockerSubmitButton` (`bg-blue-700 text-white hover:bg-blue-600 disabled:opacity-40`); `proposed_changes` → `BlockerDiffView` below the body text + `BlockerRejectButton` (`border border-red-800 text-red-400 hover:bg-red-950/40`) + `BlockerApproveButton` (`bg-green-800 text-green-100 hover:bg-green-700`); `budget_exceeded` → `BlockerSpendTable` below the body text + `BlockerDismissButton` (`border border-gray-700 text-gray-400 hover:bg-gray-800`) only — no reply field
- Renders the queue counter in the header when `queueLength > 1`: `ml-auto text-xs text-gray-500 whitespace-nowrap` string `"${queuePosition} of ${queueLength} blockers"`

---

**`BlockerTypeBadge({ type }: { type: string }): JSX.Element`**

- Renders `<span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border">` with text derived from the `type` string (spaces replaced with underscores normalised to lowercase for the lookup key)
- Colour map: `human_input → 'bg-blue-900 text-blue-300 border-blue-700'`, `budget_exceeded → 'bg-amber-900 text-amber-300 border-amber-700'`, `proposed_changes → 'bg-violet-900 text-violet-300 border-violet-700'`, `phase_escalated → 'bg-red-900 text-red-300 border-red-700'`; unknown types fall back to `'bg-gray-800 text-gray-400 border-gray-700'`
- Display-only; no props other than `type`

---

**`BlockerReplyArea({ value, onChange, subType, error }: BlockerReplyAreaProps): JSX.Element`**

- Renders a `px-6 py-3 border-t border-gray-800` section containing: a `text-xs font-medium text-gray-400 mb-1.5` label "Your reply", a controlled `<textarea>` (`w-full bg-gray-800 border border-gray-700 rounded p-2.5 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none resize-none h-20`), and helper + error lines below
- Placeholder varies by `subType` prop: `'budget_warning' → "e.g. Continue, Increase budget to $20, Stop cycle…"`, `'phase_escalated' → "e.g. Retry, Skip this phase, Stop cycle…"`, all other values → `"Type your reply…"`
- Renders `text-[10px] text-gray-600 mt-1` helper text "Your reply will be interpreted automatically." unconditionally below the textarea
- When `error` is non-null, renders `text-xs text-red-400 mt-1` error string immediately below the helper line; the textarea border does not change colour on error — only the inline message is shown

---

**`BlockerDiffView({ diffContent }: { diffContent: string }): JSX.Element`**

- Renders a `mt-4 border border-gray-800 rounded overflow-hidden max-h-56 overflow-y-auto` wrapper; the `max-h-56` cap ensures the dialog body scroll absorbs any overflow before the dialog itself would exceed `max-h-[82vh]`
- Calls `parseDiff(diffContent)` from `react-diff-view/esm`; maps the resulting files array to `<Diff viewType="unified" diffType={file.type}>{file.hunks.map(hunk => <Hunk key={hunk.content} hunk={hunk} />)}</Diff>` all inside a `<div className="artifact-diff-view">` which applies the CSS overrides defined in `index.css` (same class as ArtifactDiffView — no duplication needed)
- When `diffContent` is empty or `parseDiff` returns an empty array, renders `<p className="text-xs text-gray-600 p-3">No diff available.</p>` instead of the diff component; no error thrown

---

**`BlockerSpendTable({ summary }: { summary: SpendSummary }): JSX.Element`**

- Renders a `mt-4 w-full text-xs border-collapse` `<table>` with two columns: left `text-gray-500 px-0 py-1` labels and right `text-gray-200 font-mono text-right` values; no `<thead>` — rows go directly in `<tbody>`
- Row set derived from `summary`: one row per phase with non-zero spend (label = phase name, value = `$X.XX`), followed by a `border-t border-gray-800` total row (`text-gray-300 font-semibold` label "Total today", value `$X.XX`)
- Renders nothing (returns `null`) when `summary.rows.length === 0`

---

### Task 34 — `client/src/components/SettingsView/index.ts`

**`SettingsView(): JSX.Element`**

- Renders two stacked sections (`flex flex-col gap-6 p-4 overflow-y-auto`): `SettingsBudgetSection` and `SettingsSelfModSection`.
- Calls `useAppState()` to read `preferences.budget_daily_usd` (fallback to `10`); initialises `inputValue: string` state from that value.
- On save: `PUT /api/projects/:id/preferences { budget_daily_usd: parseFloat(inputValue) }`; disables Save button and shows spinner in flight; on 200 sets `saved: boolean` for 2s via `setTimeout` then clears — shows `"Saved"` in `text-xs text-green-500`.
- Save button disabled when `inputValue` unchanged, non-numeric, or `parseFloat <= 0`; input border switches to `border-red-700` + inline `text-xs text-red-400` error `"Budget must be greater than $0."` on invalid.
- `SettingsSelfModSection`: display-only — `"SELF-MODIFICATION GATE"` label, `"ENABLED"` badge (`bg-green-900 text-green-400 border border-green-800 text-[10px] font-semibold px-2 py-0.5 rounded`), helper text `"Changes to /server/src/ require your approval. Scope can be extended to include prompts/."`.

---

### Task 35 — `client/src/App.tsx`

**`App(): JSX.Element`** — refactored shell

- Retains `projects: Project[]` and `selectedProject: Project | null` state + project-list fetch `useEffect`. All other state removed (~80 lines: `feedMessages`, `inboxMessages`, `agentUpdates`, `cycleRunning`, `cycleHistory`, `agentHistory`, `artifactDrawerPhase`, WS `useEffect` dispatch block).
- Wraps entire render tree in `<AppStateProvider projectId={selectedProject?.id ?? null}>`.
- Replaces `<AgentPanel>` with `<AgentRail>` (reads from context; no props).
- Replaces `<ArtifactDrawer>` with `<ArtifactView>` embedded in a center panel tab bar; local `activeTab: 'feed' | 'artifacts'` state; `onArtifactClick` from `CycleProgressBar` calls `setActiveTab('artifacts')`.
- Adds `<CycleProgressBar onArtifactClick={() => setActiveTab('artifacts')} />` pinned between `<TopBar>` and main layout.
- Adds `<BlockerModal />` unconditionally mounted (returns null when queue empty; reads queue from context).
- Adds `<ReconnectBanner />` and `<PinnedBlockerBanner />` at top of root div.
- Keeps `handleStartCycle` / `handleStopCycle` as local async functions passed to `<TopBar>` as props; project selection state remains App-level (not snapshot state).
