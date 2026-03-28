# Implementation Plan — Cycle 9

**Developer Agent** | Ouro Platform | 2026-03-28 | Rev 5

> **Scope:** Cycle 8 backend fully implemented (SDK migration, events table, artifact versioning,
> agent lifecycle emitters, phase events). Cycle 9: close backend gaps + full UI layer.
> 8 commits. Frontend-heavy cycle.

---

## Overview

Cycle 8 delivered the backend infrastructure (SDK migration, events table, artifact versioning).
Cycle 9 wires the remaining backend plumbing (budget gate, blocking inbox, proposed_changes schema,
filtered events query) and builds the full UI layer: BudgetBar, CycleProgressBar, AgentCard
extensions, ThoughtLogPanel, ArtifactHistoryPanel + diff viewer, and BlockerModal.

**Build retry 2/3 — carry-over issues addressed in Commit 1:**
- **GH#13 (doc fix):** Build plan rev 4 said "8 columns" but listed 7. DDL is correct — no code change.
- **GH#14 (costUsd):** `emitAgentCompleted` stores only `inputTokens`/`outputTokens`. Commit 1 adds `costUsd` + `thinkingContent` to the payload so budget sums and ThoughtLogPanel both work.
- **GH#15 (temp cleanup):** `saveArtifact` finally block spawns non-awaited `rm` subprocesses. Commit 1 replaces with `await Bun.file(path).delete().catch(()=>{})`.
- **GH#16 (agents endpoint):** `GET /api/projects/:id/agents` returns raw DB rows with no token fields. Commit 1 extends the handler to join the latest `agent_completed` event per role and attach `last_phase_input_tokens`, `last_phase_output_tokens`, `last_phase_cost_usd`, `last_thinking_blocks` to each Agent row.

---

## Current State

| Layer | Status | Notes |
|---|---|---|
| `server/src/claude.ts` | ⚠️ Gap | SDK+mock done; missing `costUsd` in `ClaudeRunResult` (GH#14) |
| `server/src/db.ts` | ⚠️ Gap | events+artifacts done; missing `getEventsFiltered`, `getDailySpend`, `sendBlockingInboxMessage`, `getBlockingInboxMessages`; schema missing `blocks_cycle`/`proposed_change_id`/`proposed_changes`; `saveArtifact` tmp cleanup fire-and-forget (GH#15) |
| `server/src/agents/base.ts` | ⚠️ Gap | emit helpers wired; `emitAgentCompleted` missing `costUsd`+`thinkingContent` in payload (GH#14) |
| `server/src/agents/*.ts` (×6) | ✅ Done | cycleId param + emit helpers wired |
| `server/src/loop.ts` | ⚠️ Gap | `phase_change` emits only `{phase}` — missing `phaseStates`; no `artifact_saved` or `budget_update` broadcasts; no budget gate |
| `server/src/index.ts` | ⚠️ Gap | Missing: `GET /budget/today`, `GET /events`; `GET /artifacts` lacks `?phase=&filename=` branch; `GET /agents` returns raw rows without token fields (GH#16) |
| `client/src/` | ⚠️ Partial | App, TopBar, AgentPanel, FeedPanel, InboxPanel, ArtifactDrawer exist; all Cycle 9 components absent |

**Schema gaps (idempotent ALTER/CREATE needed):**
- `inbox_messages` missing `blocks_cycle INTEGER DEFAULT 0`
- `inbox_messages` missing `proposed_change_id TEXT`
- `proposed_changes` table does not exist

---

## File Structure

```
server/src/
  db.ts           ← add getEventsFiltered(); migrate inbox_messages; add proposed_changes table
  index.ts        ← add GET /budget/today, GET /events, extend GET /artifacts
  loop.ts         ← add artifact_saved + budget_update WS broadcasts after each phase step

client/src/
  types.ts        ← extend Agent, Artifact; add ArtifactVersion, BudgetStatus, PhaseStatus, ProposedChange; extend WsEvent
  api.ts          ← add api.budget.today(), api.events.list(), api.artifacts.history()
  App.tsx         ← budgetStatus, phaseStates, historyPanel, blockerMessages state + WS handlers + warning banner
  components/
    TopBar.tsx               ← extend: slot CycleProgressBar + BudgetBar; pass props through
    BudgetBar.tsx            ← NEW
    CycleProgressBar.tsx     ← NEW
    AgentPanel.tsx           ← extend AgentCard: token spend line, ThoughtLogToggle
    ThoughtLogPanel.tsx      ← NEW (inline expand below AgentCard)
    ArtifactDrawer.tsx       ← extend: History icon button per artifact row
    ArtifactHistoryPanel.tsx ← NEW (fixed right drawer, z-40, w-[720px])
    ArtifactVersionList.tsx  ← NEW
    ArtifactVersionItem.tsx  ← NEW
    ArtifactDetailPane.tsx   ← NEW (Content / Diff tabs)
    ArtifactContentView.tsx  ← NEW (raw pre, no markdown rendering)
    ArtifactDiffView.tsx     ← NEW (react-diff-view/esm)
    BlockerModal.tsx         ← NEW (portal, focus-trap, queue, wiggle on Escape)
    ProposedChangeModal.tsx  ← NEW (BlockerModal variant, max-w-3xl, two-step Approve)

client/package.json   ← add react-diff-view ^3.1.0
tailwind.config.ts    ← add wiggle keyframes
```

---

## Data Shapes

```typescript
// ─── client/src/types.ts additions ───────────────────────────────────────────

export interface ArtifactVersion {
  id: string;
  project_id: string;
  phase: string;
  filename: string;
  content: string;
  version: number;
  cycle_id: string | null;
  previous_version_id: string | null;
  diff_from_previous: string | null;   // raw unified diff string
  created_at: number;
}

export interface BudgetStatus {
  spentUsd: number;   // sum of today's agent_completed event costs
  limitUsd: number;   // preferences key='budget_daily_usd', default 10.00
}

export type PhaseStatus = 'pending' | 'active' | 'complete' | 'failed' | 'retrying';

// Extend existing Agent (client + server types)
export interface Agent {
  id: string;
  project_id: string;
  role: string;
  status: 'idle' | 'thinking' | 'blocked' | 'error' | 'complete';
  current_task: string | null;
  last_action_at: number | null;
  last_phase_input_tokens: number;    // default 0; from latest agent_completed event
  last_phase_output_tokens: number;   // default 0
  last_phase_cost_usd: number;        // default 0; computed: in * 3/1e6 + out * 15/1e6
  last_thinking_blocks: string[];     // default []; from thinkingContent of latest event
}

// Extend InboxMessage (client)
export interface InboxMessage {
  // ...existing fields...
  blocks_cycle: number;               // 0 or 1
  proposed_change_id: string | null;
}

export interface ProposedChange {
  id: string;
  project_id: string;
  inbox_message_id: string;
  filepath: string;
  diff_content: string;               // full replacement file content
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: number;
}

// Extend WsEvent union
export type WsEvent =
  | { event: 'feed_message';   projectId: string; data: FeedMessage }
  | { event: 'inbox_message';  projectId: string; data: InboxMessage }
  | { event: 'agent_status';   projectId: string; data: { role: string; status: string; current_task?: string | null } }
  | { event: 'phase_change';   projectId: string; data: { phase: string; phaseStates: Record<string, PhaseStatus> } }
  | { event: 'cycle_update';   projectId: string; data: { cycleId: string; status: string } }
  | { event: 'artifact_saved'; projectId: string; data: ArtifactVersion }
  | { event: 'budget_update';  projectId: string; data: BudgetStatus };
```

---

## API Contract

**New endpoints:**

| Method | Path | Query | Response |
|---|---|---|---|
| `GET` | `/api/projects/:id/budget/today` | — | `{ spentUsd: number, limitUsd: number }` |
| `GET` | `/api/projects/:id/events` | `agentRole?`, `type?`, `limit?=20` | `Event[]` |
| `GET` | `/api/projects/:id/artifacts` | `?phase=X&filename=Y` (both required) | `ArtifactVersion[]` |

**Modified:**
- `GET /api/projects/:id/artifacts` — without `phase`+`filename` query params: existing `listArtifacts()` (no breaking change); with both: `getArtifactHistory()`

**New WS events (broadcast from `loop.ts`):**
- `artifact_saved` — after `saveArtifact()` in `runPhaseStep`; payload = full Artifact row
- `budget_update` — after each `agent_completed` event; payload = `BudgetStatus`
- `budget_exceeded` (via existing `phase_change`) — no separate WS event; client infers from `budget_update` when `spentUsd >= limitUsd`

**Modified WS event:**
- `phase_change` — extend payload to include `phaseStates: Record<string, PhaseStatus>` derived from `cycle.phase_outcomes`

---

## Key Functions

### Carry-over fixes (Commit 1) — `server/src/claude.ts`

**`runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult>`**
- Adds `INPUT_PRICE_PER_MTOK = 3` and `OUTPUT_PRICE_PER_MTOK = 15` module-level constants
- Adds `costUsd?: number` to `ClaudeRunResult` interface
- Computes `costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000` in `execute()` return value
- Mock fallback sets `costUsd: 0`; timeout path and auth-error path are unchanged

### Carry-over fixes (Commit 1) — `server/src/agents/base.ts`

**`emitAgentCompleted(meta, tokens)`**
- Signature widens tokens param: `{ inputTokens: number; outputTokens: number; costUsd: number; thinkingContent?: string }`
- Adds `costUsd` and `thinkingContent` to the `insertEvent` payload so budget sums and ThoughtLogPanel both work
- All six call sites updated to pass `costUsd: result.costUsd ?? 0, thinkingContent: result.thinkingContent`

### Carry-over fixes (Commit 1) — `server/src/index.ts` (GH#16)

**`GET /api/projects/:id/agents` (extend)**
```typescript
.get("/api/projects/:id/agents", ({ params }) => {
  const agents = getAgentsForProject(params.id);
  const enriched = agents.map(agent => {
    const latestEvent = getEventsFiltered(params.id, {
      agentRole: agent.role, type: 'agent_completed', limit: 1
    })[0];
    const payload = latestEvent?.payload ?? {};
    return {
      ...agent,
      last_phase_input_tokens: (payload.inputTokens as number) ?? 0,
      last_phase_output_tokens: (payload.outputTokens as number) ?? 0,
      last_phase_cost_usd: (payload.costUsd as number) ?? 0,
      last_thinking_blocks: payload.thinkingContent
        ? [(payload.thinkingContent as string)]
        : [],
    };
  });
  return enriched;
})
```

### Carry-over fixes (Commit 1) — `server/src/db.ts` (GH#15)

**`saveArtifact()` finally block**
- Replace both `Bun.spawn(["rm", "-f", tmpA])` one-liners with `await Bun.file(tmpA).delete().catch(() => {})`
- `Bun.file().delete()` is the Bun-native unlink; `.catch(() => {})` swallows "file not found" so finally never throws
- Both `tmpA` and `tmpB` cleaned up regardless of diff success/failure

### Commit 1 — server/src/db.ts

**`getEventsFiltered(projectId, opts): Event[]`**
- `opts: { cycleId?: string; agentRole?: string; type?: EventType; limit?: number }`
- Dynamic WHERE clause; `ORDER BY created_at DESC LIMIT ?`

**`sendBlockingInboxMessage(projectId, senderRole, subject, body): InboxMessage`**
- Inserts with `blocks_cycle=1`; used by budget gate in loop.ts

**`getBlockingInboxMessages(projectId): InboxMessage[]`**
- `WHERE project_id=? AND blocks_cycle=1 AND replied_at IS NULL`; used by loop to detect active blockers

**`getDailySpend(projectId): number`**
- Filters today's `agent_completed` events; sums `inputTokens * 3/1e6 + outputTokens * 15/1e6` from `payload`
- Used by budget gate in loop.ts

**Schema migrations:**
```typescript
try { db.run("ALTER TABLE inbox_messages ADD COLUMN blocks_cycle INTEGER DEFAULT 0"); } catch {}
try { db.run("ALTER TABLE inbox_messages ADD COLUMN proposed_change_id TEXT"); } catch {}
db.run(`CREATE TABLE IF NOT EXISTS proposed_changes (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL,
  inbox_message_id  TEXT NOT NULL,
  filepath          TEXT NOT NULL,
  diff_content      TEXT NOT NULL,
  status            TEXT DEFAULT 'PENDING',
  created_at        INTEGER NOT NULL
)`);
```

Also add `'budget_exceeded'` to `EventType` union in db.ts.

### Commit 1 — server/src/index.ts

**`GET /api/projects/:id/budget/today`**
- `todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0); todayMidnight.getTime()`
- Query `getEventsFiltered(id, { type: 'agent_completed' })` then filter `created_at >= todayMidnight`
- Sum: `inputTokens * 3/1_000_000 + outputTokens * 15/1_000_000` per event
- `limitUsd = parseFloat(getPreference(id, 'budget_daily_usd') ?? '10')`
- Returns `{ spentUsd, limitUsd }`

**`GET /api/projects/:id/events`**
- Query params → `getEventsFiltered(id, { agentRole, type, limit: parseInt(limit ?? '20') })`

**`GET /api/projects/:id/artifacts` (extended)**
- If `query.phase && query.filename` → `getArtifactHistory(id, query.phase, query.filename)`
- Otherwise → existing `listArtifacts(id)`

### Commit 1 — server/src/loop.ts

After `saveArtifact(...)` in `runPhaseStep`:
```typescript
broadcast(projectId, 'artifact_saved', artifact);
```

After `insertEvent({ type: 'agent_completed' })` in `runPhaseStep`:
```typescript
const spentUsd = getDailySpend(projectId);
const limitUsd = parseFloat(getPreference(projectId, 'budget_daily_usd') ?? '10');
broadcast(projectId, 'budget_update', { spentUsd, limitUsd });
```

**Budget gate** — add at TOP of `runPhaseStep` (before agent runs), also checked after `agent_completed`:
```typescript
const spent = getDailySpend(projectId);
const limit = parseFloat(getPreference(projectId, 'budget_daily_usd') ?? '10');
if (spent >= limit) {
  insertEvent({ projectId, cycleId, type: 'budget_exceeded', payload: { spentUsd: spent, limitUsd: limit } });
  sendBlockingInboxMessage(
    projectId, 'pm',
    'Daily budget reached',
    `Daily budget of $${limit.toFixed(2)} reached ($${spent.toFixed(2)} spent). Approve to continue or adjust limit.`
  );
  broadcast(projectId, 'budget_update', { spentUsd: spent, limitUsd: limit });
  // Caller (runCycle) checks stop flag — budget blocker halts after current phase
  stopCycle(projectId);
  return;
}
```

Extend `phase_change` broadcast:
```typescript
// derive phaseStates from phaseOutcomes + current active phase
broadcast(projectId, 'phase_change', { phase, phaseStates: derivePhaseStates(phase, phaseOutcomes) });
```

### Commit 4 — BudgetBar

**`BudgetBar({ status, onOpenInbox })`**
- Props: `{ status: BudgetStatus; onOpenInbox: () => void }`
- Colour logic (ratio = spentUsd / limitUsd): `< 0.5` → `text-gray-400`; `0.5–0.79` → `text-amber-400`; `0.8–0.99` → `text-orange-500 font-medium`; `≥ 1` → `text-red-500 font-bold`
- Label: `$1.23 / $10.00` (`.toFixed(2)` always)
- Warning banner rendered by App.tsx below TopBar when ratio ≥ 0.8

### Commit 4 — CycleProgressBar

**`CycleProgressBar({ phaseStates })`**
- Props: `{ phaseStates: Record<string, PhaseStatus> }`
- 7 nodes in order: `research → spec → design-draft → design-final → build → test → review`
- Node classes: `pending=bg-gray-800 text-gray-500`, `active=bg-blue-600 text-blue-100 animate-pulse`, `complete=bg-green-700 text-green-100`, `failed=bg-red-700 text-red-100`, `retrying=bg-amber-700 text-amber-100`
- Connector: `flex-1 h-px bg-gray-800`; `bg-green-700` when both adjacent nodes complete
- Tooltip per node via `title` attribute

### Commit 5 — AgentCard + ThoughtLogPanel

**`ThoughtLogPanel({ agentRole, projectId })`**
- Fetch `GET /api/projects/:id/events?agentRole={role}&type=agent_completed&limit=1`
- Extract `payload.thinkingBlocks` (string[]) or empty array
- States: `loading` (3 animated skeleton lines), `empty` ("No reasoning blocks for this phase."), `populated`, `error` ("Could not load reasoning.")
- Typography: `font-mono text-[11px] text-gray-400 whitespace-pre-wrap leading-relaxed`
- Header right: ⓘ with `title="Summarised thinking returned by Claude Sonnet 4.6 — not raw internal monologue."`

**AgentCard token spend line:**
- Only render when `last_phase_input_tokens + last_phase_output_tokens > 0`
- Format: `((in + out) / 1000).toFixed(1)k tok · $cost`
- ThoughtLogToggle only renders when `last_thinking_blocks.length > 0`

### Commit 6 — ArtifactHistoryPanel

**`ArtifactHistoryPanel({ projectId, phase, filename, onClose })`**
- Props: `{ projectId: string; phase: string; filename: string; onClose: () => void }`
- Mount → `api.artifacts.history(projectId, phase, filename)` → auto-select `versions[versions.length - 1]`
- WS `artifact_saved` matching phase+filename → refetch; show "New version available ↑" at list top
- Layout: `fixed top-12 right-0 bottom-0 w-[720px] z-40 bg-gray-950 border-l border-gray-800 flex flex-col`
- Escape keydown + backdrop click → `onClose()`

**`ArtifactDiffView({ diff, previousVersionLabel })`**
- Props: `{ diff: string | null; previousVersionLabel: string }`
- `import { parseDiff, Diff, Hunk } from 'react-diff-view/esm'`
- null/empty diff → `text-gray-500 italic "Diff unavailable for this version."`

### Commit 7 — BlockerModal + ProposedChangeModal

**`BlockerModal({ messages, onResolve })`**
- Props: `{ messages: InboxMessage[]; onResolve: (msgId: string, reply: string, action: string) => void }`
- `createPortal(…, document.body)` — `fixed inset-0 z-50`
- Focus trap: `useEffect` keydown on mount; Tab cycles `[textarea, ...buttons]`
- Escape → `wiggling=true` → `animate-[wiggle_0.3s_ease-in-out]`; never dismisses
- Queue: ProposedChange messages sorted first; counter "Blocker N of M" top-right when N > 1

**`ProposedChangeModal({ proposedChange, message, onResolve })`**
- Props: `{ proposedChange: ProposedChange; message: InboxMessage; onResolve: (action: 'approve' | 'reject' | 'stop') => void }`
- Dialog: `max-w-3xl max-h-[80vh] flex flex-col`
- Embeds `ArtifactDiffView` with `proposedChange.diff_content`
- "Approve & Apply": click 1 → `confirmStep=true` (inline confirm row); click 2 → `onResolve('approve')`
- "Reject" / "Stop Cycle": single-click, no confirm

---

## Component Breakdown

| Component | New/Ext | Key Props | Local State |
|---|---|---|---|
| `BudgetBar` | new | `status: BudgetStatus, onOpenInbox` | — |
| `CycleProgressBar` | new | `phaseStates: Record<string, PhaseStatus>` | `hoveredPhase: string \| null` |
| `TopBar` | ext | `+phaseStates, +budgetStatus, +onOpenInbox` | existing |
| `AgentCard` (in AgentPanel) | ext | `+last_phase_input_tokens, +last_thinking_blocks` | `showThoughtLog: boolean` |
| `ThoughtLogPanel` | new | `agentRole, projectId` | `data, loading, error` |
| `ArtifactDrawer` | ext | `+onHistoryOpen: (phase, filename) => void` | existing |
| `ArtifactHistoryPanel` | new | `projectId, phase, filename, onClose` | `versions, selectedId, activeTab, newVersionAvailable` |
| `ArtifactVersionList` | new | `versions, selectedId, onSelect, loading` | — |
| `ArtifactVersionItem` | new | `version: ArtifactVersion, isSelected, onClick` | — |
| `ArtifactDetailPane` | new | `version: ArtifactVersion \| null` | `activeTab: 'content' \| 'diff'` |
| `ArtifactContentView` | new | `content: string` | — |
| `ArtifactDiffView` | new | `diff: string \| null, previousVersionLabel: string` | — |
| `BlockerModal` | new | `messages: InboxMessage[], onResolve` | `reply, wiggling` |
| `ProposedChangeModal` | new | `proposedChange, message, onResolve` | `confirmStep: boolean` |

**App.tsx new state:**
- `budgetStatus: BudgetStatus | null` — initialised from GET /budget/today; updated on `budget_update` WS
- `phaseStates: Record<string, PhaseStatus>` — updated on `phase_change` WS (new `phaseStates` field in payload)
- `historyPanel: { phase: string; filename: string } | null`
- `blockerMessages: InboxMessage[]` — `inbox.filter(m => m.blocks_cycle === 1 && !m.replied_at)`

---

## Commit Plan

```
1. feat(api): budget/today, events query, artifact history endpoints + schema migrations + WS broadcasts + budget gate
   Files: server/src/db.ts, server/src/index.ts, server/src/loop.ts,
          server/src/agents/base.ts, server/src/agents/{pm,researcher,designer,developer,tester,documenter}.ts
   - getEventsFiltered(), getDailySpend(), sendBlockingInboxMessage(), getBlockingInboxMessages() in db.ts
   - ALTER TABLE inbox_messages add blocks_cycle + proposed_change_id (idempotent)
   - CREATE TABLE IF NOT EXISTS proposed_changes
   - budget_exceeded added to EventType union
   - GET /budget/today (token cost computed from events)
   - GET /events (filtered by agentRole, type, limit)
   - GET /artifacts extended with ?phase=&filename= query (non-breaking)
   - loop.ts: artifact_saved broadcast after saveArtifact
   - loop.ts: budget gate before each runPhaseStep; halt + blocking inbox at >= limit
   - loop.ts: budget_update broadcast after agent_completed emit
   - loop.ts: phase_change payload extended with phaseStates derived from phase_outcomes
   [GH#14] base.ts: widen emitAgentCompleted tokens param → add costUsd + thinkingContent; include in payload
   [GH#14] agents/*.ts: all six runners pass costUsd: result.costUsd ?? 0, thinkingContent: result.thinkingContent
   [GH#14] claude.ts: add INPUT_PRICE_PER_MTOK=3, OUTPUT_PRICE_PER_MTOK=15; compute costUsd in runClaude()
   [GH#15] db.ts saveArtifact finally: replace Bun.spawn(["rm",...]) with await Bun.file(path).delete().catch(()=>{})
   [GH#16] index.ts: extend GET /agents to enrich each row with last_phase_* fields from latest agent_completed event

2. chore(deps): add react-diff-view to client
   Files: client/package.json, bun.lock
   - bun add react-diff-view@^3.1.0 in client/
   - import react-diff-view/style/index.css in client/src/main.tsx
   - add to vite.config.ts optimizeDeps.include if ESM issues arise (ref GH#3 C2)

3. feat(types): extend client types + api helpers
   Files: client/src/types.ts, client/src/api.ts
   - ArtifactVersion, BudgetStatus, PhaseStatus, ProposedChange interfaces
   - Extend Agent with last_phase_* + last_thinking_blocks
   - Extend InboxMessage with blocks_cycle, proposed_change_id
   - Extend WsEvent union with artifact_saved, budget_update; extend phase_change payload type
   - api.budget.today(projectId), api.events.list(projectId, opts), api.artifacts.history(projectId, phase, filename)

4. feat(ui): BudgetBar + CycleProgressBar in TopBar
   Files: client/src/components/BudgetBar.tsx (new)
          client/src/components/CycleProgressBar.tsx (new)
          client/src/components/TopBar.tsx (extend)
          client/src/App.tsx (wire budgetStatus + phaseStates; warning banner below TopBar when ratio ≥ 0.8)
          tailwind.config.ts (wiggle keyframes)

5. feat(agents): extend AgentCard with token spend and ThoughtLogPanel
   Files: client/src/components/AgentPanel.tsx (extend AgentCard render)
          client/src/components/ThoughtLogPanel.tsx (new)
   - Token spend line (only when tokens > 0): "1.2k tok · $0.03"
   - ThoughtLogToggle "Reasoning →" (only when thinkingBlocks.length > 0)
   - ThoughtLogPanel: loading/empty/populated/error states; mono font

6. feat(artifacts): ArtifactHistoryPanel + version list + diff viewer
   Files: client/src/components/ArtifactHistoryPanel.tsx (new)
          client/src/components/ArtifactVersionList.tsx (new)
          client/src/components/ArtifactVersionItem.tsx (new)
          client/src/components/ArtifactDetailPane.tsx (new)
          client/src/components/ArtifactContentView.tsx (new)
          client/src/components/ArtifactDiffView.tsx (new, react-diff-view/esm)
          client/src/components/ArtifactDrawer.tsx (extend: History icon button per row)
          client/src/App.tsx (historyPanel state; ArtifactDrawer right-[720px] when panel open)

7. feat(blockers): BlockerModal + ProposedChangeModal
   Files: client/src/components/BlockerModal.tsx (new)
          client/src/components/ProposedChangeModal.tsx (new)
          client/src/App.tsx (derive blockerMessages; render portal modals)

8. feat(app): WS reconnect indicator + budget halt UX
   Files: client/src/App.tsx, client/src/hooks/useWebSocket.ts
   - WS disconnect: pulsing "Reconnecting..." dot in TopBar next to project name
   - On reconnect: snapshot WS event restores full project state
   - Budget ≥ 100%: push synthetic blocking inbox message into blockerMessages queue
```

---

## Open Questions

1. **`phaseStates` source of truth:** `phase_change` payload currently only emits `{ phase: string }`. Commit 1 extends it to include `phaseStates: Record<string, PhaseStatus>` derived from `phase_outcomes` in `loop.ts`. Client `CycleProgressBar` reads this directly — no separate polling endpoint needed.

2. **Self-mod gate (Story 5) scope:** `proposed_changes` table is added in Commit 1 but the intercept logic (agent path → gate → pending change + blocking inbox) is not planned in this cycle. `ProposedChangeModal` (Commit 7) can render with empty diff and "Self-mod gate not yet active" if no `proposed_change_id` is present. Confirm with Chris before Commit 7.

3. **react-diff-view ESM (GH#3 C2):** v3.1.0+ ships ESM. If `parseDiff` import fails under Vite, fallback: render `diff_from_previous` as `<pre>` with manual line colouring (`line.startsWith('+')` → green, `'-'` → red). Confirm in Commit 2 before building `ArtifactDiffView` in Commit 6.

4. **ThoughtLog vs extended thinking:** No agent currently sets `thinkingBudget > 0`. `ThoughtLogPanel` will always render "No reasoning blocks" and `ThoughtLogToggle` will never appear. Correct per spec — UI is ready when thinking is enabled.

5. ~~**`costUsd` in event payload:** optional / low priority~~ — **Resolved (GH#14).** `costUsd` is added to `emitAgentCompleted` payload in Commit 1 alongside the other db.ts / agent changes. Formula: `(inputTokens * 3 + outputTokens * 15) / 1_000_000`. Constants `INPUT_PRICE_PER_MTOK=3` and `OUTPUT_PRICE_PER_MTOK=15` live in `claude.ts`; field flows through `ClaudeRunResult → emitAgentCompleted → events.payload`.

---

*Build Plan — Developer Agent | Ouro Platform | 2026-03-28 | Rev 5*
