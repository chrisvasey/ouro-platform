# Implementation Plan — Cycle 8 (rev 5)

**Developer Agent** | Ouro Platform | 2026-03-28 | Cycle 8

> **Build retry after test failure.** Tester returned FAIL with 3 issues (GH#13, GH#14, GH#15).
> Stories 1, 3, 4, 5 are fully implemented and passing. Story 2 fails on column-count.
> This revision closes the 3 open issues in 3 targeted commits.

---

## Overview

Cycle 8 backend infrastructure is substantially complete. The Anthropic SDK migration
landed, event sourcing is operational, artifact versioning with diffs is working, and all
six agent lifecycle emitters are wired through loop.ts and index.ts.

Three issues remain before the cycle can be marked complete:

| Issue | Severity | Description |
|-------|----------|-------------|
| **GH#13** | Medium | `events` table has 7 columns; spec requires 8. Missing `phase TEXT` column. |
| **GH#14** | Medium | `costUsd` not in `ClaudeRunResult` or `emitAgentCompleted` — blocks C9 Budget Gate. |
| **GH#15** | Low | Temp file cleanup in `saveArtifact` is fire-and-forget; files may accumulate. |

---

## Architecture

### File Structure (changes only)

```
server/
  src/
    claude.ts          ← ADD costUsd to ClaudeRunResult; compute from token usage
    db.ts              ← ADD phase column to events DDL + ALTER TABLE migration
                          ADD phase param to InsertEventParams + insertEvent
                          FIX temp file cleanup in saveArtifact (await unlink)
    agents/
      base.ts          ← ADD costUsd to emitAgentCompleted signature + payload
      researcher.ts    ← ADD costUsd to StepResult; accumulate totalCost; pass to emitAgentCompleted
      pm.ts            ← pass costUsd to emitAgentCompleted
      designer.ts      ← pass costUsd to emitAgentCompleted
      developer.ts     ← pass costUsd to emitAgentCompleted
      tester.ts        ← pass costUsd to emitAgentCompleted
      documenter.ts    ← pass costUsd to emitAgentCompleted
    loop.ts            ← pass phase to insertEvent calls
```

### Data Shapes (deltas)

```typescript
// claude.ts — ClaudeRunResult (Commit A: add costUsd)
export interface ClaudeRunResult {
  content: string;
  real: boolean;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;                // NEW — (inputTokens * 3 + outputTokens * 15) / 1_000_000
  thinkingContent?: string;
}

// Pricing constants (claude.ts)
const INPUT_PRICE_PER_MTOK = 3;   // $3 / 1M input tokens  (claude-sonnet-4-6)
const OUTPUT_PRICE_PER_MTOK = 15; // $15 / 1M output tokens

// db.ts — InsertEventParams (Commit B: add phase)
export interface InsertEventParams {
  projectId: string;
  cycleId?: string;
  phase?: string;    // NEW — e.g. "research", "spec", "build" etc.
  type: EventType;
  agentRole?: string;
  payload: Record<string, unknown>;
}

// db.ts — Event (Commit B: add phase)
export interface Event {
  id: string;
  project_id: string;
  cycle_id: string | null;
  phase: string | null;  // NEW
  type: EventType;
  agent_role: string | null;
  payload: Record<string, unknown>;
  created_at: number;
}

// agents/base.ts — emitAgentCompleted signature (Commit A)
function emitAgentCompleted(
  meta: AgentEventMeta,
  tokens: { inputTokens: number; outputTokens: number; costUsd: number }
): void
```

### API Contract

No new endpoints. No changes to existing response shapes.

---

## Implementation Plan

### Commit A — `feat(claude): add costUsd to ClaudeRunResult; wire through all agents`

**Resolves GH#14.**

**`server/src/claude.ts`**

1. Add two pricing constants after `DEFAULT_MAX_TOKENS`:
   ```typescript
   const INPUT_PRICE_PER_MTOK = 3;
   const OUTPUT_PRICE_PER_MTOK = 15;
   ```
2. Add `costUsd?: number` to `ClaudeRunResult` interface.
3. After extracting `inputTokens`/`outputTokens` from `response.usage`, compute:
   ```typescript
   const costUsd = (inputTokens * INPUT_PRICE_PER_MTOK + outputTokens * OUTPUT_PRICE_PER_MTOK) / 1_000_000;
   ```
4. Include `costUsd` in the returned object (`return { content, real: true, inputTokens, outputTokens, costUsd, thinkingContent }`).
5. Mock path: return `costUsd: 0` alongside existing `inputTokens: 0, outputTokens: 0`.

**`server/src/agents/base.ts`**

6. Extend `emitAgentCompleted` tokens param to `{ inputTokens: number; outputTokens: number; costUsd: number }`.
7. Add `costUsd` to the `insertEvent` payload.

**`server/src/agents/researcher.ts`**

8. Add `costUsd: number` to `StepResult` interface.
9. In `runStep`: compute `costUsd = (result.inputTokens ?? 0) * INPUT_PRICE_PER_MTOK / 1_000_000 + (result.outputTokens ?? 0) * OUTPUT_PRICE_PER_MTOK / 1_000_000`.
   — OR simpler: read `result.costUsd ?? 0` directly from `ClaudeRunResult`.
10. Add `totalCost = 0` accumulator alongside `totalInput`/`totalOutput`.
11. Accumulate `totalCost += step.costUsd` for all 5 steps.
12. Pass `costUsd: totalCost` to `emitAgentCompleted`.

**`server/src/agents/pm.ts`, `designer.ts`, `developer.ts`, `tester.ts`, `documenter.ts`**

13. Each already has `result.inputTokens ?? 0` / `result.outputTokens ?? 0` in the `emitAgentCompleted` call. Add `costUsd: result.costUsd ?? 0` to match the updated signature.
    — `designer.ts` and `developer.ts` accumulate from multiple steps: also accumulate `costUsd` per step.

---

### Commit B — `fix(db): add phase column to events table; pass phase from loop.ts`

**Resolves GH#13.**

**`server/src/db.ts`**

1. Add `phase TEXT` column to `CREATE TABLE IF NOT EXISTS events` DDL — place between `cycle_id` and `type`:
   ```sql
   phase      TEXT,
   ```
2. Add idempotent migration immediately after the existing index try/catch blocks:
   ```typescript
   try { db.run("ALTER TABLE events ADD COLUMN phase TEXT"); } catch { /* already exists */ }
   ```
3. Add `phase?: string` to `InsertEventParams` interface.
4. Add `phase: string | null` to `Event` interface.
5. Add `phase: string | null` to internal `DbEvent` interface.
6. Update `insertEvent` INSERT statement to include `phase`:
   ```sql
   INSERT INTO events (id, project_id, cycle_id, phase, type, agent_role, payload, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ```
   Bind value: `params.phase ?? null`.
7. Update the constructed return object and `parseEventRow` to include `phase`.

**`server/src/loop.ts`**

8. Add `phase` to every `insertEvent` call inside `runPhaseStep`:
   - `phase_started`: `phase`
   - `phase_completed`: `phase`
   - `error`: `phase`
9. Add `phase` to `human_input_requested` event (pass `"test"` — it always fires from the test retry block).

---

### Commit C — `fix(db): await temp file cleanup in saveArtifact`

**Resolves GH#15.**

**`server/src/db.ts`** — `saveArtifact` `finally` block (currently at ~line 418-419):

Replace fire-and-forget `Bun.spawn(["rm", "-f", tmpA])` with awaited `fs/promises` unlink:

```typescript
} finally {
  const { unlink } = await import("node:fs/promises");
  await unlink(tmpA).catch(() => {});
  await unlink(tmpB).catch(() => {});
}
```

`node:fs/promises` is available in Bun. This is one line per temp file; errors are swallowed. The `import()` is lazy and cached by the runtime after first call — no performance concern.

---

## Commit Plan

```
Commit A — feat(claude): add costUsd to ClaudeRunResult; thread through emitAgentCompleted and all 6 agents
  Files:
    server/src/claude.ts        ← costUsd field + pricing constants + compute in execute()
    server/src/agents/base.ts   ← emitAgentCompleted tokens param extended
    server/src/agents/researcher.ts ← StepResult.costUsd; totalCost accumulator
    server/src/agents/pm.ts     ← costUsd: result.costUsd ?? 0
    server/src/agents/designer.ts   ← costUsd accumulation across 3 steps
    server/src/agents/developer.ts  ← costUsd accumulation across 4 steps
    server/src/agents/tester.ts     ← costUsd: result.costUsd ?? 0 (or inputTokens path)
    server/src/agents/documenter.ts ← costUsd: result.costUsd ?? 0

Commit B — fix(db): add phase column to events table; pass phase from loop.ts  [GH#13]
  Files:
    server/src/db.ts     ← DDL update + ALTER TABLE migration + interface/helper changes
    server/src/loop.ts   ← phase threaded into all 4 insertEvent calls in runPhaseStep

Commit C — fix(db): await temp file cleanup in saveArtifact  [GH#15]
  Files:
    server/src/db.ts     ← finally block uses fs/promises unlink (awaited)
```

---

## Open Questions

1. **`costUsd` optional vs required on `ClaudeRunResult`:** Keeping it optional (`costUsd?: number`)
   maintains backward compat for any callers that destructure the result without expecting cost.
   All internal callers use `result.costUsd ?? 0` so this is safe. If the tester flags optional
   as a failure, make it required and update mock path accordingly (it already returns `costUsd: 0`).

2. **`events.type` vs `events.event_type` column name:** Spec says `event_type` but implementation
   uses `type`. Column renaming in SQLite requires table rebuild. Given all code is consistent on
   `type`, defer the rename to a schema migration story rather than breaking all callers now.
   GH#13 only required an 8th column — the column-name inconsistency is a separate, lower-priority issue.

3. **Cycle 9 readiness:** After Commits A–C, `costUsd` flows from every `agent_completed` event.
   The C9 Budget Gate can sum `costUsd` from the `events` table without any further schema changes.
   The `GET /api/projects/:id/budget/today` endpoint (C9-1) can be added in Cycle 9.

---

*Implementation Plan — Developer Agent | Ouro Platform | 2026-03-28 | Cycle 8 rev 5*
