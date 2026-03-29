# Build Tasks — Cycle 10

1. [server/src/db.ts] — add idempotent `ALTER TABLE feed_messages ADD COLUMN thinking_content TEXT` migration
2. [server/src/db.ts] — add idempotent `ALTER TABLE cycles ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0` migration
3. [server/src/db.ts] — add `DAILY_BUDGET_LIMIT = 10.0` constant and `dailySpend(projectId): number` helper (sums events.cost_usd since UTC midnight)
4. [server/src/db.ts] — add `addCycleCost(cycleId: string, delta: number): void` helper (atomic increment on cycles.cost_usd)
5. [server/src/db.ts] — extend `CycleRow`/`CycleRun` with `cost_usd: number`; update `parseCycleRow` and `createCycleRecord` to include it
6. [server/src/db.ts] — extend `FeedMessage` interface with `thinking_content: string | null`; add optional 6th param `thinkingContent` to `postFeedMessage`
7. [server/src/claude.ts] — add `thinkingContent?: string` to `ClaudeRunResult`; collect `b.type === "thinking"` blocks in parse loop; join with `\n\n`
8. [server/src/agents/base.ts] — add `costUsd: number` (required) and `thinkingContent?: string | null` to `AgentResult` interface
9. [server/src/agents/researcher.ts] — return `costUsd: totalCost` in final return statement
10. [server/src/agents/pm.ts] — return `costUsd: result.costUsd` in final return statement
11. [server/src/agents/designer.ts] — return `costUsd: totalCost` in final return statement
12. [server/src/agents/developer.ts] — return `costUsd: totalCost` in final return statement
13. [server/src/agents/tester.ts] — return `costUsd: totalCost` in final return statement (0 for Playwright path)
14. [server/src/agents/documenter.ts] — return `costUsd: result.costUsd` in final return statement
15. [server/src/loop.ts] — import `addCycleCost`, `dailySpend`, `DAILY_BUDGET_LIMIT`; add `broadcastSpendUpdate(projectId)` module helper; call after each successful phase
16. [server/src/loop.ts] — pass `result.thinkingContent ?? undefined` as 6th arg to handoff `postFeedMessage` call
17. [server/src/index.ts] — add `GET /api/projects/:id/spend/today` route returning `{ spend: dailySpend(id), limit: DAILY_BUDGET_LIMIT }`
18. [server/src/index.ts] — extend `GET /api/projects/:id/cycles` query with `LEFT JOIN events` to include `total_cost_usd` per cycle row
19. [client/src/types.ts] — add `thinking_content: string | null` to `FeedMessage`; `blocks_cycle: number` to `InboxMessage`; `total_cost_usd?: number` to `CycleRun`; new `SpendResponse` interface; `spend_updated` variant to `WsEvent` union
20. [client/src/api.ts] — add `spend.today(projectId: string)` method calling `GET /projects/:id/spend/today`
21. [client/src/App.tsx] — add `dailySpend` state, fetch+30s-poll useEffect on project change, `spend_updated` WS handler, `budgetHalted` and `hasBlocker` derived values; pass all to TopBar
22. [client/src/components/TopBar.tsx] — add `SpendIndicator` inline sub-component (4 colour thresholds: gray/amber/orange/red); extend `TopBarProps` with spend/inbox/blocker props
23. [client/src/components/TopBar.tsx] — add `InboxBadge` inline sub-component (blue/amber dot, onInboxClick); insert both indicators in right-side layout; disable StartCycleButton with tooltip when `budgetHalted && !cycleRunning`
24. [client/src/components/FeedPanel.tsx] — add `ReasoningToggle` inline sub-component; render after message body when `thinking_content` truthy; add `$X.XX` cost span to `CycleHistoryRow` when `total_cost_usd > 0`
25. [client/src/components/ArtifactDrawer.tsx] — replace `<pre>` block with `MarkdownContent` inline sub-component backed by `renderMarkdown` line-by-line state machine and `applyInline` formatter

---

---

## Test Failure Analysis (Cycle 10, Attempt 3)

The tester reported **34 passed / 12 failed** across 46 Playwright acceptance criteria. A codebase audit confirms **all 13 Cycle 10 features are unimplemented** — the failures are not plan deficiencies but unwritten code. The plan below addresses every failure point.

| Failure | Root cause | Addressed in tasks |
|---|---|---|
| `SpendIndicator` not rendered in TopBar | Component doesn't exist | Tasks 21–22 |
| `InboxBadge` not rendered in TopBar | Component doesn't exist | Tasks 21–22 |
| StartCycleButton not disabled at budget limit | `budgetHalted` derived value absent | Tasks 21–22 |
| `$X.XX / $10.00 today` text not found | No spend state or polling | Tasks 20–22 |
| `spend_updated` WS events not handled | No WS handler branch | Task 21 |
| `ReasoningToggle` button not found | Component doesn't exist | Task 23 |
| Reasoning content not expandable | No toggle state | Task 23 |
| `$X.XX` not shown in CycleHistoryRow | `total_cost_usd` absent from type/query | Tasks 19, 24 |
| Artifact content not rendered as markdown | `<pre>` not replaced with `MarkdownContent` | Task 25 |
| `## headings` not styled in artifact drawer | MarkdownContent missing | Task 25 |
| `thinking_content` not stored in feed messages | DB column + postFeedMessage param missing | Tasks 1, 6, 16 |
| Daily spend not tracked server-side | `dailySpend()` / `addCycleCost()` missing | Tasks 2–4, 15, 17 |

**Conclusion:** The 25-task plan below is complete and correct. All 12 failure areas are covered. No plan changes required — the code simply needs to be written.

---

## Overview

Three UI stories drive this cycle:
1. **Reasoning toggle** — feed messages expose Claude's thinking blocks behind a collapsible `▸ Reasoning` button.
2. **Daily spend indicator** — TopBar shows `$X.XX / $10.00 today` with colour thresholds; StartCycleButton disabled at budget limit.
3. **Artifact markdown rendering** — `ArtifactDrawer` replaces raw `<pre>` with a minimal line-by-line renderer.

Plus supporting plumbing: `thinking_content` DB column, `costUsd` propagation through all agents, `spend_updated` WS broadcast, and `GET /api/projects/:id/spend/today`.

---

## File Structure

```
server/src/
  db.ts                        [MOD] — thinking_content migration, cost_usd on cycles, dailySpend, addCycleCost
  claude.ts                    [MOD] — thinkingContent field on ClaudeRunResult
  agents/
    base.ts                    [MOD] — costUsd + thinkingContent on AgentResult
    researcher.ts              [MOD] — return costUsd
    pm.ts                      [MOD] — return costUsd
    designer.ts                [MOD] — return costUsd
    developer.ts               [MOD] — return costUsd
    tester.ts                  [MOD] — return costUsd
    documenter.ts              [MOD] — return costUsd
  loop.ts                      [MOD] — addCycleCost, broadcastSpendUpdate, pass thinkingContent to postFeedMessage
  index.ts                     [MOD] — GET /api/projects/:id/spend/today

client/src/
  types.ts                     [MOD] — thinking_content, blocks_cycle, total_cost_usd, SpendResponse, spend_updated WsEvent
  api.ts                       [MOD] — spend.today()
  App.tsx                      [MOD] — dailySpend state, polling, WS handler, derived values, TopBar props
  components/
    TopBar.tsx                 [MOD] — SpendIndicator, InboxBadge inline sub-components; TopBarProps extended
    FeedPanel.tsx              [MOD] — ReasoningToggle inline sub-component; CycleHistoryRow cost display
    ArtifactDrawer.tsx         [MOD] — MarkdownContent inline sub-component replaces <pre>
```

---

## Data Shapes

```ts
// db.ts / types.ts additions

export interface FeedMessage {           // server + client
  // ... existing fields ...
  thinking_content: string | null;       // NEW — NULL for old rows and mock runs
}

export interface CycleRun {             // server + client
  // ... existing fields ...
  cost_usd: number;                     // server: NOT NULL DEFAULT 0
  // client adds total_cost_usd?: number (optional for backwards compat)
}

export interface SpendResponse {        // client only
  spend: number;    // USD float, e.g. 0.42
  limit: number;    // USD float, always 10.0 for now
}

export interface AgentResult {          // agents/base.ts
  content: string;
  summary: string;
  costUsd: number;                      // NEW — required field; 0 for mock/Playwright runs
  thinkingContent?: string | null;      // NEW — optional, only for agents that use Claude
}

export interface ClaudeRunResult {      // claude.ts
  content: string;
  real: boolean;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  toolUses: Array<{ id: string; name: string; input: unknown }>;
  thinkingContent?: string;            // NEW — joined thinking blocks, undefined if none
}
```

---

## API Contract

### `GET /api/projects/:id/spend/today`

**Response 200:**
```json
{ "spend": 0.42, "limit": 10.0 }
```
**Response 404:** `{ "message": "Project not found" }`

**Logic:** calls `dailySpend(projectId)` which sums `events.cost_usd` since UTC midnight.

### `GET /api/projects/:id/cycles` — extended

Extend existing query to include `total_cost_usd` per cycle row:
```sql
SELECT c.*, COALESCE(SUM(e.cost_usd), 0) as total_cost_usd
FROM cycles c
LEFT JOIN events e ON e.cycle_id = c.id
WHERE c.project_id = ?
GROUP BY c.id
ORDER BY c.started_at DESC
```

### `spend_updated` WS broadcast

Emitted after each successful phase completion via `broadcastSpendUpdate(projectId)`:
```json
{ "event": "spend_updated", "projectId": "...", "data": { "spend": 0.42, "limit": 10.0 } }
```

---

## Implementation Plan

### Task 1 — `server/src/db.ts` — `thinking_content` migration

After existing `inbox_messages` idempotent migrations (~line 76), add:

```ts
// Migrate: add thinking_content to feed_messages for Claude reasoning blocks
try { db.run("ALTER TABLE feed_messages ADD COLUMN thinking_content TEXT"); } catch { /* already exists */ }
```

- `TEXT` nullable — old rows get `NULL` automatically, no backfill needed.
- Placed before the `tasks` table CREATE statement to maintain migration ordering.

---

### Task 2 — `server/src/db.ts` — `cost_usd` on `cycles`

After the `events` index creation block (~line 146), add:

```ts
// Migrate: add cost_usd to cycles for per-cycle cost accumulation
try { db.run("ALTER TABLE cycles ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0"); } catch { /* already exists */ }
```

- SQLite allows `NOT NULL DEFAULT` in `ALTER TABLE ADD COLUMN` — safe.
- Must run before `addCycleCost` or `parseCycleRow` are used at runtime.

---

### Task 3 — `server/src/db.ts` — `DAILY_BUDGET_LIMIT` and `dailySpend()`

In the `// ─── Events ───` section, after `getEvents`:

```ts
export const DAILY_BUDGET_LIMIT = 10.0;

export function dailySpend(projectId: string): number {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const row = db
    .query<{ total: number }, [string, number]>(
      "SELECT COALESCE(SUM(cost_usd), 0) as total FROM events WHERE project_id = ? AND created_at >= ?"
    )
    .get(projectId, todayStart.getTime());
  return row?.total ?? 0;
}
```

- UTC midnight boundary keeps the 24-hour window consistent regardless of server timezone.
- Returns `number` — `COALESCE` guarantees non-null from SQLite; `?? 0` covers edge cases.

---

### Task 4 — `server/src/db.ts` — `addCycleCost()`

In the `// ─── Cycles ───` section, after `listCycles`:

```ts
export function addCycleCost(cycleId: string, delta: number): void {
  db.run("UPDATE cycles SET cost_usd = cost_usd + ? WHERE id = ?", [delta, cycleId]);
}
```

- Atomic increment — no race condition in single-threaded Bun runtime.
- `loop.ts` calls this after each phase; caller guards with `delta > 0` to skip zero-cost phases.

---

### Task 5 — `server/src/db.ts` — `cost_usd` on `CycleRow` / `CycleRun`

**`CycleRow` interface (internal, ~line 522):**
```ts
interface CycleRow { ...; cost_usd: number; }
```

**`CycleRun` interface (exported, ~line 513):**
```ts
export interface CycleRun { ...; cost_usd: number; }
```

**`parseCycleRow`:** add `cost_usd: row.cost_usd` to the spread return — SQLite `REAL` maps directly to `number`.

**`createCycleRecord`:** return object gains `cost_usd: 0` (new cycles start at zero cost).

**`listCycles`:** `SELECT *` already picks up the new column after the migration runs — no query change needed.

---

### Task 6 — `server/src/db.ts` — `thinking_content` on `FeedMessage` / `postFeedMessage`

**`FeedMessage` interface (~line 242):**
```ts
export interface FeedMessage { ...; thinking_content: string | null; }
```

**`postFeedMessage` signature (~line 252):**
```ts
export function postFeedMessage(
  projectId: string,
  senderRole: string,
  recipient: string,
  content: string,
  messageType: string,
  thinkingContent?: string | null   // new optional param
): FeedMessage
```

**INSERT statement** gains `thinking_content` column:
```sql
INSERT INTO feed_messages (id, project_id, sender_role, recipient, content, message_type, thinking_content, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
```
Bind values: `[id, projectId, senderRole, recipient, content, messageType, thinkingContent ?? null, ts]`

**Return object** gains `thinking_content: thinkingContent ?? null`.

All existing 5-arg call sites are unaffected — omitting the 6th arg resolves to `undefined`, stored as `NULL`.

---

### Task 7 — `server/src/claude.ts` — `thinkingContent` on `ClaudeRunResult`

**Interface extension:**
```ts
export interface ClaudeRunResult {
  // ... existing fields ...
  thinkingContent?: string;   // NEW — joined thinking blocks, undefined if none
}
```

Declare `const thinkingParts: string[] = []` before the `for...of raw.split("\n")` loop. Inside the `msg.type === "assistant"` branch, alongside `b.type === "text"` and `b.type === "tool_use"`:

```ts
if (b.type === "thinking") thinkingParts.push(b.thinking ?? "");
```

**Return statement:**
```ts
return {
  content: content.trim(),
  real: true,
  inputTokens,
  outputTokens,
  costUsd,
  toolUses,
  thinkingContent: thinkingParts.length > 0 ? thinkingParts.join("\n\n") : undefined,
};
```

Mock fallbacks return `thinkingContent: undefined` (field absent) — no change needed to mock paths.

---

### Task 8 — `server/src/agents/base.ts` — `costUsd` on `AgentResult`

```ts
export interface AgentResult {
  content: string;
  summary: string;
  costUsd: number;               // NEW — required; 0 for Playwright/mock runs
  thinkingContent?: string | null; // NEW — optional
}
```

Making `costUsd` required ensures TypeScript catches any agent that fails to return it — compiler errors at the agent's return statement until all agents are updated (tasks 9–14).

---

### Task 9 — `server/src/agents/researcher.ts` — return `costUsd`

`runResearcher` accumulates `totalCost` across its multi-step Claude calls (already present). Change the final return:

```ts
return { content, summary, costUsd: totalCost };
```

---

### Task 10 — `server/src/agents/pm.ts` — return `costUsd`

`runPM` makes a single `runClaude()` call; result is in `result`. Change the return:

```ts
return { content, summary, costUsd: result.costUsd };
```

---

### Task 11 — `server/src/agents/designer.ts` — return `costUsd`

`runDesigner` accumulates `totalCost` (already present). Change the final return:

```ts
return { content: designMd, summary, costUsd: totalCost };
```

---

### Task 12 — `server/src/agents/developer.ts` — return `costUsd`

`runDeveloper` accumulates `totalCost` (already present). Change the final return:

```ts
return { content, summary, costUsd: totalCost };
```

---

### Task 13 — `server/src/agents/tester.ts` — return `costUsd`

`runTester` already tracks `totalCost = 0` at line ~540 and sets it from `result.costUsd` in the Claude-fallback branch (line ~558). Playwright path leaves it `0`. Change the final return at line ~581:

```ts
return { content, summary, costUsd: totalCost };
```

`loop.ts` guards with `result.costUsd > 0` before calling `addCycleCost`, so returning `0` is safe.

---

### Task 14 — `server/src/agents/documenter.ts` — return `costUsd`

`runDocumenter` makes a single `runClaude()` call; `result.costUsd` is already used in `emitAgentCompleted`. Change the return:

```ts
return { content, summary, costUsd: result.costUsd };
```

---

### Task 15 — `server/src/loop.ts` — cost accumulation and `broadcastSpendUpdate`

**Imports** — extend the `"./db.js"` destructure:
```ts
import {
  // ... existing ...
  addCycleCost,
  dailySpend,
  DAILY_BUDGET_LIMIT,
} from "./db.js";
```

**`broadcastSpendUpdate` helper** — add at module scope after `setBroadcastFn`:
```ts
function broadcastSpendUpdate(projectId: string): void {
  const spend = dailySpend(projectId);
  broadcast(projectId, "spend_updated", { spend, limit: DAILY_BUDGET_LIMIT });
}
```

**In `runPhaseStep`** after `lastResult = result`, before `await saveArtifact(...)`:
```ts
if (result.costUsd > 0) {
  addCycleCost(cycleRecord.id, result.costUsd);
}
broadcastSpendUpdate(projectId);
```

`broadcastSpendUpdate` is unconditional — client gets an up-to-date total after each phase, even zero-cost (mock) runs.

---

### Task 16 — `server/src/loop.ts` — pass `thinkingContent` to handoff `postFeedMessage`

The handoff `postFeedMessage` call (line ~216) gains a 6th argument:

```ts
const feedMsg = postFeedMessage(
  projectId,
  role,
  "all",
  `[${phase.toUpperCase()} COMPLETE] ${result.summary}`,
  "handoff",
  result.thinkingContent ?? undefined   // NEW — 6th arg; undefined stores NULL
);
```

The `onFeed` notes, error, and escalate calls receive no 6th arg and are unchanged.

---

### Task 17 — `server/src/index.ts` — `GET /api/projects/:id/spend/today`

Insert after `GET /api/projects/:id/cycles`:

```ts
.get("/api/projects/:id/spend/today", ({ params, error }) => {
  const project = getProject(params.id);
  if (!project) return error(404, { message: "Project not found" });
  return { spend: dailySpend(params.id), limit: DAILY_BUDGET_LIMIT };
})
```

---

### Task 18 — `server/src/index.ts` — imports

Extend the existing `"./db.js"` import:
```ts
import {
  // ... existing ...
  dailySpend,
  DAILY_BUDGET_LIMIT,
} from "./db.js";
```

---

### Task 18b — `server/src/index.ts` — extend `GET /api/projects/:id/cycles` with `total_cost_usd`

Replace the existing `listCycles(params.id)` call with an inline raw query that JOINs events:

```ts
.get("/api/projects/:id/cycles", ({ params, error }) => {
  const project = getProject(params.id);
  if (!project) return error(404, { message: "Project not found" });
  const rows = db
    .query<CycleRow & { total_cost_usd: number }, [string]>(`
      SELECT c.*, COALESCE(SUM(e.cost_usd), 0) as total_cost_usd
      FROM cycles c
      LEFT JOIN events e ON e.cycle_id = c.id
      WHERE c.project_id = ?
      GROUP BY c.id
      ORDER BY c.started_at DESC
    `)
    .all(params.id);
  return rows.map(row => ({
    ...parseCycleRow(row),
    total_cost_usd: row.total_cost_usd,
  }));
})
```

**Imports:** `db`, `CycleRow` (currently unexported — either export it from `db.ts` or inline the type as `{ total_cost_usd: number }`). Simplest: cast the query result as the spread type without importing `CycleRow`:

```ts
const rows = db.query<{ id: string; project_id: string; status: string; started_at: number; ended_at: number | null; phase_outcomes: string; cost_usd: number; total_cost_usd: number }, [string]>(...).all(params.id);
```

Or export `CycleRow` from `db.ts` to avoid the verbose inline type. **Recommended:** export `CycleRow` since it is already used in `parseCycleRow`.

---

### Task 19 — `client/src/types.ts` — five additive type changes

1. `FeedMessage`: add `thinking_content: string | null` after `message_type`
2. `InboxMessage`: add `blocks_cycle: number` after `reply_body`
3. `CycleRun`: add `total_cost_usd?: number` (optional for backwards compat)
4. New export: `export interface SpendResponse { spend: number; limit: number; }`
5. `WsEvent` union: add `| { event: "spend_updated"; projectId: string; data: SpendResponse }` after `cycle_update`

---

### Task 20 — `client/src/api.ts` — `spend.today()`

Add `SpendResponse` to the named import from `"./types"`. Add to the exported `api` object:

```ts
spend: {
  today: (projectId: string) =>
    get<SpendResponse>(`/projects/${projectId}/spend/today`),
},
```

---

### Task 21 — `client/src/App.tsx` — spend state, polling, WS handler, derived values

**Module scope:** `const DAILY_LIMIT = 10.0`

**Inside `App()`:**
```ts
const [dailySpend, setDailySpend] = useState(0);
```

**`useEffect`** on `selectedProject?.id`:
```ts
useEffect(() => {
  if (!selectedProject) { setDailySpend(0); return; }
  const pid = selectedProject.id;
  api.spend.today(pid).then(r => setDailySpend(r.spend)).catch(console.error);
  const interval = setInterval(() => {
    api.spend.today(pid).then(r => setDailySpend(r.spend)).catch(console.error);
  }, 30_000);
  return () => clearInterval(interval);
}, [selectedProject?.id]);
```

**`handleWsEvent`** — add after `cycle_update` branch:
```ts
if (payload.event === "spend_updated" && payload.projectId === pid) {
  setDailySpend(payload.data.spend);
}
```

**Derived values** before JSX return:
```ts
const budgetHalted = dailySpend >= DAILY_LIMIT;
const hasBlocker = inboxMessages.some(m => m.is_read === 0 && m.blocks_cycle === 1);
```

**`<TopBar>` props extended:** `dailySpend={dailySpend}`, `dailyLimit={DAILY_LIMIT}`, `budgetHalted={budgetHalted}`, `unreadInboxCount={inboxMessages.filter(m => m.is_read === 0).length}`, `hasBlocker={hasBlocker}`.

---

### Task 22 — `client/src/components/TopBar.tsx` — `SpendIndicator`, `InboxBadge`, extended props

**`SpendIndicator`** — stateless; colour thresholds:
- `limit === 0` → `text-gray-600`, render `$X.XX / -- today`
- `ratio < 0.50` → `text-gray-400`
- `0.50 ≤ ratio < 0.80` → `text-amber-400`
- `0.80 ≤ ratio < 1.00` → `text-orange-400 font-semibold`
- `ratio ≥ 1.00` → `text-red-500 font-bold`

Renders `<span className="text-sm tabular-nums {colorClass}">${spend.toFixed(2)} / ${limit.toFixed(2)} today</span>`

**`InboxBadge`** — `📬` emoji in `relative inline-flex items-center cursor-pointer`; count dot `absolute -top-1 -right-1 min-w-[1rem] h-4 text-[10px] font-bold rounded-full px-1`; `bg-amber-500` when `hasBlocker`, `bg-blue-600` otherwise; no dot when `unreadCount === 0`. `title`: `"${n} unread message(s)"` or `"Inbox"`. `onClick={onInboxClick}`.

**`TopBarProps` extension** — add after `onStopCycle`:
```ts
dailySpend: number;
dailyLimit: number;
budgetHalted: boolean;
unreadInboxCount: number;
hasBlocker: boolean;
onInboxClick?: () => void;
```

**Right-side layout** — insert between `flex-1` spacer and cycle buttons:
```tsx
<SpendIndicator spend={dailySpend} limit={dailyLimit} />
<InboxBadge unreadCount={unreadInboxCount} hasBlocker={hasBlocker} onInboxClick={onInboxClick} />
```

**`StartCycleButton` disabled state** when `budgetHalted && !cycleRunning`: add `disabled`, classes `bg-gray-700 text-gray-500 cursor-not-allowed`, title `` `Daily budget reached ($${dailySpend.toFixed(2)} / $${dailyLimit.toFixed(2)})` ``.

---

### Task 23 — `client/src/components/FeedPanel.tsx` — `ReasoningToggle`

```tsx
function ReasoningToggle({ content }: { content: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button
        className="mt-1.5 flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors cursor-pointer select-none"
        onClick={() => setIsOpen(v => !v)}
      >
        <span>{isOpen ? "▾" : "▸"}</span>
        <span>Reasoning</span>
      </button>
      {isOpen && (
        <div className="mt-1 bg-gray-900 border border-gray-800 rounded-md p-3 text-xs text-gray-500 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed">
          {content}
        </div>
      )}
    </div>
  );
}
```

In `FeedMessageRow`, after the `<p>` body paragraph:
```tsx
{msg.thinking_content && <ReasoningToggle content={msg.thinking_content} />}
```

Falsy guard prevents empty space for `null`/`""` values.

---

### Task 24 — `client/src/components/FeedPanel.tsx` — `CycleHistoryRow` cost display

Inside `CycleHistoryRow`'s header `<div className="flex items-center gap-2 mb-1.5">`, after the duration `<span>`:

```tsx
{typeof cycle.total_cost_usd === 'number' && cycle.total_cost_usd > 0 && (
  <span className="text-xs text-gray-600 tabular-nums">
    ${cycle.total_cost_usd.toFixed(2)}
  </span>
)}
```

`> 0` guard suppresses `$0.00` for mock runs. `tabular-nums` prevents layout shift.

---

### Task 25 — `client/src/components/ArtifactDrawer.tsx` — `MarkdownContent`

**`applyInline(text: string): React.ReactNode[]`** — single-pass regex tokeniser:
- Pattern: `` /(\*\*(.+?)\*\*|`(.+?)`)/g ``
- `**text**` → `<strong className="text-gray-100 font-semibold">`
- `` `code` `` → `<code className="bg-gray-800 text-gray-300 text-xs px-1 py-0.5 rounded font-mono">`
- Called only for `<p>` and `<li>` — headings receive raw string (no inline formatting).

**`renderMarkdown(lines: string[]): React.ReactNode[]`** — line-by-line state machine:

State: `inCodeBlock: boolean`, `codeLines: string[]`, `currentList: 'ul' | 'ol' | null`, `listItems: React.ReactNode[]`

Rules (in order of precedence):
1. `` ^``` `` → toggle `inCodeBlock`; on close flush `<pre className="bg-gray-950 border border-gray-800 rounded p-2 font-mono text-xs text-gray-400 my-2 overflow-x-auto">` containing joined `codeLines`
2. `inCodeBlock` → append line to `codeLines`
3. `^---` / `^===` → flush list; push `<hr className="border-gray-800 my-3" />`
4. `^# ` → flush list; push `<h1 className="text-lg font-semibold text-gray-100 mt-4 mb-1 pb-0.5 border-b border-gray-800">`
5. `^## ` → flush list; push `<h2 className="text-base font-semibold text-gray-200 mt-3 mb-1">`
6. `^### ` → flush list; push `<h3 className="text-sm font-semibold text-gray-300 mt-2 mb-0.5">`
7. `^- ` / `^\* ` → open `<ul className="ml-4 my-1 space-y-0.5">` if needed; push `<li className="text-sm text-gray-300 list-disc">{applyInline(text)}</li>`
8. `^[0-9]+\. ` → open `<ol className="ml-4 my-1 space-y-0.5">` if needed; push `<li className="text-sm text-gray-300 list-decimal">{applyInline(text)}</li>`
9. Empty line → flush list; push `<div className="h-2" />`
10. Any other → flush list; push `<p className="text-sm text-gray-300 leading-relaxed">{applyInline(line)}</p>`

At EOF: flush any open list or code block.

**`MarkdownContent` component:**
```tsx
function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed">
      {renderMarkdown(content.split('\n'))}
    </div>
  );
}
```

**Replace site:** swap existing `<pre className="...">` block with `<MarkdownContent content={artifact.content} />`.

---

## Commit Plan

```
fix(db): add thinking_content column to feed_messages (idempotent migration)

fix(db): add cost_usd column to cycles (idempotent migration)

feat(db): add DAILY_BUDGET_LIMIT, dailySpend(), addCycleCost()
  - DAILY_BUDGET_LIMIT = 10.0 constant
  - dailySpend(projectId): sums events.cost_usd since UTC midnight
  - addCycleCost(cycleId, delta): atomic increment on cycles.cost_usd

feat(db): extend CycleRun with cost_usd; extend FeedMessage + postFeedMessage with thinking_content
  - CycleRow/CycleRun.cost_usd; parseCycleRow; createCycleRecord returns cost_usd: 0
  - FeedMessage.thinking_content; postFeedMessage optional 6th arg thinkingContent

feat(claude): add thinkingContent field to ClaudeRunResult
  - Collect b.type === "thinking" blocks in parse loop; join with \n\n

feat(agents): add costUsd (required) + thinkingContent (optional) to AgentResult
  - base.ts: extend AgentResult interface

feat(agents): return costUsd from all six agent runners
  - researcher.ts, pm.ts, designer.ts, developer.ts, tester.ts, documenter.ts

feat(loop): accumulate cycle cost, broadcast spend_updated, pass thinkingContent to handoff
  - Import addCycleCost, dailySpend, DAILY_BUDGET_LIMIT
  - broadcastSpendUpdate() module-level helper
  - addCycleCost + broadcastSpendUpdate after each phase success
  - result.thinkingContent as 6th arg to handoff postFeedMessage

feat(server): add spend/today route + extend cycles route with total_cost_usd
  - GET /api/projects/:id/spend/today returns { spend, limit }
  - GET /api/projects/:id/cycles extended with LEFT JOIN events for total_cost_usd per cycle
  - Export CycleRow from db.ts to use in cycles route inline query
  - Import dailySpend, DAILY_BUDGET_LIMIT

feat(types): extend client types for thinking_content, blocks_cycle, spend, WsEvent
  - FeedMessage.thinking_content, InboxMessage.blocks_cycle, CycleRun.total_cost_usd
  - SpendResponse interface; spend_updated WsEvent variant

feat(api): add spend.today() to api client

feat(app): wire daily spend state, polling, WS handler, budget/blocker derived values
  - DAILY_LIMIT constant, dailySpend state, fetch+poll useEffect, spend_updated WS branch
  - budgetHalted + hasBlocker derived; pass all new props to TopBar

feat(topbar): add SpendIndicator, InboxBadge, budget-halted StartCycleButton state
  - SpendIndicator inline sub-component (4 colour thresholds)
  - InboxBadge inline sub-component (blue/amber dot, onInboxClick)
  - Extend TopBarProps; insert indicators; disable StartCycleButton at budget limit

feat(feed): add ReasoningToggle to FeedMessageRow and cost display to CycleHistoryRow
  - ReasoningToggle inline sub-component with isOpen toggle + monospace content box
  - FeedMessageRow renders ReasoningToggle when thinking_content is truthy
  - CycleHistoryRow renders $X.XX span when total_cost_usd > 0

feat(ui): replace ArtifactDrawer <pre> with inline MarkdownContent renderer
  - MarkdownContent + renderMarkdown (line-by-line state machine) + applyInline
  - Swap <pre> for <MarkdownContent content={artifact.content} />
```

---

## Open Questions

1. **`addCycleCost` in `index.ts`:** Imported per spec but no call site in `index.ts` this cycle. Leave `// TODO: wire to manual budget adjustment endpoint` comment.

2. ~~**`GET /api/projects/:id/cycles` `total_cost_usd`:** Not covered in tasks above.~~ **Resolved** — Task 18b adds the LEFT JOIN aggregation to the cycles route and exports `CycleRow` from `db.ts`.

3. **`onInboxClick` scroll target:** Wired through `InboxBadge` props but no panel-scroll logic in `App.tsx` yet. Pass `undefined` for MVP — badge acts as visual indicator only.

4. **`is_read` type in `hasBlocker`:** `InboxMessage.is_read` is `number`. `hasBlocker` uses `m.is_read === 0` — confirm API never returns boolean. If it does, change guard to `!m.is_read`.

5. **Timeout-path cost broadcast:** On double-timeout, `result` is never set — `addCycleCost` and `broadcastSpendUpdate` are skipped. Spend display lags until the next successful phase. Acceptable for MVP; a `finally`-block broadcast can be added in a future cycle.
