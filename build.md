# Build Plan — Cycle 16
# Ouro Platform — Self-Mod Gate (Fix Pass)

## Status Assessment

Previous cycle left 6 test failures. Root causes confirmed by reading source:

| Gap | File | Status |
|-----|------|--------|
| `ProposedChangeModal` diff guard | `client/src/components/ProposedChangeModal.tsx` | ✅ Already done |
| Approve endpoint writes file | `server/src/index.ts` | ✅ Already done |
| `insertEvent` not imported but called (line 159) | `server/src/index.ts` | ❌ Runtime bug |
| `getProposedChangeById` helper | `server/src/db.ts` | ❌ Missing |
| `setBaseBroadcast` / `waitForProposedChangeResolution` | `server/src/agents/base.ts` | ❌ Missing |
| `setBaseBroadcast` call in loop init | `server/src/loop.ts` | ❌ Missing |
| Self-mod guard after Claude Code execution | `server/src/agents/developer.ts` | ❌ Missing (`git add -A` used) |

---

## File Structure

Files to modify (no new files):

```
server/src/
  db.ts                    ← add getProposedChangeById()
  agents/base.ts           ← add setBaseBroadcast, waitForProposedChangeResolution; update dispatchToolUses
  loop.ts                  ← call setBaseBroadcast in setBroadcastFn
  agents/developer.ts      ← guard self-mod files before git add
  index.ts                 ← add insertEvent to DB import list
```

---

## Data Shapes

No schema changes. All tables exist. One new exported function type:

```typescript
// server/src/agents/base.ts
type BaseBroadcastFn = (projectId: string, event: string, data: unknown) => void;
```

---

## Key Functions

### `db.ts` — `getProposedChangeById`
```typescript
export function getProposedChangeById(id: string): ProposedChange | null {
  return db
    .query<ProposedChange, [string]>("SELECT * FROM proposed_changes WHERE id = ?")
    .get(id);
}
```

### `base.ts` — `setBaseBroadcast`
```typescript
let baseBroadcast: BaseBroadcastFn = () => {};
export function setBaseBroadcast(fn: BaseBroadcastFn): void {
  baseBroadcast = fn;
}
```

### `base.ts` — `waitForProposedChangeResolution`
```typescript
export async function waitForProposedChangeResolution(
  changeId: string,
  timeoutMs = 30 * 60 * 1000
): Promise<"APPROVED" | "REJECTED"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const change = getProposedChangeById(changeId);
    if (change && change.status !== "PENDING") {
      return change.status as "APPROVED" | "REJECTED";
    }
    await Bun.sleep(2000);
  }
  throw new Error(`Self-mod approval timed out for change ${changeId}`);
}
```

### `base.ts` — `dispatchToolUses` self-mod branch update
In the `isSelfModPath(filename)` branch, after `createProposedChange`:
1. `notifyChange?.(change)` — keep existing callback
2. `baseBroadcast(projectId, "proposed_change", change)`
3. `baseBroadcast(projectId, "agent_status", { role: agentRole, status: "blocked", current_task: "Awaiting self-mod approval" })`
4. `const resolution = await waitForProposedChangeResolution(change.id)`
5. If `APPROVED`: `await Bun.write(filename, inp.content as string)`
6. `baseBroadcast(projectId, "proposed_change_resolved", { id: change.id, status: resolution })`
7. `baseBroadcast(projectId, "agent_status", { role: agentRole, status: "thinking", current_task: null })`

### `developer.ts` — self-mod guard in `executeWithClaudeCode`

Add `ExecuteOpts` interface:
```typescript
interface ExecuteOpts {
  workspaceDir: string;
  prompt: string;
  projectId: string;
  agentRole: string;
  cycleId?: string;
  onProgress?: (msg: string) => void;
}
```

After Claude Code exits, replace `git add -A` with:
1. Run `git status --porcelain` → parse into `string[]` of relative paths
2. Partition: `guardedFiles` = paths starting with `server/src/`; rest = `normalFiles`
3. For each guarded file (sequential):
   - Read content: `await Bun.file(join(workspaceDir, relativePath)).text()`
   - `createProposedChange(opts.projectId, opts.agentRole, join(workspaceDir, relativePath), content, opts.cycleId)`
   - `baseBroadcast(opts.projectId, "proposed_change", change)` — import `baseBroadcast` getter or pass broadcast in opts
   - `const res = await waitForProposedChangeResolution(change.id)`
   - if APPROVED: `Bun.spawn(["git", "add", relativePath], { cwd: workspaceDir })`
   - if REJECTED: `Bun.spawn(["git", "checkout", "HEAD", "--", relativePath], { cwd: workspaceDir })`
4. For normalFiles: stage each with `git add <relativePath>` individually
5. Commit as before if any staged files

**Broadcast in developer.ts:** Import `setBaseBroadcast` and expose a module-level `devBroadcast` ref, OR simply inline an import of `baseBroadcast` as a closure. Simplest: import `waitForProposedChangeResolution` and `isSelfModPath` from `./base.js`; for broadcast, re-use the pattern — add a `broadcast` param to `ExecuteOpts` and pass the module-level broadcast from loop.ts through `runDeveloper` → `executeWithClaudeCode`.

---

## API Contract

No new endpoints. One existing endpoint fixed:

| Method | Path | Fix |
|--------|------|-----|
| `POST` | `/api/projects/:id/inbox/:msgId/reply` | `insertEvent` added to import — no more ReferenceError |

---

## Commit Plan

### Commit 1 — `fix(db): add getProposedChangeById helper`
- File: `server/src/db.ts`
- Add after `listProposedChanges`: `getProposedChangeById(id: string): ProposedChange | null`
- Export it

### Commit 2 — `fix(base): wire broadcast and pause on self-mod proposal`
- File: `server/src/agents/base.ts`
- Add `BaseBroadcastFn` type, `baseBroadcast` module-level var (default no-op)
- Export `setBaseBroadcast(fn: BaseBroadcastFn): void`
- Import `getProposedChangeById` from `../db.js`
- Export `waitForProposedChangeResolution(changeId, timeoutMs?): Promise<"APPROVED" | "REJECTED">`
- Update `dispatchToolUses` self-mod branch: broadcast + block + await resolution + conditional write + unblock

### Commit 3 — `fix(loop): call setBaseBroadcast on init`
- File: `server/src/loop.ts`
- Add `setBaseBroadcast` to import from `./agents/base.js`
- In `setBroadcastFn(fn)`: add `setBaseBroadcast(fn)` call

### Commit 4 — `fix(developer): guard self-mod files before commit`
- File: `server/src/agents/developer.ts`
- Add `ExecuteOpts` interface
- Refactor `executeWithClaudeCode(workspaceDir, prompt, onProgress?)` → `executeWithClaudeCode(opts: ExecuteOpts)`
- Import `waitForProposedChangeResolution`, `isSelfModPath` from `./base.js`
- Import `createProposedChange` from `../db.js`
- After CC exits: parse porcelain, partition, approval-gate guarded files, stage normal files
- Update `runDeveloper` call site to pass all opts (add broadcast plumbing via `baseBroadcast` imported from base.ts)

### Commit 5 — `fix(server): add insertEvent to index.ts imports`
- File: `server/src/index.ts`
- Add `insertEvent` to the existing DB import block
- No logic changes — call sites already exist

---

## Open Questions

1. **`isSelfModPath` vs relative git paths:** `git status --porcelain` returns `server/src/agents/base.ts` (no leading `/`). In developer.ts, use `relativePath.startsWith("server/src/")` directly — do not call `isSelfModPath` which expects leading `/server/src/`.

2. **Broadcast plumbing in developer.ts:** The cleanest approach for Commit 4 is to import `baseBroadcast` as a module-level variable reference from base.ts (after Commit 2 makes it available via `setBaseBroadcast`). Since `setBaseBroadcast` is called during loop init before any cycle runs, the broadcast will always be wired by the time `executeWithClaudeCode` fires.

3. **Sequential approval UX:** Multiple guarded files → multiple sequential modals. Correct MVP behaviour.
