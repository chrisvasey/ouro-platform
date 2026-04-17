# Research Report

## Summary

The AI autonomous software development space is maturing rapidly in 2025–2026, with Devin, OpenHands, and MetaGPT as the dominant players. Ouro's core differentiators — a multi-role specialised agent loop, event-sourced persistence, and a self-modification gate — have no direct open-source equivalent. The closest architectural analogue is MetaGPT (role-modelled company), but Ouro's self-improvement loop and blocking HITL inbox pattern are genuinely novel. Three pre-existing plan-review failures (GH#7, GH#4, GH#3) are the highest-priority risks before any implementation begins.

---

## Competitors

| Name | Description | What we can learn |
|------|-------------|-------------------|
| [Devin (Cognition)](https://cognition.ai/blog/introducing-devin) | Proprietary autonomous dev agent, end-to-end task execution, ~14% SWE-bench. $20/month. | Pre-execution transparency, evidence-before-approval UX; avoid their closed-platform trap |
| [OpenHands](https://www.openhands.dev/) (formerly OpenDevin) | Leading OSS AI dev agent, generalist, CLI + browser capable, ~40k GitHub stars | Single-agent generalism is their ceiling; Ouro's multi-role specialisation is a structural advantage |
| [MetaGPT](https://github.com/geekan/MetaGPT) | Multi-agent system explicitly modelling a software company (PM, architect, engineer). Most structurally similar to Ouro's role loop. | Role decomposition patterns, agent handoff contracts |
| [SWE-agent (Princeton)](https://github.com/princeton-nlp/SWE-agent) | Specialist debug/PR-resolution agent, high benchmark scores on narrow tasks | Reference architecture for the developer-agent role's tool-use design |
| [Hermes Agent](https://www.ai.cc/blogs/hermes-agent-2026-self-improving-open-source-ai-agent-vs-openclaw-guide/) | OSS, genuine learning loop with skill accumulation across sessions | Most direct self-improvement analogue; study memory/skill persistence architecture |
| [Compound Product](https://addyosmani.com/blog/self-improving-agents/) | OSS, runs separate Analysis/Planning/Execution loops, sets its own priorities | Closest architectural match to Ouro's phase DAG and self-improvement loop |
| [CrewAI](https://crewai.com/) | Role-based agent orchestration, sequential/hierarchical flows, built-in loop-back on test failure. ~30k stars | Pattern reference for role-to-role handoffs; loop-back on failure matches Ouro's retry model |

---

## OSS / Libraries

| Library | Purpose | Verdict (✅ use / ⚠️ maybe / ❌ avoid) |
|---------|---------|---------------------------------------|
| [LangGraph](https://github.com/langchain-ai/langgraph) | Graph-based stateful agent orchestration, `interrupt()` for HITL pauses, v1.0 stable | ✅ Study `interrupt()` for blocker/pause flow; phase DAG pattern maps directly |
| [OpenAI Agents SDK (TS)](https://openai.github.io/openai-agents-js/) | Lightweight orchestration, handoffs, tool use, native TS, ~100 LLM providers | ✅ Study handoff + tool registration patterns; don't adopt (Anthropic-native stack) |
| [Mastra](https://mastra.ai/) | TypeScript-native agent framework, graph workflows, memory, MCP supervisor pattern. 22k+ stars, $13M seed. `bunx` support. | ⚠️ Reference architecture for multi-agent supervisor + memory patterns; don't adopt wholesale given Elysia investment |
| [VoltAgent](https://voltagent.dev/) | Lightweight TS multi-agent chain API, modern stack | ⚠️ Monitor; could replace bespoke `loop.ts` if complexity grows significantly |
| [Google ADK (TypeScript)](https://developers.googleblog.com/introducing-agent-development-kit-for-typescript-build-ai-agents-with-the-power-of-a-code-first-approach/) | Sequential/Parallel/Loop agent workflows, model-agnostic | ⚠️ Good pattern reference for phase DAG parallelism implementation |
| [AutoGen (Microsoft)](https://github.com/microsoft/autogen) | Conversational multi-agent, flexible HITL | ⚠️ Less relevant — Ouro uses structured phases, not free-form conversation |
| [react-diff-viewer-continued](https://www.npmjs.com/package/react-diff-viewer-continued) | Actively maintained fork of react-diff-viewer; inline/split diff | ✅ Safe fallback if `git-diff-view` ESM/Vite compat fails (GH#3) |
| [git-diff-view](https://github.com/MrWangJustToDo/git-diff-view) | Feature-rich diff viewer, already in build plan | ⚠️ Vite ESM compatibility unverified — must confirm before Commit 11 (GH#3) |

---

## UI Patterns

- **Agent rail with status cards** — One card per active agent role showing: current status, current task, last action timestamp, cost accrued. Colour-coded status chips (idle / running / blocked / done) reduce cognitive load. Industry standard per 2026 dashboard comparison surveys.
- **Append-only event feed** — Reverse-chronological, filterable by agent role and event type. Group related events under collapsible phase headings ("Build phase — 14 events"). Ouro's `agent_event / phase_meta / blocker / snapshot` taxonomy aligns with the emerging AG-UI and A2A `tasks/sendSubscribe` standard.
- **HITL approval gates as modals, not inline** — Keep the feed scrollable while the gate is open. Show the agent's planned next action *before* execution — pre-execution transparency is a key trust signal per Shape of AI research.
- **Evidence-pack before approval** — HITL flows that show only "approve/deny" fail in practice. Users need full context: what changed, why, what happens next. Ouro's `BlockerModal` + diff viewer (`diff_content` as the evidence pack) directly matches best practice.
- **Diff viewer for proposed changes** — Inline split-diff or unified-diff with approve/reject per file. Prominent cost estimate adjacent to each proposed change.
- **Visual agent identity** — Distinct iconography/colour per agent role so users can scan the feed without reading text. Ouro's deterministic avatar colour (hash mod 8 → Tailwind class) satisfies this.
- **Adaptive layout** — Collapse agent rail on small screens, expand on wide displays.
- **Consent + audit trail** — Every agent action logged with who/what triggered it. OpenTelemetry semantic conventions recommended for consistent queryable telemetry fields.

---

## Dev Patterns

- **Event sourcing (append-only events table)** — Validated as correct for agent systems by multiple 2025–2026 references (Zylos, Fastio). Immutable event log is the backbone for auditability and replay. Ouro's planned `events` table is the right call.
- **Phase DAG parallelism** — `research → (spec ‖ design-draft) → design-final → build → test → review` matches the Sequential/Parallel/Loop workflow pattern in Google ADK and LangGraph. Use LangGraph's `interrupt()` as a reference implementation for the pause/resume mechanism.
- **Propose-Approve-Execute** — Canonical pattern across OpenAI SDK, Microsoft Agent Framework, Temporal, AWS Bedrock. Ouro's proposed-change flow matches. Store full replacement content (not patch) as decided — correct for MVP simplicity.
- **Self-mod gating** (`SELF_MOD_PATHS`) — No direct open-source analogue found. This is novel and a genuine differentiator. Must remain hard-coded in `base.ts`, not in DB, to prevent agents from widening their own gate.
- **Persistent skill/context files across sessions** — Used by Hermes, Compound Product for the self-improvement loop. Relevant for the documenter/reviewer agents writing back to project memory. Map this to Ouro's artifacts table + cycle log.
- **Decoupled loop from HTTP layer** — None of the major TS agent frameworks (Mastra, VoltAgent, ADK) explicitly support Elysia. Keep `loop.ts` clean of HTTP concerns so a framework adapter is possible later without a full rewrite.
- **Structured tool registration** — Every competitor and framework ships agents with registered tool definitions. Ouro's `AGENT_TOOLS` must be wired into `runClaude()` before any agent runs (GH#7 is a correctness blocker, not a feature gap).

---

## Risks

1. **GH#7 — Tool definitions not registered in `runClaude()`** → The entire structured tool-use pipeline is inert. No competitor ships agents without registered tool definitions. Mitigation: register `AGENT_TOOLS` before Commit 6; this is pre-implementation, not mid-sprint.
2. **GH#4 — Self-mod gate bypassed by freeform text fallback** → Agents can write to `SELF_MOD_PATHS` without approval via the legacy save path. Safety-critical. Mitigation: guard the legacy path before enabling any agent write-back; audit all save entrypoints.
3. **GH#3 — `git-diff-view` ESM/Vite compat unverified** → Discovering incompatibility mid-Commit 11 would block the diff viewer epic. Mitigation: run a standalone Vite + git-diff-view smoke test now; fall back to `react-diff-viewer-continued` if needed.
4. **Elysia framework isolation** → No major TS agent framework explicitly supports Elysia. If framework adoption becomes desirable, an adapter layer is required. Mitigation: keep `loop.ts` decoupled from the HTTP layer from day one.
5. **Self-improvement loop correctness** → No open-source system has a fully validated self-mod gate. Agents may write plausible-looking but incorrect self-modifications. Mitigation: mandatory human approval for all `SELF_MOD_PATHS` writes; test suite must cover self-mod gate bypass attempts.
6. **Token budget pricing drift** → Pricing assumptions ($3/$15 per MTok for claude-sonnet-4-6) must be validated against Anthropic's live API. Models and prices change. Mitigation: pull live pricing or make pricing configurable via `preferences` table before the budget gate goes live.
7. **Extended thinking beta header** (GH#2) → Thought log silently empty if header not set in `claude.ts`. Low visibility failure — no error, just missing data. Mitigation: confirm header in `claude.ts` before Commit 2; add a startup assertion.

---

## Recommendations

1. **Fix GH#7 before any agent run** — Register `AGENT_TOOLS` in `runClaude()`. This is a correctness blocker; all structured tool use is broken without it.
2. **Verify or swap `git-diff-view` now** — Run a Vite ESM smoke test. If it fails, switch to `react-diff-viewer-continued` before the build plan is locked. Discovering this in Commit 11 is preventable.
3. **Guard self-mod gate (GH#4) before enabling write-back** — Audit all agent save paths; any path that can write to `SELF_MOD_PATHS` without going through the approval gate is a safety hole.
4. **Study LangGraph's `interrupt()` pattern** for the blocker/pause flow — most battle-tested HITL pause mechanism available; apply its semantics to `loop.ts` without adopting the full library.
5. **Study Mastra's supervisor + memory patterns** — their multi-agent orchestration solves agent handoff and cross-session memory in TypeScript; solutions can be adopted piecemeal without replacing the Elysia stack.
6. **Confirm extended thinking header (GH#2)** — Add a startup assertion in `claude.ts`; silent empty thought logs are harder to debug than an explicit startup failure.
7. **Make token pricing configurable** — Store pricing constants in the `preferences` table rather than hard-coding, so price changes don't require a code deploy.
