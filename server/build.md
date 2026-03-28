# Implementation Plan — Ouro Platform Cycle 3

*Prepared by: Developer agent | Date: 2026-03-28*

> **Carry-forward note:** 16-commit Cycle 2 plan carried forward with targeted corrections for all 7 plan-review failures. Three corrections affect file contents: adaptive thinking (no beta header, Commit 2), `react-diff-view` replaces `git-diff-view` (Commit 11), `AGENT_TOOLS` registration moved to Commit 2. Four corrections add explicit acceptance criteria within existing commits (GH#1 → Commit 3, GH#4 → Commit 6, GH#5 → Commit 7, GH#6 → Commit 8). Story 16 (IntentGate Extension to Blocker Resolution) is implemented in **Commit 17** — additive, no existing commits reordered. All 6 open questions from Cycle 2 build.md are now closed.

---

## Pre-Implementation State

The following are **already implemented** and must not be re-implemented:

| Item | Location | Status |
|---|---|---|
| `extractIntent()` | `server/src/intent.ts` | Implemented (commit `14e5621`) |
| `inbox_messages.reply_intent_json` column | `server/src/db.ts` | In schema |
| IntentGate in inbox reply handler | `server/src/index.ts` | Implemented |
| Ralph Loop test retry (up to 3×) | `server/src/loop.ts` | Implemented |
| Todo Enforcer timeout watchdog | `server/src/loop.ts` | Implemented |
| 6 agent files | `server/src/agents/*.ts` | Implemented (stubs) |
| WS broadcast: `connected`, `subscribed`, `feed_message`, `inbox_message`, `agent_status`, `phase_change`, `cycle_update` | `server/src/index.ts` | Implemented |
| `agents` table columns `current_task`, `last_action_at` | `server/src/db.ts` | In schema |

The following open questions from Cycle 2 build.md are **closed**:

| # | Resolution |
|---|---|
| 1 (`diff` package) | Use `diff` npm package (`bun add diff`). `diff.createPatch(filename, old, new)` in Commit 1. |
| 2 (`applyUnifiedDiff`) | Store full replacement content in `diff_content` — apply by writing directly. No patch needed. |
| 3 (thinking blocks) | Adaptive thinking: pass `thinking: { type: 'enabled', budget_tokens: 8000 }` — **no beta header**. |
| 4 (`design-draft` split) | No new prompt files — abbreviated context injection in `loop.ts`. |
| 5 (inbox reply coupling) | Acceptable for MVP — `is_read = 1` query. Commit 17 hardens this with typed intent. |
| 6 (`git-diff-view` compat) | Replaced with `react-diff-view` (confirmed ESM via `react-diff-view/esm`). |

---

## File Structure

```
server/src/
├── db.ts                         ← MODIFY: 5 schema changes + new helpers
├── loop.ts                       ← MODIFY: retry, budget, phase DAG, crash recovery, typed blocker resolution
├── index.ts                      ← MODIFY: 6 new endpoints, WS snapshot, new broadcast types
├── claude.ts                     ← MODIFY: return token counts + thinking blocks; register AGENT_TOOLS
├── intent.ts                     ← MODIFY: extend for blocker-specific intent shapes (Story 16)
└── agents/
    ├── base.ts                   ← MODIFY: AGENT_TOOLS definition, checkSelfModGate, dispatchToolUse
    ├── researcher.ts             ← MODIFY: accept cycleId, log events, guard saveArtifact
    ├── pm.ts                     ← MODIFY: accept cycleId, log events, guard saveArtifact
    ├── designer.ts               ← MODIFY: accept cycleId, log events, guard saveArtifact; export runDesignerDraft
    ├── developer.ts              ← MODIFY: accept cycleId, log events, guard saveArtifact
    ├── tester.ts                 ← MODIFY: accept cycleId, log events, guard saveArtifact
    └── documenter.ts             ← MODIFY: accept cycleId, log events, guard saveArtifact

client/src/
├── types.ts                      ← MODIFY: 9 new interfaces, extend 5 existing
├── api.ts                        ← MODIFY: 6 new endpoint helpers
├── App.tsx                       ← MODIFY: new state slices, blocker queue, snapshot handler
└── components/
    ├── TopBar.tsx                 ← UNMODIFIED
    ├── AgentPanel.tsx             → DELETE (replaced by AgentRail/)
    ├── FeedPanel.tsx              ← MODIFY: add FeedToolCallBlock; operates as CenterPanel child
    ├── InboxPanel.tsx             ← MODIFY: resolved blocker visual state; rendered inside RightPanel
    ├── CycleProgressBar/
    │   ├── index.ts               NEW (re-export)
    │   └── CycleProgressBar.tsx   NEW
    ├── AgentRail/
    │   ├── index.ts               NEW (re-export)
    │   ├── AgentRail.tsx          NEW
    │   ├── AgentCard.tsx          NEW
    │   └── ThoughtLogPanel.tsx    NEW
    ├── CenterPanel/
    │   ├── index.ts               NEW (re-export)
    │   ├── CenterPanel.tsx        NEW (tabs wrapper)
    │   ├── ArtifactView.tsx       NEW
    │   ├── ArtifactDiffView.tsx   NEW (react-diff-view — not git-diff-view)
    │   └── ArtifactToolbar.tsx    NEW
    ├── RightPanel/
    │   ├── index.ts               NEW (re-export)
    │   ├── RightPanel.tsx         NEW (tabs wrapper)
    │   └── SettingsView.tsx       NEW
    ├── BlockerModal/
    │   ├── index.ts               NEW (re-export)
    │   └── BlockerModal.tsx       NEW (sub-type-aware placeholders, IntentGate helper text)
    └── Banners/
        ├── index.ts               NEW (re-export)
        ├── PinnedBlockerBanner.tsx NEW
        └── ReconnectBanner.tsx    NEW
```

**Package installs required:**
```bash
# server workspace
bun add diff                # Commit 1 — unified diff computation
bun add @types/diff --dev  # types for diff package

# client workspace
bun add react-diff-view     # Commit 11 — diff viewer (NOT git-diff-view)
```

---

## Data Shapes

### Server — new / extended DB types (`server/src/db.ts`)

```typescript
// ── events table (new) ────────────────────────────────────────────────────────

interface AgentEvent {
  id: string;
  cycle_id: string;
  project_id: string;
  agent_role: string;
  event_type:
    | 'phase_started'
    | 'phase_completed'
    | 'phase_failed'
    | 'tool_call'
    | 'artifact_saved'
    | 'thinking'
    | 'human_input_requested'   // GH#1: must have explicit logEvent() call site
    | 'human_input_received'    // GH#1: must have explicit logEvent() call site
    | 'budget_exceeded'
    | 'error';                  // GH#1: must have explicit logEvent() call site
  payload: string;              // JSON-stringified; shape varies by event_type
  token_count: number;
  cost_usd: number;
  created_at: number;
}

// Payload shapes by event_type:
interface ToolCallPayload    { tool_name: string; input: unknown; output?: unknown }
interface ThinkingPayload    { summary: string; full_text: string }
interface PhaseFailPayload   { error: string; attempt: number; max_attempts: number }
interface ArtifactPayload    { artifact_id: string; phase: string; filename: string }
interface HumanInputPayload  { subject: string; body: string; inbox_message_id?: string }
interface BudgetPayload      { spend_today_usd: number; budget_usd: number; phase: string }
interface ErrorPayload       { message: string; phase?: string; stack?: string }

// ── proposed_changes table (new) ─────────────────────────────────────────────

interface ProposedChange {
  id: string;
  cycle_id: string;
  project_id: string;
  proposed_by: string;   // agent_role
  file_path: string;
  diff_content: string;  // FULL replacement file content (not a patch) — applied by writing directly
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewed_at: number | null;
  created_at: number;
}

// ── Extended existing types ───────────────────────────────────────────────────

interface Artifact {
  id: string;
  project_id: string;
  phase: string;
  filename: string;
  content: string;
  version: number;
  cycle_id: string | null;              // NEW column (ALTER TABLE)
  previous_version_id: string | null;   // NEW column (ALTER TABLE)
  diff_from_previous: string | null;    // NEW column — unified diff string, '' if identical
  created_at: number;
}

interface InboxMessage {
  id: string;
  project_id: string;
  sender_role: string;
  subject: string;
  body: string;
  is_read: number;
  blocks_cycle: number;          // NEW column (ALTER TABLE) — 0 | 1
  replied_at: number | null;
  reply_body: string | null;
  reply_intent_json: string | null;  // ALREADY EXISTS (commit 14e5621) — typed blocker intent
  created_at: number;
}

interface CycleRun {
  id: string;
  project_id: string;
  status: 'running' | 'complete' | 'stopped' | 'error';
  started_at: number;
  ended_at: number | null;
  phase_outcomes: PhaseOutcome[];
  last_completed_phase: string | null;             // NEW column (ALTER TABLE)
  phase_states: Record<string, PhaseStateRecord>; // NEW column, stored as TEXT JSON
}

interface PhaseStateRecord {
  status: 'complete' | 'error' | 'skipped';
  artifact_id?: string;
  ended_at: number;
}
```

### Server — Story 16 types (`server/src/intent.ts` additions)

```typescript
// Blocker-specific intent shapes — NEW for Cycle 3 (Story 16):
// These extend extractIntent() for blocks_cycle=1 message replies.

interface BudgetBlockerIntent {
  action: 'approve' | 'adjust_budget' | 'stop_cycle';
  newBudget?: number;  // only when action === 'adjust_budget'
}

interface PhaseEscalationIntent {
  action: 'retry' | 'stop_cycle' | 'skip_phase';
}

// Typed return value from waitForBlockerResolution():
type BlockerResolution =
  | { outcome: 'stop_cycle' }
  | { outcome: 'continue' }
  | { outcome: 'adjust_budget'; newBudget: number }
  | { outcome: 'retry_phase' }
  | { outcome: 'skip_phase' }
  | { outcome: 'approved' }    // proposed_changes approval
  | { outcome: 'rejected' };   // proposed_changes rejection
```

### Client — new types (`client/src/types.ts`)

```typescript
interface AgentEvent {
  id: string;
  cycle_id: string;
  project_id: string;
  agent_role: string;
  event_type: string;
  payload: unknown;
  token_count: number;
  cost_usd: number;
  created_at: number;
}

interface ThoughtEntry {
  id: string;
  summary: string;
  full_text: string;
  created_at: number;
}

interface PhaseState {
  status: 'pending' | 'active' | 'complete' | 'failed' | 'skipped' | 'retrying';
  retry_count?: number;
}

interface PhaseMeta {
  elapsed_ms: number;
  token_count: number;
  cost_usd: number;
  artifact_id: string | null;
}

interface BlockerMessage extends InboxMessage {
  blocks_cycle: 1;
  blocker_sub_type?: 'budget_warning' | 'phase_escalated' | 'human_input'; // Story 16
  proposed_diff?: string;        // set when linked to a ProposedChange
  spend_summary?: SpendSummary;  // set for budget_exceeded type
}

interface SpendSummary {
  spend_today_usd: number;
  budget_usd: number;
  phases: Array<{ phase: string; cost_usd: number; token_count: number }>;
}

interface ProposedChange {
  id: string;
  cycle_id: string;
  project_id: string;
  proposed_by: string;
  file_path: string;
  diff_content: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewed_at: number | null;
  created_at: number;
}

type BannerType = 'budget_warning' | 'phase_retry' | 'sse_reconnecting';

interface Banner {
  id: string;
  type: BannerType;
  message: string;
  dismissible: boolean;
}

interface SnapshotPayload {
  feed: FeedMessage[];
  inbox: InboxMessage[];
  agents: Agent[];
  cycles: CycleRun[];
  artifacts: Artifact[];
  activeCycle: CycleRun | null;
  phaseStates: Record<string, PhaseState>;
  phaseMeta: Record<string, PhaseMeta>;
}

// Extensions to existing types (in the same types.ts file):

// Agent: add (GH#6 fix — fields exist in DB, must be present in client type):
//   last_action_at: number | null      — ALREADY IN DB; ensure server sends it in WS events
//   current_task: string | null        — ALREADY IN DB; ensure server sends it in WS events
//   last_phase_token_count: number     — NEW; derived from events table aggregate, not a DB column

// Artifact: add cycle_id, previous_version_id, diff_from_previous (as above)
// InboxMessage: add blocks_cycle: number; reply_intent_json: string | null
// CycleRun: add last_completed_phase, phase_states (as above)
// WsEvent: extend union with agent_event, phase_meta, blocker,
//          proposed_change_resolved, snapshot, inbox_reply types
```

---

## Key Functions

### `server/src/db.ts` — additions and modifications

```typescript
// ── events table ──────────────────────────────────────────────────────────────

function logEvent(params: {
  cycleId: string;
  projectId: string;
  agentRole: string;
  eventType: AgentEvent['event_type'];
  payload: unknown;
  tokenCount?: number;   // default 0
  costUsd?: number;      // default 0
}): AgentEvent
// INSERT into events (append-only — no UPDATE/DELETE paths for this table).
// Payload is JSON.stringify'd before INSERT.
// Returns inserted row.

// CRITICAL (GH#1): logEvent must be called at these specific sites:
//   event_type='human_input_requested' → in loop.ts, when createBlockingInboxMessage() is called
//   event_type='human_input_received'  → in index.ts inbox reply handler, after is_read set
//   event_type='error'                 → in agents/*.ts catch blocks; in loop.ts catch blocks

function listEvents(projectId: string, opts?: {
  cycleId?: string;
  agentRole?: string;
  eventType?: string;
  limit?: number;   // default 100
  offset?: number;  // default 0
}): { data: AgentEvent[]; total: number }
// SELECT with optional filters. ORDER BY created_at ASC. Returns paginated result.

function sumCycleCost(cycleId: string): { token_count: number; cost_usd: number }
// SELECT SUM(token_count), SUM(cost_usd) FROM events WHERE cycle_id = ?

function sumTodayCost(projectId: string): number
// SELECT SUM(cost_usd) FROM events
// WHERE project_id = ? AND created_at >= floor(Date.now()/86400000)*86400000

// ── proposed_changes table ────────────────────────────────────────────────────

function createProposedChange(params: {
  cycleId: string;
  projectId: string;
  proposedBy: string;
  filePath: string;
  diffContent: string;  // full replacement content, not a patch
}): ProposedChange
// INSERT with status = 'PENDING'

function getProposedChange(id: string): ProposedChange | null

function listProposedChanges(projectId: string, status?: string): ProposedChange[]

function updateProposedChangeStatus(
  id: string,
  status: 'APPROVED' | 'REJECTED'
): ProposedChange
// UPDATE status, reviewed_at = Date.now()

// ── artifacts helpers (modified) ──────────────────────────────────────────────

function saveArtifact(params: {
  projectId: string;
  phase: string;
  filename: string;
  content: string;
  cycleId?: string;   // NEW parameter
}): Artifact
// 1. Look up prior: getArtifactByPhase(projectId, phase) — latest version
// 2. If prior: compute diff using diff.createPatch(filename, prior.content, content)
//    store previous_version_id = prior.id, diff_from_previous = diff string
//    Empty diff (identical) stored as '' not NULL
// 3. INSERT row with cycle_id, lineage fields
// 4. Return inserted Artifact

function getArtifactByPhase(
  projectId: string,
  phase: string,
  cycleId?: string   // if provided, filter to that cycle; otherwise latest
): Artifact | null

function computeUnifiedDiff(
  filename: string,
  oldText: string,
  newText: string
): string
// Uses diff.createPatch(filename, oldText, newText) from 'diff' npm package.
// Returns '' when content is identical.
// Pure function; no side effects.

// ── inbox helpers ─────────────────────────────────────────────────────────────

function createBlockingInboxMessage(params: {
  projectId: string;
  senderRole: string;
  subject: string;
  body: string;
}): InboxMessage
// INSERT with blocks_cycle = 1, is_read = 0

function listBlockingMessages(projectId: string): InboxMessage[]
// SELECT WHERE project_id = ? AND blocks_cycle = 1 AND is_read = 0
// ORDER BY created_at ASC

// ── preferences helpers ───────────────────────────────────────────────────────

function getPreference(projectId: string, key: string): string | null
// Already exists — no change needed

function setPreference(projectId: string, key: string, value: string): void
// Already exists — no change needed

function getBudgetUsd(projectId: string): number
// getPreference(projectId, 'token_budget_daily_usd') → parseFloat or default 10.00

// ── cycles helpers (extended) ─────────────────────────────────────────────────

function updateCyclePhaseState(
  cycleId: string,
  phase: string,
  state: PhaseStateRecord
): void
// Read phase_states JSON TEXT column, merge new entry, write back.
// Also sets last_completed_phase = phase when state.status === 'complete'.
```

### `server/src/claude.ts` — modifications

```typescript
interface ClaudeResult {
  content: string;           // text content (unchanged field for existing callers)
  token_count: number;       // input_tokens + output_tokens from usage
  cost_usd: number;          // ($3 * input_MTok) + ($15 * output_MTok)
  thinking_blocks: Array<{ summary: string; full_text: string }>;
  tool_uses: Array<{ tool_name: string; input: unknown }>;
}

// runClaude() signature changes:
async function runClaude(options: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  tools?: AnthropicTool[];    // NEW — accepts AGENT_TOOLS array
  thinking?: { type: 'enabled'; budget_tokens: number };  // NEW — NO beta header
  tool_choice?: { type: 'auto' } | { type: 'none' };     // NEW — never 'tool' when thinking enabled
}): Promise<ClaudeResult>

// Changes from Cycle 2:
// 1. Pass thinking: { type: 'enabled', budget_tokens: 8000 } in request body — NO betas header
//    (betas: ['interleaved-thinking-2025-05-14'] is deprecated; do not use)
// 2. Pass tools parameter to Claude API when options.tools provided
// 3. Extract usage.input_tokens / output_tokens from API response
// 4. Compute cost_usd at claude-sonnet-4-6 rates ($3/MTok input, $15/MTok output)
// 5. Extract thinking-type content blocks → thinking_blocks[]
// 6. Extract tool_use content blocks → tool_uses[]
// 7. Return type changes from string → ClaudeResult
// All existing callers receive result.content — non-breaking if they destructure correctly.
```

### `server/src/agents/base.ts` — modifications

```typescript
// ── Tool definitions (GH#7 fix — registered here, passed to every runClaude() call) ──

const AGENT_TOOLS: AnthropicTool[] = [
  {
    name: 'save_artifact',
    description: 'Save an artifact file for the current phase.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Filename, e.g. spec.md' },
        content:  { type: 'string', description: 'Full file content' },
        phase:    { type: 'string', description: 'Phase name, e.g. spec' }
      },
      required: ['filename', 'content', 'phase']
    }
  },
  {
    name: 'post_feed_message',
    description: 'Post a message to the project feed.',
    input_schema: {
      type: 'object',
      properties: {
        message:   { type: 'string' },
        recipient: { type: 'string', description: 'Role name or "all"' },
        type:      { type: 'string', enum: ['handoff','question','decision','note','escalate'] }
      },
      required: ['message', 'recipient']
    }
  },
  {
    name: 'request_human_input',
    description: 'Block the cycle and request input from Chris.',
    input_schema: {
      type: 'object',
      properties: {
        subject:      { type: 'string' },
        body:         { type: 'string' },
        blocks_cycle: { type: 'boolean', default: true }
      },
      required: ['subject', 'body']
    }
  }
];

// ── Self-mod gate (GH#4 fix) ──────────────────────────────────────────────────

const SELF_MOD_PATHS = ['/server/src/'] as const;
// Hard-coded. Not in DB. Never agent-writable.

function checkSelfModGate(filePath: string): boolean
// Returns true if filePath starts with any entry in SELF_MOD_PATHS.

// ── Tool dispatch ─────────────────────────────────────────────────────────────

async function dispatchToolUse(
  tool: { tool_name: string; input: unknown },
  context: { projectId: string; cycleId: string; agentRole: string }
): Promise<unknown>
// Dispatches tool calls from ClaudeResult.tool_uses:
//   'save_artifact':
//     if checkSelfModGate(input.filename): createProposedChange() + createBlockingInboxMessage()
//     else: db.saveArtifact()
//   'post_feed_message': db.postFeedMessage()
//   'request_human_input': db.createBlockingInboxMessage()
//                          + logEvent('human_input_requested', payload)  ← GH#1 call site
// All results logged as 'tool_call' event via logEvent().
// Broadcasts WS 'agent_event' after logEvent().
// Returns result (artifact row, message row, etc.) or null for human_input.

// FREEFORM FALLBACK (GH#4 fix):
// When dispatchToolUse receives a text-only ClaudeResult (no tool_uses):
//   - Accept as graceful degradation and log content as a feed message
//   - Do NOT call db.saveArtifact() directly on freeform text
//   - Do NOT bypass the self-mod gate
// Every agent runner that previously called db.saveArtifact() directly must
// now call checkSelfModGate() first — see per-agent modification notes below.

// ── Per-agent direct saveArtifact guard (GH#4) ───────────────────────────────
// In researcher.ts, pm.ts, designer.ts, developer.ts, tester.ts, documenter.ts:
// Any direct db.saveArtifact() call for paths not in SELF_MOD_PATHS is permitted.
// Any call that could target SELF_MOD_PATHS must go through dispatchToolUse().
// Pattern for every agent runner:
//   if (checkSelfModGate(targetPath)) {
//     await dispatchToolUse({ tool_name: 'save_artifact', input: {...} }, context);
//   } else {
//     db.saveArtifact({ ... });
//   }
```

### `server/src/loop.ts` — modifications

```typescript
const MAX_RETRIES = 3;

async function runPhaseWithRetry(
  phase: string,
  runner: () => Promise<AgentRunResult>,
  context: { projectId: string; cycleId: string }
): Promise<'complete' | 'failed' | 'stopped'>
// Attempts runner() up to MAX_RETRIES times.
// On each failure:
//   logEvent('phase_failed', { error, attempt, max_attempts })
//   broadcast 'phase_meta' with retry_count
// After MAX_RETRIES failures:
//   createBlockingInboxMessage({ subject: 'Phase escalated: {phase}', ... })
//   broadcast 'blocker'
//   const res = await waitForBlockerResolution(projectId, msgId)
//   if res.outcome === 'stop_cycle': return 'stopped'
//   if res.outcome === 'retry_phase': attempt runner() one more time, return result
//   if res.outcome === 'skip_phase': return 'failed' (caller skips the phase)
// On stop signal: return 'stopped' early.

async function checkBudgetGate(
  projectId: string,
  cycleId: string,
  phase: string
): Promise<'ok' | 'warning' | 'exceeded'>
// sumTodayCost(projectId) vs getBudgetUsd(projectId)
// >80%:  broadcast 'phase_meta' with budget_warning flag; return 'warning' (cycle continues)
// >=100%: logEvent('budget_exceeded', BudgetPayload)
//          createBlockingInboxMessage({ subject: 'Budget exceeded' })
//          broadcast 'blocker' with spend_summary
//          const res = await waitForBlockerResolution(projectId, msgId)
//          if res.outcome === 'adjust_budget': setPreference(budgetKey, res.newBudget); return 'ok'
//          if res.outcome === 'stop_cycle': return 'exceeded'
//          default: return 'exceeded'

async function waitForBlockerResolution(
  projectId: string,
  messageId: string
): Promise<BlockerResolution>
// Poll db.listBlockingMessages(projectId) every 500ms.
// Stop polling when messageId is no longer in the blocking queue (is_read = 1).
// Read reply_intent_json from the resolved inbox message.
// Parse JSON into BlockerResolution:
//   { action: 'approve' | 'continue' }         → { outcome: 'continue' }
//   { action: 'adjust_budget', newBudget: N }   → { outcome: 'adjust_budget', newBudget: N }
//   { action: 'stop_cycle' }                    → { outcome: 'stop_cycle' }
//   { action: 'retry' }                         → { outcome: 'retry_phase' }
//   { action: 'skip_phase' }                    → { outcome: 'skip_phase' }
// Fallback: if intent is null/unparseable → { outcome: 'continue' }
// If global stop signal set: return { outcome: 'stop_cycle' }

// runCycle() changes:
// 1. Pass cycleId to every agent runner call
// 2. checkBudgetGate() before each phase; branch on return value
// 3. Wrap each phase in runPhaseWithRetry()
// 4. On restart: read phase_states from cycles table; skip phases with status 'complete'
// 5. Call updateCyclePhaseState() on each phase completion/failure
// 6. logEvent('error', ErrorPayload) in top-level catch ← GH#1 error call site

// Phase DAG (Story 15) — defined after serial path is stable:
const PHASE_DAG: Record<string, string[]> = {
  'research':      [],
  'spec':          ['research'],
  'design-draft':  ['research'],
  'design-final':  ['spec', 'design-draft'],
  'build':         ['design-final'],
  'test':          ['build'],
  'review':        ['test'],
};
// Execution: topological sort → dependency waves → Promise.all per wave
```

### `server/src/intent.ts` — extensions (Story 16)

```typescript
// New function alongside existing extractIntent():

async function extractBlockerIntent(
  replyText: string,
  blockerSubType: 'budget_warning' | 'phase_escalated' | 'human_input'
): Promise<BudgetBlockerIntent | PhaseEscalationIntent | { action: 'continue' }>
// Calls Claude with a concise prompt (256 token budget) that understands the blocker context.
// System prompt instructs output as JSON matching the blocker sub-type shape.
// budget_warning intent shapes:
//   - "approve" / "continue" / "ok" / "yes" → { action: 'approve' }
//   - "stop" / "halt" / "cancel"             → { action: 'stop_cycle' }
//   - mentions a number (e.g. "$20", "20")   → { action: 'adjust_budget', newBudget: 20 }
// phase_escalated intent shapes:
//   - "retry" / "try again"                  → { action: 'retry' }
//   - "stop" / "halt" / "cancel"             → { action: 'stop_cycle' }
//   - "skip"                                 → { action: 'skip_phase' }
// Falls back to { action: 'continue' } on parse error.

// Inbox reply handler (index.ts) must call extractBlockerIntent() instead of
// extractIntent() when the resolved inbox message has blocks_cycle = 1.
// Store result in reply_intent_json (column already exists).
// Then broadcast WS 'inbox_reply' to unblock waitForBlockerResolution().
```

### `server/src/index.ts` — modifications

```typescript
// On WS project subscribe: emit snapshot immediately
async function buildSnapshot(projectId: string): Promise<SnapshotPayload>
// Queries: feed last 100, all inbox, agents, last 5 cycles, all latest artifacts
// Computes phaseStates + phaseMeta from active cycle's events table
// Returns SnapshotPayload

// Inbox reply handler modification (Story 16):
// POST /api/projects/:id/inbox/:msgId/reply
//   1. Persist reply: replyToInboxMessage(msgId, body)  [existing]
//   2. logEvent('human_input_received', HumanInputPayload)  ← GH#1 call site
//   3. If message.blocks_cycle === 1:
//        extractBlockerIntent(body, message.blocker_sub_type)
//        store result in reply_intent_json via DB update
//        broadcast WS 'inbox_reply' { messageId }  → unblocks waitForBlockerResolution()
//   4. If message.blocks_cycle === 0:
//        extractIntent(body, context) [existing behaviour]
//   → 200: InboxMessage (with reply_intent_json populated)
```

---

## Component Breakdown

### `CycleProgressBar` (`components/CycleProgressBar/CycleProgressBar.tsx`)

```typescript
interface CycleProgressBarProps {
  cyclePhaseStates: Record<string, PhaseState>;
  phaseMeta: Record<string, PhaseMeta>;
  totalTokens: number;
  totalCostUsd: number;
  budgetDailyUsd: number;
  onArtifactLinkClick: (phase: string) => void;
}
```

**State:** none (pure display)

**Key logic:**
- `PHASES = ['research', 'spec', 'design', 'build', 'test', 'review']`
- StepIndicator class map:
  - `pending` → `border-gray-700 bg-gray-900 text-gray-600`
  - `active` → `border-blue-500 bg-blue-950 text-blue-400 animate-pulse`
  - `retrying` → same as active + amber `retry N/3` sub-label at `text-[9px] text-amber-500`
  - `complete` → `bg-green-800 border-green-700 text-green-200` + `✓`
  - `failed` → `bg-red-900 border-red-700 text-red-300` + `✗`
  - `skipped` → `border-gray-700 bg-gray-900 text-gray-500 opacity-40` + `/`
- StepMeta renders only when `phaseMeta[phase]` exists
  - `formatElapsed(ms)` → `"2m 14s"` (add to `utils.ts`)
  - `formatTokens(n)` → `"1.2K"` (add to `utils.ts`)
  - `formatCost(usd)` → `"$0.18"` (add to `utils.ts`)
  - Null-safe: token count zero → show `— · —`
- Artifact link `↗`: calls `onArtifactLinkClick(phase)`; gray + `cursor-not-allowed` when `artifact_id === null`
- CycleCostSummary: hidden when `totalTokens === 0`; values in `text-amber-400` when `totalCostUsd / budgetDailyUsd >= 0.8`
- Parallel active state (Story 15): DAG phases `spec` and `design-draft` can both be `active` simultaneously — no special handling needed; the step map just shows two pulsing circles

---

### `AgentRail` (`components/AgentRail/`)

**AgentRail.tsx**
```typescript
interface AgentRailProps {
  agents: Agent[];
  thoughts: Record<string, ThoughtEntry[]>;  // keyed by agent_role
  isLoading: boolean;
}
```
**State:** `expandedRoles: Set<string>` — which cards have ThoughtLogPanel open

**AgentCard.tsx**
```typescript
interface AgentCardProps {
  agent: Agent;   // includes last_action_at, current_task, last_phase_token_count (GH#6)
  thoughts: ThoughtEntry[];
  isExpanded: boolean;
  onToggleExpand: () => void;
}
```
**Key logic:**
- Role display order: `['researcher', 'pm', 'designer', 'developer', 'tester', 'documenter']`
- Role emoji map: `{ researcher: '🔍', pm: '📋', designer: '🎨', developer: '💻', tester: '🧪', documenter: '📝' }`
- Card border/bg from `agent.status`: `thinking→border-blue-800 bg-blue-950/30`, `blocked→border-amber-800 bg-amber-950/20`, `idle/done→border-gray-800 bg-gray-900`
- `StatusBadge` extended with `done` state (`text-green-500` + green dot)
- `ThoughtLogToggle` renders only when `thoughts.length > 0`
  - Label: **`∨ Reasoning (N)`** when collapsed, **`∧ Hide reasoning`** when expanded (GH#2 correction)
  - `title` tooltip: **"Summarised by the model — not raw internal thoughts."** (GH#2 correction)
- `AgentLastActionTime`: render `agent.last_action_at` as relative time (uses existing `relativeTime()`)
- `AgentTokenBadge`: render `agent.last_phase_token_count` if > 0; hidden when 0
- Skeleton: 6 pulse divs `h-[74px] rounded-lg border border-gray-800 bg-gray-900 animate-pulse` when `isLoading`

**ThoughtLogPanel.tsx**
```typescript
interface ThoughtLogPanelProps {
  thoughts: ThoughtEntry[];
}
```
**State:** `expandedIds: Set<string>` — which thought entries show full text

**Key logic:**
- Panel header text: **"Claude's Reasoning"** `text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5` (GH#2 correction)
- New thoughts prepend to list; no auto-scroll when user has scrolled up
- When new thoughts arrive off-screen: show `text-[9px] text-blue-400` "N new" at panel top
- Scroll position tracking via `useRef` on scroll container + `onScroll` handler

---

### `CenterPanel` (`components/CenterPanel/`)

**CenterPanel.tsx**
```typescript
interface CenterPanelProps {
  activeTab: 'feed' | 'artifacts';
  onTabChange: (tab: 'feed' | 'artifacts') => void;
  banners: Banner[];
  onDismissBanner: (id: string) => void;
  reconnectState: 'connected' | 'reconnecting' | 'reconnected';
  feedMessages: FeedMessage[];
  artifacts: Artifact[];
  cycles: CycleRun[];
  artifactPhaseFilter?: string;
  onArtifactPhaseFilterConsumed: () => void;
}
```

**ArtifactView.tsx**
```typescript
interface ArtifactViewProps {
  artifacts: Artifact[];
  cycles: CycleRun[];
  initialPhase?: string;
  onPhaseConsumed: () => void;
}
```
**State:**
- `activePhase: string` — default first phase with artifact
- `selectedCycleId: string` — default latest cycle id
- `activeView: 'rendered' | 'diff'`
- `copiedFlash: boolean` — 2s "Copied" confirmation

**Key logic:**
- `artifactsByPhase`: filter `artifacts` by `cycle_id === selectedCycleId`, index by phase
- `canDiff = cycles.length > 1`
- For diff view: look up artifact for the same phase in the cycle immediately preceding `selectedCycleId`; pass `artifact.diff_from_previous` to ArtifactDiffView
- Download: `URL.createObjectURL(new Blob([content]))` with `download="{phase}-cycle{N}.md"` anchor click
- `initialPhase`: consumed via `useEffect`, sets `activePhase`, calls `onPhaseConsumed()`
- Real-time updates: if `agent_event.event_type === 'artifact_saved'` and it matches active phase/cycle, show "Updated just now" flash for 3s

**ArtifactDiffView.tsx** (GH#3 correction — uses `react-diff-view`, not `git-diff-view`)
```typescript
interface ArtifactDiffViewProps {
  diffContent: string;  // unified diff string from artifacts.diff_from_previous
  filename: string;     // e.g. "design.md" — used as Diff gutterType label
}
```
**Key logic:**
- Import from `react-diff-view/esm` — confirmed Vite/ESM compatible
- Import base stylesheet: `react-diff-view/style/index.css`
- Usage:
  ```tsx
  const files = parseDiff(diffContent);
  return (
    <div className="artifact-diff-view">
      {files.map(({ hunks }, i) => (
        <Diff key={i} viewType="unified" diffType="modify" hunks={hunks}>
          {hunks => hunks.map(hunk => <Hunk key={hunk.content} hunk={hunk} />)}
        </Diff>
      ))}
    </div>
  );
  ```
- CSS class overrides scoped under `.artifact-diff-view` (inject via `<style>` tag or CSS module):
  - `.diff-line-add` → `background: rgba(22, 101, 52, 0.25)`
  - `.diff-code-add` → `background: rgba(22, 101, 52, 0.12)`
  - `.diff-gutter-add` → `background: rgba(22, 101, 52, 0.50); color: #4b5563`
  - `.diff-line-delete` → `background: rgba(127, 29, 29, 0.25)`
  - `.diff-code-delete` → `background: rgba(127, 29, 29, 0.12)`
  - `.diff-gutter-delete` → `background: rgba(127, 29, 29, 0.50); color: #4b5563`
  - `.diff-gutter-normal` → `background: transparent; color: #4b5563`
  - `.diff-line-normal` → `background: transparent`
  - `.diff-code-edit` → `font-family: ui-monospace, monospace; font-size: 11px; color: #d1d5db`
  - `.diff-widget-content` → `background: #030712`
- `parseDiff('')` → empty hunks array → render `text-center py-12 text-sm text-gray-600` "No changes between these cycles." (edge case 23)
- Loading: 8 skeleton lines `h-3 bg-gray-800 rounded animate-pulse`

**ArtifactToolbar.tsx**
```typescript
interface ArtifactToolbarProps {
  cycles: { id: string; label: string }[];
  selectedCycleId: string;
  activeView: 'rendered' | 'diff';
  canDiff: boolean;
  onCycleChange: (id: string) => void;
  onViewChange: (view: 'rendered' | 'diff') => void;
  onCopy: () => void;
  onDownload: () => void;
}
```

---

### `BlockerModal` (`components/BlockerModal/BlockerModal.tsx`)

```typescript
interface BlockerModalProps {
  message: BlockerMessage;  // includes blocker_sub_type for Story 16
  queueLength: number;
  onSubmitReply: (reply: string) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onDismiss: () => Promise<void>;  // budget_exceeded only
}
```
**State:** `replyText: string`, `isSubmitting: boolean`, `submitError: string | null`

**Key logic:**
- `ReactDOM.createPortal(…, document.body)` — portal render
- `useFocusTrap(dialogRef, true)` — new hook `client/src/hooks/useFocusTrap.ts`
- `Escape` key: `event.preventDefault()` — no close
- Backdrop click: `event.stopPropagation()` — no close
- Blocker type routing: `proposed_diff` present → approve/reject variant; `spend_summary` present → dismiss-only; else → reply variant

**Reply textarea placeholder (Story 16 — sub-type-aware):**
```typescript
const placeholderBySubType: Record<string, string> = {
  budget_warning:    'e.g. Continue, Increase budget to $20, Stop cycle…',
  phase_escalated:   'e.g. Retry, Skip this phase, Stop cycle…',
  human_input:       'Type your reply…',
};
const placeholder = placeholderBySubType[message.blocker_sub_type ?? 'human_input'];
```

**IntentGate helper text (Story 16):** render below textarea when `message.blocker_sub_type` is set:
```tsx
<p className="text-[10px] text-gray-600 mt-1">Your reply will be interpreted automatically.</p>
```

- Submit disabled when `replyText.trim() === ''` or `isSubmitting`

**`useFocusTrap.ts`** (`client/src/hooks/useFocusTrap.ts`)
```typescript
function useFocusTrap(ref: React.RefObject<HTMLElement>, isActive: boolean): void
// On mount when isActive: query all focusable elements in ref (a, button, input, textarea, select, [tabindex])
// Intercept Tab/Shift-Tab to cycle within them.
// Restore focus to previously focused element on cleanup.
// ~30 lines, no dependencies beyond React.
```

---

### `PinnedBlockerBanner` / `ReconnectBanner` (`components/Banners/`)

**PinnedBlockerBanner.tsx**
```typescript
interface PinnedBlockerBannerProps {
  banners: Banner[];
  onDismiss: (id: string) => void;
}
```
**Key logic:**
- Priority sort: `budget_warning > phase_retry > sse_reconnecting`
- `visible = sorted.slice(0, 3)`; if `banners.length > 3`: append "and N more warnings" row
- Each row: `▲` + message text + `×` dismiss

**ReconnectBanner.tsx**
```typescript
interface ReconnectBannerProps {
  state: 'reconnecting' | 'reconnected' | 'hidden';
}
```

---

### `RightPanel` / `SettingsView` (`components/RightPanel/`)

**RightPanel.tsx**
```typescript
interface RightPanelProps {
  activeTab: 'inbox' | 'settings';
  onTabChange: (tab: 'inbox' | 'settings') => void;
  inboxMessages: InboxMessage[];
  inboxUnreadCount: number;
  onMessagesChange: (msgs: InboxMessage[]) => void;
  projectId: string;
  budgetDailyUsd: number;
  onSaveBudget: (usd: number) => Promise<void>;
  selfModEnabled: boolean;
}
```

**SettingsView.tsx**
```typescript
interface SettingsViewProps {
  budgetDailyUsd: number;
  onSaveBudget: (usd: number) => Promise<void>;
  selfModEnabled: boolean;  // always true for MVP
}
```
**State:** `inputValue: string`, `isSaving: boolean`, `saveError: string | null`, `saveSuccess: boolean`

**Key logic:**
- `isDirty = parseFloat(inputValue) !== budgetDailyUsd`
- `isValid = !isNaN(parseFloat(inputValue)) && parseFloat(inputValue) > 0`
- Save disabled when `!isDirty || !isValid || isSaving`
- On success: `setSaveSuccess(true)` + `setTimeout(() => setSaveSuccess(false), 2000)`
- Error: `border-red-700` on input + inline `text-xs text-red-400`

---

### `FeedMessage` upgrade (`components/FeedPanel.tsx`)

```typescript
interface FeedToolCallBlockProps {
  toolName: string;
  argsPreview: string;  // JSON.stringify(input).slice(0, 50)
  detail: unknown;      // full JSON
}
```
**State:** `isExpanded: boolean`

**Key logic:**
- Rendered when `message.message_type === 'tool_call'`
- `tool_call` badge: `bg-gray-800 text-gray-500 border border-gray-700`
- Chevron: `transition-transform rotate-180` when expanded
- Detail: `<pre>JSON.stringify(detail, null, 2)</pre>` with `rehype-highlight` if installed, else plain

---

### `App.tsx` changes

**New state:**
```typescript
const [blockerQueue,       setBlockerQueue]       = useState<BlockerMessage[]>([]);
const [centerTab,          setCenterTab]          = useState<'feed' | 'artifacts'>('feed');
const [rightTab,           setRightTab]           = useState<'inbox' | 'settings'>('inbox');
const [cyclePhaseStates,   setCyclePhaseStates]   = useState<Record<string, PhaseState>>({});
const [phaseMeta,          setPhaseMeta]          = useState<Record<string, PhaseMeta>>({});
const [thoughts,           setThoughts]           = useState<Record<string, ThoughtEntry[]>>({});
const [banners,            setBanners]            = useState<Banner[]>([]);
const [reconnectState,     setReconnectState]     = useState<'connected'|'reconnecting'|'reconnected'>('connected');
const [budgetDailyUsd,     setBudgetDailyUsd]     = useState<number>(10.00);
const [artifacts,          setArtifacts]          = useState<Artifact[]>([]);
const [artifactPhaseFilter, setArtifactPhaseFilter] = useState<string | undefined>();
```

**New WS event handlers:**
- `'snapshot'` → replace feed, inbox, agents, cycles, artifacts, phaseStates, phaseMeta from payload
- `'agent_event'` where `event_type === 'thinking'` → prepend to `thoughts[agentRole]`
- `'agent_event'` where `event_type === 'artifact_saved'` → update matching artifact in state
- `'phase_meta'` → update `phaseMeta` + `cyclePhaseStates`; add/update banner if `budget_warning` or `retry_count > 0`
- `'blocker'` → `setBlockerQueue(q => [...q, message])`
- WS `onclose` → `setReconnectState('reconnecting')`; add `sse_reconnecting` banner
- WS `onopen` → `setReconnectState('reconnected')`; remove `sse_reconnecting` banner; `setTimeout(() => setReconnectState('connected'), 2000)`
- On project switch → `setBlockerQueue([]); setCyclePhaseStates({}); setPhaseMeta({}); setThoughts({})`

**New handlers:**
```typescript
async function handleSubmitBlockerReply(messageId: string, reply: string): Promise<void>
// api.inbox.reply(selectedProject.id, messageId, reply)
// Pop messageId from blockerQueue on success

async function handleApproveChange(messageId: string, changeId: string): Promise<void>
// api.proposedChanges.approve(selectedProject.id, changeId)
// Pop messageId from blockerQueue

async function handleRejectChange(messageId: string, changeId: string): Promise<void>
// api.proposedChanges.reject(selectedProject.id, changeId)
// Pop messageId from blockerQueue

async function handleSaveBudget(usd: number): Promise<void>
// api.budget.save(selectedProject.id, usd) → setBudgetDailyUsd(usd)

function handleArtifactLinkClick(phase: string): void
// setCenterTab('artifacts'); setArtifactPhaseFilter(phase)
```

**Load on project select:** also fetch `artifacts` and `budgetDailyUsd` alongside existing data fetches.

---

## API Contract

### Existing endpoints — changes

```
GET /api/projects/:id/artifacts
  NEW optional query: ?cycleId=<id>
  Response: Artifact[]  (now includes cycle_id, previous_version_id, diff_from_previous)

GET /api/projects/:id/inbox
  Response: InboxMessage[]  (now includes blocks_cycle, reply_intent_json)

POST /api/projects/:id/inbox/:msgId/reply
  Request: { body: string }
  Response: InboxMessage
  NEW side effects:
    - logEvent('human_input_received', ...)  ← GH#1 explicit call site
    - if blocks_cycle=1: extractBlockerIntent() + store reply_intent_json
    - if blocks_cycle=1: broadcast WS 'inbox_reply' { messageId }
    - if blocks_cycle=0: existing extractIntent() behaviour
```

### New endpoints

```
GET /api/projects/:id/events
  Query: cycleId?, agentRole?, eventType?, limit=100, offset=0
  Response: { data: AgentEvent[]; total: number }
  Errors: 404 project not found

GET /api/projects/:id/preferences/budget
  Response: { budget_daily_usd: number }

PUT /api/projects/:id/preferences/budget
  Request: { budget_daily_usd: number }
  Validation: finite, > 0
  Response: { budget_daily_usd: number }
  Errors: 400 if invalid

GET /api/projects/:id/proposed-changes
  Query: status? (PENDING | APPROVED | REJECTED)
  Response: ProposedChange[]

POST /api/projects/:id/proposed-changes/:changeId/approve
  Response: ProposedChange (status=APPROVED)
  Side effects: write diff_content to file_path on disk; broadcast WS 'proposed_change_resolved'
  Errors: 404 not found; 409 already resolved

POST /api/projects/:id/proposed-changes/:changeId/reject
  Response: ProposedChange (status=REJECTED)
  Side effects: broadcast WS 'proposed_change_resolved'
  Errors: 404 not found; 409 already resolved
```

### WebSocket — new event types (GH#5: all names match WS event taxonomy — no separate enum)

```
{ type: 'agent_event',              projectId, data: AgentEvent }
  — event_type values: phase_started | phase_completed | phase_failed | tool_call |
    artifact_saved | thinking | human_input_requested | human_input_received |
    budget_exceeded | error
  — no separate lifecycle marker enum (fixes GH#5)

{ type: 'phase_meta',               projectId, data: { phase } & PhaseMeta & { retry_count?: number; budget_warning?: boolean } }
{ type: 'blocker',                  projectId, data: BlockerMessage }
{ type: 'proposed_change_resolved', projectId, data: ProposedChange }
{ type: 'snapshot',                 projectId, data: SnapshotPayload }
  — emitted immediately after client subscribes
{ type: 'inbox_reply',              projectId, data: { messageId: string } }
  — signals waitForBlockerResolution() to re-check DB
```

---

## Commit Plan

> Each commit leaves the server + client in a working, deployable state.
> DB migrations use `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN` (SQLite ≥ 3.35, bun:sqlite default).
> Server commits 1–7 are independent of client commits 8–15 and can be reviewed in parallel.
> Commit 16 (phase DAG) depends on commits 1–7.
> Commit 17 (IntentGate extension) depends on commits 1–7 and the existing `intent.ts`.

```
Commit 1 — feat(db): events + proposed_changes tables; extend artifacts/inbox/cycles schema
  - events table (append-only; no UPDATE/DELETE paths exist)
  - proposed_changes table
  - ALTER artifacts: add cycle_id TEXT, previous_version_id TEXT, diff_from_previous TEXT
  - ALTER inbox_messages: add blocks_cycle INTEGER DEFAULT 0
    (reply_intent_json already exists — no ALTER needed)
  - ALTER cycles: add last_completed_phase TEXT, phase_states TEXT DEFAULT '{}'
  - bun add diff in server workspace
  - New helpers: logEvent, listEvents, sumCycleCost, sumTodayCost,
    createProposedChange, getProposedChange, listProposedChanges,
    updateProposedChangeStatus, createBlockingInboxMessage, listBlockingMessages,
    getBudgetUsd, updateCyclePhaseState
  - saveArtifact() extended: accept cycleId, compute and store diff lineage via
    diff.createPatch(filename, oldContent, newContent)
  - computeUnifiedDiff() pure helper wrapping diff.createPatch()
  - getArtifactByPhase() extended: optional cycleId filter

Commit 2 — feat(server): extend runClaude() — token counts, adaptive thinking, AGENT_TOOLS
  - ClaudeResult interface replacing string return type
  - Extract usage.input_tokens / output_tokens; compute cost_usd
  - Extract thinking content blocks → ClaudeResult.thinking_blocks[]
    IMPORTANT: pass thinking: { type: 'enabled', budget_tokens: 8000 } — NO beta header
    (betas: ['interleaved-thinking-2025-05-14'] is deprecated — do not include)
  - Extract tool_use content blocks → ClaudeResult.tool_uses[]
  - AGENT_TOOLS array defined in agents/base.ts and passed as tools parameter in
    every runClaude() call (fixes GH#7 — tool pipeline is now active)
  - tool_choice: { type: 'auto' } when thinking enabled;
    never { type: 'tool', name: '...' } when thinking is on (API constraint)
  - All existing callers updated to destructure result.content

Commit 3 — feat(server): event logging in loop and agents; explicit call sites for GH#1
  - Pass cycleId from runCycle() to every agent runner
  - Each agent logs: phase_started, thinking (per block), artifact_saved, phase_completed
  - logEvent() called after every Claude API call; WS 'agent_event' broadcast
  - phase_completed event includes aggregate token_count + cost_usd for the phase
  - EXPLICIT CALL SITES (GH#1 fix — these three must be named and findable by grep):
    1. logEvent('human_input_requested', ...) in loop.ts when createBlockingInboxMessage() fires
    2. logEvent('human_input_received', ...) in index.ts inbox reply handler
    3. logEvent('error', ErrorPayload) in loop.ts top-level catch and per-agent catch blocks

Commit 4 — feat(server): token budget gate + blocking inbox in cycle runner
  - checkBudgetGate() in loop.ts
  - Called before each phase; broadcasts 'phase_meta' with budget_warning at >80%
  - waitForBlockerResolution() polling loop (returns 'resolved' | 'stopped' for now —
    Story 16 in Commit 17 upgrades this to typed BlockerResolution)
  - Budget exceeded path: createBlockingInboxMessage + broadcast 'blocker' + await resolution
  - GET + PUT /api/projects/:id/preferences/budget endpoints

Commit 5 — feat(server): saga retry × 3 with phase escalation and crash recovery
  - runPhaseWithRetry() wrapping each phase runner
  - phase_failed event logged on each failure with attempt count
  - After 3 failures: createBlockingInboxMessage + broadcast 'blocker' + await resolution
  - 'phase_meta' broadcast with retry_count on each retry
  - On cycle restart: read phase_states from cycles table; skip phases with 'complete' status
  - updateCyclePhaseState() called on each phase complete/fail

Commit 6 — feat(server): self-modification approval gate for /server/src/ writes
  - SELF_MOD_PATHS = ['/server/src/'] as const in agents/base.ts (hard-coded, never DB)
  - checkSelfModGate(filePath) in base.ts
  - dispatchToolUse() in base.ts: save_artifact → gate check; post_feed_message;
    request_human_input with logEvent('human_input_requested', ...)
  - save_artifact intercepted: createProposedChange() + createBlockingInboxMessage() if gated
  - GUARD (GH#4 fix): every direct db.saveArtifact() call in agents/*.ts is audited —
    any that could target /server/src/ is replaced with checkSelfModGate() + dispatchToolUse()
  - Freeform fallback (GH#4): text-only ClaudeResult → post as feed note, NOT direct file save
  - GET /api/projects/:id/proposed-changes endpoint
  - POST .../approve: apply diff_content (full file content) to disk + broadcast 'proposed_change_resolved'
  - POST .../reject: update status + broadcast 'proposed_change_resolved'

Commit 7 — feat(server): WS snapshot on subscribe; events endpoint; lifecycle marker alignment
  - buildSnapshot() helper
  - Emit 'snapshot' event immediately on WS project subscribe
  - GET /api/projects/:id/events endpoint with pagination
  - Register all new WS event type broadcasts
  - LIFECYCLE MARKER ALIGNMENT (GH#5 fix): all event_type values use WS taxonomy names:
    phase_started, phase_completed, phase_failed, error — no separate enum
    Verify every logEvent() call site uses these names; grep for any legacy names
    (RunStarted, PhaseStarted, PhaseFinished, RunFinished, RunError) and rename

Commit 8 — feat(client): Cycle 3 TypeScript interfaces and API helpers; extend Agent type
  - types.ts: AgentEvent, ThoughtEntry, PhaseState, PhaseMeta, BlockerMessage,
    SpendSummary, ProposedChange, Banner, SnapshotPayload
  - EXTEND Agent type (GH#6 fix):
    last_action_at: number | null     — already in DB; ensure server sends in WS events
    current_task: string | null       — already in DB; ensure server sends in WS events
    last_phase_token_count: number    — new derived field from events aggregate
  - Extend InboxMessage: add blocks_cycle, reply_intent_json
  - Extend Artifact: add cycle_id, previous_version_id, diff_from_previous
  - Extend CycleRun: add last_completed_phase, phase_states
  - Extend WsEvent union: agent_event, phase_meta, blocker, proposed_change_resolved,
    snapshot, inbox_reply
  - api.ts: api.events.list(), api.budget.get(), api.budget.save(),
    api.proposedChanges.list(), api.proposedChanges.approve(), api.proposedChanges.reject()

Commit 9 — feat(client): CycleProgressBar with phase steps, cost summary, artifact links
  - components/CycleProgressBar/CycleProgressBar.tsx + index.ts
  - formatElapsed(), formatTokens(), formatCost() added to utils.ts
  - Wired into App.tsx below TopBar — always rendered, empty when no cycle
  - onArtifactLinkClick → setCenterTab('artifacts') + setArtifactPhaseFilter

Commit 10 — feat(client): AgentRail replaces AgentPanel; ThoughtLogPanel with "Reasoning" label
  - components/AgentRail/ (AgentRail.tsx, AgentCard.tsx, ThoughtLogPanel.tsx, index.ts)
  - ThoughtLogToggle label: '∨ Reasoning (N)' / '∧ Hide reasoning' (GH#2 correction)
  - ThoughtLogToggle title tooltip: 'Summarised by the model — not raw internal thoughts.'
  - ThoughtLogPanel header: 'Claude\'s Reasoning' (GH#2 correction)
  - AgentCard shows last_action_at + current_task + last_phase_token_count (GH#6)
  - StatusBadge 'done' state added
  - Delete components/AgentPanel.tsx
  - useFocusTrap hook scaffolded at client/src/hooks/useFocusTrap.ts
  - Wired into App.tsx; thoughts state keyed by agent_role passed down

Commit 11 — feat(client): CenterPanel with Feed/Artifacts tabs and ArtifactDiffView
  - components/CenterPanel/ (CenterPanel.tsx, ArtifactView.tsx, ArtifactDiffView.tsx,
    ArtifactToolbar.tsx, index.ts)
  - bun add react-diff-view in client workspace (NOT git-diff-view — GH#3 correction)
  - ArtifactDiffView imports from react-diff-view/esm; no Vite config changes needed
  - Uses parseDiff() → <Diff viewType="unified"> → <Hunk> render pattern
  - Dark-theme CSS class overrides scoped under .artifact-diff-view
  - Props: { diffContent: string, filename: string } — diff is pre-computed server-side
  - FeedPanel.tsx operates as child (tab content) rather than standalone panel
  - Artifacts fetched on project select in App.tsx
  - onArtifactLinkClick wired: CycleProgressBar → App.tsx → CenterPanel

Commit 12 — feat(client): BlockerModal with focus trap, three variants, sub-type placeholders
  - components/BlockerModal/BlockerModal.tsx + index.ts
  - useFocusTrap.ts completed
  - Reply textarea placeholder varies by blocker_sub_type (Story 16 UI)
  - IntentGate helper text: 'Your reply will be interpreted automatically.'
    rendered when blocker_sub_type is set
  - Wired into App.tsx: render when blockerQueue.length > 0
  - 'blocker' WS event → append to blockerQueue
  - Project switch → flush blockerQueue

Commit 13 — feat(client): PinnedBlockerBanner and ReconnectBanner above feed
  - components/Banners/ (PinnedBlockerBanner.tsx, ReconnectBanner.tsx, index.ts)
  - Wired into CenterPanel.tsx
  - App.tsx WS onclose/onopen: manage reconnectState + banners array
  - budget_warning + phase_retry banners added from 'phase_meta' WS events

Commit 14 — feat(client): RightPanel with Inbox/Settings tabs and budget input
  - components/RightPanel/ (RightPanel.tsx, SettingsView.tsx, index.ts)
  - InboxPanel.tsx rendered inside RightPanel as Inbox tab content
  - InboxPanel: resolved blocker visual state — green border + 'Cycle resumed' sub-label
  - budgetDailyUsd fetched on project select; handleSaveBudget wired in App.tsx

Commit 15 — feat(client): FeedToolCallBlock in feed messages; tool_call badge
  - FeedPanel.tsx: add FeedToolCallBlock component inline
  - tool_call message_type badge added to FeedTypeBadge colour map
  - Collapsible JSON detail with chevron rotation

Commit 16 — feat(server): phase dependency DAG for parallel research/design-draft execution
  - PHASE_DAG constant in loop.ts (see data shapes above)
  - Topological sort → wave grouping → Promise.all per wave
  - designer.ts exports runDesignerDraft() (research-only context injection)
  - designer.ts existing runDesigner() receives spec + draft as context
  - Both parallel branches write separate events with correct phase labels
  - CycleProgressBar already handles two simultaneous active steps (Commit 9)

Commit 17 — feat(server): IntentGate extension — typed blocker resolution in cycle runner
  - intent.ts: extractBlockerIntent(replyText, blockerSubType) function
    Separate Claude call (256 token budget) with blocker-specific system prompt
    Returns BudgetBlockerIntent | PhaseEscalationIntent | { action: 'continue' }
  - index.ts inbox reply handler: call extractBlockerIntent() for blocks_cycle=1 messages
    Store result in reply_intent_json; broadcast WS 'inbox_reply' { messageId }
  - loop.ts waitForBlockerResolution() upgraded:
    Reads reply_intent_json from resolved inbox message
    Returns typed BlockerResolution (not just 'resolved' | 'stopped')
  - loop.ts runCycle() branches on BlockerResolution:
    adjust_budget → setPreference(budget key, newBudget); continue cycle
    stop_cycle → halt cycle cleanly
    retry_phase → re-queue phase (reset attempt count)
    skip_phase → mark phase skipped; advance to next
    continue / approved / rejected → handled per context
  - Self-mod approval/rejection still uses APPROVE/REJECT buttons — extractBlockerIntent()
    not called for proposed_changes type (button state is unambiguous)
```

---

## Open Questions

1. **Self-mod gate scope (pre-Commit 6):** Should `checkSelfModGate()` also intercept writes to `prompts/` directory and `prompt_versions` table entries? Currently gates only `/server/src/`. Chris must weigh in before Commit 6 ships. If yes, extend `SELF_MOD_PATHS` — small change.

2. **Mastra integration (pre-Commit 3):** Research recommends `@mastra/core@1.4.0` for persistent cross-cycle researcher memory. Optional enhancement. If Chris wants it, install in server workspace and wire `MastraClient` into `agents/researcher.ts`. If not, events table provides sufficient context recovery for MVP. Decision required before Commit 3.
