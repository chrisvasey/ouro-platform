# Implementation Plan — Cycle 15

**Developer:** Ouro Developer Agent | **Date:** 2026-04-17 | **Cycle:** 15
**Scope:** Artifact visibility panel (Story 1), self-mod diff view in approval modal (Story 2/GH#3), schema prerequisite for GH#4. Cycle closes GH#3; lays structural groundwork for GH#4 (does NOT implement the self-mod gate in agents — that is a future cycle).

---

## File Structure

```
Modified:
  server/src/db.ts                           — ALTER proposed_changes; update ProposedChange interface;
                                               add original_content capture to createProposedChange();
                                               add notify callback to saveArtifact()
  server/src/loop.ts                         — pass notify callback at saveArtifact call sites (lines ~214, ~463)
  client/src/types.ts                        — ProposedChange.original_content; WsEvent union; FeedMessage.message_type
  client/src/components/ArtifactDrawer.tsx   — remove inline DiffLine/computeLineDiff/DiffView; import from ./DiffView
  client/src/components/ProposedChangeModal.tsx — diff/full tab UI; DiffView integration; original_content handling
  client/src/components/FeedPanel.tsx        — BlockedBadge on message_type === "blocked"
  client/src/components/InboxPanel.tsx       — root element: remove w-80 flex-shrink-0 (move to App.tsx wrapper)
  client/src/App.tsx                         — artifacts state; artifact_created + proposed_change WS handlers;
                                               right-column restructure; ArtifactsPanel mount

Created:
  client/src/components/DiffView.tsx         — shared diff component extracted from ArtifactDrawer
  client/src/components/ArtifactsPanel.tsx   — live artifact list panel (ArtifactRow + ArtifactEmptyState inline)
```

---

## Data Shapes

```typescript
// ── server/src/db.ts — updated ProposedChange interface ──────────────────────
export interface ProposedChange {
  id: string;
  cycle_id: string | null;
  project_id: string;
  proposed_by: string;
  file_path: string;
  diff_content: string;
  original_content: string | null;   // NEW — file content captured at proposal time
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewed_at: number | null;
  created_at: number;
}

// ── client/src/components/DiffView.tsx ───────────────────────────────────────
interface DiffLine {
  type: "added" | "removed" | "context";
  content: string;
}

interface DiffViewProps {
  oldContent: string;   // baseline; empty string = new file
  newContent: string;   // proposed replacement
  maxLines?: number;    // collapse hunks when diff > maxLines*2 lines; default: unlimited
}

// ── client/src/components/ArtifactsPanel.tsx ─────────────────────────────────
interface ArtifactsPanelProps {
  artifacts: Artifact[];
  initialIds: Set<string>;        // IDs from initial HTTP fetch — skip "new" animation
  onPhaseClick: (phase: string) => void;
}

interface ArtifactRowProps {
  artifact: Artifact;
  isNew: boolean;   // true when artifact.id NOT in initialIds (arrived via WS after mount)
  onClick: () => void;
}
```

---

## Key Functions

### `server/src/db.ts` — `createProposedChange()`

**Current signature (sync):**
```typescript
export function createProposedChange(
  projectId, proposedBy, filePath, diffContent, cycleId?
): ProposedChange
```

**Updated signature:**
```typescript
export function createProposedChange(
  projectId: string,
  proposedBy: string,
  filePath: string,
  diffContent: string,
  cycleId?: string,
  notify?: (change: ProposedChange) => void
): ProposedChange
```

**New behaviour:**
1. Before INSERT: try `readFileSync(filePath, "utf-8")` from `node:fs` — on any error set `null`.
   (Using sync Node compat to keep function sync; avoids changing all call sites to async.)
2. INSERT includes `original_content` column binding.
3. Returned object includes `original_content`.
4. After INSERT: call `notify?.(record)`.

**Import to add:** `import { readFileSync } from "node:fs";`

---

### `server/src/db.ts` — `saveArtifact()`

**Current signature:**
```typescript
export async function saveArtifact(projectId, phase, filename, content, cycleId?): Promise<Artifact>
```

**Updated signature (6th param added):**
```typescript
export async function saveArtifact(
  projectId: string,
  phase: string,
  filename: string,
  content: string,
  cycleId?: string,
  notify?: (artifact: Artifact) => void
): Promise<Artifact>
```

**New behaviour:** After building the return value, call `notify?.(artifact)` before returning. Parameter is additive — all existing call sites without a 6th arg continue to compile and behave identically.

---

### `client/src/components/DiffView.tsx` — `computeLineDiff()`

Extracted verbatim from `ArtifactDrawer.tsx` lines 36–75. No logic changes.

```typescript
export function computeLineDiff(oldText: string, newText: string): DiffLine[]
```

---

### `client/src/components/DiffView.tsx` — `DiffView`

```typescript
export function DiffView({ oldContent, newContent, maxLines }: DiffViewProps): JSX.Element
```

**Base render:** identical to current `ArtifactDrawer.tsx` implementation (lines 77–108).

**Hunk collapsing** (only when `maxLines` is defined and `lines.length > maxLines * 2` and `!showAll`):
1. Collect changed indices: `lines.forEach((l, i) => { if (l.type !== "context") changedSet.add(i); })`
2. Build visible set: each changed index ± 5 lines, clamped to `[0, lines.length - 1]`.
3. Walk `lines` in order; track consecutive gaps between visible indices. For each gap of N lines, render:
   ```tsx
   <div className="text-gray-600 text-xs py-1 px-2 bg-gray-900/50 select-none">
     ── {N} unchanged lines ──
   </div>
   ```
4. "Show all" toggle at bottom (local `showAll: boolean` state, default `false`):
   ```tsx
   <button
     className="text-xs text-gray-500 hover:text-gray-300 underline mt-2 cursor-pointer"
     onClick={() => setShowAll(true)}
   >
     Show all
   </button>
   ```

**State:** `const [showAll, setShowAll] = useState(false)`
**Exports:** `DiffView` (named), `computeLineDiff` (named).

---

### `client/src/App.tsx` — new WS branches in `handleWsEvent()`

```typescript
if (payload.event === "artifact_created") {
  if (payload.projectId !== pid) return;
  setArtifacts((prev) => {
    if (prev.some((a) => a.id === payload.data.id)) return prev;
    return [payload.data, ...prev];   // prepend; newest first
  });
  // Note: no "new" animation state mutation here — ArtifactsPanel computes isNew
  // from initialIds (the Set built at project-select time). Newly arrived IDs are
  // not in initialIds, so isNew is automatically true.
}

if (payload.event === "proposed_change") {
  if (payload.projectId !== pid) return;
  setProposedChanges((prev) => {
    if (prev.some((c) => c.id === payload.data.id)) return prev;
    return [payload.data, ...prev];
  });
}
```

---

## Component Breakdown

### `DiffView.tsx` [NEW]

**File:** `client/src/components/DiffView.tsx`
**Exports:** `computeLineDiff`, `DiffView`
**State:** `showAll: boolean`
**Line colour map (unchanged from ArtifactDrawer):**
- Added: `bg-green-950/40 text-green-300` | prefix `text-green-500 select-none` `+`
- Removed: `bg-red-950/40 text-red-300 line-through decoration-red-700/40` | prefix `text-red-500 select-none` `-`
- Context: `text-gray-500` | prefix space

---

### `ArtifactsPanel.tsx` [NEW]

**File:** `client/src/components/ArtifactsPanel.tsx`

**Props:** `{ artifacts: Artifact[]; initialIds: Set<string>; onPhaseClick: (phase: string) => void }`

**isNew logic:** `isNew = !initialIds.has(artifact.id)`. No timers — the amber border stays until page refresh or project switch (acceptable MVP behaviour; amber border only appears for artifacts that arrived live).

**Render states:**
- `artifacts.length === 0` → `<ArtifactEmptyState />`
- Populated → `artifacts.map(art => <ArtifactRow ... />)` (newest first — App.tsx prepends on WS event)

**Root element:**
```tsx
<aside className="flex-1 min-h-0 flex flex-col bg-gray-950 border-t border-gray-800">
  <div className="flex items-center justify-between px-3 py-2 flex-shrink-0 border-b border-gray-800">
    <span className="text-gray-400 text-xs font-medium uppercase tracking-wide">Artifacts</span>
    {artifacts.length > 0 && (
      <span className="text-gray-600 text-xs">{artifacts.length}</span>
    )}
  </div>
  <div className="flex-1 overflow-y-auto">
    {artifacts.length === 0 ? <ArtifactEmptyState /> : artifacts.map(…)}
  </div>
</aside>
```

---

### `ArtifactEmptyState` [inline in ArtifactsPanel.tsx]

```tsx
function ArtifactEmptyState() {
  return (
    <div className="flex items-center justify-center h-16">
      <span className="text-gray-600 text-xs">No artifacts yet</span>
    </div>
  );
}
```

---

### `ArtifactRow` [inline in ArtifactsPanel.tsx]

```tsx
function ArtifactRow({ artifact, isNew, onClick }: ArtifactRowProps) {
  return (
    <div
      className={`px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-gray-900/60 transition-colors border-l-2 ${
        isNew ? "border-amber-500 bg-gray-900" : "border-transparent"
      }`}
      onClick={onClick}
    >
      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 flex-shrink-0">
        {artifact.phase}
      </span>
      <span className="text-gray-100 text-sm truncate flex-1">{artifact.filename}</span>
      <span className="text-gray-600 text-xs flex-shrink-0">{relativeTime(artifact.created_at)}</span>
    </div>
  );
}
```

Imports needed in `ArtifactsPanel.tsx`: `relativeTime` from `"../utils"`, `Artifact` from `"../types"`.

---

### `ProposedChangeModal.tsx` [MOD]

**Changes only:**

1. Add import: `import { DiffView } from "./DiffView";`
2. Add state: `const [activeTab, setActiveTab] = useState<"diff" | "full">("diff");`
3. Insert tab bar between the file-path block and the content block:
   ```tsx
   <div className="flex gap-1 px-5 pt-3 pb-0 border-b border-gray-800 flex-shrink-0">
     {(["diff", "full"] as const).map((tab) => (
       <button
         key={tab}
         onClick={() => setActiveTab(tab)}
         className={activeTab === tab
           ? "border-b-2 border-blue-500 text-gray-100 text-xs pb-2"
           : "text-gray-500 text-xs pb-2 hover:text-gray-300"
         }
       >
         {tab === "diff" ? "Diff" : "Full content"}
       </button>
     ))}
   </div>
   ```
4. Replace the single `<div className="flex-1 overflow-y-auto px-5 py-3">` block with two conditional blocks:

   **Diff tab:**
   ```tsx
   {activeTab === "diff" && (
     <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
       {!change.original_content && (
         <p className="text-xs text-amber-500/80 mb-2">New file — all content is new</p>
       )}
       <DiffView
         oldContent={change.original_content ?? ""}
         newContent={change.diff_content}
         maxLines={200}
       />
     </div>
   )}
   ```

   **Full content tab** (existing `<pre>` block, moved here):
   ```tsx
   {activeTab === "full" && (
     <div className="flex-1 overflow-y-auto px-5 py-3">
       <p className="text-xs text-gray-500 mb-2">Proposed content</p>
       <pre className="text-xs text-gray-300 font-mono bg-gray-800/60 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed">
         <code>{change.diff_content}</code>
       </pre>
     </div>
   )}
   ```

No changes to: approve/reject handlers, loading state, backdrop, header, or file-path display block.

---

### `FeedPanel.tsx` [MOD — add BlockedBadge]

Add above `FeedMessageRow`:
```tsx
function BlockedBadge() {
  return (
    <span className="text-[10px] text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded font-medium ml-1">
      ▲ Blocked
    </span>
  );
}
```

In `FeedMessageRow`, inside the header flex row (after the `isClickable` hint span, before the timestamp span), add:
```tsx
{msg.message_type === "blocked" && <BlockedBadge />}
```

---

### `App.tsx` [MOD]

**New state:**
```typescript
const [artifacts, setArtifacts] = useState<Artifact[]>([]);
const [artifactInitialIds, setArtifactInitialIds] = useState<Set<string>>(new Set());
```

**New imports:** `Artifact` (add to existing types import line), `ArtifactsPanel`.

**Project selection effect — additions:**
```typescript
// In reset block:
setArtifacts([]);
setArtifactInitialIds(new Set());

// Extend Promise.all (5th item):
api.artifacts.list(selectedProject.id),

// Extend destructure:
.then(([feed, inbox, cycles, changes, arts]) => {
  if (currentProjectIdRef.current === selectedProject.id) {
    // ... existing setters ...
    setArtifacts(arts);
    setArtifactInitialIds(new Set(arts.map((a) => a.id)));
  }
})
```

**Right column (replace bare `{selectedProject && <InboxPanel .../>}`):**
```tsx
{selectedProject && (
  <div className="w-80 flex-shrink-0 flex flex-col overflow-hidden">
    <InboxPanel
      projectId={selectedProject.id}
      messages={inboxMessages}
      onMessagesChange={setInboxMessages}
    />
    <ArtifactsPanel
      artifacts={artifacts}
      initialIds={artifactInitialIds}
      onPhaseClick={(phase) => setArtifactDrawerPhase(phase)}
    />
  </div>
)}
```

---

### `InboxPanel.tsx` [MOD — root class only]

Root `<aside>` class change:
- **From:** `"w-80 flex-shrink-0 flex flex-col overflow-hidden"`
- **To:** `"flex-shrink-0 max-h-[40%] flex flex-col overflow-hidden"`

`w-80` and outer `flex-shrink-0` now live on the App.tsx wrapper div. `max-h-[40%]` caps InboxPanel at 40% of the right column height, leaving `flex-1` space for ArtifactsPanel.

---

## API Contract

No new HTTP endpoints.

**Existing routes unchanged:**
| Method | Path | Response |
|---|---|---|
| `GET` | `/api/projects/:id/artifacts` | `Artifact[]` (latest version per phase, ordered by created_at DESC — verify) |
| `POST` | `/api/projects/:id/proposed-changes/:changeId/approve` | `{ ok: true }` |
| `POST` | `/api/projects/:id/proposed-changes/:changeId/reject` | `{ ok: true }` |

**New WS events (server → client):**
| Event | Payload shape | Emitted by |
|---|---|---|
| `artifact_created` | `{ event, projectId: string, data: Artifact }` | `saveArtifact()` notify callback, called from loop.ts |
| `proposed_change` | `{ event, projectId: string, data: ProposedChange }` | `createProposedChange()` notify callback, called from loop.ts/agents |

Both follow existing pattern: `broadcastToProject(projectId, eventName, data)` — `broadcast` is the module-level `BroadcastFn` ref already in loop.ts scope.

---

## Commit Plan

### Commit 1 — `chore(db): add original_content column to proposed_changes`

**Files:** `server/src/db.ts`, `client/src/types.ts`

**`server/src/db.ts`:**
1. Add `import { readFileSync } from "node:fs"` at top (alongside existing imports).
2. After existing column migration block (~line 163), add:
   ```typescript
   try { db.run("ALTER TABLE proposed_changes ADD COLUMN original_content TEXT"); } catch { /* already exists */ }
   ```
3. Update `ProposedChange` interface: add `original_content: string | null`.
4. Update `createProposedChange()`:
   - Add `notify?: (change: ProposedChange) => void` as 6th param (after optional `cycleId`).
   - Before INSERT: `let originalContent: string | null = null; try { originalContent = readFileSync(filePath, "utf-8"); } catch { /* new file or unreadable */ }`
   - Extend INSERT statement: add `original_content` column and `?` binding after `diff_content`.
   - Extend returned object literal: add `original_content`.
   - After building `record` (before/after `return`): call `notify?.(record)`.
5. `listProposedChanges` uses `SELECT *` — automatically returns the new column. No change.

**`client/src/types.ts`:**
1. Add `original_content: string | null` to `ProposedChange` interface.

**Downstream call sites to update:**
- `server/src/seed.ts:141` — new param `notify` is optional; no change required (seed doesn't need broadcast).

---

### Commit 2 — `feat(server): broadcast artifact_created event via saveArtifact notify callback`

**Files:** `server/src/db.ts`, `server/src/loop.ts`

**`server/src/db.ts` — `saveArtifact()`:**
1. Add `notify?: (artifact: Artifact) => void` as the 6th param.
2. After `return { id, project_id: projectId, ... }` line: call `notify?.(artifact)`.
   (Build the return object into a named `const artifact = {...}`, then `notify?.(artifact); return artifact;`.)

**`server/src/loop.ts`:**
1. Line ~214 — extend call: add `(art) => broadcast(projectId, "artifact_created", art)` as 6th arg.
2. Line ~463 — same.
3. `broadcast` is the module-level `let broadcast: BroadcastFn` already in scope.

**Not changed:** `agents/base.ts:59`, `agents/documenter.ts:38` — these call `saveArtifact` without notify (no broadcast access in agent context). Artifacts saved via agent direct-path won't emit WS events; covered by initial HTTP fetch on page load. Addressed in a future cycle.

---

### Commit 3 — `feat(client): extend WsEvent union and FeedMessage.message_type`

**File:** `client/src/types.ts`

1. `FeedMessage.message_type` union — add `"blocked"`:
   ```typescript
   message_type: "handoff" | "question" | "decision" | "note" | "escalate" | "blocked";
   ```
2. `WsEvent` union — add after the `proposed_change_resolved` line:
   ```typescript
   | { event: "artifact_created"; projectId: string; data: Artifact }
   | { event: "proposed_change"; projectId: string; data: ProposedChange }
   ```

No runtime changes. Enables TypeScript narrowing for the new WS event branches added in Commit 5.

---

### Commit 4 — `refactor(client): extract DiffView to shared component`

**Files:** `client/src/components/DiffView.tsx` (CREATE), `client/src/components/ArtifactDrawer.tsx` (MOD)

**`DiffView.tsx` (new file):**
1. Copy `DiffLine` interface, `computeLineDiff` function, and `DiffView` component from `ArtifactDrawer.tsx` lines 31–108 verbatim.
2. Change `DiffView` props from `{ oldContent, newContent }` to the `DiffViewProps` interface (adds optional `maxLines`).
3. Add `const [showAll, setShowAll] = useState(false)` inside `DiffView`.
4. Add hunk collapsing logic (active when `maxLines !== undefined && !showAll && lines.length > maxLines * 2`) per Key Functions spec above.
5. Add "Show all" toggle button below `<pre>` when collapsed.
6. Named exports: `export function computeLineDiff(...)` and `export function DiffView(...)`.

**`ArtifactDrawer.tsx`:**
1. Delete lines 31–108 (the `DiffLine` interface, `computeLineDiff` function, and `DiffView` component).
2. Add at top: `import { DiffView } from "./DiffView";`
3. Existing `<DiffView oldContent={previousArtifact.content} newContent={artifact.content} />` call at ~line 226 — unchanged (no `maxLines`, defaults to unlimited → identical behaviour).

**Verification:** ArtifactDrawer diff view must render identically to before this commit.

---

### Commit 5 — `feat(client): add ArtifactsPanel; wire artifacts into App`

**Files:** `client/src/components/ArtifactsPanel.tsx` (CREATE), `client/src/components/InboxPanel.tsx` (MOD), `client/src/App.tsx` (MOD)

**`ArtifactsPanel.tsx`:** Implement per Component Breakdown above. Includes inline `ArtifactEmptyState` and `ArtifactRow`. No local state except what's in `ArtifactRow` for onClick. No loading skeleton needed — App.tsx gates mount until artifacts fetch resolves (see note in Open Questions).

**`InboxPanel.tsx`:** Root `<aside>` class change per Component Breakdown above (remove `w-80 flex-shrink-0`; add `max-h-[40%]`).

**`App.tsx`:** All changes per Component Breakdown above:
- New state (`artifacts`, `artifactInitialIds`)
- New imports
- Extended Promise.all and reset block in project selection effect
- New `artifact_created` and `proposed_change` WS branches
- Right column restructure

---

### Commit 6 — `feat(client): add diff/full-content tabs to ProposedChangeModal`

**File:** `client/src/components/ProposedChangeModal.tsx`

Changes per Component Breakdown above. No logic changes to approve/reject.

**Verification path:** Use seed.ts to insert a proposed change with a real `file_path`. Confirm:
- Diff tab renders green/red lines (or all-green with amber note if `original_content` is null)
- Full content tab renders raw replacement text
- Approve/Reject still function correctly

---

### Commit 7 — `feat(client): add BlockedBadge to FeedMessageRow`

**File:** `client/src/components/FeedPanel.tsx`

Changes per Component Breakdown above.

**Verification path:** Insert a feed message with `message_type = 'blocked'` via SQLite CLI or seed. Confirm amber `▲ Blocked` badge renders inline. Confirm no visual change for other message types.

---

## Open Questions

1. **`createProposedChange` not yet called from loop.ts** — GH#4 (self-mod gate logic in agents) is out of scope for Cycle 15. The `proposed_change` WS event will not fire during a live cycle run. Testing requires either: (a) inserting a proposed change via seed.ts, or (b) resolving GH#4 in a future cycle. No action needed this cycle.

2. **`saveArtifact` in agents not broadcasting** — `agents/base.ts:59` and `agents/documenter.ts:38` call `saveArtifact` without the notify callback. These artifact saves won't trigger live WS pushes. Acceptable for MVP — initial HTTP fetch covers them. Address in a future cycle.

3. **`listArtifacts` order** — `db.ts:listArtifacts` must return newest-first (`ORDER BY created_at DESC`) for App.tsx to `setArtifacts(arts)` correctly (panel renders `artifacts[0]` first). If the query currently returns oldest-first, add `.reverse()` in App.tsx before `setArtifacts`: `setArtifacts([...arts].reverse())`. Check the query.

4. **ArtifactsPanel loading state** — Panel receives `artifacts` from App.tsx, which fetches on project select. During the initial fetch (Promise.all in flight), `artifacts` is `[]`, so panel shows `ArtifactEmptyState`. This is technically incorrect (distinguishing "loading" from "loaded empty"). For MVP, acceptable. To fix: add `artifactsLoading: boolean` state to App.tsx, pass as prop, render skeleton rows. Deferred.

5. **InboxPanel overflow after max-h change** — After removing `overflow-hidden` from InboxPanel root and adding `max-h-[40%]`, verify internal scroll still works. InboxPanel's internal content div likely has its own `overflow-y-auto` — this should work fine. Spot-check with many inbox messages before merging Commit 5.

6. **`proposed_change` WS event naming** — Previous build plans used `blocker` as the WS event name. This cycle uses `proposed_change` to match design.md and distinguish from the inbox blocker flow. Ensure the client handler (`payload.event === "proposed_change"`) and the server broadcast call (`broadcast(projectId, "proposed_change", change)`) use the same string.
