# Design Specification — Cycle 5

> **Scope:** C5-1 (migrate `claude.ts` to Anthropic SDK) and C5-2 (SQLite WAL mode).
> These are pure backend changes. No UI components are added or modified.
> **C5-2 pre-confirmed done:** `db.ts:9` already has `db.run("PRAGMA journal_mode = WAL")` — no code change needed.

---

## User Flows

### Flow: C5-1 — SDK call (real key present)

1. Agent calls `runClaude({ systemPrompt, userPrompt, maxTokens?, timeoutMs?, tools?, thinkingBudget? })`
2. `runClaude` reads env: `CLAUDE_CODE_OAUTH_TOKEN` → `ANTHROPIC_API_KEY` → `null`
3. Key found → construct `Anthropic({ apiKey: key })`
4. Build `params`: model, system, user message, max_tokens, optional tools, optional thinking config
5. If `thinkingBudget` set: add `thinking: { type: 'enabled', budget_tokens: N }`, pass beta header
6. Call `client.messages.create(params[, requestOptions])`
7. Extract text blocks → `content` string
8. Extract thinking blocks → `thinkingContent` string (or `undefined` if none)
9. Read `response.usage` → `inputTokens`, `outputTokens`
10. Return `{ content, real: true, inputTokens, outputTokens, thinkingContent? }`

### Flow: C5-1 — Timeout

1. Steps 1–5 as above
2. `Promise.race([execute(), timeoutPromise])` — timeout fires before API responds
3. Error thrown with `.timeout = true` property
4. Caller (`researcher.ts`, etc.) catches, retries or continues — **unchanged from today**

### Flow: C5-1 — No key (mock fallback)

1. `runClaude` reads env: neither `CLAUDE_CODE_OAUTH_TOKEN` nor `ANTHROPIC_API_KEY` present
2. Log: `[claude] No auth token found — using mock output`
3. Return `{ content: mockOutput(opts.userPrompt), real: false, inputTokens: 0, outputTokens: 0 }`

### Flow: C5-1 — API auth error (bad key)

1. Key present but invalid → `client.messages.create()` throws 401 `AuthenticationError`
2. Caught in the outer `try/catch` (non-timeout error path)
3. Log warning with error message
4. Fall back to mock — return `{ content: mockOutput(...), real: false, inputTokens: 0, outputTokens: 0 }`

### Flow: C5-1 — Tools passed by caller

1. Caller adds `tools: [...]` to `ClaudeRunOptions`
2. `runClaude` forwards `tools` to `params.tools` unchanged
3. If Claude returns `tool_use` blocks, they do not contribute to `content` (text blocks only)
4. Caller inspects `.content` — empty string if Claude replied only with tool calls
5. Caller is responsible for tool dispatch (C6-3 scope, not C5)

### Flow: C5-2 — WAL mode (already done)

1. `db.ts` opens `Database(DB_PATH, { create: true })`
2. Immediately runs `db.run("PRAGMA journal_mode = WAL")` ← **line 9, already present**
3. No action required

---

## Component Tree

```
claude.ts (module)
├── imports: @anthropic-ai/sdk (Anthropic, MessageParam, etc.)
├── ClaudeRunOptions (interface — extended)
├── ClaudeRunResult (interface — extended)
├── runClaude(opts) → Promise<ClaudeRunResult>
│   ├── auth resolve: CLAUDE_CODE_OAUTH_TOKEN | ANTHROPIC_API_KEY | null
│   ├── [no key] → mockOutput(userPrompt) → return mock result
│   └── [key present]
│       ├── new Anthropic({ apiKey })
│       ├── buildParams(opts) → MessageCreateParamsNonStreaming
│       │   ├── base: model, max_tokens, system, messages[user]
│       │   ├── [tools set] → params.tools = opts.tools
│       │   └── [thinkingBudget set] → params.thinking + requestOptions header
│       ├── execute() → ClaudeRunResult
│       │   ├── client.messages.create(params[, requestOptions])
│       │   ├── extractText(response.content) → string
│       │   ├── extractThinking(response.content) → string | undefined
│       │   └── response.usage → { inputTokens, outputTokens }
│       ├── [timeoutMs set] → Promise.race([execute(), timeoutPromise])
│       └── [no timeout] → execute()
├── mockOutput(userPrompt) → string  (unchanged)
└── detectPhase(prompt) → string     (unchanged)

db.ts (unchanged — WAL already on line 9)
```

**Callers — compile-unchanged surface:**
```
agents/researcher.ts  → runClaude({ systemPrompt, userPrompt, timeoutMs })
agents/designer.ts    → runClaude({ systemPrompt, userPrompt, timeoutMs })
agents/pm.ts          → runClaude({ systemPrompt, userPrompt, timeoutMs })
agents/developer.ts   → runClaude({ systemPrompt, userPrompt, timeoutMs })
agents/tester.ts      → runClaude({ systemPrompt, userPrompt, timeoutMs })
agents/documenter.ts  → runClaude({ systemPrompt, userPrompt, timeoutMs })
```
All callers only use `.content` and `.real`. New fields are additive.

---

## Layout Specs

Not applicable — no UI changes. Interface specs serve this role for Cycle 5.

### `ClaudeRunOptions` (extended)

```typescript
export interface ClaudeRunOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Max tokens to request. Defaults to 4096.
   *  If thinkingBudget is set and maxTokens is not provided,
   *  defaults to thinkingBudget + 1000 (API requires max_tokens > budget_tokens). */
  maxTokens?: number;
  /** Per-call timeout in milliseconds. Unchanged — rejects with .timeout=true */
  timeoutMs?: number;
  /** Optional tool definitions forwarded to the API as-is. */
  tools?: Anthropic.Tool[];
  /** If set, enables extended thinking with this budget in tokens. */
  thinkingBudget?: number;
}
```

### `ClaudeRunResult` (extended)

```typescript
export interface ClaudeRunResult {
  /** Text content from the response (all text blocks joined). */
  content: string;
  /** True if real API response; false if mock fallback. */
  real: boolean;
  /** Input token count from usage. 0 for mock. */
  inputTokens: number;
  /** Output token count from usage. 0 for mock. */
  outputTokens: number;
  /** Concatenated thinking block text. Undefined if not requested or not returned. */
  thinkingContent?: string;
}
```

---

## Component Specs

### `runClaude` function

**Signature:** `async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult>`

**Auth resolution:**
```typescript
const apiKey = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.warn("[claude] No auth token found — using mock output");
  return { content: mockOutput(opts.userPrompt), real: false, inputTokens: 0, outputTokens: 0 };
}
```

**SDK client:** Instantiated per call:
```typescript
const client = new Anthropic({ apiKey });
```

**Params construction:**
```typescript
const effectiveMaxTokens = opts.maxTokens
  ?? (opts.thinkingBudget ? opts.thinkingBudget + 1000 : 4096);

const params: Anthropic.MessageCreateParamsNonStreaming = {
  model: "claude-sonnet-4-6",
  max_tokens: effectiveMaxTokens,
  system: opts.systemPrompt,
  messages: [{ role: "user", content: opts.userPrompt }],
};

if (opts.tools?.length) {
  params.tools = opts.tools;
}

// Extended thinking — beta header required
let requestOptions: Parameters<typeof client.messages.create>[1] | undefined;
if (opts.thinkingBudget) {
  params.thinking = { type: "enabled", budget_tokens: opts.thinkingBudget };
  requestOptions = {
    headers: { "anthropic-beta": "interleaved-thinking-2025-05-14" },
  };
}
```

**Execute inner function:**
```typescript
const execute = async (): Promise<ClaudeRunResult> => {
  const response = await client.messages.create(params, requestOptions);

  const content = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const thinkingRaw = response.content
    .filter((b): b is Anthropic.ThinkingBlock => b.type === "thinking")
    .map((b) => b.thinking)
    .join("\n")
    .trim();

  return {
    // Empty text (e.g. tool-only response) mirrors old CLI empty-response guard
    content: content || mockOutput(opts.userPrompt),
    real: true,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    thinkingContent: thinkingRaw || undefined,
  };
};
```

**Timeout + error wrapper:**
```typescript
try {
  if (opts.timeoutMs) {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        const err = new Error(`Claude call timed out after ${opts.timeoutMs}ms`);
        (err as any).timeout = true;
        reject(err);
      }, opts.timeoutMs);
    });
    return await Promise.race([execute(), timeoutPromise]);
  }
  return await execute();
} catch (err) {
  if ((err as any).timeout) throw err;  // re-throw so callers can retry
  console.warn("[claude] API call failed:", (err as Error).message);
  return { content: mockOutput(opts.userPrompt), real: false, inputTokens: 0, outputTokens: 0 };
}
```

**Preserved unchanged:** `mockOutput(userPrompt)` and `detectPhase(prompt)` — copy verbatim from current `claude.ts`.

---

### `package.json` change

Add to `dependencies` in `server/package.json`:
```json
"@anthropic-ai/sdk": "^0.52.0"
```
Run `bun add @anthropic-ai/sdk` in `server/`. Developer should verify the latest `^0.x` version from `npm` at implementation time.

---

### `db.ts` — C5-2

**No change.** `db.run("PRAGMA journal_mode = WAL")` is already present on line 9. Confirm visually, mark the story done.

---

## Edge Cases

1. **`CLAUDE_CODE_OAUTH_TOKEN` is an OAuth token, not an API key.** SDK throws 401. Outer catch → mock fallback. Silent per spec (open question #2 deferred).

2. **Response has zero text blocks** (e.g. Claude replied with only `tool_use`). `content` → empty string → `mockOutput()` substituted, `real: true`. Callers use `.content` — they receive mock text. Acceptable until C6-3 adds tool dispatch.

3. **`thinkingBudget` set, `maxTokens` not set.** `effectiveMaxTokens = thinkingBudget + 1000`. Prevents API error `"max_tokens must be greater than budget_tokens"`.

4. **`thinkingBudget` + `maxTokens` both set, but `maxTokens <= thinkingBudget`.** API rejects. Not silently corrected — caller's bug. Developer may add a `console.warn` guard.

5. **Beta header type compatibility.** Extended thinking is passed via `requestOptions` second argument (not a `params.betas` property) to avoid SDK type friction. This pattern is stable across SDK versions.

6. **Timeout fires mid-request.** `Promise.race` rejects. In-flight `client.messages.create()` eventually settles but its result is discarded. No explicit abort needed for non-streaming calls. No leak.

7. **`@anthropic-ai/sdk` not yet installed when running typecheck.** Compile error. `bun add` must precede `bun run typecheck` in the commit sequence.

8. **`Anthropic.ThinkingBlock` type unavailable in the installed SDK version.** Use `(b as any).thinking` with the `b.type === "thinking"` guard. Runtime behaviour is identical.

9. **All existing callers compile unchanged.** They destructure only `.content` and `.real`. New fields (`inputTokens`, `outputTokens`, `thinkingContent`) are additive and optional-like. Zero breaking changes confirmed by reading all six agent files.
