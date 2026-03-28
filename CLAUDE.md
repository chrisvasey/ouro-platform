# Ouro — CLAUDE.md

## Project Overview
Ouro is a self-improving AI software agency. A multi-role agent loop (researcher → PM → designer → developer → tester → documenter) builds and iterates on software projects. The platform serves as both the tool and the subject of improvement.

## Architecture
- **Stack:** Bun + TypeScript, Elysia HTTP/SSE server, SQLite (`bun:sqlite`), React + Vite frontend, Caddy reverse proxy on Tailscale
- **Key files:** `server/src/db.ts` (schema + helpers), `server/src/loop.ts` (cycle orchestrator), `server/src/agents/*.ts` (one file per role), `server/src/prompts.ts`, `server/src/index.ts` (HTTP + SSE + WS)
- **Frontend structure:** `client/src/components/` (one dir per feature), `client/src/hooks/`, `client/src/utils/`
- **WS event taxonomy:** `agent_event`, `phase_meta`, `blocker`, `proposed_change_resolved`, `snapshot` (emitted on subscribe)
- **Phase DAG (Cycle 2):** `research → (spec ‖ design-draft) → design-final → build → test → review`

## Client Preferences
- Token budget default: $10/project/day (assumed — confirm before Story 9 is built)
- Self-mod gate scope for `prompts/` directory: open question (currently only `/server/src/`)

## Patterns Established
- **Commit style:** `type(scope): description` — types: `feat`, `fix`, `refactor`, `chore`, `docs`
- **Component directories:** one subdirectory per feature under `client/src/components/` with an `index.ts` re-export
- **Schema-first:** all DB changes land in one atomic commit before any feature work
- **Event sourcing:** all agent actions write append-only rows to `events` table; no UPDATE/DELETE
- **Self-mod gate:** `SELF_MOD_PATHS = ['/server/src/'] as const` in `agents/base.ts` — hard-coded, never in DB
- **Blocker flow:** `blocks_cycle=1` inbox messages → `BlockerModal` portal → cycle pauses until resolved
- **Budget gate:** >80% daily spend = warning banner; ≥100% = halt + blocking inbox message
- **Retry:** `MAX_RETRIES = 3` per phase, then escalate via `blocks_cycle=1` inbox
- **Token pricing:** claude-sonnet-4-6 at $3/MTok input, $15/MTok output
- **Proposed changes (MVP):** store full replacement content in `diff_content`, not a patch (simpler apply)
- **Deterministic avatar colour:** hash `project.id` via `(hash * 31 + charCode) >>> 0`, mod 8 → Tailwind bg class (violet-700…rose-700)
- **Slug derivation:** `name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')`. Server auto-suffixes on collision.
- **Avatar initials:** split on `/[\s\-_]+/` — `my-api → MA`

## Current Phase
Cycle 2 complete (no code committed). 16-commit implementation plan written. 7 plan-review failures (GH#1–GH#7 below) must be resolved before the developer begins Commit 1. Cycle 1 ProjectSwitcher issues (original GH#1–GH#7) also remain unresolved — no code has been committed for either cycle.

## Known Issues / TODOs
1. **[High] GH#7 (C2)** — Tool definitions not registered in `runClaude()` — entire structured tool use pipeline inert. Add `AGENT_TOOLS` to Commit 6 before implementation.
2. **[High] GH#4 (C2)** — Self-mod gate bypassed by freeform text fallback. Guard legacy save path in agent runners.
3. **[High] GH#3 (C2)** — `git-diff-view` ESM/Vite compatibility unconfirmed. Verify before Commit 11.
4. **[Med] GH#1 (C2)** — `human_input_requested`, `human_input_received`, `error` event types have no logging call site in plan. Add to Commit 3/6.
5. **[Med] GH#5 (C2)** — Spec lifecycle marker names (`RunStarted` etc.) don't match planned WS event taxonomy. Align before Commit 7.
6. **[Med] GH#6 (C2)** — `AgentCard` missing `last_action_at` / `current_task`. Extend `Agent` type in Commit 8.
7. **[Med] GH#2 (C2)** — Thought log silently empty if extended thinking beta header not set. Confirm in `claude.ts` before Commit 2.
8. **[Deferred]** Cycle 1 ProjectSwitcher issues (original GH#1–GH#7) — no code was committed; issues remain open.

## Cycle Log
- **Cycle 2 — 2026-03-28:** Full pipeline on Ouro Platform infrastructure. Specced 15 stories across 6 epics: event sourcing, artifact versioning + diff, safety gates (self-mod approval, token budget, blocking inbox), saga retry + crash recovery, UI transparency (progress bar, agent rail, diff viewer), and phase DAG parallelism. 16-commit build plan written. 7 plan-review issues raised (GH#1–GH#7). No code committed.
- **Cycle 1 — 2026-03-28:** Full pipeline on Demo Project (ProjectSwitcher feature). Research, spec, design, build plan, and test report produced. 7 plan-review issues raised. No code committed.
