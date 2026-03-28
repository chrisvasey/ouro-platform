# Design Specification — Cycle 5

> **Scope:** Backend-only. No UI changes. One file changed: `server/src/claude.ts`.
> One new dependency: `@anthropic-ai/sdk`.

---

## User Flows

### Flow 1 — Normal API call (token available)

1. Caller invokes `runClaude({ systemPrompt, userPrompt, timeoutMs: 90_000 })`
2. `runClaude` reads `ANTHROPIC_API_KEY` (primary) → `CLAUDE_CODE_OAUTH_TOKEN` (fallback)
3. Token found → constructs `Anthropic` client with `apiKey: token`
4. Calls `anthropic.messages.create(...)` with built params
5. Response arrives within `timeoutMs` → parse `text` blocks into `content`, read `usage`
6. Returns `{ content, real: true, inputTokens, outputTokens }`

### Flow 2 — Extended thinking enabled

1. Caller invokes `runClaude({ ..., thinkingBudget: 8000 })`
2. `runClaude` adds `betas: ['interleaved-thinking-2025-05-14']` to request
3. Adds thinking param: `{ type: 'enabled', budget_tokens: 8000 }`
4. Response contains interleaved `thinking` and `text` content blocks
5. Collect all `thinking` block `thinking` fields → `thinkingContent`
6. Collect all `text` block `text` fields → `content`
7. Returns `{ content, real: true, inputTokens, outputTokens, thinkingContent }`

### Flow 3 — Tool use enabled

1. Caller invokes `runClaude({ ..., tools: [myTool] })`
2. `runClaude` passes `tools` array directly to `messages.create`
3. If model returns `tool_use` blocks, they are **ignored** in Cycle 5 — only `text` blocks are collected into `content`
4. Returns `{ content, real: true, inputTokens, outputTokens }`

> **Note:** Structured tool-use parsing (GH#7) is deferred to C6-3. Cycle 5 only wires the forwarding so callers compile.

### Flow 4 — No auth token

1. `runClaude` reads env — neither `ANTHROPIC_API_KEY` nor `CLAUDE_CODE_OAUTH_TOKEN` set
2. Logs `[claude] No auth token found — using mock output`
3. Returns `{ content: mockOutput(userPrompt), real: false, inputTokens: 0, outputTokens: 0 }`

### Flow 5 — SDK throws (auth error, network error, rate limit)

1. `anthropic.messages.create` rejects with an `APIError`
2. `runClaude` catches, logs `[claude] SDK error: <message>`
3. Falls back to `{ content: mockOutput(userPrompt), real: false, inputTokens: 0, outputTokens: 0 }`
4. Does **not** re-throw (preserves existing mock-fallback contract)

### Flow 6 — Timeout

1. `AbortController` created, `signal` passed to SDK call
2. `setTimeout(timeoutMs)` fires → `controller.abort()`
3. SDK rejects with `AbortError` (or subclass)
4. `runClaude` detects abort → constructs timeout error with `.timeout = true`, re-throws
5. Caller (e.g. `researcher.ts`) catches `.timeout === true` and retries

---

## Component Tree

```
server/src/claude.ts
├── ClaudeRunOptions (interface)        ← extended with tools, thinkingBudget
├── ClaudeRunResult (interface)         ← extended with inputTokens, outputTokens, thinkingContent
├── runClaude(opts) → Promise<Result>   ← replaces Bun.spawn with SDK call
│   ├── buildMessages(opts)             ← internal helper: constructs messages array
│   ├── buildCreateParams(opts)         ← internal helper: constructs full create() params
│   ├── parseResponse(msg)              ← internal helper: extracts content + thinking + usage
│   └── mockOutput(userPrompt)          ← unchanged
└── detectPhase(prompt)                 ← unchanged
```

No other files change. All callers (`pm.ts`, `researcher.ts`, `designer.ts`, `developer.ts`, `tester.ts`, `documenter.ts`, `intent.ts`) compile without modification because the new fields in `ClaudeRunResult` are optional additions.

---

## Layout Specs

_No UI layout. This section covers the TypeScript interface contracts._

### `ClaudeRunOptions` (final shape)

```typescript
export interface ClaudeRunOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Max output tokens. Defaults to 4096. */
  maxTokens?: number;
  /**
   * Per-call timeout in ms. On expiry, rejects with error where .timeout === true.
   * Callers (researcher, developer) catch and retry.
   */
  timeoutMs?: number;
  /**
   * Tool definitions forwarded to the API.
   * Tool-use response blocks are ignored in Cycle 5; parsed in C6-3.
   */
  tools?: Anthropic.Tool[];
  /**
   * If set, enables extended thinking with the given token budget.
   * Requires betas: ['interleaved-thinking-2025-05-14'].
   * Min value: 1024 (Anthropic requirement).
   */
  thinkingBudget?: number;
}
```

### `ClaudeRunResult` (final shape)

```typescript
export interface ClaudeRunResult {
  /** Concatenated text content from all text blocks. */
  content: string;
  /** true = real API response; false = mock fallback. */
  real: boolean;
  /** Prompt token count. 0 for mock responses. */
  inputTokens: number;
  /** Completion token count. 0 for mock responses. */
  outputTokens: number;
  /** Concatenated thinking content if thinkingBudget was set. Undefined otherwise. */
  thinkingContent?: string;
}
```

### `Anthropic` client construction

```typescript
// Constructed once per runClaude() call — stateless, no caching needed at this scale
const client = new Anthropic({ apiKey: token });
```

### `messages.create` params

```typescript
const params: Anthropic.MessageCreateParamsNonStreaming = {
  model: 'claude-sonnet-4-6',         // hardcoded — matches existing behaviour
  max_tokens: opts.maxTokens ?? 4096,
  system: opts.systemPrompt,
  messages: [{ role: 'user', content: opts.userPrompt }],
  ...(opts.tools?.length ? { tools: opts.tools } : {}),
  ...(opts.thinkingBudget ? {
    thinking: { type: 'enabled', budget_tokens: opts.thinkingBudget },
    betas: ['interleaved-thinking-2025-05-14'],
  } : {}),
};
```

---

## Component Specs

### `runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult>`

**States:**

| State | Trigger | Behaviour |
|-------|---------|-----------|
| No token | Neither env var set | Return mock immediately, no network call |
| SDK success | `messages.create` resolves | Parse blocks, return real result |
| SDK auth error | 401/403 from API | Log + return mock (same as no-token) |
| SDK rate limit / 5xx | 429/5xx from API | Log + return mock |
| Timeout | `timeoutMs` exceeded | Abort controller fires → re-throw with `.timeout = true` |
| SDK network error | DNS/TCP failure | Log + return mock |

**Timeout implementation:**

```typescript
const controller = new AbortController();
const timer = opts.timeoutMs
  ? setTimeout(() => controller.abort(), opts.timeoutMs)
  : null;

try {
  const msg = await client.messages.create(params, { signal: controller.signal });
  if (timer) clearTimeout(timer);
  return parseResponse(msg);
} catch (err) {
  if (timer) clearTimeout(timer);
  if (err instanceof Error && err.name === 'AbortError') {
    const timeoutErr = new Error(`Claude call timed out after ${opts.timeoutMs}ms`);
    (timeoutErr as any).timeout = true;
    throw timeoutErr;
  }
  console.warn('[claude] SDK error:', (err as Error).message);
  return { content: mockOutput(opts.userPrompt), real: false, inputTokens: 0, outputTokens: 0 };
}
```

### `parseResponse(msg: Anthropic.Message): ClaudeRunResult`

```
Input: Anthropic.Message (stop_reason: 'end_turn' | 'tool_use' | 'max_tokens')
Output: ClaudeRunResult

Algorithm:
1. textParts = msg.content
     .filter(b => b.type === 'text')
     .map(b => b.text)
   content = textParts.join('\n\n').trim()

2. thinkingParts = msg.content
     .filter(b => b.type === 'thinking')
     .map(b => b.thinking)
   thinkingContent = thinkingParts.length ? thinkingParts.join('\n\n') : undefined

3. If content is empty after step 1:
   - Log '[claude] Empty text in response — using mock'
   - Return mock result with real: false

4. Return {
     content,
     real: true,
     inputTokens: msg.usage.input_tokens,
     outputTokens: msg.usage.output_tokens,
     thinkingContent,
   }
```

### `mockOutput(userPrompt)` — unchanged

No changes to this function or `detectPhase`. Both remain identical.

---

## Edge Cases

1. **`CLAUDE_CODE_OAUTH_TOKEN` rejected as `apiKey`.**
   The SDK call will throw a 401. `runClaude` catches it, logs `[claude] SDK error: ...`, falls back to mock. No crash. PM spec says "try it; fall back to mock if it fails" — this handles it automatically.

2. **`thinkingBudget < 1024`.**
   Anthropic rejects with a 400. Catch in the generic SDK error handler → mock fallback. Developer should document the minimum in the option JSDoc.

3. **`thinkingBudget` set but model returns no `thinking` blocks.**
   `thinkingParts` will be empty → `thinkingContent` is `undefined`. Not an error — caller gets `content` normally.

4. **`stop_reason: 'max_tokens'`.**
   Response is partial. Still parse and return whatever text was generated with `real: true`. Callers already handle truncated output (they use text as-is).

5. **`stop_reason: 'tool_use'` with no `text` blocks.**
   `content` will be empty string. Log and return mock. Structured tool-use handling is deferred to C6-3.

6. **`tools` array passed but `thinkingBudget` also set.**
   Extended thinking and tool use are incompatible per Anthropic docs. If both are set, **drop `thinkingBudget`** (log a warning). Tools take precedence because they're more likely to be intentional.

7. **`AbortError` name varies across runtimes.**
   Check both `err.name === 'AbortError'` and `err instanceof DOMException` (Bun may use either). Safest: also check `controller.signal.aborted === true` as the final guard.

8. **Response arrives but `content` is only whitespace.**
   `trim()` produces empty string. Treat as empty → mock fallback (same as existing behaviour).

9. **`timeoutMs` not set.**
   `timer` stays `null`, `AbortController` is created but never triggered. No overhead beyond object allocation. The `clearTimeout(null)` call is a no-op in Bun/Node.

10. **Existing callers that destructure only `{ content, real }` from result.**
    New fields (`inputTokens`, `outputTokens`, `thinkingContent`) are additions — destructuring with `const { content, real } = await runClaude(...)` still compiles. No breaking change.
