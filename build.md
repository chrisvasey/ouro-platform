# Implementation Plan — Cycle 9: Anthropic SDK Migration + Tool Use + Token/Cost UI

**Developer Agent** | Ouro Platform | 2026-03-29

---

## Overview

Replace the `Bun.spawn(["claude"...])` subprocess in `claude.ts` with the `@anthropic-ai/sdk`
SDK. Extend `ClaudeRunResult` to carry `costUsd`, `thinkingBlocks`, and `toolUses`. Wire cost
accumulation into all 6 agent runners. Fix `insertEvent()` to actually write `token_count` and
`cost_usd` (currently omitted despite the schema having both columns). Add `blocks_cycle` to
`inbox_messages`. Add `AGENT_TOOLS` and `dispatchToolUses()`. Add a `GET /api/projects/:id/events`
endpoint. Add `AgentEventRow` + `TokenCostBadge` UI and an `EventsSection` collapsible in
`FeedPanel`.

---

## File Structure

```
ouro-platform/
├── server/
│   ├── package.json                    ← Commit 1: add @anthropic-ai/sdk
│   └── src/
│       ├── claude.ts                   ← Commits 2–3: SDK, costUsd, AGENT_TOOLS
│       ├── db.ts                       ← Commits 4–5: blocks_cycle, insertEvent fix
│       ├── index.ts                    ← Commit 6: GET /api/projects/:id/events
│       └── agents/
│           ├── base.ts                 ← Commits 7–8: emitAgentCompleted, dispatchToolUses
│           ├── developer.ts            ← Commit 9
│           ├── researcher.ts           ← Commit 10
│           ├── pm.ts                   ← Commit 11
│           ├── designer.ts             ← Commit 12
│           ├── tester.ts               ← Commit 13
│           └── documenter.ts           ← Commit 14
└── client/
    └── src/
        ├── types.ts                    ← Commit 15: OuroEvent interface
        └── components/
            ├── AgentEventRow.tsx       ← Commit 16: AgentEventRow + TokenCostBadge
            └── FeedPanel/              ← Commit 17: EventsSection + events fetch
```

---

## Data Shapes

```typescript
// ── server/src/claude.ts ──────────────────────────────────────────────────────

export interface ClaudeRunOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  tools?: Anthropic.Tool[];   // Commit 3 — forwarded to messages.create()
}

export interface ClaudeRunResult {
  content: string;
  real: boolean;
  inputTokens: number;        // non-optional; 0 for mock
  outputTokens: number;       // non-optional; 0 for mock
  costUsd: number;            // (in/1M)*3 + (out/1M)*15; 0 for mock
  thinkingBlocks: Array<{ thinking: string }>;              // [] when none/mock
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;  // [] when none/mock
}

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "save_artifact",
    description: "Save the agent's primary output artifact for this phase.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Artifact filename, e.g. research.md" },
        content:  { type: "string", description: "Full markdown content to save." },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "post_feed_message",
    description: "Post a message to the project feed.",
    input_schema: {
      type: "object",
      properties: {
        recipient:    { type: "string" },
        content:      { type: "string" },
        message_type: { type: "string", enum: ["handoff", "question", "decision", "note", "escalate"] },
      },
      required: ["recipient", "content", "message_type"],
    },
  },
  {
    name: "request_human_input",
    description: "Send a blocking inbox message to the human operator.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        body:    { type: "string" },
      },
      required: ["subject", "body"],
    },
  },
];

// ── server/src/db.ts ───────────────────────────────────────────────────────────

// Extended InsertEventParams (Commit 5)
export interface InsertEventParams {
  projectId: string;
  cycleId?: string;
  type: EventType;
  agentRole?: string;
  payload: Record<string, unknown>;
  tokenCount?: number;   // defaults to 0 in INSERT
  costUsd?: number;      // defaults to 0 in INSERT
}

// Event interface (add token_count + cost_usd — currently missing)
export interface Event {
  id: string;
  project_id: string;
  cycle_id: string | null;
  type: EventType;
  agent_role: string | null;
  payload: Record<string, unknown>;
  token_count: number;   // NEW
  cost_usd: number;      // NEW
  created_at: number;
}

// InboxMessage extended (Commit 4)
export interface InboxMessage {
  // ... existing fields ...
  blocks_cycle: number;  // 0=non-blocking, 1=blocking (blocks loop until replied)
}

// ── client/src/types.ts ────────────────────────────────────────────────────────

export interface OuroEvent {
  id: string;
  project_id: string;
  cycle_id: string | null;
  event_type: string;
  agent_role: string | null;
  phase: string | null;       // extracted from payload.phase on client
  payload: Record<string, unknown>;
  token_count: number;
  cost_usd: number;
  created_at: number;
}
```

---

## Key Functions

### `server/src/claude.ts`

**`runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult>`** (Commits 2–3)
- Reads `ANTHROPIC_API_KEY` (also tries `CLAUDE_CODE_OAUTH_TOKEN` / `CLAUDE_OAUTH_TOKEN` for backward compat)
- Constructs `new Anthropic({ apiKey })` and calls `client.messages.create({ model: "claude-sonnet-4-6", max_tokens: opts.maxTokens ?? 4096, system: opts.systemPrompt, messages: [{ role: "user", content: opts.userPrompt }], tools: opts.tools ?? [] })` with header `"anthropic-beta": "interleaved-thinking-2025-05-14"`
- Maps response content blocks: `type==="text"` → append to `content`; `type==="thinking"` → push `{ thinking }` to `thinkingBlocks`; `type==="tool_use"` → push `{ id, name, input }` to `toolUses`
- Reads `response.usage.input_tokens` / `output_tokens`; computes `costUsd = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15`
- On `AuthenticationError`: logs warning, returns mock with `real: false` (does not propagate)
- On `RateLimitError`: rethrows so caller's `MAX_RETRIES` logic fires
- On timeout (`opts.timeoutMs`): `Promise.race` around SDK call, rethrows with `err.timeout = true` unchanged from current pattern
- Mock path (no key or `AuthenticationError`): returns `{ content: mockOutput(...), real: false, inputTokens: 0, outputTokens: 0, costUsd: 0, thinkingBlocks: [], toolUses: [] }`

---

### `server/src/db.ts`

**Migration: `blocks_cycle` column** (Commit 4)
- `try { db.run("ALTER TABLE inbox_messages ADD COLUMN blocks_cycle INTEGER NOT NULL DEFAULT 0") } catch { }`
- Update `InboxMessage` interface: add `blocks_cycle: number`
- Update `sendInboxMessage` signature: add optional `blocksCycle = 0` param
- Update INSERT statement to include `blocks_cycle` value

**`insertEvent(params: InsertEventParams): Event`** (Commit 5) — **bug fix**
- **Currently broken**: INSERT omits `token_count` and `cost_usd` even though schema has both columns; `parseEventRow` also strips them from the returned `Event`
- Fix INSERT: `INSERT INTO events (..., token_count, cost_usd) VALUES (..., ?, ?)` binding `params.tokenCount ?? 0` and `params.costUsd ?? 0`
- Fix `parseEventRow`: include `token_count: row.token_count` and `cost_usd: row.cost_usd` in returned object
- Fix `Event` interface: add `token_count: number` and `cost_usd: number`

---

### `server/src/index.ts`

**`GET /api/projects/:id/events`** (Commit 6)
- Returns `{ events: OuroEventRow[] }` for the project, newest-first, limit 200
- Supports optional `?cycleId=<id>` query param — delegates to existing `getEvents(projectId, cycleId?)`
- Returns `404 { error: "Project not found" }` if project doesn't exist
- `OuroEventRow` is the `Event` interface from `db.ts` (already has `token_count`, `cost_usd` after Commit 5)

---

### `server/src/agents/base.ts`

**`emitAgentCompleted(meta: AgentEventMeta, tokens: { inputTokens: number; outputTokens: number; costUsd: number }): void`** (Commit 7)
- Extends existing signature: add `costUsd: number` to the `tokens` param (non-optional — callers updated in Commits 9–14)
- Passes `tokenCount: tokens.inputTokens + tokens.outputTokens` and `costUsd: tokens.costUsd` to `insertEvent()`
- Payload retains `inputTokens`, `outputTokens`, `costUsd` for observability

**`dispatchToolUses(projectId: string, toolUses: ClaudeRunResult["toolUses"], agentRole: string, cycleId?: string): Promise<void>`** (Commit 8)
- Iterates `toolUses` array; routes by `name`:
  - `"save_artifact"` → `saveArtifact(projectId, input.phase as string, input.filename as string, input.content as string, cycleId)` — the actual `AGENT_TOOLS` definition in `claude.ts` includes `phase` as a required field in `input_schema`, so pass `input.phase` directly (not `agentRole`)
  - `"post_feed_message"` → `postFeedMessage(projectId, agentRole, input.recipient as string, input.content as string, input.message_type as string)`
  - `"request_human_input"` → `sendInboxMessage(projectId, agentRole, input.subject as string, input.body as string, 1)` (blocksCycle=1)
  - Unknown name → `console.warn("[base] unknown tool:", name)` and skip; does not throw
- If `toolUses` is empty and the caller has freeform `content`, the caller falls back to legacy artifact save (self-mod gate enforced by each agent runner for `/server/src/` paths)
- Imports: add `saveArtifact`, `postFeedMessage`, `sendInboxMessage` to existing import from `"../db.js"` (line 8 of `base.ts`); add `ClaudeRunResult` type import from `"../claude.js"` for the parameter type
- Must be `export`ed — called from agent runner files in the same directory

---

### `server/src/agents/developer.ts` (Commit 9)

**`runStep(opts): Promise<StepResult>`** — extend `StepResult`
- Add `costUsd: number` field to the local `StepResult` interface
- Map `result.costUsd` from `ClaudeRunResult` (no `?? 0` needed — field is now non-optional)

**`runDeveloper(projectId, taskDescription, onFeed?, cycleId?): Promise<AgentResult>`**
- Add `let totalCost = 0` alongside existing `totalInput`/`totalOutput`
- After each `runStep()`: `totalCost += step.costUsd`
- After each `runStep()`: `await dispatchToolUses(projectId, step.toolUses, "developer", cycleId)`
- Pass `costUsd: totalCost` to `emitAgentCompleted()`

---

### `server/src/agents/researcher.ts` (Commit 10)

Same pattern as `developer.ts`:
- Extend local `StepResult` with `costUsd: number`
- Add `let totalCost = 0` accumulator
- Accumulate across all 5 steps (1 planning + 3 search + 1 synthesis)
- `await dispatchToolUses(...)` after each `runStep()` call
- Pass `costUsd: totalCost` to `emitAgentCompleted()`

---

### `server/src/agents/pm.ts` (Commit 11)

Single `runClaude()` call — no multi-step loop:
- `await dispatchToolUses(projectId, result.toolUses, "pm", cycleId)` after `runClaude()`
- Pass `costUsd: result.costUsd` to `emitAgentCompleted()`

---

### `server/src/agents/designer.ts` (Commit 12)

Single `runClaude()` call (confirm at implementation time):
- Same pattern as `pm.ts`: `dispatchToolUses` + `costUsd` in `emitAgentCompleted`

---

### `server/src/agents/tester.ts` (Commit 13)

Single `runClaude()` call (confirm at implementation time):
- Same pattern as `pm.ts`

---

### `server/src/agents/documenter.ts` (Commit 14)

Single `runClaude()` call:
- Same pattern as `pm.ts`

---

### `client/src/types.ts` (Commit 15)

Add `OuroEvent` interface:
- `id`, `project_id`, `cycle_id`, `event_type`, `agent_role`, `payload`, `token_count`, `cost_usd`, `created_at` — all from API response
- `phase: string | null` — extracted from `payload.phase` when mapping API response on the client (not a DB column)

---

### `client/src/components/AgentEventRow.tsx` (Commit 16)

**`AgentEventRow({ event: OuroEvent }): JSX.Element`**
- Container: `flex items-center gap-3 px-3 py-2 border-b border-gray-800 text-sm`
- Renders agent role chip using `ROLE_COLOUR` map (same as `FeedPanel`); falls back to `italic text-gray-600 "(system)"` when `agent_role` is null
- Renders `·` separator, phase label (`event.payload.phase ?? event.event_type`), then `TokenCostBadge` if `event.token_count > 0 && event.cost_usd > 0`
- Renders `relativeTime(event.created_at)` at `ml-auto` right edge
- Uses `ROLE_EMOJI` map for emoji prefix on the role chip

**`TokenCostBadge({ tokenCount: number, costUsd: number }): JSX.Element`** (co-located, unexported)
- `inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 text-xs font-mono`
- Renders `{tokenCount.toLocaleString()} tok · $${costUsd.toFixed(4)}`
- No internal conditional — parent is fully responsible for mounting/unmounting
- No interactions; read-only display

---

### `client/src/components/FeedPanel/` (Commit 17)

**`EventsSection` (inline in `FeedPanel.tsx`, not a separate file)**
- Adds `const [eventsOpen, setEventsOpen] = useState(false)` — collapsed by default
- Adds `events: OuroEvent[]` to `FeedPanel` props (or internal state if fetched inside)
- Fetches from `GET /api/projects/:id/events` on project change and on section expand; stores in local state
- Renders a collapsible section matching the existing "Run Status" pattern: chevron toggle button, `▶ Agent Events (N)` header, `max-h-64 overflow-y-auto` body
- Body: newest-first (`[...events].reverse().map(e => <AgentEventRow key={e.id} event={e} />)`)
- Empty state: `text-xs text-gray-600 px-4 py-3 "No events yet."` when `events.length === 0`
- Fetch errors → silently show empty state (events are diagnostic, not critical)

---

## Source-Anchored Notes (Tasks 7–12)

These notes were written after reading the actual source files. They supplement the Key Functions section above with exact line references and confirmed bug locations.

### Task 7 — `server/src/db.ts`: `blocks_cycle` migration

**File:** `server/src/db.ts` — insert after lines 65–69 (existing `reply_intent_json` migration)

- Add: `try { db.run("ALTER TABLE inbox_messages ADD COLUMN blocks_cycle INTEGER NOT NULL DEFAULT 0") } catch { /* already exists */ }`
- Update `InboxMessage` interface (line 272): add `blocks_cycle: number` after `reply_intent_json: string | null`
- Update `sendInboxMessage` signature (line 285): add `blocksCycle = 0` as 5th param
- Update INSERT (line 293–295): add `blocks_cycle` to column list and `blocksCycle` to VALUES bindings
- Update return object (line 298): add `blocks_cycle: blocksCycle`

### Task 8 — `server/src/db.ts`: extend `InsertEventParams`

**File:** `server/src/db.ts` — `InsertEventParams` interface at line 574

- Add `tokenCount?: number` — maps to `token_count INTEGER NOT NULL DEFAULT 0` schema column
- Add `costUsd?: number` — maps to `cost_usd REAL NOT NULL DEFAULT 0` schema column
- Both optional; existing call sites pass neither and get 0 by default via `?? 0` in `insertEvent()`

### Task 9 — `server/src/db.ts`: fix `insertEvent()`, `parseEventRow`, `Event`

**File:** `server/src/db.ts`

- `DbEvent` (line 592–602) **already** has `token_count: number` and `cost_usd: number` — the bug is only in the return mapping and INSERT, not in the raw row type
- `Event` interface (line 582): add `token_count: number` and `cost_usd: number` — currently missing despite DB schema having both columns
- `parseEventRow` (line 604): return object omits `token_count` and `cost_usd`; add `token_count: row.token_count` and `cost_usd: row.cost_usd`
- `insertEvent` INSERT (line 619–622): column list omits `token_count, cost_usd`; add them and bind `params.tokenCount ?? 0` and `params.costUsd ?? 0`
- `insertEvent` return object (line 624–632): add `token_count: params.tokenCount ?? 0` and `cost_usd: params.costUsd ?? 0`

### Task 10 — `server/src/agents/base.ts`: extend `emitAgentCompleted()`

**File:** `server/src/agents/base.ts` — function at line 33

- Current `tokens` type (line 35): `{ inputTokens: number; outputTokens: number }` — add `costUsd: number` (non-optional; callers updated in tasks 11–12)
- Pass `tokenCount: tokens.inputTokens + tokens.outputTokens` to `insertEvent()` (currently `insertEvent` doesn't accept it — fixed in task 8)
- Pass `costUsd: tokens.costUsd` to `insertEvent()`
- Add `costUsd: tokens.costUsd` to the `payload` object for observability in the events table

### Task 11 — `server/src/agents/base.ts`: add `dispatchToolUses()`

**File:** `server/src/agents/base.ts`

- Update import at line 8: add `saveArtifact`, `postFeedMessage`, `sendInboxMessage` to the existing `../db.js` import; add `type ClaudeRunResult` import from `"../claude.js"`
- New exported async function — signature: `dispatchToolUses(projectId: string, toolUses: ClaudeRunResult["toolUses"], agentRole: string, cycleId?: string): Promise<void>`
- Route `"save_artifact"` → `await saveArtifact(projectId, input.phase as string, input.filename as string, input.content as string, cycleId)` — **important**: the live `AGENT_TOOLS` in `claude.ts` (line 62) requires `phase` as a field in the input, so pass `input.phase`, not `agentRole`
- Route `"post_feed_message"` → `postFeedMessage(projectId, agentRole, input.recipient as string, input.content as string, input.message_type as string)` — synchronous, no await needed
- Route `"request_human_input"` → `sendInboxMessage(projectId, agentRole, input.subject as string, input.body as string, 1)` — `blocksCycle=1` (requires task 7 to be landed first)
- Unknown tool names: `console.warn("[base] unknown tool:", name)` and continue — does not throw

### Task 12 — `server/src/agents/developer.ts`: accumulate `costUsd` + dispatch tool uses

**File:** `server/src/agents/developer.ts`

- `StepResult` (line 32): add `costUsd: number` alongside `inputTokens` and `outputTokens`
- `runStep()` inner `attempt()` (line 40–43): add `costUsd: result.costUsd` to return; the `?? 0` fallbacks on `inputTokens`/`outputTokens` can be cleaned up once `ClaudeRunResult` makes them non-optional (task 2 / commit 2)
- `runStep()` timeout fallback (line 54): add `costUsd: 0` to the empty-output return
- `runDeveloper()` (line 87): add `let totalCost = 0` after `let totalOutput = 0` (line 97)
- Import `dispatchToolUses` from `"./base.js"` — add to existing import line 27
- After **each** of the 4 `runStep()` calls (steps 1, 2, 4 and each iteration of the step 3 loop): `totalCost += step.costUsd` and `await dispatchToolUses(projectId, step.toolUses, "developer", cycleId)`
- Line 229 (`emitAgentCompleted`): add `costUsd: totalCost` to the tokens argument

---

## API Contract

### `GET /api/projects/:id/events`

```
Request:  GET /api/projects/:id/events?cycleId=<optional>
Response 200: {
  events: Array<{
    id: string;
    project_id: string;
    cycle_id: string | null;
    event_type: string;
    agent_role: string | null;
    payload: Record<string, unknown>;
    token_count: number;
    cost_usd: number;
    created_at: number;
  }>
}
Response 404: { error: "Project not found" }
```

- No `cycleId` → all events for project, newest-first, limit 200
- With `?cycleId=X` → filtered to that cycle, ascending order

---

## Commit Plan

```
Commit 1 — chore(deps): add @anthropic-ai/sdk to server
  Files: server/package.json
  Action: add "@anthropic-ai/sdk": "^0.39.0" (confirm latest with bun add @anthropic-ai/sdk@latest)
  Action: run bun install

Commit 2 — feat(claude): migrate runClaude to Anthropic SDK; extend ClaudeRunResult
  Files: server/src/claude.ts
  - import Anthropic from "@anthropic-ai/sdk"
  - make inputTokens/outputTokens non-optional in ClaudeRunResult
  - add costUsd: number, thinkingBlocks, toolUses to ClaudeRunResult
  - add tools?: Anthropic.Tool[] to ClaudeRunOptions
  - replace Bun.spawn subprocess + NDJSON parser with client.messages.create()
  - set "anthropic-beta": "interleaved-thinking-2025-05-14" header always
  - map text/thinking/tool_use content blocks
  - compute costUsd from usage tokens ($3/$15 per MTok constants)
  - catch AuthenticationError → mock fallback; rethrow RateLimitError
  - update mock fallback: costUsd: 0, thinkingBlocks: [], toolUses: []

Commit 3 — feat(claude): add AGENT_TOOLS and forward to SDK call
  Files: server/src/claude.ts
  - export const AGENT_TOOLS: Anthropic.Tool[] (3 tool definitions)
  - forward opts.tools ?? [] to messages.create()

Commit 4 — fix(db): add blocks_cycle column to inbox_messages
  Files: server/src/db.ts
  - try/catch ALTER TABLE migration
  - add blocks_cycle: number to InboxMessage interface
  - add blocksCycle = 0 param to sendInboxMessage()
  - update INSERT to include blocks_cycle

Commit 5 — fix(db): persist token_count and cost_usd in insertEvent
  Files: server/src/db.ts
  - add tokenCount?, costUsd? to InsertEventParams
  - add token_count: number, cost_usd: number to Event interface
  - fix parseEventRow to include token_count and cost_usd
  - fix insertEvent INSERT to write token_count and cost_usd columns

Commit 6 — feat(api): add GET /api/projects/:id/events endpoint
  Files: server/src/index.ts
  - new Elysia route: GET /api/projects/:id/events?cycleId?
  - calls getEvents(projectId, cycleId?) from db.ts
  - returns 404 if project not found, 200 with events array otherwise

Commit 7 — feat(agents/base): extend emitAgentCompleted with costUsd
  Files: server/src/agents/base.ts
  - add costUsd: number to tokens param of emitAgentCompleted
  - pass tokenCount and costUsd to insertEvent()

Commit 8 — feat(agents/base): add dispatchToolUses helper
  Files: server/src/agents/base.ts
  - import saveArtifact, postFeedMessage, sendInboxMessage from db.js
  - import ClaudeRunResult type from claude.js
  - implement dispatchToolUses(projectId, toolUses, agentRole, cycleId?)
  - route save_artifact, post_feed_message, request_human_input

Commit 9 — feat(agents/developer): accumulate costUsd and dispatch tool uses
  Files: server/src/agents/developer.ts
  - extend StepResult with costUsd: number
  - add totalCost accumulator
  - dispatchToolUses() after each runStep()
  - pass costUsd: totalCost to emitAgentCompleted()

Commit 10 — feat(agents/researcher): accumulate costUsd and dispatch tool uses
  Files: server/src/agents/researcher.ts
  - same pattern as Commit 9

Commit 11 — feat(agents/pm): add costUsd and dispatch tool uses
  Files: server/src/agents/pm.ts
  - dispatchToolUses() after runClaude()
  - pass costUsd: result.costUsd to emitAgentCompleted()

Commit 12 — feat(agents/designer): add costUsd and dispatch tool uses
  Files: server/src/agents/designer.ts
  - same pattern as Commit 11

Commit 13 — feat(agents/tester): add costUsd and dispatch tool uses
  Files: server/src/agents/tester.ts
  - same pattern as Commit 11

Commit 14 — feat(agents/documenter): add costUsd and dispatch tool uses
  Files: server/src/agents/documenter.ts
  - same pattern as Commit 11

Commit 15 — feat(client): add OuroEvent type to types.ts
  Files: client/src/types.ts
  - export interface OuroEvent (id, project_id, cycle_id, event_type, agent_role,
    phase, payload, token_count, cost_usd, created_at)

Commit 16 — feat(client): add AgentEventRow and TokenCostBadge components
  Files: client/src/components/AgentEventRow.tsx
  - AgentEventRow: role chip, phase label, TokenCostBadge (conditional), relativeTime
  - TokenCostBadge: co-located unexported component, mono badge with tok/cost

Commit 17 — feat(client): add EventsSection collapsible to FeedPanel
  Files: client/src/components/FeedPanel/ (index.tsx or FeedPanel.tsx)
  - eventsOpen state (default false)
  - fetch GET /api/projects/:id/events on project change
  - collapsible section matching existing Run Status pattern
  - newest-first AgentEventRow list; empty state fallback
```

---

## Open Questions

1. **`@anthropic-ai/sdk` version** — Confirm Bun-compatible version: `bun add @anthropic-ai/sdk@latest` before Commit 1.

2. **`AGENT_TOOLS` placement** — Task prompt specifies `claude.ts`; design spec decision #10 says `base.ts`. Plan follows the task prompt (claude.ts). If both callers (agents) and the SDK transport (claude.ts) import from the same file, placing tools in `claude.ts` creates a circular-import risk if agents also import from `claude.ts`. Recommend confirming before Commit 3.

3. **Multi-turn tool loop** — SDK protocol expects a `tool_result` follow-up message after `tool_use` blocks before generating text. For MVP: dispatch tools silently from the first (and only) assistant turn and stop — no second API call. Flag as known limitation if tool-triggered text generation is needed.

4. **`designer.ts` and `tester.ts` step count** — Read at implementation time; plan assumes single-step (pm.ts pattern). If they have multi-step loops, apply developer.ts pattern instead.

5. **`blocks_cycle` loop-pause hook** — After `sendInboxMessage(..., 1)`, `loop.ts` needs to detect the blocking message and pause the cycle. Whether this wiring exists in `loop.ts` is not covered by this plan — may need a follow-up story.

6. **`ROLE_EMOJI` / `ROLE_COLOUR` maps** — `AgentEventRow` needs to import these from `FeedPanel` or a shared `utils.ts`. Confirm they are already exported or extract to a shared constant before Commit 16.
