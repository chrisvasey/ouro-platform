# Research Report

*Prepared by: Researcher agent | Date: 2026-03-29 | Cycle 10*

> **Scope note:** Cycle 9 findings remain valid in full. Cycle 10 search pass (five queries: multi-agent AI software development framework 2025 OSS, self-improving autonomous coding agent loop architecture, AI software agency competitors Devin SWE-agent AutoCodeRover comparison, multi-role agent orchestration patterns LLM tool use structured output, agent-based software development UI patterns transparency observability) confirmed all prior recommendations. No new competitors or architectural reversals identified. One library recommendation reinforced: `react-diff-view` (confirmed ESM/Vite compatible via `/esm` subpath, v3.1.0+) remains the correct choice over `@git-diff-view/react` (pre-1.0, ESM compat unverified for Vite). No architectural reversals.

---

## Summary

The multi-agent AI software development landscape is now well-validated commercially: MetaGPT launched MGX as a commercial product (Feb 2026), OpenHands raised $18.8M, and CrewAI reports 1.4B+ automations at enterprise scale. Factory.ai and Google's "Antigravity" pipeline independently confirm the PM → Engineer → QA → DevOps multi-role loop as the production-validated approach. None of these systems implement sanctioned self-modification — Ouro's unique moat. SICA (ICLR 2025) is the strongest academic precedent for Ouro's self-mod loop. Overstory (Bun/TS + SQLite + multi-agent) is the closest OSS structural analog in the same stack and should be monitored closely. The architecture patterns Ouro has chosen (event sourcing, phase DAG with human-in-the-loop, append-only event log, blocker modal) are consistently confirmed across multiple independent sources as the correct patterns for observable multi-agent systems. The most critical unresolved blocker remains the `claude.ts` CLI subprocess, which makes Stories 3, 9, and 14 architecturally impossible in their current form.

---

## Competitors

| Name | Description | What we can learn |
|------|-------------|-------------------|
| **SICA** (Self-Improving Coding Agent, ICLR 2025) | Agent edits its own codebase to self-improve. First peer-reviewed implementation of a sanctioned self-mod loop. ([openreview.net](https://openreview.net/pdf?id=rShJCyLsOr)) | Strongest academic precedent for Ouro's self-modification story. Cite in documentation. No approval gate — Ouro's human-in-the-loop gate is a genuine differentiator. |
| **Agyn** (arxiv 2602.01465) | Academic: manager/researcher/engineer/reviewer agents backed by GPT-5 variants. Role-based SOP. | Confirms the four-role SOP structure. Python + GPT-5 only — no Bun/TS path. Research reference only. |
| **Overstory** | Bun/TS multi-agent orchestrator, SQLite mailbox, 11 pluggable runtime adapters. Closest OSS analog in the same stack. ([github.com/jayminwest/overstory](https://github.com/jayminwest/overstory)) | Monitor actively — nearly identical stack. Ouro's differentiator: self-improvement loop + event sourcing + web UI + self-mod gate. Study SQLite mailbox and runtime adapter patterns. |
| **ComposioHQ/agent-orchestrator** | Parallel coding agents running in isolated git worktrees; agent-agnostic; CI auto-fix loop. ([github.com/ComposioHQ/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator)) | Git worktree isolation is the right pattern for safely running parallel build agents. Reference for Commit 16 parallel phase implementation. |
| **AgentScope** | MCP/A2A support, Kubernetes-ready, OpenTelemetry tracing. Python-only. ([github.com/agentscope-ai/agentscope](https://github.com/agentscope-ai/agentscope)) | Production-grade observability (OTel) confirms that structured tracing matters at scale. Not usable in Bun/TS — reference for Cycle N+1 observability story. |
| **Factory.ai** | Enterprise "Agent-Native Development" with Droids across the SDLC (MongoDB, Zapier customers). ~19% SWE-bench. | Closest commercial analog to Ouro's multi-role pipeline. Validates the enterprise go-to-market angle post-MVP. |
| **Google Antigravity** | Google Codelabs autonomous dev pipeline: PM → Engineer → QA → DevOps via `/startcycle`. OSS demo project. | Structure is nearly identical to Ouro's cycle DAG. Confirms Ouro is on the right track architecturally; not a competitive threat. |
| **agent-loop (OSS)** | Framework/guide for Architect → Builder → Tester orchestration. Small GitHub project (conceptually identical to Ouro). | Confirms the role-based pipeline pattern, but no event sourcing, no self-mod gate, no UI. |
| **Ouroboros** ([github.com/razzant/ouroboros](https://github.com/razzant/ouroboros), Feb 2026) | Self-modifying agent that rewrites its own code via Git commits; requires multi-model review before merging. Direct conceptual overlap with Ouro. | Closest OSS analog to Ouro's self-mod loop. Key difference: Ouro adds a human-approval gate and restricts modification to `SELF_MOD_PATHS` — more conservative by design. Monitor actively. |
| **AWS Kiro** | Agentic IDE with spec-driven development mode. Converts specs into tasks/checklists that coding agents execute. | Validates Ouro's PM → spec → build phase order. Spec-as-primary-artefact approach is the same pattern. Not a direct competitor (IDE tool, not a pipeline runtime). |
| **GitHub Spec Kit** (2025) | Spec-at-centre workflow: spec document drives auto-generated task checklists for coding agents. | Directly validates Ouro's PM → spec → task decomposition flow. Potential integration point post-MVP: export Ouro specs in Spec Kit format. |
| **MetaGPT / MGX** | ~62K stars (GitHub). PM → Architect → Engineer → QA pipeline. SOP-driven structured handoffs. MGX launched as commercial product Feb 2026. AFlow (ICLR '25 top 1.8%) automates workflow generation. | Structured inter-agent communication (typed artifacts, not freeform chat) is the single biggest reliability lever. Directly supports fixing GH#7. Market-validates multi-role agent pipelines commercially. |
| **ChatDev** | Virtual software company pipeline. Chat-chain topology evolved into DAG-based multi-agent networks (MacNet). Research-focused. | Dialogue-based comms between agents accumulate drift. Structured handoffs consistently outperform. Confirms Ouro's tool-use approach. |
| **OpenHands** | 68.6K+ stars, MIT. 77.6% SWE-bench Verified. Raised $18.8M. V1 architecture: optional sandboxing, SDK-first. Key documented weakness: zero project memory per session. | Ouro's `events` table + artifact versioning is the direct answer to OpenHands' biggest documented weakness. Prioritise making persistent cross-cycle memory visible in the UI. |
| **Devin 2.0** (Cognition) | Fully autonomous, multi-agent dispatch, 67% PR merge rate. Opaque — no feed transparency. | Ouro's transparency story (feed, agent rail, thought log) is a real differentiator. Devin users consistently cite opacity as a frustration. |
| **GitHub Copilot Workspace** | GA May 2025. 56% SWE-bench. MCP support. Human approval before CI. | "Assign GitHub issue → agent resolves with human approval before merge" is the Cycle 4+ target UX. |
| **CrewAI** | 44K+ stars, Python. 1.4B+ automations. Role-based, well-documented SOP patterns. | Vocabulary and task DAG concept are worth adopting. Library itself is Python-only — not usable. |
| **GPT Engineer** | Spec → working project. Single-agent, no role differentiation. | Shows the ceiling for single-agent approaches. Ouro's multi-role differentiation is the right direction. |
| **SWE-Agent** | Research-grade, GitHub issue fixing. Strong SWE-bench but not a product pipeline. | SWE-bench is becoming the benchmark credibility standard — Ouro has no external eval yet. |
| **Aider / Cline** | CLI/VSCode agents, git-integrated, model-agnostic. Popular for loop use. | Adjacent tools, not direct competitors. Low relevance to Ouro's agency model. |
| **LangGraph** | GA May 2025. ~400 production companies (LinkedIn, Uber). Stateful graph execution, human-in-the-loop, parallel branches. Python only. | Confirms stateful phase DAGs + human-in-the-loop are the production-validated pattern. Ouro's `phase_states` + `waitForBlockerResolution()` is the same pattern in SQLite. |
| **EvoAgentX** | EMNLP '25. Automated workflow evolution — generates, optimises, ranks agent workflow variants. | Closest academic analog to Ouro's self-improvement loop. Too early for production. Informs Cycle N+1 self-mod stories. |

---

## OSS / Libraries

| Library | Purpose | Verdict |
|---------|---------|---------|
| **`@anthropic-ai/sdk`** | Official Anthropic Messages API. Tools, thinking, usage fields. Pure JS/TS, Bun-compatible. | ✅ **Install as Commit 0** — `bun add @anthropic-ai/sdk` in `server/`. Replaces `Bun.spawn(["claude", "--print", ...])`. Required for GH#7, GH#2, Stories 3/9/14. |
| **`diff`** (kpdecker/jsdiff v8.x) | Line/char diffing. `createPatch()`, `applyPatch()`. Types bundled in v8. ~2M weekly downloads. | ✅ Use — `bun add diff` in server. Resolves build.md Open Questions #1 and #2. Do not install `@types/diff` (types bundled). |
| **`react-diff-view`** | GitHub-style diff component for React. ESM via `/esm` subpath from v3.1.0+. ~40K weekly downloads. | ✅ Use — import from `react-diff-view/esm`. Resolves GH#3 (C2). Prefer over `git-diff-view`. |
| **`git-diff-view`** | GitHub-style diff viewer. ESM compat unverified for Vite. | ⚠️ Downgrade to maybe — switch to `react-diff-view` which has confirmed ESM support. |
| **`react-markdown` + `rehype-highlight`** | Markdown rendering with syntax highlighting. | ✅ Use — unchanged. Standard, well-maintained. |
| **`@mastra/core`** (v1.4.0, Apache 2.0, 22.3K stars) | TypeScript agent framework. Layered memory, workflow suspend/resume, Mastra Studio. | ⚠️ Study patterns only — Bun support is broken (monorepo + Turbo version conflicts). Use as architectural reference for memory model and human-in-the-loop suspend/resume. |
| **VoltAgent** (TypeScript, MIT) | TypeScript multi-agent framework. Zod-typed workflow steps, chain API, observability console. | ✅ Study patterns — most Bun-compatible TypeScript agent framework. Zod-typed step contracts are the right model for Ouro's phase runner. Not needed for MVP. |
| **BullMQ** | Redis-backed job queues. Bun+ioredis works, but requires Redis instance. | ⚠️ Phase 2 only — adds Redis operational overhead not justified for MVP. Use `Promise.all()` in `loop.ts` for Commit 16. |
| **Temporal TypeScript SDK** | Durable workflow execution. Worker runtime requires Node.js (Node-API native). | ❌ Avoid — Worker incompatible with Bun. Implement saga/retry manually. |
| **LangGraph (JS)** | DAG orchestration, conditional retry loops. | ⚠️ Overkill — Ouro's custom `loop.ts` is sufficient. Study patterns, don't adopt. |
| **Drizzle ORM** | Type-safe SQLite with migrations. | ⚠️ Worth adding if schema grows — not needed for current MVP scope. |
| **AutoGen / Semantic Kernel** | .NET/Python focus. No TypeScript/Bun runtime. | ❌ Avoid — no update. |
| **`elysia-mcp`** | MCP server adapter for Elysia/Bun — exposes Ouro agent tools as MCP endpoints addressable from Claude Code, Cursor, Windsurf. | ⚠️ Post-MVP — not needed for Cycle 2. Valuable ecosystem play for Cycle N+1: Ouro agents become callable tools in any MCP-aware IDE. |

---

## UI Patterns

- **Mission-control dashboard** — dominant pattern for multi-agent systems: real-time status per agent, intervention controls, exception alerts. Confirmed across MetaGPT UI, CrewAI dashboards, AG-UI protocol spec. Maps to Ouro's agent rail + `AgentCard` component.
- **Event-stream / real-time feed over SSE** — expected delivery mechanism for agent orchestration UIs. AG-UI protocol formalises this. Ouro's existing SSE feed is correct; ensure `snapshot` event fires on subscribe for reconnect.
- **Progressive disclosure of thought** — "Reasoning Steps" panels let power users inspect without overwhelming casual users. Collapsed by default, expandable. Critical: Claude Sonnet 4.6 returns *summarized* thinking blocks, not raw internal monologue. Label as "Claude's Reasoning" with tooltip clarification.
- **Blocker modal with focus trap** — portal overlay, `blocks_cycle=1` pause, `Escape` must NOT dismiss. Confirmed as correct behaviour. Always-available controls to pause/redirect/approve high-stakes actions.
- **Cycle progress tracker** — horizontal step bar with `pending / active / complete / failed / retrying` states. When Commit 16 parallel phases land, two steps can be `active` simultaneously — render both with pulsing animation from day one.
- **Artifact diff viewer** — `react-diff-view` renders unified diff string from `diff.createPatch()`. Tab order: rendered view default, diff toggle secondary. Cycle selector as primary navigation axis.
- **Budget warning colour ramp** — `<50% → text-gray-400`, `50–79% → text-amber-400`, `80–99% → text-orange-500 font-medium`, `≥100% → text-red-500 font-bold`. Prevents users noticing spend only at the hard-stop.
- **Sticky agent status rail** — one card per agent, status badge + pulsing animation + last action timestamp + current task. Extend `Agent` type with `last_phase_token_count` (GH#6 fix).
- **Transparency moments** — explicit spots where the agent shows reasoning, previews outcomes, or requests confirmation before irreversible actions. Human-in-the-loop override always available.
- **VS Code Multi-Agent Sessions view (Feb 2026)** — single panel lists all local/background/cloud agent sessions; expanding any session shows full prompt + result tree. Reference pattern for Ouro's agent rail: each `AgentCard` should be expandable to reveal the full prompt sent and raw response received, not just the parsed output.

---

## Dev Patterns

- **Commit 0 — SDK migration (gating prerequisite):** Replace `Bun.spawn(["claude", "--print", ...])` with `@anthropic-ai/sdk` `anthropic.messages.create()`. New `ClaudeRunResult` must expose `inputTokens`, `outputTokens`, `costUsd`, `thinkingBlocks`, `toolUses`. Without this, GH#7, GH#2, Stories 3/9/14 are impossible.

  ```typescript
  interface ClaudeRunResult {
    content: string;
    real: boolean;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    thinkingBlocks: Array<{ thinking: string; signature: string }>;
    toolUses: Array<{ id: string; name: string; input: unknown }>;
  }
  ```

- **Extended thinking (resolves GH#2):** Use `thinking: { type: 'adaptive', effort: 'high' }`. No beta header needed for basic extended thinking on Claude 4.6. `budget_tokens` is deprecated. `betas: ['interleaved-thinking-2025-05-14']` enables thinking *between* tool calls — not needed for Ouro's current single-turn-per-phase architecture. Preserve `signature` field verbatim if multi-turn calls are added.

- **Tool use + thinking constraint:** Only `tool_choice: { type: 'auto' }` or `none` are valid when extended thinking is enabled. `dispatchToolUse()` must handle the case where the model returns text instead of a tool call. Design for graceful fallback.

- **Structured agent outputs (resolves root of GH#7):** MetaGPT's key finding: freeform text between agents compounds errors cycle over cycle. Ouro's tool-use pipeline is the right fix. Register `AGENT_TOOLS` (`save_artifact`, `post_feed_message`, `request_human_input`) with Anthropic `InputSchema` format before Commit 6.

- **Planner-Worker-Judge pattern** — Planner reads full codebase + spawns tasks; Workers implement; Judge assesses completion and feeds back. Cursor used this to produce 1M+ lines across 1K+ files. Directly maps to Ouro's PM → Developer → Tester roles. Confirms the role decomposition is correct.

- **Orchestrator + specialist pattern** — one control-plane loop routes to domain agents. Confirmed as the production-validated pattern (LangGraph, CrewAI). Matches Ouro's existing `loop.ts` design.

- **Event sourcing (append-only events table)** — industry standard for agent audit trails. MetaGPT uses similar artifact versioning. No UPDATE/DELETE = full replay. Include `GET /api/projects/:id/events?after=N` for crash recovery (offset-based replay pattern, per AgentLog).

- **Phase DAG with conditional retry** — LangGraph pattern: each phase node has pass/fail edge; failure routes back with feedback rather than terminating. Ouro's `MAX_RETRIES=3` matches. WAL mode already correct for SQLite write concurrency.

- **Per-agent mutex** — already implemented (`c559097`). Best practice for sequential phase execution with parallel sub-phases.

- **Self-modification gate** — novel to Ouro; no direct prior art in OSS frameworks. Closest analogue: AutoGen's human-in-the-loop confirmation before destructive actions. Hard-code `SELF_MOD_PATHS = ['/server/src/']` in `agents/base.ts`, never in DB. OpenAI's Self-Evolving Agents Cookbook (2025) describes a repeatable loop: capture issues → learn from feedback → promote improvements → replace baseline agent — the same concept, but Ouro adds a sanctioned human approval gate that their cookbook lacks.

- **~15× token consumption warning** — multi-agent systems consume approximately 15× tokens compared to single-agent chat (confirmed across CrewAI production data and Anthropic research). Budget gate at 80%/100% is correctly positioned. Log per-phase token spend in `events` table from day one for post-hoc analysis.

- **Memory layering** — short-term (context window) + long-term (DB/artifact versioning) + entity memory. Ouro's `events` + `artifacts` tables serve this role. The persistent cross-cycle memory is Ouro's strongest competitive differentiator vs. OpenHands.

- **IntentGate pattern (already implemented):** `extractIntent()` and `reply_intent_json` column are live. Extend to blocker resolution: when a user replies to a budget blocker, extract `{ action: 'approve' | 'adjust_budget' | 'stop_cycle', newBudget?: number }`.

- **`Promise.all()` for Commit 16 parallelism** — BullMQ requires Redis; Temporal Worker requires Node.js. Both eliminated. Native `Promise.all()` with phase DAG in `loop.ts` is sufficient (~30 lines, zero dependencies).

---

## Risks

1. **[CRITICAL] `claude.ts` CLI subprocess incompatible with Cycle 2 features** — `Bun.spawn(["claude", "--print", ...])` cannot pass `tools`, return `usage.input_tokens`, or receive `thinking_blocks`. This is why GH#7, GH#2, and Story 9 are architecturally blocked. Commit 0 SDK migration is mandatory before any other Cycle 2 work.

2. **[High] GH#7 — Tool definitions not registered in `runClaude()`** — Entire structured tool use pipeline inert. Tool call events will be empty until fixed. Confirm tool schema matches Anthropic `InputSchema` format before Commit 6.

3. **[High] GH#4 — Self-mod gate bypassed by freeform text fallback** — If an agent returns freeform text with a path under `/server/src/`, legacy `saveArtifact()` writes directly without gate interception. Guard the legacy path in `dispatchToolUse()`: check every `save_artifact` path regardless of whether it arrived via tool use or freeform parse.

4. **[High] GH#3 — `git-diff-view` ESM/Vite compat unconfirmed** — Resolved by switching to `react-diff-view`. Import from `react-diff-view/esm`. No Vite config changes needed.

5. **Tool use + extended thinking incompatibility** — Cannot force a specific tool when extended thinking is enabled. `dispatchToolUse()` must handle model returning text instead of tool call. Test both paths.

6. **MetaGPT/MGX and OpenHands well-funded and moving fast** — MGX launched commercially Feb 2026; OpenHands raised $18.8M. Ouro's defensible moat is self-modification (agents improve their own prompts/code) — none of these systems implement this. Prioritise making the self-mod approval flow demonstrable.

7. **No external eval / SWE-bench score** — SWE-bench is becoming the credibility standard. Ouro has no external eval. Not blocking MVP but worth planning for Cycle N+1.

8. **Compound error rate at scale** — A 20% per-step failure rate compounds to ~63% total failure over a 100-step task (1 − 0.8^100). Ouro's cycles are short (6 phases), giving ~26% compound failure at 20% per-phase — acceptable, but keep cycles short, fail fast, and surface MAX_RETRIES exhaustion visibly in the UI.

9. **Context window bloat in long cycles** — Multi-phase loops accumulate tokens fast (~15× vs single-agent chat). Lean briefs (partially addressed in `3fd21fa`), trim feed messages aggressively. Budget check fires before each phase — a single expensive phase can overshoot budget by 1× phase cost (by design, but document clearly in UI).

10. **SQLite write contention under parallel phases** — WAL mode handles concurrent reads, serialises writes. Fine for MVP (single-project). Batch writes where possible; test once `research ‖ spec` parallel phases land.

11. **Recursive self-improvement safety** — Hard gate on `/server/src/` writes, human approval required, `proposed_changes` table with `PENDING` status. Must ship in Commit 6 before further self-improvement cycles are enabled.

---

## Recommendations

1. **Install `@anthropic-ai/sdk` and rewrite `claude.ts` — this is Commit 0** — `bun add @anthropic-ai/sdk` in `server/`. New `ClaudeRunResult` exposes `inputTokens`, `outputTokens`, `costUsd`, `thinkingBlocks`, `toolUses`. Unblocks GH#7, GH#2, Stories 3/9/14 simultaneously.

2. **Replace `git-diff-view` with `react-diff-view`** — `bun add react-diff-view` in client. Import from `react-diff-view/esm`. Directly resolves GH#3 with no further investigation.

3. **Add `diff` package to server** — `bun add diff` in server. `diff.createPatch()` for `computeUnifiedDiff()`, `diff.applyPatch()` for Commit 6 approval path. Resolves build.md Open Questions #1 and #2.

4. **Add thinking support to SDK-based `claude.ts`** — In `anthropic.messages.create()`, include `thinking: { type: 'adaptive', effort: 'high' }`. Do not add `interleaved-thinking` beta header. Extract `content.filter(b => b.type === 'thinking')`. Resolves GH#2.

5. **Register `AGENT_TOOLS` in `runClaude()` before Commit 6** — Define `save_artifact`, `post_feed_message`, `request_human_input` with Anthropic `InputSchema` format. This is GH#7 — the most critical structural blocker.

6. **Guard legacy `saveArtifact()` path in all agent runners** — In every `agents/*.ts` file, any direct call to `db.saveArtifact()` or file-write targeting `/server/src/` must be intercepted by `checkSelfModGate()`. Add explicit path check before every file write (GH#4).

7. **Extend `IntentGate` to blocker resolution** — Call `extractIntent()` on inbox replies to budget and phase-escalation blockers. Return `{ action: 'approve' | 'adjust_budget' | 'stop_cycle' | 'retry', ... }`. Wire into `waitForBlockerResolution()`.

8. **Land Commit 0 then Commit 1 (schema) immediately** — `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS` statements are non-breaking and can deploy independently. Unblock the rest of the plan by landing these first.

9. **Use `Promise.all()` for Commit 16 parallelism** — Skip BullMQ (requires Redis) and Temporal (Worker requires Node.js). Native `Promise.all()` with phase DAG in `loop.ts` is sufficient and has zero new dependencies.

10. **Lean into Ouro's self-mod moat** — MetaGPT, ChatDev, CrewAI, OpenHands: none support agents modifying their own system prompts or source code with a sanctioned approval gate. SICA (ICLR 2025) is the closest academic precedent but lacks a human approval gate — cite it in documentation and use it to legitimise Ouro's approach. This is Ouro's primary differentiator. Make the proposed-change approval flow polished and demonstrable as a priority.

11. **Monitor Overstory** — Bun/TS + SQLite + multi-agent orchestrator on the identical stack. Track their SQLite mailbox coordination pattern and 11-runtime-adapter approach. Study before writing Commit 16 parallel-phase code.

12. **Plan MCP exposure post-MVP** — `elysia-mcp` makes Ouro's agents addressable as MCP tools from Claude Code, Cursor, and Windsurf. Zero architectural changes needed — just an adapter layer on top of existing Elysia routes. Schedule as a Cycle N+1 story to unlock ecosystem integrations.

---

*Sources (Cycle 9 additions): [Ouroboros](https://github.com/razzant/ouroboros) · [AWS Kiro](https://aws.amazon.com/kiro/) · [GitHub Spec Kit](https://github.com/github/spec-kit) · [VS Code Multi-Agent Dev Blog](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development) · [Awesome Devins (e2b)](https://github.com/e2b-dev/awesome-devins) · [SICA ICLR 2025](https://openreview.net/pdf?id=rShJCyLsOr)*

*Sources (Cycle 1–8): [MetaGPT GitHub](https://github.com/FoundationAgents/MetaGPT) · [ChatDev arXiv](https://arxiv.org/html/2307.07924v5) · [OpenHands arXiv](https://arxiv.org/abs/2407.16741) · [OpenHands](https://openhands.dev/) · [Factory.ai Deep Dive](https://www.eesel.ai/blog/factory-ai) · [Google Antigravity Codelabs](https://codelabs.developers.google.com/autonomous-ai-developer-pipelines-antigravity) · [agent-loop OSS](https://github.com/Saik0s/agent-loop) · [Karpathy Loopy Era](https://www.nextbigfuture.com/2026/03/andrej-karpathy-on-code-agents-autoresearch-and-the-self-improvement-loopy-era-of-ai.html) · [CrewAI](https://crewai.com/open-source) · [LangGraph Multi-Agent](https://www.adopt.ai/blog/multi-agent-frameworks) · [Google Cloud Agentic Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system) · [Microsoft UX Design for Agents](https://microsoft.design/articles/ux-design-for-agents/) · [Google ADK Multi-Agent Patterns](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) · [OpenAI Self-Evolving Agents Cookbook](https://developers.openai.com/cookbook/examples/partners/self_evolving_agents/autonomous_agent_retraining) · [Addy Osmani Self-Improving Agents](https://addyosmani.com/blog/self-improving-agents/) · [AWS Agent Squad](https://github.com/awslabs/agent-squad) · [Mastra GitHub](https://github.com/mastra-ai/mastra) · [VoltAgent GitHub](https://github.com/VoltAgent/voltagent) · [react-diff-view npm](https://www.npmjs.com/package/react-diff-view) · [diff npm](https://www.npmjs.com/package/diff) · [Anthropic Extended Thinking Docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) · [EvoAgentX](https://github.com/EvoAgentX/Awesome-Self-Evolving-Agents) · [ESAA arXiv](https://arxiv.org/pdf/2602.23193) · [AgentLog GitHub](https://github.com/sumant1122/agentlog) · [SICA ICLR 2025](https://openreview.net/pdf?id=rShJCyLsOr) · [Agyn arXiv](https://arxiv.org/html/2602.01465) · [Overstory GitHub](https://github.com/jayminwest/overstory) · [ComposioHQ agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) · [AgentScope GitHub](https://github.com/agentscope-ai/agentscope) · [elysia-mcp](https://www.mcpserverfinder.com/servers/keithagroves/elysia-mcp) · [Approval Gates DEV](https://dev.to/bridgeace/approval-gates-how-to-make-ai-agents-safe-for-real-world-operations-54mi) · [ISACA Self-Modifying AI](https://www.isaca.org/resources/news-and-trends/isaca-now-blog/2025/unseen-unchecked-unraveling-inside-the-risky-code-of-self-modifying-ai)*
