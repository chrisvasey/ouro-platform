# Research Report

## Summary
The autonomous multi-agent software agency space matured rapidly in 2025–2026. At least a dozen direct analogues now exist (Devin, SWE-AF, MetaGPT, agency-agents, Open SWE, GitHub Squad, Blitzy, Factory AI) across commercial and OSS. Ouro's confirmed differentiators — absent from every surveyed competitor — are: (1) **self-referential improvement** (the agency builds itself), (2) **event-sourced append-only audit trail**, (3) **structured blocker/inbox escalation loop**, and (4) **budget gate at the orchestrator level**. Critically: Bun joined Anthropic in December 2025, making Ouro's exact stack (Bun + Claude + SSE) the officially blessed infrastructure for AI coding products. The immediate risk is that 4 cycles have produced zero committed code; moat erodes if Cycle 5 does not ship a running build.

---

## Competitors

| Name | Description | What we can learn |
|------|-------------|-------------------|
| [Devin 2.0](https://cognition.ai/blog/introducing-devin) (Cognition, $20/mo) | Closed-source autonomous software engineer. Cloud IDE, parallel agents, wiki knowledge base auto-updated by Devin. 67% PR merge rate after 18 months. | Users expect a live activity timeline and plan-edit UI. Parallel agent lanes are table stakes by mid-2025. |
| [MGX / MetaGPT](https://github.com/FoundationAgents/MetaGPT) (~55k ★) | OSS multi-agent framework simulating a full software company (PM → Architect → Engineer → QA). "Code = SOP(Team)" philosophy. AFlow (automated workflow gen) presented at ICLR 2025. | Role-specialisation + global message pool pattern maps directly onto Ouro's feed. SOP-driven agents reduce hallucination — worth adapting for Ouro prompts. |
| [CrewAI](https://crewai.com/) | Role-based multi-agent orchestration; Crews (agentic) + Flows (event-driven pipelines). AOP control plane launched late 2025. | Hierarchical manager-agent pattern is a clean model for Ouro's PM role. Flows pattern = explicit DAG execution, matches Ouro's Phase DAG design. |
| [AutoGen v0.4](https://github.com/microsoft/autogen) (Microsoft) | Async multi-agent conversations; AutoGen Studio (no-code UI). Bug-fix-only after 2025 — Microsoft moving to broader Agent Framework. | Studio-style visual builder is a good long-term UX goal. Async messaging model informs Ouro's WS event taxonomy. |
| [OpenHands](https://openhands.dev/) (MIT, ~2.1K contributors) | Leading OSS coding agent. Model-agnostic, runs on Claude/GPT. Issues in → PR out. 1yr old as of Nov 2025. | Community proof that a lean, model-agnostic coding agent can outperform proprietary systems on SWE-bench. |
| [SWE-agent](https://github.com/princeton-nlp/SWE-agent) (Princeton) | OSS, 12.29% SWE-bench accuracy, 93s/task. Lightweight agent + shell interaction harness. | Fast, minimal agent runner pattern useful for Ouro developer/tester agents. |
| [OpenAI Agents SDK](https://platform.openai.com/docs/agents) | Released March 2025. Minimal primitives: Agents, Handoffs, Sessions, Tracing. Deliberately "close to the metal." | Handoff pattern (specialized tool call to transfer control) is a cleaner model than Ouro's current inline role switching. Tracing API is a good UX precedent. |
| [GitHub Copilot Workspace](https://githubnext.com/projects/copilot-workspace) | Spec-driven coding: requirement → plan → tasks → PR. GitHub's Spec Kit open-sourced in 2025. | Spec-at-centre workflow validates Ouro's research→spec→build ordering. |
| [GitHub Squad](https://github.blog/ai-and-ml/github-copilot/how-squad-runs-coordinated-ai-agents-inside-your-repository/) | Copilot-powered multi-agent team (lead, frontend, backend, tester) inside a repo with independent review loop. | Parallel role specialisation within a single repo — confirms Ouro's agent rail + feed approach. |
| [SWE-AF](https://github.com/Agent-Field/SWE-AF) | Spins up full autonomous team (PM, architect, coders, reviewers, testers) from one API call. 95/100 benchmark score, outperforming Claude Code and Codex. | Best-in-class benchmark. The single-API-call entry point is clean UX; Ouro's project creation flow should match this simplicity. |
| [Blitzy](https://blitzy.com/) | Thousands of specialised agents, infinite context. | Multi-agent orchestration at scale — proof that deep role specialisation is commercially viable. |
| [Factory AI](https://factory.ai/) | Agent-native dev platform (Droids) with pipeline/role specialisation. | Role specialisation model; confirms Ouro's per-agent file pattern is industry-standard. |
| [Replit Agent](https://replit.com/) | 200-min autonomous runs, self-tests, self-deploys. | Self-verification loop pattern; confirms Ouro's tester agent role and in-loop test execution. |
| [Open SWE (LangChain)](https://blog.langchain.com/introducing-open-swe-an-open-source-asynchronous-coding-agent/) | Async cloud-hosted agent: Manager → Planner → Programmer/Reviewer chain. | Async chain model; the Manager role maps to Ouro's PM. Async message-passing reduces blocking. |
| [agency-agents](https://github.com/msitarzewski/agency-agents) | 8-role AI agency (Researcher, Backend Architect, UX Researcher, PM, etc.) producing unified product plans. | Confirms 8-role specialisation is viable; Ouro's 6-role set is reasonable. |

---

## OSS / Libraries

| Library | Purpose | Verdict (✅ use / ⚠️ maybe / ❌ avoid) |
|---------|---------|---------------------------------------|
| [@anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk) | Official Anthropic TypeScript SDK — streaming API calls, tool use, extended thinking. Supports Bun 1.0+. | ✅ Migrate `runClaude()` to this immediately; resolves GH#12 subprocess blocking. Streaming via `.stream()` + event listeners is the standard pattern. `ThinkingConfig: { type: "adaptive" }` (Opus 4.6+) or `{ type: "enabled", budgetTokens }` controls extended thinking — critical for GH#2 thought log. |
| [claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript) | Official Claude Agent SDK — tool execution, subagents, MCP, `include_partial_messages` SSE. V2 preview adds `createSession()` / `resumeSession()`, `stream()` method, built-in `AskUserQuestion` tool. Powering Claude Code. | ✅ Evaluate for Cycle 5+; `@anthropic-ai/sdk` is the right Cycle 5 dependency. Agent SDK V2 `resumeSession()` directly maps to Ouro's crash-recovery story. `settingSources: ['user','project']` required to load Skills from filesystem. |
| [Elysia](https://elysiajs.com/) (in use) | Bun-native HTTP + SSE + WS framework | ✅ Keep; SSE and WS are first-class |
| [bun:sqlite](https://bun.sh/docs/api/sqlite) (in use) | Zero-dependency SQLite for event sourcing | ✅ Keep; add WAL mode (`PRAGMA journal_mode=WAL`) before parallel phases land |
| [diff](https://www.npmjs.com/package/diff) | Pure-JS unified diff / patch generation | ✅ Use as fallback if `git-diff-view` fails Vite compat check (GH#3) |
| [CrewAI](https://crewai.com/) | Role-based orchestration, hierarchical manager, Flows for DAG execution | ⚠️ Useful as design reference; adopting it would duplicate Ouro's custom loop + SQLite |
| [LangGraph](https://github.com/langchain-ai/langgraph) | State machine / graph-based agent orchestration, cycles + supervision | ⚠️ Overkill for Ouro's current Phase DAG; revisit if DAG complexity grows significantly |
| [MetaGPT](https://github.com/FoundationAgents/MetaGPT) | Full software-company simulation, SOP-driven agents, global message pool | ⚠️ Direct architectural competitor; reference implementation only, not a dependency |
| [AutoGen](https://github.com/microsoft/autogen) | Async multi-agent conversation patterns, AutoGen Studio | ❌ Microsoft deprioritising new features; avoid as a dependency |
| [git-diff-view](https://github.com/MrWangJustToDo/git-diff-view) | React diff viewer component | ⚠️ ESM/Vite compat unconfirmed (GH#3); smoke-test before Commit 11 |

---

## UI Patterns

- **Live agent activity rail** — Devin and MGX both show a sidebar of agent steps in real time. Maps to Ouro's `AgentCard` + `last_action_at` / `current_task` fields (GH#6). Users orient around "which agent is active and what it last did."
- **Inline diff viewer with approve/reject** — Copilot Workspace and Devin show file diffs before applying. Ouro's `proposed_changes` diff viewer (Commit 11) should display a side-by-side or unified diff with single-click approve/reject.
- **Phase progress bar tied to DAG** — Phase-level progress (not just a spinner) is expected. Show current phase name + fraction of phases complete.
- **Blocking inbox / human-in-the-loop modal** — Devin surfaces blockers as UI interrupts. Ouro's `BlockerModal` pattern matches market expectations; ensure it pauses the cycle visually, not just in DB state.
- **Budget / cost visibility** — Token spend and daily budget shown persistently (not buried in settings). Warning banner at 80%, hard stop at 100% aligns with every surveyed tool.
- **Parallel agent swimlanes** — Devin 2.0 visualises concurrent agents. Ouro's parallel Phase DAG (spec ‖ design-draft) should eventually render as swimlanes; design the data model to support it now.
- **Intent preview / plan summary** — Show a reviewable plan *before* any irreversible action. Standard in Copilot Workspace and Devin; maps to Ouro's `proposed_changes` approval flow. ([Smashing Magazine](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/))
- **Thought log / transparency panel** — Visible reasoning trace alongside output (already planned via extended thinking, GH#2). Users grant more autonomy when they can see why an agent acted. ([agentic-design.ai](https://agentic-design.ai/patterns/ui-ux-patterns))
- **Task-oriented UI over chat-centric** — 2025 trend away from chatboxes toward outcome-focused controls (status tiles, approval queues, feed messages). Ouro's feed + inbox is already aligned; avoid adding a chat panel unless needed. ([Fuselab](https://fuselabcreative.com/ui-design-for-ai-agents/))
- **Control handoff indicator** — Clearly surface whether the loop is running (agent in control) or paused awaiting human input. A simple status chip (e.g., "Running · spec phase" vs "Waiting for you") eliminates ambiguity. ([Microsoft Design](https://microsoft.design/articles/ux-design-for-agents/))
- **Mission-control interface** — Multi-agent systems benefit from a monitoring-first layout (like a NOC) rather than a traditional settings dashboard. Anomaly-triggered human intervention is the primary interaction mode. ([Agentic Design Patterns](https://agentic-design.ai/patterns/ui-ux-patterns))
- **Autonomy override controls** — Per-task dial to increase/decrease agent authority. Cursor's autonomy slider is the canonical example. Map to Ouro's future "supervision level" preference per project. ([Cursor](https://cursor.com/))
- **Error recovery UX** — Undo/retry/rollback without a full loop restart. Surface the cause and what changed post-recovery. Ouro's `MAX_RETRIES` + blocker escalation covers this at the loop level; the UI should make retry/rollback status visible to users. ([Exalt Studio](https://exalt-studio.com/blog/designing-for-ai-agents-7-ux-patterns-that-drive-engagement))

---

## Dev Patterns

- **Event sourcing / append-only log** — All major frameworks record immutable event streams. Ouro's `events` table is correct; resist any UPDATE/DELETE paths.
- **Phase DAG as serialised state machine** — CrewAI Flows and LangGraph model pipelines as directed graphs with explicit state transitions. `cycles.phase_states` should store serialised DAG state, not just a phase name string.
- **Tool registration before agent invocation** — All frameworks register tools declaratively before the loop starts. GH#7 (missing `AGENT_TOOLS` in `runClaude()`) is a known failure mode; resolve immediately after GH#12 migration.
- **Structured output over freeform fallback** — MetaGPT's SOP agents and Devin's plan-edit UI both rely on typed outputs. Freeform text fallback (GH#4 self-mod bypass) is a critical footgun; enforce structured tool use everywhere.
- **Self-improvement gate** — No surveyed competitor exposes unrestricted self-modification. All gate it via human approval or sandboxed execution (NVIDIA OpenShell). Ouro's `SELF_MOD_PATHS` hard-coded in `base.ts` is the right pattern; close the freeform bypass (GH#4).
- **SDK-native streaming over subprocess** — Claude Agent SDK's `include_partial_messages` delivers SSE token-by-token without spawning a child process. This is the industry-standard pattern for Claude integrations and resolves GH#12.
- **SQLite WAL mode for concurrent writes** — When spec and design-draft run in parallel, both agents write to the same DB. Enable `PRAGMA journal_mode=WAL` to serialise writes safely under Bun's single-writer model.
- **MCP / A2A as emerging interoperability standards** — Anthropic's Model Context Protocol (broad 2025 adoption) standardises tool/API connections. Google's A2A defines cross-vendor agent handoff. Ouro should model its tool registration against MCP conventions now to ease future interoperability.
- **Bun as strategic AI runtime** — Anthropic acquired Bun (Dec 2025) and is building Claude Code + Agent SDK on it. Ouro's Bun + Elysia choice is now the canonical Anthropic stack — keep it and expect first-class SDK support.
- **Plan-and-Execute heterogeneous model pricing** — Use a frontier model (Sonnet) only for planning/orchestration; delegate execution steps to cheaper models or constrained prompts. Can cut token costs 90% at scale. Relevant when Ouro's cycle spend grows beyond $10/day budget.

---

## Risks

1. **GH#12 — subprocess blocking (Critical):** `claude.ts` spawning a subprocess blocks Stories 3, 9, 14. Migrating to `@anthropic-ai/sdk` eliminates the subprocess model. Risk if not fixed: entire streaming pipeline broken. Mitigation: make this Commit 1 of Cycle 5.
2. **GH#3 — `git-diff-view` ESM/Vite incompatibility:** ESM support with Vite is unconfirmed. Risk: Commit 11 ships but diff viewer is blank at runtime. Mitigation: run `vite build` smoke test in a branch before Commit 11; fallback is `diff` npm package with a custom renderer.
3. **GH#7 + GH#4 — tool definitions not registered / self-mod bypass:** `AGENT_TOOLS` missing from `runClaude()` means all structured tool use is silently ignored, falling back to freeform text — which bypasses the self-mod gate. Mitigation: add tool registration immediately after GH#12 migration.
4. **GH#2 — extended thinking not configured:** When migrating to `@anthropic-ai/sdk`, use `ThinkingConfig: { type: "enabled", budgetTokens: N }` (or `"adaptive"` on Opus 4.6+) — the old beta header approach is replaced by SDK-native config. Risk: thought log silently empty if config is omitted. Mitigation: set `ThinkingConfig` in migrated `claude.ts`; add startup assertion + warn if no thinking events are received in first agent turn.
5. **Competitor velocity:** Devin 2.0 ($20/mo, 4× faster YoY), OpenHands (2.1K contributors, model-agnostic), and OpenAI Agents SDK (launched March 2025) are all moving fast. Ouro's moat is self-referential improvement and full source access. Risk: moat erodes if cycles produce no committed code. Mitigation: commit a running build in Cycle 5 before adding features.
6. **SQLite write contention under parallel phases:** `bun:sqlite` is single-writer. Parallel spec + design-draft agents risk write serialisation errors. Mitigation: enable WAL mode + serialise writes through a single async queue.

---

## Recommendations

1. **Migrate `claude.ts` to `@anthropic-ai/sdk` (Cycle 5, Commit 1)** — resolves GH#12, unblocks Stories 3/9/14, enables SDK-native SSE streaming. All other Cycle 5 work is blocked on this.
2. **Register `AGENT_TOOLS` in `runClaude()` immediately after migration (Commit 2)** — resolves GH#7 and closes the GH#4 freeform bypass; without this the entire structured-output and self-mod pipeline is inert.
3. **Smoke-test `git-diff-view` with Vite before Commit 11** — 30-minute check. If incompatible, use `diff` npm package with a custom unified-diff renderer.
4. **Enable SQLite WAL mode in `db.ts`** — one-line change (`PRAGMA journal_mode=WAL`), eliminates write-contention risk before parallel phases land.
5. **Add `last_action_at` / `current_task` to `Agent` type (GH#6, Commit 8)** — live agent rail is the highest-impact UI differentiator based on competitor analysis.
6. **Serialise Phase DAG state into `cycles.phase_states`** — enables crash recovery, progress bar, and future parallel swimlane UI without schema changes.
7. **Verify extended thinking header in migrated `claude.ts` (GH#2)** — add a startup assertion so it fails loudly rather than silently.
