# Design Specification — Cycle 15

**Designer:** Ouro Designer Agent | **Date:** 2026-04-17 | **Cycle:** 15
**Scope:** Three high-priority blockers — artifact visibility (Story 1), self-mod diff view in approval modal (Story 2/GH#3), and schema prerequisites. Cycle closes GH#3 and lays the structural groundwork for GH#4/GH#7 verification.

---

## User Flows

### Flow 1 — Artifacts appear when a phase completes

1. User opens a project while a cycle is running (or just started one).
2. Right-column right panel renders `ArtifactsPanel` (below `InboxPanel` in a stacked split). On mount it fetches `GET /api/projects/:id/artifacts`. Response is an empty array.
3. `ArtifactsPanel` renders `ArtifactEmptyState`: centered text "No artifacts yet".
4. A cycle phase (e.g. Research) completes in `loop.ts`. Server calls `saveArtifact()`, then broadcasts a new `artifact_created` WS event with the full `Artifact` object.
5. Client receives `{ event: "artifact_created", projectId, data: Artifact }` in `App.tsx`. The artifact is appended to `artifacts` state.
6. `ArtifactsPanel` re-renders without user interaction. The empty state is replaced by an `ArtifactRow` for the new artifact.
7. The row enters a **"new" state** for 2 s: amber left border + `bg-gray-900` background, then fades back to default. This draws the eye without an intrusive notification.
8. Subsequent phases complete; more `ArtifactRow` components appear in order.

---

### Flow 2 — Proposed self-mod change pauses cycle and shows approval modal

1. During a build phase, the developer agent proposes a change to `/server/src/agents/base.ts`.
2. `loop.ts` calls `createProposedChange(projectId, proposedBy, filePath, diffContent, cycleId)` passing the full replacement content as `diff_content` **and** the current file content as `original_content`.
3. Server broadcasts `{ event: "proposed_change", projectId, data: ProposedChange }`. The cycle phase does not advance; loop enters a `suspended` wait.
4. `App.tsx` receives the event, prepends the `ProposedChange` to `proposedChanges` state.
5. `ProposedChangeModal` is already conditionally rendered for `proposedChanges[0]` (first pending change). It mounts as a full-page portal (z-50).
6. Modal displays: "Proposed File Change" heading, `proposed_by` label, "Pending approval" amber badge, `file_path` in a code chip, and a two-tab toggle: **"Diff"** (default) | **"Full content"**.
7. The Diff tab renders `DiffView` (extracted shared component) comparing `original_content` → `diff_content`. Additions are green, removals are red strikethrough, context lines are gray.
8. The Full Content tab renders the raw `diff_content` in a scrollable `<pre>` block (current behaviour preserved as fallback).
9. The feed entry for the blocked phase shows a `▲ Blocked` amber indicator inline.
10. User reviews the diff and clicks **Approve** → modal shows "Applying…" spinner, calls `POST /api/projects/:id/proposed-changes/:id/approve`, server applies the file write, broadcasts `proposed_change_resolved { id, status: "approved" }`, loop resumes, modal unmounts.
11. OR user clicks **Reject** → same flow but `status: "rejected"`, change is not applied.
12. If a second proposed change is queued, the next modal mounts immediately after the first resolves.

---

### Flow 3 — Approval modal shows a before/after diff

*(Continuation of Flow 2 — detail on the diff view mechanics.)*

1. `ProposedChangeModal` receives `change.original_content` (the file's content at proposal time) and `change.diff_content` (the full intended replacement).
2. If `original_content` is `null` or empty string (new file creation): all lines render as additions ("+"), with a subheading "New file — no prior content".
3. If `original_content` is present: `computeLineDiff(original_content, diff_content)` runs the existing LCS algorithm (extracted from `ArtifactDrawer`) and produces `DiffLine[]`.
4. Lines render in the `DiffView` component: added=green, removed=red strikethrough, context=gray-500. Prefix characters (`+` / `-` / ` `) are `select-none`.
5. Large files (>500 lines) show only the changed hunks ± 5 context lines each. A "Show all" toggle below the diff expands to the full view.
6. The scroll container is `max-h-[55vh] overflow-y-auto` so the action buttons stay visible without scrolling.

---

## Component Tree

Legend: `[NEW]` = new file | `[MOD]` = existing file modified | `[EXTRACT]` = moved from another file

```
App.tsx [MOD]
├── TopBar (unchanged)
├── main content area (3-column flex)
│   ├── AgentPanel (unchanged)
│   ├── FeedPanel [MOD — add "blocked" status indicator on FeedMessageRow]
│   │   └── FeedMessageRow [MOD — add BlockedBadge when message_type="blocked"]
│   └── right column (flex-col, full height)
│       ├── InboxPanel (unchanged, top half)
│       └── ArtifactsPanel [NEW] (bottom half, min-h-0 flex-1)
│           ├── ArtifactEmptyState [NEW]
│           └── ArtifactRow [NEW] ×N
└── ProposedChangeModal [MOD — upgrade diff view] (portal, conditional)
    ├── DiffView [EXTRACT from ArtifactDrawer.tsx]
    └── (existing approve/reject buttons, unchanged)

DiffView.tsx [NEW FILE — extracted shared component]
  (used by both ArtifactDrawer and ProposedChangeModal)
```

---

## Layout & Responsive Behaviour

### Right column split

```
┌─────────────────────────┐
│  InboxPanel             │  flex-shrink-0, max-h-[40%] of column
│  (existing)             │
├─────────────────────────┤
│  ArtifactsPanel [NEW]   │  flex-1, min-h-0, overflow-y-auto
│  ─────────────────────  │
│  ARTIFACTS (label)      │  text-gray-400 text-xs uppercase, px-3 py-2
│  ─────────────────────  │  border-b border-gray-800
│  ArtifactRow            │
│  ArtifactRow            │
│  ...                    │
└─────────────────────────┘
```

- Right column: `flex flex-col h-full`
- `InboxPanel`: add `flex-shrink-0 max-h-[40%] overflow-y-auto` (currently likely unbounded)
- `ArtifactsPanel`: `flex-1 min-h-0 flex flex-col bg-gray-950 border-t border-gray-800`
- On narrow viewports (<1200 px): ArtifactsPanel collapses to a header-only strip with artifact count badge; clicking expands it over the inbox.

### ProposedChangeModal dimensions

- Container: `max-w-2xl w-full max-h-[90vh] flex flex-col` (unchanged outer shell)
- Diff/content area: `flex-1 min-h-0 overflow-y-auto` — grows to fill modal, stays scrollable
- Tab bar: `flex gap-1 px-5 pt-3 pb-0 border-b border-gray-800` above the scrollable area
- Active tab: `border-b-2 border-blue-500 text-gray-100 text-xs pb-2`
- Inactive tab: `text-gray-500 text-xs pb-2 hover:text-gray-300`

---

## Component Specs

### DiffView [EXTRACT — new shared file]

**File:** `client/src/components/DiffView.tsx`
Extract `computeLineDiff` and the `DiffView` render function verbatim from `ArtifactDrawer.tsx`. No logic changes.

**Props:**
```typescript
interface DiffViewProps {
  oldContent: string;   // baseline (empty string = new file)
  newContent: string;   // proposed replacement
  maxLines?: number;    // if set, collapse hunks beyond ±5 context; default: unlimited
}
```

**Appearance:** identical to current `ArtifactDrawer` implementation:
- Added line: `bg-green-950/40 text-green-300`, prefix `+` in `text-green-500 select-none`
- Removed line: `bg-red-950/40 text-red-300 line-through decoration-red-700/40`, prefix `-` in `text-red-500 select-none`
- Context line: `text-gray-500`, prefix ` ` (space)
- Wrapper: `<pre className="text-xs font-mono leading-relaxed overflow-x-auto">`

**Hunk collapsing** (only when `maxLines` is set and diff > `maxLines * 2`):
- Compute changed line index ranges; keep 5 context lines either side
- Between collapsed hunks: `<div className="text-gray-600 text-xs py-1 px-2 bg-gray-900/50 select-none">── N unchanged lines ──</div>`
- "Show all" toggle button at bottom: `text-xs text-gray-500 hover:text-gray-300 underline mt-2 cursor-pointer`

**Update `ArtifactDrawer.tsx`:** Remove the inline `computeLineDiff` and `DiffView` definitions, import from `./DiffView`.

---

### ArtifactsPanel [NEW]

**File:** `client/src/components/ArtifactsPanel.tsx`

**Purpose:** Always-visible list of all artifacts produced in the current project's most recent cycle. Live-updates via WS without page refresh.

**Props:**
```typescript
interface ArtifactsPanelProps {
  projectId: string;
  artifacts: Artifact[];   // managed in App.tsx state, passed down
}
```

**States:**
- `loading` — skeleton pulse rows (3 rows, `h-8 rounded bg-gray-800 animate-pulse`)
- `empty` — renders `ArtifactEmptyState`
- `populated` — renders `ArtifactRow` per artifact, newest first

**Appearance:**
- Outer: `flex flex-col bg-gray-950 border-t border-gray-800 flex-1 min-h-0`
- Header bar: `flex items-center justify-between px-3 py-2 flex-shrink-0`
  - Label: `text-gray-400 text-xs font-medium uppercase tracking-wide`
  - Count badge (when populated): `text-gray-600 text-xs` e.g. "3"
- Body: `flex-1 overflow-y-auto`

**Data flow:**
1. On mount: `App.tsx` already fetches `GET /api/projects/:id/artifacts` and stores in `artifacts` state. No local fetch needed.
2. On `artifact_created` WS event: `App.tsx` prepends new artifact to `artifacts` array, triggering re-render.

**Interactions:** read-only panel. Clicking an `ArtifactRow` opens `ArtifactDrawer` for that phase (same as clicking phase chip in FeedPanel). Pass `onPhaseClick(phase: string)` prop from App.

---

### ArtifactEmptyState [NEW — inline in ArtifactsPanel]

**Purpose:** Placeholder when `artifacts.length === 0`.

**Appearance:**
```
flex items-center justify-center h-16
"No artifacts yet" — text-gray-600 text-xs
```

No icon, no action button.

---

### ArtifactRow [NEW — inline in ArtifactsPanel]

**Purpose:** Single artifact line — name, role badge, relative timestamp.

**Props:**
```typescript
interface ArtifactRowProps {
  artifact: Artifact;
  isNew: boolean;        // true for 2s after insertion
  onClick: () => void;
}
```

**Appearance (default):**
```
px-3 py-2 flex items-center gap-3 cursor-pointer
hover:bg-gray-900/60 transition-colors
border-l-2 border-transparent
```

**State: `new`** (2 s after insertion):
```
border-l-2 border-amber-500 bg-gray-900
```
Faded via `transition-colors duration-[2000ms]` — on mount set `isNew=true`, after 2000 ms set `isNew=false`.

**Layout inside row:**
```
[role badge] [artifact name — flex-1] [timestamp]
```
- Role badge: `text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-gray-800 text-gray-400` — e.g. "researcher"
- Name: `text-gray-100 text-sm truncate flex-1`
- Timestamp: `text-gray-600 text-xs flex-shrink-0` — `relativeTime(artifact.created_at)` from `utils.ts`

**Interactions:**
- Click → calls `onClick()` → App opens `ArtifactDrawer` for `artifact.phase`
- No keyboard shortcut (MVP)

---

### ProposedChangeModal [MOD]

**File:** `client/src/components/ProposedChangeModal.tsx`

**Changes from current:**
1. Import `DiffView` from `./DiffView` (new shared file).
2. Add `activeTab: "diff" | "full"` local state, default `"diff"`.
3. Render tab bar between file-path block and content area.
4. Diff tab: `<DiffView oldContent={change.original_content ?? ""} newContent={change.diff_content} maxLines={200} />`
5. Full tab: existing `<pre>` block (unchanged).
6. If `change.original_content` is `null`/empty and active tab is "diff": render an info note above `DiffView`:
   ```
   <p className="text-xs text-amber-500/80 mb-2">New file — all content is new</p>
   ```

**Props:** unchanged (`ProposedChangeModalProps`).
**No changes** to Approve/Reject logic, loading state, or backdrop.

**DB prerequisite:** `proposed_changes` table needs an `original_content TEXT` column (nullable). Server's `createProposedChange()` must read the current file content before writing the record. See Edge Cases §2 for failure handling.

---

### FeedMessageRow [MOD — add BlockedBadge]

**File:** `client/src/components/FeedPanel.tsx`

**Change:** When a feed message has `message_type === "blocked"` (new type to be emitted by loop.ts when a blocker is created), render an amber inline badge after the sender name:

```
<span className="text-[10px] text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded font-medium ml-1">
  ▲ Blocked
</span>
```

The badge is purely cosmetic — it signals to the user that the cycle is paused at this step.

---

## Schema Prerequisites

These DB changes must land in a single migration commit before any component work.

### 1. `proposed_changes` — add `original_content`

```sql
ALTER TABLE proposed_changes ADD COLUMN original_content TEXT;
```

`NULL` means new file or content was unreadable at proposal time. The modal handles both cases.

### 2. WS event type — `artifact_created`

No schema change. Server adds a `broadcastToProject` call inside `saveArtifact()` in `db.ts`:

```typescript
// After INSERT in saveArtifact():
broadcastToProject(projectId, "artifact_created", artifact);
```

This requires `broadcastToProject` to be importable from `db.ts` or passed in as a callback. Preferred pattern: pass the broadcast function as an optional parameter to `saveArtifact()` to avoid circular imports between `db.ts` and `index.ts`.

### 3. `WsEvent` union in `client/src/types.ts`

Add:
```typescript
| { event: "artifact_created"; projectId: string; data: Artifact }
| { event: "proposed_change"; projectId: string; data: ProposedChange }
```

Note: `proposed_change` (new change proposed) is distinct from `proposed_change_resolved`. The existing `proposed_change_resolved` event is unchanged.

---

## Edge Cases & Empty States

1. **Phase completes but `saveArtifact` throws** — artifact row never appears. ArtifactsPanel stays in populated state with previous artifacts. No error shown in panel (the loop's error handling should post a feed message). No special handling needed in ArtifactsPanel.

2. **`original_content` read fails** (file doesn't exist yet, or read permission error) — `createProposedChange` stores `original_content = null`. Modal renders "New file — all content is new" note and shows all lines as additions. This is correct for new-file proposals and a tolerable approximation for unreadable-file proposals.

3. **`original_content` is very large** (>10 000 lines) — `DiffView` with `maxLines=200` collapses to hunks. "Show all" toggle is available if the user needs it. LCS on 10 000-line files may be slow (~100 ms) — acceptable as this is a one-time render triggered by user approval, not a hot path.

4. **Multiple proposed changes queued simultaneously** — `App.tsx` already handles this (first pending item in array drives the modal; on `proposed_change_resolved` the next item shows). No design change needed.

5. **WS reconnect mid-cycle** — `useWebSocket` already sends `{ type: "subscribe", projectId }` on reconnect. Server should respond with a `snapshot` event containing current `proposedChanges` and `artifacts`. If snapshot is not yet implemented, ArtifactsPanel falls back to its initial HTTP fetch (already in mount path via App.tsx). Proposed-change queue is re-fetched by App.tsx's `api.proposedChanges.list()` on reconnect (confirm this is in the reconnect handler — if not, add it).

6. **ArtifactsPanel on project switch** — `App.tsx` already resets state on `selectedProject` change. `artifacts` array resets to `[]`, triggering `ArtifactEmptyState`.

7. **ArtifactRow "new" flash on initial load** — all rows from the initial HTTP fetch must NOT animate in as "new". Only rows inserted via WS event after mount should receive `isNew=true`. Implement by tracking a `Set<string>` of IDs that were present at mount time in `App.tsx` or `ArtifactsPanel`.

8. **Cycle has no artifacts (e.g. cycle errored before any phase completed)** — `ArtifactEmptyState` is shown indefinitely. This is correct.

9. **`ArtifactsPanel` in narrow viewport** — at <1200 px the right column may be hidden. The panel should not break layout; use `hidden lg:flex` on the right column if not already present.

10. **`BlockedBadge` on non-`blocked` message types** — guard with `{message.message_type === "blocked" && <BlockedBadge />}`. No effect on existing message types.

---

## Design Decisions

### D1 — Extract `DiffView` rather than duplicate

`ArtifactDrawer.tsx` already contains a working, pure-TypeScript `DiffView` with LCS. Rather than introducing `git-diff-view` (GH#3 says ESM compat is unconfirmed), extract the existing implementation into a shared `DiffView.tsx`. This closes GH#3 without adding a dependency.

### D2 — `ArtifactsPanel` receives `artifacts` from App.tsx, not local state

Centralising `artifacts` in `App.tsx` means WS events update the panel without prop drilling or context. This matches the existing pattern for `feedMessages`, `inboxMessages`, and `proposedChanges`.

### D3 — `original_content` stored at proposal time, not fetched at approval time

If we deferred the file read to approval time, the current file content might have changed (e.g. another change was applied). Storing at proposal time gives the user an accurate before/after picture of what the agent actually saw.

### D4 — "Diff" tab is default in ProposedChangeModal

The diff is the most actionable view for a reviewer. The "Full content" tab is a fallback for users who want to read the entire replacement without the noise of unchanged context lines.

### D5 — No dedicated `phase_meta` event; use `artifact_created` instead

The spec mentions `phase_meta` but the server currently emits `phase_change`. Rather than adding another event with overlapping semantics, `artifact_created` is more specific: it fires exactly when an artifact is available, avoids ambiguity around phases that might complete without producing artifacts (e.g. a blocked phase), and requires no changes to existing `phase_change` handling.

### D6 — `broadcastToProject` passed as callback into `saveArtifact`

Avoid circular import: `db.ts` imports nothing from `index.ts`. Pass the broadcast function as an optional `notify?: (artifact: Artifact) => void` parameter. Call sites in `loop.ts`/`agents/*.ts` that already have access to the broadcast function pass it in.
