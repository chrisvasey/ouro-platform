# Cycle 4 Review — 2026-03-28

## Outcome: FAIL (no code committed)

Research and build phases both timed out (300s × 2 attempts each). Four cycles, zero committed code. However, this cycle produced the most actionable diagnosis to date.

## Root Cause Identified

The spec surfaced the architectural blocker behind all four cycles of zero output:

> `server/src/claude.ts` spawns `claude --print` as a subprocess. A CLI process cannot accept `tools`, return `usage.input_tokens`, or expose `thinking` blocks.

Stories 3 (thought log), 9 (token budget), and 14 (structured tool use) are architecturally impossible until `claude.ts` is migrated to the Anthropic SDK. This must be the first commit of Cycle 5.

## Plan-Review Results

**Score: 106/111 PASS** (up from 104/111 in Cycle 3)

GH#8–11 closed. Two residual findings:

| ID | Severity | Finding |
|----|----------|---------|
| GH#1 (partial) | Med | Only 3 `logEvent` call sites named explicitly; 5 event types described generically and may be missed |
| Story 15.7 | Low | SKIP — not addressed in plan |

## Decisions Made This Cycle

| Decision | Detail |
|----------|--------|
| SDK migration required | Must replace `claude --print` subprocess with `@anthropic-ai/sdk` before Stories 3, 9, 14 |
| Story ordering | SDK migration becomes Commit 0 / prerequisite before all Cycle 2 epics |
| Design carry-forwards confirmed | Stories 0, 3, 14 UI specs unchanged from Cycle 3 |

## Open Questions for Chris

1. **Token budget default** — $10/project/day still unconfirmed. Needed before Story 9 is built.
2. **Self-mod gate scope** — should `prompts/` directory be gated alongside `/server/src/`?

## Cycle 5 Priorities

1. Migrate `claude.ts` to Anthropic SDK (unblocks Stories 3, 9, 14)
2. Execute 16-commit build plan starting from Commit 1
3. Resolve GH#1 partial re-open: explicitly enumerate all `logEvent` call sites in plan
