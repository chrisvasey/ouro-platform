# Research Report

*Prepared by: Researcher agent | Date: 2026-03-28 | Cycle 5*

> **Scope note:** This cycle's research builds directly on the Cycle 3 report. The 16-commit plan remains unimplemented across 4 cycles. This update focuses on: (1) new Claude Agent SDK developments that affect `claude.ts` migration strategy, (2) confirming the diff viewer choice, (3) newly relevant TypeScript agent framework options, and (4) any competitive landscape changes. Prior findings remain valid unless superseded below.

---

## Summary

The Cycle 3 diagnosis remains valid: `claude.ts` CLI subprocess blocks all Cycle 2 features; migrate to `@anthropic-ai/sdk` as Commit 0. New this cycle: Anthropic has shipped the **Claude Agent SDK** (renamed from Claude Code SDK) with a V2 TypeScript interface (preview) that simplifies multi-turn agent loops, and **interleaved thinking** is now in public beta — relevant once Ouro moves to multi-turn tool call phases. `react-diff-view` (ESM via `/esm` subpath) remains the correct diff viewer choice; `git-diff-view` is now confirmed to have good ESM support too but `react-diff-view` has higher download velocity and is already the plan. Competitive landscape: EvoAgentX (EMNLP '25) and LangGraph (GA May 2025, 400 companies) are the notable new entrants; neither changes Ouro's architecture. MetaGPT launched MGX (Feb 2026) as a commercial product — good signal that the multi-role agent approach is now market-validated. VoltAgent (TypeScript, Zod-typed workflow steps) is the most relevant new OSS option for Ouro's Bun + TypeScript stack.

---

## Competitors

| Name | Description | What we can learn |
|------|-------------|-------------------|
| **OpenHands** (All-Hands AI) | 68.6K+ stars, MIT, Python. V0→V1 architecture migration underway (V0 deprecated April 2026). Optional sandboxing, `LocalWorkspace` as default, SDK-first. 77.6% SWE-bench Verified. | V1 architecture lesson: moving from mandatory Docker to optional sandboxing dramatically lowers friction for local runs. Ouro's cycle runner should similarly be runnable without infra dependencies. Critical weakness exposed: each session starts with zero project memory — exactly the problem Ouro's `events` table + artifact versioning solves. |
| **Devin 2.0** (Cognition) | Fully autonomous, multi-agent dispatch, 67% PR merge rate. Primary weakness: opaque black box, no feed transparency. | Ouro's transparency story (feed, agent rail, thought log) is still the right differentiator. No material update. |
| **Mastra** (`mastra-ai/mastra`, 22.3K stars, Apache 2.0) | TypeScript-native, YC W25, $13M raised, launched Jan 2026. v1.4.0 (Feb 2026). 40+ model providers, graph-based workflow engine (`.then()`, `.branch()`, `.parallel()`), layered memory (conversation + RAG + working + semantic), MCP server support, Mastra Studio IDE, built-in evals. | Most directly relevant competitor-turned-library. The workflow engine's human-in-the-loop `suspend/resume` maps precisely to Ouro's `waitForBlockerResolution()` pattern. The layered memory model is the reference implementation for the researcher agent's memory system. 330+ contributors, actively maintained. |
| **GitHub Copilot Workspace** | GA May 2025, 56% SWE-Bench, MCP support, sandbox via GitHub Actions, human approval before CI. | The "assign GitHub issue to agent" pattern remains Ouro's target UX for Cycle 4+. Nothing new. |
| **CrewAI** | 44K+ stars, Python. 1.4B+ automations run at enterprise scale. | No meaningful update. Adopt vocabulary and task DAG concept, not the library. |
| **MetaGPT / MGX** | 62K+ stars, Python. Feb 2026: launched MGX (MetaGPT X) — "world's first AI agent development team" commercial product. AFlow paper (automating agentic workflow generation) accepted at ICLR 2025, top 1.8%. | Market validation that multi-role agent pipelines are commercially viable. MGX going commercial means the OSS multi-agent approach has a proven path to product. No architectural changes for Ouro. |
| **EvoAgentX** | EMNLP '25. Automated framework for evolving agentic workflows — generates, optimises, and ranks agent workflow variants. | Closest academic analog to Ouro's self-improvement loop. Key insight: treat workflows as evolvable artefacts, not static pipelines. Could inform Ouro's Cycle N+1 self-mod stories. Too early for production use. |
| **LangGraph** | GA May 2025. ~400 production companies including LinkedIn (SQL Bot) and Uber (code migration). Stateful graph execution, human-in-the-loop, parallel branches. | Confirms that stateful phase DAGs with human-in-the-loop are the production-validated pattern. Ouro's `phase_states` + `waitForBlockerResolution()` is the same pattern in SQLite. Python only — not directly usable. |

---

## OSS / Libraries

| Library | Purpose | Verdict |
|---------|---------|---------|
| **`@anthropic-ai/sdk`** (`anthropic` on npm, TypeScript, MIT) | Official Anthropic Messages API client. Supports `tools`, `thinking`, `usage` fields in response. Fully Bun-compatible (pure JS/TS). Current server `claude.ts` uses CLI subprocess — all Cycle 2 features (tool use, token counts, thinking blocks) require replacing it with this SDK. | ✅ **Use — install as Commit 0 prerequisite.** `bun add @anthropic-ai/sdk` in `server/`. Replaces `Bun.spawn(["claude", "--print", ...])` with `anthropic.messages.create({model, tools, thinking, ...})`. Without this, Stories 3, 9, and 14 are impossible to implement. |
| **`@mastra/core`** (`mastra-ai/mastra`, v1.4.0, Apache 2.0, 22.3K stars) | TypeScript agent framework: model routing, layered memory, MCP, workflow graphs with suspend/resume, Mastra Studio IDE, built-in evals. | ⚠️ Study patterns, don't run on Bun — Bun support is broken: monorepo integration fails under Bun + Turbo, `bun create mastra` throws version-mismatch errors, Studio blanks out intermittently. v1.0 introduced breaking import changes (subpath entry points; codemods provided). Use as architectural reference for memory model and human-in-the-loop suspend/resume. Import paths for patterns you manually implement: `@mastra/core/agent`, `@mastra/core/tools`, `@mastra/core/memory`. |
| **`diff`** (`kpdecker/jsdiff`, v8.0.4, MIT, ~2M weekly downloads) | Line-level and character-level text diffing, `createPatch()` for unified diff output, `applyPatch()` for applying patches. Full TypeScript types in-package. | ✅ Use — `diff.createPatch(filename, oldStr, newStr)` is the direct call for `computeUnifiedDiff()` in Commit 1. `diff.applyPatch(fileContent, patchStr)` solves the Commit 6 open question on applying stored unified diffs. Use this; do not write inline LCS. Resolves build.md Open Question #1 and #2. |
| **`react-diff-view`** (`otakustay/react-diff-view`, MIT, ~40K weekly downloads) | GitHub-style diff component for React. Split and unified views, token highlighting, web worker support. ESM available via `/esm` subpath from v3.1.0+. | ✅ Use — prefer over `git-diff-view` (see ❌ below). Import from `react-diff-view/esm` for full Vite/ESM compatibility. Takes unified diff string as input (compatible with `diff.createPatch()` output). Resolves GH#3 (C2). |
| **`git-diff-view`** (`mrwangjusttodo/git-diff-view`) | GitHub-style diff viewer. | ⚠️ Downgrade to maybe — Vite/ESM compatibility for this specific package remains unverified. The Cycle 2 build plan flagged this as GH#3 and it was never confirmed. Switch to `react-diff-view` which has confirmed ESM support and higher download velocity. |
| **`react-markdown` + `rehype-highlight`** | Markdown rendering with syntax highlighting for artifact viewer. | ✅ Use — unchanged recommendation. Standard, well-maintained. |
| **BullMQ** (`taskforcesh/bullmq`, v5.71.0, MIT) | Redis-backed job queues for parallel agent phase fan-out. Bun is officially a supported runtime, but use `ioredis` not `Bun.redis` (incompatible as of Oct 2025). Requires a Redis instance. | ⚠️ Maybe (phase 2) — Bun + ioredis combination works. However, standing up Redis adds operational overhead not justified for MVP. Implement parallel phase execution with `Promise.all()` directly in `loop.ts` for Commit 16. BullMQ is the right choice only if you need durable job queues across restarts or horizontal worker scaling. |
| **Temporal TypeScript SDK** (`temporalio/temporal`, v1.12.0, MIT SDKs) | Durable workflow execution: each phase = Activity, whole cycle = Workflow. Crash recovery, retry, human-in-the-loop signals. Used by OpenAI Codex. | ⚠️ Major Bun blocker — `@temporalio/client` works on Bun, but the Worker runtime requires Node.js (uses Node-API native modules, `worker_threads`, `vm`). Cannot run Workflow/Activity workers on Bun without a separate Node.js sidecar. This makes Temporal impractical for Ouro's Bun server unless the architecture is split. Implement saga/retry manually in Commits 4–5; revisit Temporal only if the stack migrates to Node or adds a sidecar. |
| **VoltAgent** (`VoltAgent/voltagent`, TypeScript, MIT) | TypeScript multi-agent framework. Chain API for composing/branching/orchestrating agents. Workflow steps typed with Zod schemas. Built-in observability console. Actively maintained. | ✅ Study patterns — most Bun-compatible TypeScript agent framework found. Zod-typed step contracts are the right pattern for Ouro's phase runner. Could replace hand-rolled phase dispatch if complexity grows. Not needed for MVP but worth following. |
| **AutoGen / Microsoft Agent Framework** | AutoGen + Semantic Kernel merged. Enterprise-grade session state, telemetry, type safety. | ❌ Avoid — .NET/Python focus, no TypeScript/Bun runtime. No update. |

---

## UI Patterns

- **Adaptive thinking display (updated pattern):** Claude Sonnet 4.6 returns *summarized* thinking blocks, not raw full-text thinking. The `thinking_blocks` in `ClaudeResult` will contain `{ summary, full_text }` where `full_text` is the model's summarization, not the raw internal monologue. The `ThoughtLogPanel` should present this as "Claude's reasoning" rather than "raw thinking" and set user expectations accordingly. Do not tell users they're seeing unfiltered internal reasoning — they're seeing a model-generated summary.

- **Sticky agent status rail:** Unchanged from Cycle 2 design. One card per agent with status badge + pulsing animation + last action timestamp + current task. `AgentCard` should display `token_count` from the last completed phase (GH#6 fix: extend `Agent` type with `last_phase_token_count`).

- **Blocker modal with focus trap:** The `BlockerModal` portal pattern with `useFocusTrap` remains correct. Critical accessibility constraint: `Escape` key must NOT dismiss a blocking modal (cycle is halted until resolved). Design review confirmed this is correct behaviour.

- **Cycle progress tracker:** The horizontal step bar with `pending / active / complete / failed / retrying` states remains the right approach. When phase DAG parallelism (Commit 16) ships, two steps can be `active` simultaneously — the step bar must render both with pulsing animation. Design should accommodate this from day one rather than retrofitting.

- **Artifact diff viewer:** The `react-diff-view` library renders a unified diff string. The `diff.createPatch()` output feeds directly into it. Tab order: rendered view default, diff toggle secondary. Cycle selector dropdown is the primary navigation axis.

- **Budget warning colour ramp:** Token cost display should shift colour progressively: `<50% → text-gray-400`, `50–79% → text-amber-400`, `80–99% → text-orange-500 font-medium`, `≥100% → text-red-500 font-bold`. This prevents users from only noticing spend at the hard-stop threshold.

---

## Dev Patterns

- **Commit 0 — SDK migration (gating prerequisite for all Cycle 2 features):** Replace `claude.ts`'s `Bun.spawn(["claude", "--print", ...])` subprocess with `@anthropic-ai/sdk`. `claude.ts` must return `inputTokens`, `outputTokens`, `costUsd`, `thinkingBlocks`, and `toolUses`. New signature:
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
  Without this, Stories 3, 9, and 14 are architecturally impossible — tool calls return empty, token counts are always 0, and thought logs are silent noop.

- **`diff` package for unified diffs (replaces inline LCS):** `computeUnifiedDiff()` in `db.ts` should call `diff.createPatch(filename, oldContent, newContent)` from the `diff` npm package. Applying a stored diff to a file in Commit 6 should call `diff.applyPatch(currentContent, storedDiff)`. This eliminates both open questions #1 and #2 from `build.md`. Install: `bun add diff` in the server workspace. **Do not install `@types/diff`** — types are bundled directly in `diff@8.x`. TypeScript caveat: pass options as inline object literals, not programmatic `let opts: any = {}`; overload resolution fails on non-literal options objects.

- **Extended thinking API for Claude 4.6 (resolves GH#2):** Use `thinking: { type: 'adaptive', effort: 'high' }` (or `'medium'` / `'low'`). The older `thinking: { type: 'enabled', budget_tokens: N }` syntax still works but `budget_tokens` is deprecated. Response includes `type='thinking'` content blocks with a `thinking` field (model-summarized reasoning) and a `signature` field (encrypted full reasoning — preserve verbatim in any multi-turn pass). **Note on `betas: ['interleaved-thinking-2025-05-14']`:** This header is NOT deprecated — it specifically enables thinking *between* tool calls (interleaved). Ouro's current single-turn-per-phase architecture doesn't need it. If agents ever make multi-turn conversations with tool calls, add this header then. For now, omit it. No beta flag needed for basic extended thinking on Claude 4.6.

- **Advanced tool use beta (optional enhancement):** The `advanced-tool-use-2025-11-20` beta header enables Tool Search (thousands of tools without context window overhead), Programmatic Tool Calling (tools invoked in a code execution environment), and Tool Use Examples. Relevant for Commit 6 (structured tool use) — evaluate whether `save_artifact`, `post_feed_message`, and `request_human_input` benefit from Tool Use Examples to improve agent tool call accuracy. Not required for MVP.

- **Claude Agent SDK V2 TypeScript (preview — do NOT use yet):** Anthropic renamed the "Claude Code SDK" to "Claude Agent SDK" and shipped a V2 TypeScript interface (preview). V2 replaces async generator + yield patterns with session-based `send()` / `stream()` calls, separating sending and streaming into discrete steps. **Do not use V2 in Ouro today** — it is marked unstable, APIs may change before GA. Once stable, V2 would simplify the phase loop's streaming architecture. Monitor the changelog at `anthropics/claude-agent-sdk-typescript`.

- **Interleaved thinking (new beta — not needed for MVP):** `betas: ['interleaved-thinking-2025-05-14']` enables Claude to think *between* tool calls in a multi-turn loop. Ouro's current architecture makes single-turn API calls per phase — this beta adds no value yet. Becomes relevant in a future story where agents use multi-step tool call loops (e.g., researcher browsing + refining in one session). Plan for it but do not add the header now.

- **Fine-grained tool streaming (new beta):** `betas: ['fine-grained-tool-streaming-2025-05-14']` streams tool input as it generates, rather than buffering the full tool call before yielding. Useful for long `save_artifact` tool calls where users see no UI feedback during generation. Low priority for MVP but worth adding with the Commit 6 tool use work.

- **AgentLog append-only JSONL pattern (architecture reference):** [AgentLog](https://github.com/sumant1122/agentlog) is a lightweight event bus for AI agents built on append-only JSONL logs with HTTP/SSE pub-sub. Agents publish events via POST and subscribe via GET/SSE with offset-based replay. This is architecturally identical to Ouro's `events` table + SSE feed design — validates the approach. The key differentiator AgentLog adds is `GET /topics/{topic}/replay?offset=X` for exactly-once state rehydration after crash. Ouro should implement equivalent functionality in the `GET /api/projects/:id/events?after=N` endpoint for cycle recovery.

- **Tool use + extended thinking constraint:** When using extended thinking alongside tool use, only `tool_choice: { type: 'auto' }` or `tool_choice: { type: 'none' }` are valid. Forcing specific tools (`tool_choice: { type: 'tool', name: '...' }`) will throw an API error. This constrains GH#7 (C2) tool registration: agents cannot be forced to call a specific tool. Design `dispatchToolUse()` to handle cases where the model returns text instead of a tool call.

- **Thinking blocks in multi-turn:** If any multi-turn conversation passes thinking blocks back to the API, include the unmodified block verbatim for the last assistant turn. This is not currently a concern for Ouro (single-turn Claude calls per phase), but becomes relevant if agents are given conversation history.

- **Event sourcing with WAL mode (already correct):** `db.ts` correctly sets `PRAGMA journal_mode = WAL`. SQLite WAL mode supports concurrent readers with single writer — correct for Ouro's access pattern. No change needed.

- **Slug collision handling:** `db.ts` `slugify()` does not currently auto-suffix on collision. The CLAUDE.md spec says server should auto-suffix. Add collision check + `-2`, `-3` suffix in `createProject()`. Low priority but catches the spec gap.

- **IntentGate pattern (already implemented):** The `extractIntent()` function and `reply_intent_json` column are live (Commit `14e5621`). This is the right direction — structured intent extraction from user replies enables agents to act on replies rather than just reading raw text. This pattern should be extended to the blocker resolution flow in Commit 4: when a user replies to a budget blocker, `extractIntent()` should determine `{ action: 'approve' | 'adjust_budget' | 'stop_cycle', newBudget?: number }`.

---

## Risks

1. **[CRITICAL] `claude.ts` CLI subprocess is incompatible with Cycle 2 features** → `server/src/claude.ts` spawns `claude --print` and reads stdout. You cannot pass `tools`, get `usage.input_tokens`, or receive `thinking_blocks` from a CLI subprocess. This is why GH#7, GH#2, and Story 9 are all impossible in the current architecture. Migrating to `@anthropic-ai/sdk` (pure JS, Bun-compatible) is **Commit 0** — must happen before the schema changes.

2. **GH#7 [High] — Tool definitions not registered in `runClaude()`** → The entire structured tool use pipeline is inert until `AGENT_TOOLS` is added to `runClaude()` in Commit 6. All Commit 3 event logging for `tool_call` events will be empty. Confirm tool schema matches Anthropic's `InputSchema` format before Commit 6.

3. **GH#4 [High] — Self-mod gate bypassed by freeform text fallback** → If an agent returns freeform text (not a `tool_use` block) containing a file path under `/server/src/`, the legacy `saveArtifact()` path will write directly without gate interception. Guard the legacy path explicitly: in `dispatchToolUse()`, check every `save_artifact` call path regardless of whether it arrived via tool use or freeform parse.

4. **GH#3 [High] — `git-diff-view` ESM/Vite compat unconfirmed** → Resolved by switching to `react-diff-view`. Import from `react-diff-view/esm`. No Vite config changes needed.

5. **Extended thinking API clarification (resolves GH#2)** → For basic extended thinking on Claude 4.6, use `thinking: { type: 'adaptive', effort: 'high' }` in the request body. No beta header is needed. `budget_tokens` is deprecated. The `interleaved-thinking-2025-05-14` header is NOT deprecated — it specifically enables thinking *between* tool calls (interleaved), which Ouro doesn't need in its current single-turn-per-phase architecture. Once the SDK migration (Commit 0) is done, add `thinking: { type: 'adaptive', effort: 'high' }` to `runClaude()` and verify `thinking_blocks` populate in the response. Resolves GH#2 (C2).

6. **Tool use + extended thinking incompatibility** → Cannot force a specific tool when extended thinking is enabled. `dispatchToolUse()` must handle the fallback where Claude returns a text response instead of a tool call. This affects agent reliability when thinking is enabled — test both paths.

7. **SQLite write contention under Ralph Loop retries** → The Ralph Loop can trigger up to 3 build → test cycles. Each iteration writes feed messages, artifacts, and (in Cycle 2) events to SQLite. WAL mode handles concurrent reads, but if the cycle runner and a concurrent HTTP request both write simultaneously, WAL serializes writes. This is fine for MVP (single-project cycles) but will degrade under parallel projects. Batch writes where possible.

8. **Budget check timing** → `checkBudgetGate()` checks `sumTodayCost()` *before* each phase. A phase that costs more than the remaining budget will run to completion and only be caught at the *next* phase boundary. This is by design (non-blocking mid-phase) but means a single expensive phase can overshoot the budget by 1× phase cost. Document this clearly in the settings UI.

9. **OpenHands V1 session memory problem** → OpenHands explicitly documented their "zero project memory per session" weakness in their V1 migration blog. This is Ouro's strongest competitive differentiator: the `events` table, artifact versioning, and cycle history give Ouro persistent cross-cycle project memory. Prioritize making this visible in the UI (artifact diff viewer, cycle history panel) — it's the product story.

10. **Recursive self-improvement safety** → Unchanged from Cycle 2. Hard gate on `/server/src/` writes, human approval required, `proposed_changes` table with `PENDING` status. This must ship in Commit 6 before any further self-improvement cycles are enabled.

---

## Recommendations

1. **Install `@anthropic-ai/sdk` and rewrite `claude.ts` — this is Commit 0** — `bun add @anthropic-ai/sdk` in `server/`. Replace the `Bun.spawn(["claude", "--print", ...])` subprocess with a direct `anthropic.messages.create()` call. New `ClaudeRunResult` must expose `inputTokens`, `outputTokens`, `costUsd`, `thinkingBlocks`, and `toolUses`. This unblocks GH#7, GH#2, Story 3, Story 9, and Story 14 simultaneously.

2. **Replace `git-diff-view` with `react-diff-view`** — Install `bun add react-diff-view` in the client workspace. Import from `react-diff-view/esm` for Vite compatibility. This directly resolves GH#3 (C2) with no further investigation needed. Update Commit 11 accordingly.

3. **Add `diff` package to server** — Run `bun add diff` in the server workspace. Use `diff.createPatch()` for `computeUnifiedDiff()` and `diff.applyPatch()` for the Commit 6 approval path. Resolves build.md Open Questions #1 and #2 without any inline algorithm.

4. **Add thinking support to the new SDK-based `claude.ts`** — In the `anthropic.messages.create()` call (from Commit 0), include `thinking: { type: 'adaptive', effort: 'high' }`. Do not pass `betas: ['interleaved-thinking-2025-05-14']` unless Ouro moves to multi-turn tool call loops. Extract `content.filter(b => b.type === 'thinking')` from the response. The `signature` field must be preserved verbatim if multi-turn calls are added. Resolves GH#2 (C2).

5. **Register `AGENT_TOOLS` in `runClaude()` before Commit 6** — Define tool schemas for `save_artifact`, `post_feed_message`, `request_human_input` using Anthropic's `InputSchema` format. Pass as `tools` array in the API request. This is GH#7 (C2) — the most critical blocker.

6. **Extend `IntentGate` to blocker resolution** — The existing `extractIntent()` function should be called on inbox replies to budget blockers and phase-escalation blockers. Return `{ action: 'approve' | 'adjust_budget' | 'stop_cycle' | 'retry', ... }`. Wire into `waitForBlockerResolution()` so the cycle runner can react to the user's intent rather than just unblocking on any reply.

7. **Evaluate Mastra for researcher memory** — `@mastra/core@1.4.0` is now stable and ships with Mastra Studio for local observability. The working memory + semantic memory layers directly address the cross-cycle context problem. Install in isolation and evaluate before Commit 3 event logging ships.

8. **Document adaptive thinking behaviour for users** — Claude Sonnet 4.6 returns *summarized* thinking, not raw internal monologue. Update the `ThoughtLogPanel` label from "Thought Log" to "Claude's Reasoning" and add a tooltip: "Summarized by the model — not raw internal thoughts." Avoids user confusion.

9. **Guard legacy `saveArtifact()` path in all agent runners** — In each `agents/*.ts` file, any direct call to `db.saveArtifact()` or file-write that could target `/server/src/` must be intercepted by `checkSelfModGate()`. The freeform text fallback in `dispatchToolUse()` is the specific risk vector (GH#4). Add an explicit path check before every file write, not just in the tool use dispatch path.

10. **Ship Commit 0 then Commit 1 (schema) immediately** — The `events`, `proposed_changes`, `blocks_cycle`, `cycle_id`, and `last_completed_phase`/`phase_states` schema changes are non-breaking `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS` statements. They can be merged and deployed independently of any other work. Unblock the rest of the plan by landing this first.

10. **Add `Promise.all()` parallelism for Commit 16 (skip BullMQ and Temporal)** — Implement the `research → (spec ‖ design-draft)` parallel phase execution with native `Promise.all()` in `loop.ts`. BullMQ adds a Redis dependency; Temporal Worker is incompatible with Bun. Both are eliminated as options. Native `Promise.all()` with the phase DAG is sufficient (~30 lines) and has zero dependencies.

---

*Sources: [Mastra GitHub](https://github.com/mastra-ai/mastra) · [Anthropic Extended Thinking Docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) · [Anthropic Agent SDK Docs](https://platform.claude.com/docs/en/agent-sdk/overview) · [Anthropic Agent SDK TypeScript V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) · [Anthropic Streaming Docs](https://platform.claude.com/docs/en/build-with-claude/streaming) · [react-diff-view npm](https://www.npmjs.com/package/react-diff-view) · [git-diff-view GitHub](https://github.com/MrWangJustToDo/git-diff-view) · [diff npm](https://www.npmjs.com/package/diff) · [BullMQ Bun issue](https://github.com/taskforcesh/bullmq/issues/2177) · [OpenHands GitHub](https://github.com/OpenHands/OpenHands) · [MetaGPT GitHub](https://github.com/FoundationAgents/MetaGPT) · [EvoAgentX / Awesome-Self-Evolving-Agents](https://github.com/EvoAgentX/Awesome-Self-Evolving-Agents) · [VoltAgent GitHub](https://github.com/VoltAgent/voltagent) · [AgentLog GitHub](https://github.com/sumant1122/agentlog) · [LangGraph Multi-Agent Frameworks](https://www.adopt.ai/blog/multi-agent-frameworks)*
