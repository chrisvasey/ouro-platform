# Implementation Plan — Cycle 15

## Audit: What Already Exists

Before specifying new work, a codebase audit confirms:

- **Story 1 (Artifacts panel)**: Already implemented. `ArtifactsPanel.tsx` renders "No artifacts yet" when empty. `loop.ts` posts `[PHASE COMPLETE]` handoff messages and broadcasts `artifact_created` WS events. No code changes needed.
- **Story 3 (Diff view in modal)**: Already implemented. `DiffView.tsx` uses a custom LCS algorithm with no external dependencies. `ProposedChangeModal.tsx` shows "New file — all content is new" for empty `original_content`. GH#3 is resolved. No code changes needed.
- **Story 2 (Self-mod gate)**: Partially implemented. `dispatchToolUses()` in `base.ts` creates a `proposed_changes` row when a file is in `SELF_MOD_PATHS`. **Gaps:** (a) `loop.ts` does not pause after the agent returns, (b) approved file content is never written to disk, (c) `blocked` message_type has no visual style in `FeedPanel.tsx`.

This plan addresses exactly those three gaps.

---

## File Structure

```
server/src/
  loop.ts              [MOD] — add waitForPendingProposedChanges(); call in runPhaseStep(); broadcast pending changes; post blocked feed msg
  index.ts             [MOD] — add "path" import; in /approve route: resolve abs path; Bun.write(path, diff_content)

client/src/components/
  FeedPanel.tsx        [MOD] — add blocked entry to TYPE_COLOUR
```

---

## Data Shapes

No new types. Existing type used:

```typescript
// Already in db.ts
interface ProposedChange {
  id: string;
  cycle_id: string | null;
  project_id: string;
  proposed_by: string;
  file_path: string;       // absolute or project-relative path
  diff_content: string;    // full replacement file content (not a patch)
  original_content: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewed_at: number | null;
  created_at: number;
}
```

---

## Key Functions

### `waitForPendingProposedChanges` — `server/src/loop.ts`

```typescript
async function waitForPendingProposedChanges(projectId: string): Promise<void>
```

- **Purpose:** Polls the DB every 2 s until no PENDING proposed_changes remain for `projectId`.
- **Inputs:** `projectId: string`
- **Outputs:** `Promise<void>` — resolves when `listProposedChanges(projectId, 'PENDING').length === 0`
- **Side effects:** None. Caller handles broadcast and feed messages before calling this.
- **Implementation:**
  ```typescript
  async function waitForPendingProposedChanges(projectId: string): Promise<void> {
    const POLL_MS = 2000;
    while (listProposedChanges(projectId, "PENDING").length > 0) {
      await Bun.sleep(POLL_MS);
    }
  }
  ```

### Modified `runPhaseStep` — `server/src/loop.ts`

After `saveArtifact()` completes (inside `try`, before "PHASE COMPLETE" `postFeedMessage`), insert:

```typescript
// Check for pending proposed changes created by this agent step
const pendingChanges = listProposedChanges(projectId, "PENDING");
if (pendingChanges.length > 0) {
  // Broadcast each pending change so the client shows the approval modal
  for (const change of pendingChanges) {
    broadcast(projectId, "proposed_change", change);
  }
  // Post a blocked feed entry
  const blockedMsg = postFeedMessage(
    projectId,
    role,
    "all",
    `[${phase.toUpperCase()} BLOCKED] Proposed change to guarded path requires approval: ${pendingChanges.map((c) => c.file_path).join(", ")}`,
    "blocked"
  );
  broadcast(projectId, "feed_message", blockedMsg);
  // Suspend the cycle until all changes are approved or rejected
  await waitForPendingProposedChanges(projectId);
}
```

### Modified `/approve` route — `server/src/index.ts`

After `updateProposedChangeStatus(params.changeId, "APPROVED")`, write approved content to disk:

```typescript
// Always resolve relative to the repo root regardless of path convention
const absPath = change.file_path.startsWith("/")
  ? change.file_path
  : join(import.meta.dir, "../../", change.file_path);
try {
  await Bun.write(absPath, change.diff_content);
  console.log(`[proposed-change] Applied approved change to ${absPath}`);
} catch (writeErr) {
  console.error(`[proposed-change] Failed to write ${absPath}:`, writeErr);
  return error(500, { message: `Failed to apply change: ${(writeErr as Error).message}` });
}
```

`join` must be imported from `"path"` — currently absent from `index.ts`.

---

## Component Breakdown

### `FeedPanel.tsx` — TYPE_COLOUR addition

Add `blocked` entry to the existing `TYPE_COLOUR` constant at line 29:

```diff
 const TYPE_COLOUR: Record<string, string> = {
   handoff: "bg-blue-900/60 text-blue-400",
   question: "bg-amber-900/60 text-amber-400",
   decision: "bg-green-900/60 text-green-400",
   note: "bg-gray-800 text-gray-500",
   escalate: "bg-red-900/60 text-red-400",
+  blocked: "bg-orange-900/60 text-orange-400",
 };
```

---

## API Contract

No new endpoints. One behaviour change to an existing endpoint:

### `POST /api/projects/:id/proposed-changes/:changeId/approve`

**Before:** Updates DB status to APPROVED; broadcasts `proposed_change_resolved`.
**After:** Also writes `change.diff_content` to `change.file_path` on disk before broadcasting.

```
Request:  POST /api/projects/:id/proposed-changes/:changeId/approve
Body:     (empty)
Response (success):    200 { ok: true }
Response (not found):  404 { message: "Proposed change not found" }
Response (write fail): 500 { message: "Failed to apply change: <err>" }
```

---

## Commit Plan

### Commit 1 — `fix(loop): pause cycle on pending proposed changes and broadcast to client`

**File:** `server/src/loop.ts`

1. Add `listProposedChanges` to the import from `"./db.js"` (after `insertEvent` at line ~41).
2. Add `waitForPendingProposedChanges(projectId: string): Promise<void>` as a module-level function (place before `runCycle`).
3. In `runPhaseStep()`, after the `saveArtifact()` call resolves (inside the `try` block, before the `postFeedMessage(... "[${phase.toUpperCase()} COMPLETE]" ...)` call at line ~218), insert the pending-changes check block shown above.

**Exact import diff:**
```diff
 import {
   getProject,
   setProjectPhase,
   setProjectStatus,
   setAgentStatus,
   saveArtifact,
   postFeedMessage,
   sendInboxMessage,
   getArtifactByPhase,
+  listProposedChanges,
   createCycleRecord,
   updateCycleRecord,
   insertEvent,
   type PhaseOutcome,
 } from "./db.js";
```

**New function (add before `export async function runCycle`):**
```diff
+async function waitForPendingProposedChanges(projectId: string): Promise<void> {
+  const POLL_MS = 2000;
+  while (listProposedChanges(projectId, "PENDING").length > 0) {
+    await Bun.sleep(POLL_MS);
+  }
+}
+
 export async function runCycle(projectId: string): Promise<void> {
```

**In `runPhaseStep()`, after `saveArtifact()` block (before the COMPLETE feed message):**
```diff
       await saveArtifact(projectId, phase, filename, result.content, cycleRecord.id, (artifact) => {
         broadcast(projectId, "artifact_created", artifact);
       });

+      const pendingChanges = listProposedChanges(projectId, "PENDING");
+      if (pendingChanges.length > 0) {
+        for (const change of pendingChanges) {
+          broadcast(projectId, "proposed_change", change);
+        }
+        const blockedMsg = postFeedMessage(
+          projectId,
+          role,
+          "all",
+          `[${phase.toUpperCase()} BLOCKED] Proposed change to guarded path requires approval: ${pendingChanges.map((c) => c.file_path).join(", ")}`,
+          "blocked"
+        );
+        broadcast(projectId, "feed_message", blockedMsg);
+        await waitForPendingProposedChanges(projectId);
+      }
+
       const feedMsg = postFeedMessage(
```

---

### Commit 2 — `fix(server): write approved file content to disk on proposed_change approval`

**File:** `server/src/index.ts`

1. Add `import { join } from "path";` near the top (after the Elysia import).
2. Make the handler `async`.
3. After `updateProposedChangeStatus(params.changeId, "APPROVED")`, write the file.

**Import diff:**
```diff
 import { Elysia, t } from "elysia";
 import { cors } from "@elysiajs/cors";
+import { join } from "path";
```

**Handler diff:**
```diff
-  .post("/api/projects/:id/proposed-changes/:changeId/approve", ({ params, error }) => {
+  .post("/api/projects/:id/proposed-changes/:changeId/approve", async ({ params, error }) => {
     const changes = listProposedChanges(params.id);
     const change = changes.find((c) => c.id === params.changeId);
     if (!change) return error(404, { message: "Proposed change not found" });
     updateProposedChangeStatus(params.changeId, "APPROVED");
+    const absPath = change.file_path.startsWith("/")
+      ? change.file_path
+      : join(import.meta.dir, "../../", change.file_path);
+    try {
+      await Bun.write(absPath, change.diff_content);
+      console.log(`[proposed-change] Applied approved change to ${absPath}`);
+    } catch (writeErr) {
+      console.error(`[proposed-change] Failed to write ${absPath}:`, writeErr);
+      return error(500, { message: `Failed to apply change: ${(writeErr as Error).message}` });
+    }
     broadcastToProject(params.id, "proposed_change_resolved", { id: params.changeId, status: "APPROVED" });
     return { ok: true };
   })
```

---

### Commit 3 — `fix(ui): add blocked message type styling to FeedPanel`

**File:** `client/src/components/FeedPanel.tsx`

```diff
 const TYPE_COLOUR: Record<string, string> = {
   handoff: "bg-blue-900/60 text-blue-400",
   question: "bg-amber-900/60 text-amber-400",
   decision: "bg-green-900/60 text-green-400",
   note: "bg-gray-800 text-gray-500",
   escalate: "bg-red-900/60 text-red-400",
+  blocked: "bg-orange-900/60 text-orange-400",
 };
```

---

## Open Questions

1. ~~**DB function name:**~~ Confirmed — `listProposedChanges` is the correct export name in `db.ts`.

2. ~~**Path convention for `file_path`:**~~ Resolved — use `startsWith("/")` to detect absolute paths; fall back to `join(import.meta.dir, "../../", change.file_path)` for relative paths. Drops the fragile `/home` prefix check.

3. **Reject does not need disk write** — confirmed. Rejected changes are discarded; no file operation needed.
