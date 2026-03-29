# Design Specification — Cycle 9

**Scope:** US-01 (SDK migration), US-02 (token/cost fields in events), US-03 (AGENT_TOOLS registration)
**Theme:** Server-side only (US-01, US-02, US-03 are back-end); one new UI component pair (`AgentEventRow` + `TokenCostBadge`) surfaces US-02 data in `FeedPanel`.

---

## User Flows

### Flow 1 — US-01: SDK-backed Claude call (happy path)

1. Phase runner (e.g. `researcher.ts`) calls `runClaude({ systemPrompt, userPrompt, tools? })`.
2. `claude.ts` reads `ANTHROPIC_API_KEY` from `process.env`.
3. Key present → constructs `anthropic.messages.create()` call:
   - `model`: `"claude-sonnet-4-6"`
   - `max_tokens`: `opts.maxTokens ?? 4096`
   - `system`: `opts.systemPrompt`
   - `messages`: `[{ role: "user", content: opts.userPrompt }]`
   - `tools`: `opts.tools ?? []` (empty array when no tools passed)
   - Extended thinking header: `"anthropic-beta": "interleaved-thinking-2025-05-14"` always set so thinking blocks are captured if the model emits them.
4. API streams response; `claude.ts` collects all content blocks.
5. Maps content blocks to `ClaudeRunResult`:
   - `content`: concatenation of all `text`-type blocks
   - `thinkingBlocks`: array of `thinking`-type block objects `{ thinking: string }`
   - `toolUses`: array of `tool_use`-type block objects `{ id, name, input }`
   - `inputTokens`, `outputTokens`: from `response.usage`
   - `costUsd`: computed as `(inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15`
   - `real: true`
6. Returns `ClaudeRunResult` to caller.
7. Callers (`agents/*.ts`) are unchanged — they receive the same interface as before plus new optional fields.

### Flow 1b — US-01: SDK-backed Claude call (key absent / mock)

1. `ANTHROPIC_API_KEY` absent from env.
2. `claude.ts` logs `[claude] No API key — using mock output`.
3. Returns `{ content: mockOutput(...), real: false, inputTokens: 0, outputTokens: 0, costUsd: 0, thinkingBlocks: [], toolUses: [] }`.

### Flow 1c — US-01: SDK-backed Claude call (API error)

1. `anthropic.messages.create()` throws (network error, 4xx/5xx, timeout).
2. `claude.ts` catches, logs `[claude] SDK error: <message>`.
3. If `opts.timeoutMs` was set and elapsed, rethrows with `err.timeout = true` so loop can retry.
4. Otherwise returns mock fallback with `real: false`.

### Flow 2 — US-02: Token/cost persisted in events table

1. Agent runner calls `emitAgentCompleted(meta, result)` in `base.ts`.
2. `emitAgentCompleted` calls `insertEvent()` with `token_count` and `cost_usd` from `ClaudeRunResult`.
3. `insertEvent()` writes row: `token_count = inputTokens + outputTokens`, `cost_usd = costUsd`.
4. `GET /api/projects/:id/events` returns rows; each `agent_completed` row has non-zero `token_count` and `cost_usd`.
5. `FeedPanel` receives events (via WS push or REST poll); `AgentEventRow` renders `TokenCostBadge` for rows where both values are non-zero.

### Flow 3 — US-03: Tool call dispatched by agent runner

1. Agent runner calls `runClaude({ systemPrompt, userPrompt, tools: AGENT_TOOLS })`.
2. `claude.ts` includes `tools` array in `anthropic.messages.create()`.
3. Model emits a `tool_use` block with `name` ∈ `{ "save_artifact", "post_feed_message", "request_human_input" }`.
4. `runClaude()` returns `toolUses: [{ id, name, input }]`.
5. Agent runner iterates `result.toolUses` and dispatches:
   - `save_artifact` → calls `saveArtifact(projectId, phase, filename, content, cycleId)`
   - `post_feed_message` → calls `postFeedMessage(projectId, role, recipient, content, messageType)`
   - `request_human_input` → calls `sendInboxMessage(projectId, role, subject, body)` + emits `human_input_requested` event
6. If `toolUses` is empty and `result.content` is non-empty, agent runner falls back to legacy freeform save (guarded by self-mod gate for `/server/src/` paths).

---

## Component Tree

The only new UI components are `AgentEventRow` and `TokenCostBadge`. They live alongside `FeedPanel` but are used in a new "Events" sub-section (or can be appended below the feed — see Layout section).

```
FeedPanel (existing)
├── header strip
├── message list
│   └── FeedMessageRow (existing, unchanged)
├── CycleTimeline (existing, unchanged)
└── EventsSection (NEW — collapsible, below run-status section)
    └── AgentEventRow (NEW) × N
        └── TokenCostBadge (NEW, conditional)
```

Client component file locations:
- `client/src/components/AgentEventRow.tsx` — new file
- `TokenCostBadge` — co-located in `AgentEventRow.tsx` (not a separate file; only used here)

Type additions:
- `client/src/types.ts` — add `OuroEvent` interface

---

## Layout & Responsive Behaviour

### EventsSection inside FeedPanel

Position: below "Run Status" collapsible in `FeedPanel`, at the bottom of the left-center column. Matches the collapsible style of the existing "Cycle History" and "Run Status" sections.

```
┌─────────────────────────────────────────────────────┐
│ Feed                                    (header)     │
├─────────────────────────────────────────────────────┤
│ [feed messages scroll area]                         │
│                                                     │
├─────────────────────────────────────────────────────┤
│ ▶ Cycle History  (2)                    (toggle)    │
├─────────────────────────────────────────────────────┤
│ ▶ Run Status  (3)                       (toggle)    │
├─────────────────────────────────────────────────────┤
│ ▶ Agent Events  (12)                    (toggle)    │  ← NEW
│   ┌─────────────────────────────────────────────┐  │
│   │ researcher  ·  research  ·  2m ago          │  │
│   │              1,234 tok · $0.0012            │  │
│   ├─────────────────────────────────────────────┤  │
│   │ developer   ·  build     ·  5m ago          │  │
│   │              8,900 tok · $0.0340            │  │
│   └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

- Section header: same style as "Run Status" — `px-4 py-2.5`, `text-xs font-semibold text-gray-500 uppercase tracking-wider`, chevron toggle.
- Event list: `max-h-64 overflow-y-auto` when expanded.
- `AgentEventRow` height: `py-2 px-3`, single line with badge inline.
- No horizontal scroll — all content wraps or truncates.
- Responsive: the panel already takes `flex-1` width; no special breakpoints needed.

### TokenCostBadge placement

Inline after the phase label, on the same row. Does not wrap to a second line.

```
researcher  ·  research  ·  [1,234 tok · $0.0012]  ·  2m ago
```

---

## Component Specs

### AgentEventRow

**File:** `client/src/components/AgentEventRow.tsx`

**Props:**
```ts
interface AgentEventRowProps {
  event: OuroEvent; // see types.ts addition below
}
```

**Appearance:**
- Container: `flex items-center gap-3 px-3 py-2 border-b border-gray-800 text-sm`
- Agent role chip: `text-xs font-medium text-gray-100` — same role colour mapping as `FeedPanel` (`ROLE_COLOUR`)
- Separator dot: `text-gray-700 select-none` — `·`
- Phase label: `text-xs text-gray-500`
- `TokenCostBadge`: rendered inline after phase label when both values present
- Timestamp: `text-xs text-gray-600 ml-auto` — relative (`relativeTime()` from `utils.ts`)

**Rendered markup structure:**
```tsx
<div className="flex items-center gap-3 px-3 py-2 border-b border-gray-800 text-sm">
  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${ROLE_COLOUR[event.agent_role]}`}>
    {ROLE_EMOJI[event.agent_role]} {event.agent_role}
  </span>
  <span className="text-gray-700">·</span>
  <span className="text-xs text-gray-500">{event.phase ?? event.event_type}</span>
  {hasCost && <TokenCostBadge tokenCount={event.token_count} costUsd={event.cost_usd} />}
  <span className="text-xs text-gray-600 ml-auto">{relativeTime(event.created_at)}</span>
</div>
```

**States:**

| State | Description | Visual |
|---|---|---|
| `default` | `token_count > 0` and `cost_usd > 0` | Badge shown |
| `no-cost` | Either value is `null`, `0`, or `undefined` | Badge hidden; layout unchanged |
| `non-agent event` | `event_type` ≠ `agent_completed` | Badge always hidden |

**Interactions:** none — read-only display row.

**Data shape (`OuroEvent` to add to `types.ts`):**
```ts
export interface OuroEvent {
  id: string;
  project_id: string;
  cycle_id: string | null;
  event_type: string;
  agent_role: string | null;
  phase: string | null;       // extracted from payload.phase if present
  payload: Record<string, unknown>;
  token_count: number;
  cost_usd: number;
  created_at: number;
}
```

Note: `phase` is not a top-level column in the DB — extract from `payload.phase` when mapping API response to `OuroEvent` on the client.

---

### TokenCostBadge

**Co-located in:** `client/src/components/AgentEventRow.tsx` (unexported, used only by `AgentEventRow`)

**Props:**
```ts
interface TokenCostBadgeProps {
  tokenCount: number;
  costUsd: number;
}
```

**Appearance:**
- `inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 text-xs font-mono`
- Text format: `{tokenCount.toLocaleString()} tok · $${costUsd.toFixed(4)}`
- Example: `1,234 tok · $0.0012`

**States:**

| State | Condition | Behaviour |
|---|---|---|
| `visible` | `tokenCount > 0 && costUsd > 0` | Rendered by parent |
| `hidden` | Either value ≤ 0 or absent | Parent does not render component |

No internal empty state — parent is fully responsible for conditional rendering. `TokenCostBadge` always renders visibly when mounted.

**Interactions:** none.

---

### EventsSection (wrapper inside FeedPanel)

No new component file — implemented inline in `FeedPanel.tsx` alongside the existing "Run Status" section. Follows the exact same collapsible pattern.

**State:** `const [eventsOpen, setEventsOpen] = useState(false)` — collapsed by default.

**Header:**
```tsx
<button onClick={() => setEventsOpen(v => !v)}
  className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-gray-900 transition-colors text-left">
  <span className="text-xs text-gray-600" style={{ transform: eventsOpen ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent Events</span>
  {events.length > 0 && <span className="text-xs text-gray-600 ml-1">({events.length})</span>}
</button>
```

**Body (when open):**
```tsx
<div className="max-h-64 overflow-y-auto border-t border-gray-800/60">
  {events.length === 0
    ? <div className="px-4 py-3 text-xs text-gray-600">No events yet.</div>
    : [...events].reverse().map(e => <AgentEventRow key={e.id} event={e} />)
  }
</div>
```

Events are shown newest-first (reversed).

---

## Server-Side Interface Changes

These are not UI components but must be specified precisely for the developer.

### `ClaudeRunResult` (updated interface in `claude.ts`)

```ts
export interface ClaudeRunResult {
  content: string;
  real: boolean;
  inputTokens: number;   // 0 for mock
  outputTokens: number;  // 0 for mock
  costUsd: number;       // 0 for mock; computed = (in/1M)*3 + (out/1M)*15
  thinkingBlocks: Array<{ thinking: string }>;  // [] when none / mock
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;  // [] when none / mock
}
```

All fields non-optional. No `?` — callers must not need to null-check.

### `runClaude()` signature (updated)

```ts
export async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult>
```

`ClaudeRunOptions` adds one optional field:

```ts
export interface ClaudeRunOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;     // default 4096
  timeoutMs?: number;
  tools?: AnthropicTool[]; // pass AGENT_TOOLS here (US-03)
}
```

`AnthropicTool` is the SDK's `Anthropic.Tool` type — import from `"@anthropic-ai/sdk"`.

### `AGENT_TOOLS` constant (new, in `agents/base.ts`)

```ts
export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "save_artifact",
    description: "Save the agent's primary output artifact for this phase.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Artifact filename, e.g. research.md" },
        content: { type: "string", description: "Full markdown content to save." },
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
        recipient: { type: "string" },
        content: { type: "string" },
        message_type: {
          type: "string",
          enum: ["handoff", "question", "decision", "note", "escalate"],
        },
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
        body: { type: "string" },
      },
      required: ["subject", "body"],
    },
  },
];
```

### `insertEvent()` signature (updated in `db.ts`)

```ts
export interface InsertEventParams {
  projectId: string;
  cycleId?: string;
  type: EventType;
  agentRole?: string;
  payload: Record<string, unknown>;
  tokenCount?: number;   // NEW — written to token_count column; defaults to 0
  costUsd?: number;      // NEW — written to cost_usd column; defaults to 0
}
```

### `emitAgentCompleted()` (updated signature in `base.ts`)

```ts
export function emitAgentCompleted(
  meta: AgentEventMeta,
  result: Pick<ClaudeRunResult, "inputTokens" | "outputTokens" | "costUsd">
): void {
  insertEvent({
    projectId: meta.projectId,
    cycleId: meta.cycleId,
    type: "agent_completed",
    agentRole: meta.agentRole,
    payload: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    tokenCount: result.inputTokens + result.outputTokens,
    costUsd: result.costUsd,
  });
}
```

### `GET /api/projects/:id/events` (new endpoint in `index.ts`)

```
GET /api/projects/:id/events
→ 200 { events: OuroEventRow[] }
→ 404 { error: "Project not found" }
```

`OuroEventRow`:
```ts
{
  id: string;
  project_id: string;
  cycle_id: string | null;
  event_type: string;
  agent_role: string | null;
  payload: Record<string, unknown>;  // parsed JSON
  token_count: number;
  cost_usd: number;
  created_at: number;
}
```

Query supports optional `?cycleId=<id>` filter. Without it, returns all events for the project, newest-first, limit 200.

---

## Edge Cases & Empty States

1. **`ANTHROPIC_API_KEY` set but invalid (401):** SDK throws `AuthenticationError`. `claude.ts` catches, logs `[claude] Authentication error — check ANTHROPIC_API_KEY`, returns mock with `real: false`. Does not propagate; loop continues.

2. **API rate limit (429):** SDK throws `RateLimitError`. `claude.ts` catches and rethrows (not caught by mock fallback) so the caller's `MAX_RETRIES` logic fires. Error message includes `429` so loop can log it distinctly.

3. **`tools` array passed but model returns no `tool_use` block:** `result.toolUses` is `[]`. Agent runner falls through to legacy freeform text path. Self-mod gate must be checked before any freeform save to `/server/src/`.

4. **Model emits an unknown tool name:** Agent runner logs `[agent] Unknown tool: <name>` and skips the dispatch. Does not throw — remaining tool uses in the array are still processed.

5. **`token_count` and `cost_usd` both 0 in events row (mock run):** `TokenCostBadge` is not rendered — parent checks `event.token_count > 0 && event.cost_usd > 0` before mounting.

6. **`cost_usd` is non-zero but `token_count` is 0 (impossible in normal flow but possible via manual DB write):** Badge is hidden — both fields must be non-zero to render.

7. **Events endpoint returns empty array (new project, no cycles run):** `EventsSection` shows `"No events yet."` empty state in `text-xs text-gray-600 px-4 py-3`.

8. **Events endpoint unavailable (fetch error):** `FeedPanel` receives `events={[]}` — `EventsSection` shows empty state. No error banner; events are informational, not critical.

9. **Very large token count (e.g. 120,000):** `toLocaleString()` renders `120,000` — badge width grows but layout stays on one line because `ml-auto` on the timestamp absorbs the difference. No truncation needed.

10. **`costUsd` is very small (< 0.0001):** `.toFixed(4)` shows `$0.0000`. This is acceptable — 4 decimal places is the minimum useful precision for individual agent runs.

11. **`agent_role` is null on an event row (phase-level events like `phase_started`):** `AgentEventRow` skips the role chip, shows `text-gray-600 italic` "(system)" instead. Badge is never shown for non-agent events regardless of token values.

12. **Extended thinking header rejected (unsupported model variant):** SDK throws `BadRequestError`. `claude.ts` catches, retries once without the beta header, logs warning. If second attempt also fails, falls back to mock.

13. **`timeoutMs` fires mid-stream:** Promise.race rejects with `err.timeout = true`. `claude.ts` does not catch this — rethrows so loop's retry logic handles it. Partial content from stream is discarded.

---

## Design Decisions

1. **`TokenCostBadge` is not a standalone exported component.** It is only meaningful adjacent to agent event rows. Co-locating avoids creating a `TokenCostBadge/index.ts` for a three-line component. If a second consumer appears, extract then.

2. **`costUsd` is computed in `claude.ts`, not in `db.ts` or agents.** Keeps pricing logic in one place. If pricing changes, only `claude.ts` changes. Pricing: `$3/MTok` input, `$15/MTok` output (claude-sonnet-4-6, per CLAUDE.md).

3. **`token_count` stored as `inputTokens + outputTokens`, not separately.** The events table has a single `token_count` column. Detail (input vs output split) is preserved in `payload` JSON for consumers that need it. No schema change required.

4. **`thinkingBlocks` returned but not persisted in events.** Thinking output is ephemeral — too large for the events table. Agent runners may log it or include a summary in `payload`. Not surfaced in the UI in this cycle.

5. **Extended thinking beta header is always set.** If the model doesn't emit thinking blocks, the response is unchanged. The alternative (conditional header) adds complexity for no benefit.

6. **`GET /api/projects/:id/events` is a new endpoint, not a WebSocket push.** Events are append-only and low-volume. REST polling on section expand is sufficient. If live updates become needed, a `ws_event` push can be added later without schema changes.

7. **`EventsSection` is collapsed by default.** Events are secondary information (operator diagnostics), not primary activity. Collapsed default keeps the UI uncluttered for normal use.

8. **Mock fallback returns all numeric fields as `0`, not `undefined`.** This simplifies callers — no null checks needed. The `real: false` flag already signals mock output.

9. **Self-mod gate is checked in the agent runner, not in `claude.ts`.** `claude.ts` is transport-layer only. It does not know what paths a tool call might touch. Each agent runner remains responsible for gating its own write operations.

10. **`AGENT_TOOLS` lives in `base.ts`, not a separate file.** All three tools are always available to all agents — there is no per-agent tool filtering in this cycle. If per-agent tool scoping is needed in a future cycle, move to a `tools.ts` module then.
