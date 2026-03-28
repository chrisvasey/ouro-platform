# Implementation Plan — Cycle 5

*Prepared by: Developer agent | Date: 2026-03-28*

---

## Pre-flight Audit

| Story | Status | Notes |
|---|---|---|
| C5-2 — WAL mode | **Already done** | `db.ts:9` has `db.run("PRAGMA journal_mode = WAL")`. No changes needed. |
| C5-1 — Anthropic SDK | **Not started** | `claude.ts` still uses `Bun.spawn('claude', ...)`. `@anthropic-ai/sdk` not in `package.json`. |

Only C5-1 requires implementation.

---

## File Structure

```
server/
  package.json     ← add @anthropic-ai/sdk
  src/
    claude.ts      ← replace Bun.spawn with Anthropic SDK
```

No new files. No other files touched.

---

## Data Shapes

```typescript
// ClaudeRunOptions — extend existing interface
export interface ClaudeRunOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  // NEW — C5-1
  tools?: Anthropic.Tool[];
  thinkingBudget?: number;
}

// ClaudeRunResult — extend existing interface (backward-compatible)
export interface ClaudeRunResult {
  content: string;           // unchanged — all callers use this field
  real: boolean;             // unchanged
  // NEW — C5-1
  inputTokens: number;
  outputTokens: number;
  thinkingContent?: string;
}
```

---

## Key Functions

### `runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult>`

**File:** `server/src/claude.ts`

**Auth resolution (in order):**
1. `CLAUDE_CODE_OAUTH_TOKEN` → `apiKey`
2. `ANTHROPIC_API_KEY` → `apiKey`
3. Neither set → return mock immediately (`real: false`, `inputTokens: 0`, `outputTokens: 0`)

**Request construction:**
```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey });

const params: Anthropic.MessageCreateParams = {
  model: 'claude-sonnet-4-6',
  max_tokens: opts.maxTokens ?? 4096,
  system: opts.systemPrompt,
  messages: [{ role: 'user', content: opts.userPrompt }],
};

if (opts.tools?.length) {
  params.tools = opts.tools;
}

if (opts.thinkingBudget) {
  params.thinking = { type: 'enabled', budget_tokens: opts.thinkingBudget };
  params.betas = ['interleaved-thinking-2025-05-14'];
}
```

**Response extraction:**
- Iterate `response.content` blocks:
  - `block.type === 'thinking'` → accumulate `block.thinking` into `thinkingContent`
  - `block.type === 'text'` → accumulate `block.text` into `content`
- `inputTokens = response.usage.input_tokens`
- `outputTokens = response.usage.output_tokens`

**Timeout:** wrap `client.messages.create(params)` in `Promise.race` with `setTimeout` reject. Set `.timeout = true` before re-throw — same pattern as current code.

**Error handling:** non-timeout errors → log warning, return mock (`real: false`, tokens `0`).

**Mock return (updated):**
```typescript
return { content: mockOutput(opts.userPrompt), real: false, inputTokens: 0, outputTokens: 0 };
```

`mockOutput()` and `detectPhase()` are unchanged.

---

## API Contract

No endpoint changes. This is an internal function replacement only.
All existing callers (`agents/*.ts`, `loop.ts`) receive the same `content` and `real` fields — compile unchanged.

---

## Commit Plan

### Commit 1 — `chore(server): add @anthropic-ai/sdk dependency`

**File:** `server/package.json`

Add to `"dependencies"`:
```json
"@anthropic-ai/sdk": "^0.39.0"
```

Run `bun install` in `server/`.

### Commit 2 — `feat(claude): migrate runClaude to Anthropic SDK`

**File:** `server/src/claude.ts`

- Add `import Anthropic from '@anthropic-ai/sdk'` at top
- Remove `import`s / code only needed by `Bun.spawn` path (none to remove — just the execute function)
- Extend `ClaudeRunOptions`: add `tools?: Anthropic.Tool[]`, `thinkingBudget?: number`
- Extend `ClaudeRunResult`: add `inputTokens: number`, `outputTokens: number`, `thinkingContent?: string`
- Replace the `execute()` inner function body with SDK call as described above
- Update mock return: add `inputTokens: 0, outputTokens: 0`
- `mockOutput()` and `detectPhase()` stay unchanged

---

## Task List

```
1. [server/package.json] — add @anthropic-ai/sdk to dependencies and run bun install
2. [server/src/claude.ts] — add Anthropic SDK import
3. [server/src/claude.ts] — extend ClaudeRunOptions with tools? and thinkingBudget?
4. [server/src/claude.ts] — extend ClaudeRunResult with inputTokens, outputTokens, thinkingContent?
5. [server/src/claude.ts] — replace Bun.spawn execute() body with Anthropic client.messages.create()
6. [server/src/claude.ts] — extract text/thinking blocks from response.content array
7. [server/src/claude.ts] — update mock return to include inputTokens: 0, outputTokens: 0
8. [server/src/claude.ts] — verify timeout Promise.race still wraps SDK call
9. [server] — run bun run typecheck; confirm zero new errors
```

---

## Open Questions

None. C5-1 spec is complete and self-contained. C5-2 is already implemented.
