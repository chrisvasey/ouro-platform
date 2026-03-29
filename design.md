# Design Specification — Cycle 10

**Designer:** Ouro Designer Agent | **Date:** 2026-03-29 | **Cycle:** 10
**Scope:** Three UI stories — reasoning toggle in feed messages, daily spend indicator in top bar, artifact content rendered with section headings. Plus: StartCycleButton budget-halted state, cycle run cost in run history, InboxBadge in TopBar.

---

## User Flows

### Flow 1 — Agents produce real output, feed shows content

1. User clicks "Start Cycle" on a project (budget < $10.00 for the day).
2. `loop.ts` spawns the Research agent; server emits `agent_status` WS event (`status: "thinking"`).
3. Research agent calls `runClaude()`; response arrives with real text + optional thinking blocks.
4. Server calls `postFeedMessage(projectId, "researcher", "pm", content, "handoff")` storing the message, including `thinking_content` if present.
5. Server emits `feed_message` WS event; client appends `FeedMessageRow` to the feed.
6. If the Claude response included thinking blocks, the row renders a `ReasoningToggle` button beneath the message body. Otherwise no toggle is rendered.
7. Research phase completes; server saves artifact; emits `phase_change` WS event.
8. User clicks the "Research" phase chip in `CycleTimeline` → `ArtifactDrawer` opens, content rendered as structured markdown (visible `#` headings, `##` headings, bullet lists).
9. Cycle completes; "Run Status" section shows `#N · complete · $X.XX`.

### Flow 2 — Reasoning toggle interaction

1. Feed contains a message with `thinking_content` set to a non-empty string.
2. `FeedMessageRow` renders the message body, then immediately below it a `ReasoningToggle` button.
3. Button text: `▸ Reasoning` (collapsed state). Appearance: `text-xs text-gray-600 hover:text-gray-400`.
4. User clicks the button → `isOpen` state flips to `true`.
5. An expandable box appears below the button with the raw thinking text. Box: `bg-gray-900 border border-gray-800 rounded-md p-3 text-xs text-gray-500 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto`.
6. Button text changes to `▾ Reasoning`.
7. User clicks again → box collapses, button returns to `▸ Reasoning`.
8. If `thinking_content` is `null`, `undefined`, or empty string, `ReasoningToggle` is not rendered at all — no empty space.

### Flow 3 — Daily spend indicator

1. App loads; `App.tsx` fetches `GET /api/projects/:id/spend/today` for the selected project.
2. Response: `{ spend: 0.42, limit: 10.00 }`.
3. `SpendIndicator` inside `TopBar` renders `$0.42 / $10.00 today` in `text-gray-400` (spend < 50%).
4. A cycle runs and costs money; server emits `spend_updated` WS event with new `{ spend, limit }`.
5. Client updates spend state; `SpendIndicator` re-renders with new value.
6. When spend reaches $5.00: colour shifts to `text-amber-400`.
7. When spend reaches $8.00: colour shifts to `text-orange-400 font-semibold`.
8. When spend reaches $10.00: colour shifts to `text-red-500 font-bold`. `StartCycleButton` becomes disabled with tooltip `"Daily budget reached"`. Running cycle finishes but no new cycle can start.
9. Every 30 s, `App.tsx` re-polls spend (fallback if WS missed event).
10. Next UTC day: spend resets to $0.00; all colour states return to gray.

---

## Component Tree

Legend: `[NEW]` = new file/component, `[MOD]` = existing file modified, `[+]` = new sub-component added inline.

```
App.tsx [MOD — fetches spend, threads props]
└── AppShell (layout wrapper, no file change needed)
    ├── TopBar.tsx [MOD]
    │   ├── SpendIndicator [+inline NEW]  — right of phase badge, left of inbox badge
    │   └── InboxBadge [+inline NEW]     — right of SpendIndicator, before cycle buttons
    ├── ProjectView (layout, lives in App.tsx currently)
    │   ├── AgentPanel.tsx [no change]
    │   ├── FeedPanel.tsx [MOD]
    │   │   └── FeedMessageRow [MOD — adds ReasoningToggle]
    │   │       └── ReasoningToggle [+inline NEW]
    │   └── ArtifactDrawer.tsx [MOD — replace <pre> with MarkdownContent]
    │       └── MarkdownContent [+inline NEW]
    └── InboxPanel.tsx [no change — InboxBadge in TopBar is a separate indicator]
```

**File-level changes:**

| File | Change |
|---|---|
| `client/src/types.ts` | Add `thinking_content`, `blocks_cycle` fields; add `SpendResponse`, `WsEvent spend_updated` |
| `client/src/api.ts` | Add `spend.today(projectId)` |
| `client/src/components/TopBar.tsx` | Add `SpendIndicator`, `InboxBadge` inline; new props |
| `client/src/components/FeedPanel.tsx` | `FeedMessageRow` gets `thinking_content`; add `ReasoningToggle` |
| `client/src/components/ArtifactDrawer.tsx` | Replace `<pre>` with `MarkdownContent` |
| `server/src/db.ts` | Migration: `feed_messages ADD COLUMN thinking_content TEXT` |
| `server/src/index.ts` | New route `GET /api/projects/:id/spend/today`; broadcast `spend_updated`; include `thinking_content` in feed response |

---

## Layout & Responsive Behaviour

### TopBar — updated right section

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ 🔄 Ouro  │  [Project ▾]  [+]  │  [Research]  │          │  $0.42/$10.00  [📬 2!]  [Start Cycle] │
└────────────────────────────────────────────────────────────────────────────────────┘
           divider            phase badge     flex-1    SpendIndicator InboxBadge  cycle btn
```

- All right-side items: `flex items-center gap-3`
- `SpendIndicator`: `text-sm tabular-nums` — always visible when a project is selected
- `InboxBadge`: `text-sm` — always visible; shows count dot when unread > 0, amber ring when blocker present
- `StartCycleButton`: rightmost element, pushed by `flex-1` spacer

### FeedMessageRow — with ReasoningToggle

```
┌─────────────────────────────────────────────────────────────────┐
│  [🔬 researcher]  →  pm  [handoff]          [view artifact →]  2m ago  │
│                                                                │
│  The competitive landscape shows three key players…           │
│  ▸ Reasoning                                                   │
└─────────────────────────────────────────────────────────────────┘
```

When expanded:
```
┌─────────────────────────────────────────────────────────────────┐
│  [🔬 researcher]  →  pm  [handoff]                      2m ago  │
│                                                                │
│  The competitive landscape shows three key players…           │
│  ▾ Reasoning                                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Let me think about this carefully. The user is asking     │ │
│  │ about a self-improving AI system. First, I should…        │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### ArtifactDrawer — markdown content

The `<pre>` block is replaced with a styled div. Headings stand out visually:

```
┌─── Research Artifact ────────────────────────────────────────┐
│ 🔬  Research                                            ✕    │
│     research.md · version 1                                   │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  Competitive Analysis                      ← h1: text-lg     │
│  ─────────────────                         ← divider         │
│                                                               │
│  Market Overview                           ← h2: text-base   │
│                                                               │
│  Three key players dominate the space…     ← p: text-sm      │
│                                                               │
│  Key Findings                              ← h2              │
│  • Player A focuses on developer tooling   ← li              │
│  • Player B targets enterprise workflows                      │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### CycleHistoryRow — with cost

```
┌─────────────────────────────────────────────────────────────┐
│ #2  ● complete                         2m ago   $0.42       │
│  [research ✓] [spec ✓] [design ✓] [build ✓] [test ✓] [review ✓] │
└─────────────────────────────────────────────────────────────┘
```

Cost badge: `text-xs text-gray-500 tabular-nums` — appears after duration, before end of row.

---

## Component Specs

### SpendIndicator *(new inline sub-component of TopBar)*

**File:** `client/src/components/TopBar.tsx`

**Props:**
```ts
interface SpendIndicatorProps {
  spend: number;   // dollars, float, e.g. 0.42
  limit: number;   // dollars, float, e.g. 10.00
}
```

**Appearance:**
- Container: `text-sm tabular-nums`
- Label format: `$X.XX / $Y.00 today` where X.XX is `spend.toFixed(2)` and Y.00 is `limit.toFixed(2)`
- Colour by threshold:

| Condition | Class |
|---|---|
| `spend / limit < 0.50` | `text-gray-400` |
| `0.50 ≤ spend / limit < 0.80` | `text-amber-400` |
| `0.80 ≤ spend / limit < 1.00` | `text-orange-400 font-semibold` |
| `spend / limit ≥ 1.00` | `text-red-500 font-bold` |

**States:** stateless display component; re-renders when parent passes new `spend` prop.

**Interactions:** none — read-only.

**Edge cases:**
- `limit = 0`: render `$X.XX / -- today` (avoid division by zero); use `text-gray-600`.
- `spend = 0, limit = 10`: renders `$0.00 / $10.00 today` in `text-gray-400`.

---

### InboxBadge *(new inline sub-component of TopBar)*

**File:** `client/src/components/TopBar.tsx`

**Props:**
```ts
interface InboxBadgeProps {
  unreadCount: number;
  hasBlocker: boolean;  // true if any unread inbox message has blocks_cycle = 1
}
```

**Appearance:**
- Container: `relative inline-flex items-center`
- Icon: `📬` as text emoji, `text-base leading-none`; OR a simple envelope SVG — use emoji for zero dependencies.
- Count dot: appears when `unreadCount > 0` — `absolute -top-1 -right-1 min-w-[1rem] h-4 flex items-center justify-center text-[10px] font-bold rounded-full px-1`
  - Normal unread: `bg-blue-600 text-white`
  - Has blocker: `bg-amber-500 text-white` (overrides blue)
- No dot when `unreadCount === 0`

**States:**

| State | Appearance |
|---|---|
| `unreadCount = 0` | Icon only, no dot |
| `unreadCount > 0, !hasBlocker` | Blue dot with count |
| `hasBlocker` | Amber dot with count; icon gets `opacity-100` ring-amber-500/20 outline (1px) |

**Interactions:**
- `onClick`: scrolls InboxPanel into view OR opens inbox panel if collapsed (implementation detail for developer — emit a prop callback `onInboxClick?: () => void`).
- `title` attribute: `"${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}"` when `unreadCount > 0`; `"Inbox"` when 0.
- Cursor: `cursor-pointer`

**Data:** passed as props from parent App.tsx (computed from `inboxMessages` state).

---

### TopBar *(modified)*

**File:** `client/src/components/TopBar.tsx`

**New/changed props:**
```ts
interface TopBarProps {
  // existing:
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  onProjectsChange: (projects: Project[]) => void;
  cycleRunning: boolean;
  onStartCycle: () => void;
  onStopCycle: () => void;
  // new:
  dailySpend: number;        // dollars
  dailyLimit: number;        // dollars — always 10.00 for now
  budgetHalted: boolean;     // true when dailySpend >= dailyLimit
  unreadInboxCount: number;
  hasBlocker: boolean;
  onInboxClick?: () => void;
}
```

**Right-side layout (inside `<header>`):**
```
<div className="flex-1" />   {/* spacer */}
<SpendIndicator spend={dailySpend} limit={dailyLimit} />
<InboxBadge unreadCount={unreadInboxCount} hasBlocker={hasBlocker} onInboxClick={onInboxClick} />
<StartCycleButton ... />  {/* or running indicator */}
```

**StartCycleButton disabled state** (budget halted):
- When `budgetHalted && !cycleRunning`:
  - Button rendered with `disabled` attribute
  - Classes: `bg-gray-700 text-gray-500 cursor-not-allowed` (not `bg-blue-600`)
  - `title` attribute: `"Daily budget reached ($${dailySpend.toFixed(2)} / $${dailyLimit.toFixed(2)})"`
  - No `onClick` handler fires (button is `disabled`)

No other changes to TopBar logic.

---

### ReasoningToggle *(new inline sub-component of FeedPanel)*

**File:** `client/src/components/FeedPanel.tsx`

**Props:**
```ts
interface ReasoningToggleProps {
  content: string;  // raw thinking block text
}
```

**Internal state:** `const [isOpen, setIsOpen] = useState(false)`

**Appearance:**
- Toggle button: `mt-1.5 flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors cursor-pointer select-none`
- Button text: `{isOpen ? "▾" : "▸"} Reasoning`
- No background on button — it blends into the message row
- Expanded content box: `mt-1 bg-gray-900 border border-gray-800 rounded-md p-3 text-xs text-gray-500 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed`

**Rendering:**
```tsx
function ReasoningToggle({ content }: ReasoningToggleProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button
        className="mt-1.5 flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors cursor-pointer select-none"
        onClick={() => setIsOpen((v) => !v)}
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

**Conditions for rendering:**
- Rendered in `FeedMessageRow` only when `msg.thinking_content` is a non-empty string.
- `if (!msg.thinking_content) return null` — no empty space left behind.

---

### FeedMessageRow *(modified)*

**File:** `client/src/components/FeedPanel.tsx`

No structural change to the row. The only addition is rendering `ReasoningToggle` after `<p className="text-sm text-gray-300 ...">`:

```tsx
<p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
  {msg.content}
</p>
{msg.thinking_content && (
  <ReasoningToggle content={msg.thinking_content} />
)}
```

`FeedMessage` type must have `thinking_content?: string | null` (see Data Changes section).

---

### MarkdownContent *(new inline sub-component of ArtifactDrawer)*

**File:** `client/src/components/ArtifactDrawer.tsx`

**Purpose:** Replace the raw `<pre>` block with structured rendering for markdown-flavoured text. No external markdown library — implement a minimal line-by-line renderer sufficient for artifact content.

**Props:**
```ts
interface MarkdownContentProps {
  content: string;
}
```

**Rendering rules** (line-by-line, in order of precedence):

| Pattern | Element | Classes |
|---|---|---|
| `^# ` | `<h1>` | `text-lg font-semibold text-gray-100 mt-4 mb-1 pb-0.5 border-b border-gray-800` |
| `^## ` | `<h2>` | `text-base font-semibold text-gray-200 mt-3 mb-1` |
| `^### ` | `<h3>` | `text-sm font-semibold text-gray-300 mt-2 mb-0.5` |
| `^- ` or `^\* ` | `<li>` in `<ul>` | ul: `ml-4 my-1 space-y-0.5`; li: `text-sm text-gray-300 list-disc` |
| `^[0-9]+\. ` | `<li>` in `<ol>` | ol: `ml-4 my-1 space-y-0.5`; li: `text-sm text-gray-300 list-decimal` |
| `` ^``` `` | start/end code block | `bg-gray-950 border border-gray-800 rounded p-2 font-mono text-xs text-gray-400 my-2 overflow-x-auto` |
| `^---` or `^===` | `<hr>` | `border-gray-800 my-3` |
| empty line | paragraph break | renders as `<div className="h-2" />` |
| any other line | `<p>` | `text-sm text-gray-300 leading-relaxed` |

**Inline formatting within text nodes** (applied to `<p>` and `<li>` content only, not headings):
- `**text**` → `<strong className="text-gray-100 font-semibold">text</strong>`
- `` `code` `` → `<code className="bg-gray-800 text-gray-300 text-xs px-1 py-0.5 rounded font-mono">code</code>`

**Implementation approach:**
1. Split `content` by `\n` into lines.
2. Process line-by-line with state (`inCodeBlock: boolean`, `inList: 'ul' | 'ol' | null`).
3. When list state changes (e.g. entering a `-` line from a non-list line), open a `<ul>` wrapper. When a non-list line follows, close the wrapper.
4. Code block: toggle on `\`\`\`` line; lines between delimiters rendered as plain text inside the styled `<pre>`.
5. Return array of React elements.

**Container:**
```tsx
<div className="text-sm leading-relaxed">
  {renderMarkdown(artifact.content)}
</div>
```

**Edge cases:**
- Artifact content is a single long line with no newlines: renders as one `<p>`.
- Content starts with a code block immediately: `inCodeBlock` triggers correctly.
- Headings inside code blocks: treated as literal text.

---

### CycleHistoryRow *(modified — cost display)*

**File:** `client/src/components/FeedPanel.tsx`

`CycleRun` type gets optional `total_cost_usd?: number`. When present and > 0, render after the duration string:

```tsx
{durationStr && (
  <span className="text-xs text-gray-700">{durationStr}</span>
)}
{typeof cycle.total_cost_usd === 'number' && cycle.total_cost_usd > 0 && (
  <span className="text-xs text-gray-600 tabular-nums">
    ${cycle.total_cost_usd.toFixed(2)}
  </span>
)}
```

No other changes to `CycleHistoryRow`.

---

## Data Shape Changes

### `client/src/types.ts`

```ts
// FeedMessage — add thinking_content
export interface FeedMessage {
  id: string;
  project_id: string;
  sender_role: string;
  recipient: string;
  content: string;
  message_type: "handoff" | "question" | "decision" | "note" | "escalate";
  thinking_content: string | null;  // ADD THIS
  created_at: number;
}

// InboxMessage — add blocks_cycle
export interface InboxMessage {
  // ... existing fields ...
  blocks_cycle: number;  // ADD THIS — 0 = non-blocking, 1 = blocks cycle
}

// CycleRun — add total_cost_usd
export interface CycleRun {
  // ... existing fields ...
  total_cost_usd?: number;  // ADD THIS — null when no events recorded
}

// New type for spend response
export interface SpendResponse {
  spend: number;   // dollars, float
  limit: number;   // dollars, float — 10.00
}

// WsEvent — add spend_updated
export type WsEvent =
  | { event: "connected"; data: { clientCount: number } }
  | { event: "subscribed"; data: { projectId: string } }
  | { event: "feed_message"; projectId: string; data: FeedMessage }
  | { event: "inbox_message"; projectId: string; data: InboxMessage }
  | { event: "agent_status"; projectId: string; data: { role: string; status: string; current_task?: string | null } }
  | { event: "phase_change"; projectId: string; data: { phase: string } }
  | { event: "cycle_update"; projectId: string; data: { cycleId: string; status: string } }
  | { event: "spend_updated"; projectId: string; data: SpendResponse };  // ADD THIS
```

### `client/src/api.ts`

Add a new `spend` namespace:

```ts
spend: {
  today: (projectId: string) =>
    get<SpendResponse>(`/projects/${projectId}/spend/today`),
},
```

---

## API Contract

### `GET /api/projects/:id/spend/today`

**Response:**
```json
{ "spend": 0.42, "limit": 10.00 }
```

**Logic (server/src/index.ts):**
```ts
const todayStart = new Date();
todayStart.setUTCHours(0, 0, 0, 0);
const spend = db.query(
  "SELECT COALESCE(SUM(cost_usd), 0) as total FROM events WHERE project_id = ? AND created_at >= ?"
).get(projectId, todayStart.getTime()) as { total: number };
return { spend: spend.total, limit: 10.0 };
```

**`spend_updated` WS broadcast:**
- Triggered whenever `insertEvent()` is called with `cost_usd > 0`.
- Server computes new daily spend total and broadcasts `{ event: "spend_updated", projectId, data: { spend, limit: 10.0 } }` to all subscribers for that project.
- Implementation: call a helper `broadcastSpendUpdate(projectId)` at the end of `insertEvent()`.

### `GET /api/projects/:id/cycles` — extended

Existing route. Extend to compute `total_cost_usd` per cycle:

```sql
SELECT c.*, COALESCE(SUM(e.cost_usd), 0) as total_cost_usd
FROM cycles c
LEFT JOIN events e ON e.cycle_id = c.id
WHERE c.project_id = ?
GROUP BY c.id
ORDER BY c.started_at DESC
```

Add `total_cost_usd` to the returned JSON for each cycle row.

---

## DB Schema Changes

### `feed_messages` — add `thinking_content`

```sql
ALTER TABLE feed_messages ADD COLUMN thinking_content TEXT;
```

Wrap in try/catch (idempotent migration), add to `db.ts` alongside existing migrations.

`thinking_content` is `NULL` for all historical rows (no backfill needed — pre-SDK messages have no thinking blocks).

When `postFeedMessage` is called, pass `thinking_content?: string | null` as an optional parameter. If `null` / absent, store `NULL`.

---

## App.tsx Changes

`App.tsx` is not specced here (backend concern) but the developer needs these additions:

1. **State:** `const [dailySpend, setDailySpend] = useState(0)` and `const dailyLimit = 10.0`.
2. **Initial fetch:** after project selection, call `api.spend.today(projectId)` and set state.
3. **Poll:** `setInterval(() => api.spend.today(projectId).then(r => setDailySpend(r.spend)), 30_000)` — clear on project change / unmount.
4. **WS handler:** on `spend_updated` event matching current `projectId`, call `setDailySpend(data.spend)`.
5. **Derived:** `budgetHalted = dailySpend >= dailyLimit`.
6. **Inbox derived:** `hasBlocker = inboxMessages.some(m => !m.is_read && m.blocks_cycle === 1)`.
7. **Pass to TopBar:** `dailySpend`, `dailyLimit`, `budgetHalted`, `unreadInboxCount`, `hasBlocker`.

---

## Edge Cases & Empty States

1. **No API key / mock mode:** `runClaude()` returns `real: false`, `costUsd: 0`. Feed messages have `thinking_content = null`. `SpendIndicator` shows `$0.00 / $10.00 today` in gray. Cycle history shows `$0.00` (or omits cost label when `total_cost_usd === 0`).

2. **thinking_content is very long:** `ReasoningToggle` expanded box has `max-h-48 overflow-y-auto` — user can scroll. No truncation of the stored content.

3. **Budget exactly at limit ($10.00):** `budgetHalted = true`, Start Cycle button disabled. A running cycle that crosses $10.00 mid-run is not stopped mid-phase (the gate only applies at cycle start). Spec Story 7 covers the halt gate; this design only covers the UI disabled state.

4. **Artifact content is empty string or whitespace only:** `MarkdownContent` renders nothing (empty div). `ArtifactDrawer` shows the drawer but content area is blank — acceptable since a non-empty artifact should always exist when the drawer is opened via a phase click.

5. **Artifact has no section headings (flat prose):** `MarkdownContent` renders all lines as `<p>` elements. Still more readable than `<pre>` because word-wrap applies.

6. **InboxBadge when no project selected:** `unreadInboxCount = 0`, `hasBlocker = false` — badge not shown (no dot). Component renders the icon with no dot.

7. **SpendIndicator when no project selected:** render `null` — `SpendIndicator` is not shown until a project is selected and the first spend fetch completes.

8. **WS disconnects mid-cycle:** spend polling (30 s interval) acts as fallback. `SpendIndicator` may lag up to 30 s but will self-correct. No stale-data indicator is needed for MVP.

9. **Multiple tabs open:** each tab maintains its own spend state via independent polling + WS subscription. No conflict since spend is read-only in the UI.

10. **Cycle history with 0 events (mock run):** `total_cost_usd` = 0. Cost is not rendered in `CycleHistoryRow` when `total_cost_usd === 0` (condition: `total_cost_usd > 0` guard in JSX).

11. **MarkdownContent inside a `##` heading line containing `**bold**`:** heading lines are NOT processed for inline formatting — the raw text including `**` is rendered as-is in the heading element. This avoids edge cases in the minimal renderer; headings in practice won't use bold markdown.

12. **Code fence without closing delimiter (truncated artifact):** if `inCodeBlock` is still `true` at end of lines, close the `<pre>` block. Renders whatever content was captured.

---

## Design Decisions

1. **No markdown library dependency.** `MarkdownContent` implements only what agent output actually uses: headings, bullets, numbered lists, horizontal rules, code fences, bold, inline code. This avoids bundling a full parser and keeps the component auditable. If richer rendering is needed, swap the body of `renderMarkdown()` for `marked`/`micromark` without changing the component interface.

2. **`thinking_content` in `feed_messages`, not a separate table.** One-to-one relationship (one thinking block per message), always fetched together, simplest query path. If an agent emits multiple thinking blocks, concatenate them with `\n---\n` separator before storing.

3. **`SpendIndicator` is per-project, not global.** Consistent with the rest of the UI (all data is scoped to the selected project). A global daily limit across projects can be added later by removing the `project_id` scope from the query.

4. **`InboxBadge` rendered inside `TopBar`** rather than as a floating portal. The existing `InboxPanel` already shows an unread count in its own header. The `InboxBadge` in `TopBar` is an additional global indicator that surfaces blockers even when the user is focused on the feed. Both can coexist without confusion.

5. **Spend polling every 30 s as fallback.** WS `spend_updated` is the primary update mechanism (real-time). The poll is a cheap insurance policy against missed events or WS reconnects. 30 s is a reasonable lag for a non-critical indicator.

6. **`budgetHalted` is a UI-only gate in this design.** The server-side halt gate (blocking inbox message + `blocks_cycle=1`) is specified in the system spec but is not part of this design cycle's UI scope. The `StartCycleButton` disabled state here is purely derived from `dailySpend >= dailyLimit` on the client — no server-side enforcement added in this cycle.

7. **No `AgentPanel` changes.** The inputs did not include agent rail updates. `AgentPanel.tsx` is left unchanged.

8. **`CycleHistoryRow` cost rendered only when `> 0`.** Zero-cost runs (mock mode) do not show `$0.00` — it would be misleading noise. The absence of a cost label signals "no real API calls were made".
