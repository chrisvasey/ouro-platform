# Cycle Review — Ouro Platform (Cycle 2)

*Date: 2026-03-28 | Reviewed by: Documenter agent*

---

## Summary

Cycle 2 produced a full spec, design, implementation plan, and test report for the Ouro Platform's infrastructure layer. **No code was committed** — both Cycle 1 and Cycle 2 remain unimplemented pending resolution of plan-review failures.

**71 tests against the build plan:** 62 PASS · 6 FAIL · 3 SKIP

---

## Decisions Made This Cycle

| Decision | Rationale |
|---|---|
| Events table as observability foundation | Enables cost tracking, replay, and future structured tool use without changing agent logic |
| Artifact cycle linkage + server-side unified diff | Allows "what changed between Cycle N and N+1" queries without client computation |
| Self-mod gate hard-coded in `base.ts` | Gate cannot be disabled by an agent that controls DB or prompts |
| Proposed changes stored as full replacement content | Simpler apply path for MVP vs. unified diff patching |
| Token budget via `preferences` table, default $10/day | Prevents cost runaway; configurable per-project from UI |
| `MAX_RETRIES = 3` then blocking inbox escalation | Surfaces stuck phases without silent failure |
| Phase DAG: `research → (spec ‖ design-draft) → design-final` | Targets ≥20% wall-clock reduction; benchmark deferred to Cycle 3 |
| WS `snapshot` event on subscribe | Recovers full UI state after network drop with no page reload |
| Structured tool use + freeform fallback (graceful degradation) | Agents that don't produce `tool_use` blocks still function |

---

## Patterns Established

- **Schema-first commit:** all five schema changes land atomically in Commit 1 before any feature code
- **Blocker flow:** `blocks_cycle=1` → `BlockerModal` portal → `waitForBlockerResolution()` poll — consistent pattern for budget, self-mod, and escalation
- **WS event taxonomy:** five named types (`agent_event`, `phase_meta`, `blocker`, `proposed_change_resolved`, `snapshot`) — no freeform string events
- **Budget gate thresholds:** 80% = warn, 100% = halt (reusable pattern for future rate limits)
- `AgentRail` replaces `AgentPanel` — new left sidebar with per-role status, thoughts, and pulsing active state

---

## Issues Raised (must resolve before implementation)

| # | Severity | Story | Gap |
|---|---|---|---|
| GH#7 | **High** | Story 14 | Tool definitions never registered in `runClaude()` — `tool_uses` always `[]` |
| GH#4 | **High** | Story 7 | Self-mod gate bypassed by freeform text fallback path |
| GH#3 | **High** | Story 6 | `git-diff-view` ESM/Vite compatibility unconfirmed |
| GH#1 | Medium | Story 1 | `human_input_requested`, `human_input_received`, `error` event types have no logging call site |
| GH#5 | Medium | Story 11 | Spec lifecycle marker names don't match planned WS event taxonomy |
| GH#6 | Medium | Story 13 | `AgentCard` missing `last_action_at` and `current_task` — two spec ACs unaddressed |
| GH#2 | Medium | Story 3 | Thought log silently empty if extended thinking beta header not enabled |

**GH#7 is the most critical:** the entire structured tool use pipeline (Story 14) and the self-modification gate (Story 7) both depend on Claude producing `tool_use` blocks. Fix first.

---

## Open Questions for Chris

1. **Token budget default:** $10/project/day assumed. Confirm or override before Story 9 is built.
2. **Self-mod gate scope:** Does `/server/src/` gate also cover `prompts/` and `prompt_versions` table writes? If yes, Story 7 scope broadens.

---

## Next Cycle Priorities

Resolve all 7 plan-review failures, then execute the 16-commit plan in order. Safety cluster (Stories 7–9: self-mod gate, blocking inbox, token budget) should be treated as a single release blocker — test together end-to-end before merging.
