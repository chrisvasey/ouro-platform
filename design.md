# Design Specification — Cycle 5

> **Scope:** Backend-only. No UI changes. One file changed: `server/src/claude.ts`.
> One new dependency: `@anthropic-ai/sdk`.

---

## User Flows

### C5-1 — Developer migrates `claude.ts` to Anthropic SDK

This story has no interactive user flow. It is a server-side refactor with no UI surface change.

**Internal call flow (before → after):**

Before:
```
runClaude(opts)
  → Bun.spawn(["claude", "--print", ...])
  → write prompt to stdin
  → read stdout
  → return { content, real }
```

After:
```
runClaude(opts)
  → resolve apiKey from env
  → new Anthropic({ apiKey })
  → client.messages.create({ model, system, messages, tools?, thinking?, max_tokens })
  → filter text blocks  → content
  → filter thinking blocks → thinkingContent
  → read usage.input_tokens / usage.output_tokens
  → return { content, real, inputTokens, outputTokens, thinkingContent? }
```

**Auth resolution order:**
1. `CLAUDE_CODE_OAUTH_TOKEN` present → use as `apiKey`
2. `ANTHROPIC_API_KEY` present → use as `apiKey`
3. Neither → skip SDK entirely, return mock immediately

**Timeout flow:**
```
Promise.race([
  client.messages.create(...),         // real SDK call
  new Promise(reject after timeoutMs)  // timeout sentinel
])
  → timeout fires → throw { timeout: true }
  → caller catches and retries (existing pattern, unchanged)
```

**Tool use flow (new, passive):**
```
opts.tools present && opts.tools.length > 0
  → forwarded as-is to messages.create({ tools: opts.tools })
  → response may contain tool_use blocks — ignored for now (no agentic loop)
  → text blocks joined → content (same as without tools)
```

**Extended thinking flow (new):**
```
opts.thinkingBudget present
  → clamp to max(opts.thinkingBudget, 1024)
  → messages.create({
      thinking: { type: 'enabled', budget_tokens: N },
      betas: ['interleaved-thinking-2025-05-14'],
      max_tokens: max(opts.maxTokens ?? 4096, N + 1024),
    })
  → thinking blocks extracted, joined → thinkingContent
  → text blocks → content (unchanged)
```

---

## Component Tree

No new components. This cycle is entirely within `server/src/claude.ts`.

Unchanged callers (no modifications required):
```
loop.ts
  └── agents/pm.ts          → runClaude(opts)
  └── agents/researcher.ts  → runClaude(opts)  [uses timeoutMs]
  └── agents/designer.ts    → runClaude(opts)
  └── agents/developer.ts   → runClaude(opts)
  └── agents/tester.ts      → runClaude(opts)
  └── agents/documenter.ts  → runClaude(opts)
```

All callers read only `result.content` and `result.real` — both fields remain. `inputTokens`, `outputTokens`, and `thinkingContent` are additive; callers that don't destructure them compile unchanged.

---

## Layout & Responsive Behaviour

N/A — no UI changes this cycle.

---

## Component Specs

### `ClaudeRunOptions` (updated interface)

```typescript
export interface ClaudeRunOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Max tokens to request. Defaults to 4096. */
  maxTokens?: number;
  /**
   * Per-call timeout in milliseconds. Rejects with .timeout = true.
   * Callers catch and retry. Defaults to no timeout.
   */
  timeoutMs?: number;
  /**
   * Optional tool definitions. Forwarded to the SDK as-is.
   * Type: Anthropic.Tool[] from @anthropic-ai/sdk.
   * Empty array is treated as absent (not forwarded).
   */
  tools?: Anthropic.Tool[];
  /**
   * If set, enables extended thinking with this token budget.
   * Adds thinking: { type: 'enabled', budget_tokens: N } and the beta header.
   * Clamped to minimum 1024.
   */
  thinkingBudget?: number;
}
```

### `ClaudeRunResult` (updated interface)

```typescript
export interface ClaudeRunResult {
  /** Joined text content from all TextBlock items in the response. */
  content: string;
  /** True = real API response; false = mock fallback. */
  real: boolean;
  /** Input tokens charged (prompt + context). 0 for mock. */
  inputTokens: number;
  /** Output tokens charged (completion). 0 for mock. */
  outputTokens: number;
  /**
   * Joined text from all ThinkingBlock items, if thinkingBudget was set
   * and the model returned thinking content. Undefined otherwise.
   */
  thinkingContent?: string;
}
```

### `runClaude()` — full implementation spec

**Model constant** (top of file):
```typescript
const CLAUDE_MODEL = "claude-sonnet-4-6";
```

**Client construction** — per-call, not a module singleton:
```typescript
const client = new Anthropic({ apiKey });
```
Reason: tokens read from `process.env` at call time; singleton would bake in startup state.

**`messages.create` parameter assembly:**
```typescript
const resolvedMaxTokens = opts.thinkingBudget
  ? Math.max(opts.maxTokens ?? 4096, opts.thinkingBudget + 1024)
  : (opts.maxTokens ?? 4096);

const params: Anthropic.MessageCreateParamsNonStreaming = {
  model: CLAUDE_MODEL,
  max_tokens: resolvedMaxTokens,
  system: opts.systemPrompt,
  messages: [{ role: "user", content: opts.userPrompt }],
};

if (opts.tools && opts.tools.length > 0) {
  params.tools = opts.tools;
}

if (opts.thinkingBudget) {
  const budget = Math.max(opts.thinkingBudget, 1024);
  if (budget !== opts.thinkingBudget) {
    console.warn(`[claude] thinkingBudget clamped ${opts.thinkingBudget} → ${budget}`);
  }
  params.thinking = { type: "enabled", budget_tokens: budget };
  (params as any).betas = ["interleaved-thinking-2025-05-14"];
}
```

Note: the `betas` field must be passed on the request object; check the SDK version for whether it is a top-level param or a header. If SDK v1 requires it as a header, use:
```typescript
const client = new Anthropic({ apiKey, defaultHeaders: { "anthropic-beta": "interleaved-thinking-2025-05-14" } });
```
Only attach the beta header when `thinkingBudget` is set. Construct a fresh client instance in that branch.

**Response extraction:**
```typescript
const response = await client.messages.create(params);

const textBlocks = response.content.filter(
  (b): b is Anthropic.TextBlock => b.type === "text"
);
const thinkingBlocks = response.content.filter(
  (b): b is Anthropic.ThinkingBlock => b.type === "thinking"
);

const content = textBlocks.map((b) => b.text).join("\n").trim();
const thinkingContent = thinkingBlocks.length > 0
  ? thinkingBlocks.map((b) => b.thinking).join("\n").trim()
  : undefined;

const inputTokens = response.usage.input_tokens;
const outputTokens = response.usage.output_tokens;
```

**Empty content guard** — if `content` is empty after extraction:
```typescript
if (!content) {
  console.warn("[claude] Response contained no text blocks — using mock");
  return { content: mockOutput(opts.userPrompt), real: false, inputTokens: 0, outputTokens: 0 };
}
```

**Error handling inside `execute()`:**
```typescript
try {
  // ... client.messages.create + extraction above
  return { content, real: true, inputTokens, outputTokens, thinkingContent };
} catch (err) {
  if ((err as any).timeout) throw err;  // re-throw timeout for caller retry
  if (err instanceof Anthropic.APIError) {
    console.warn(`[claude] API error ${err.status}: ${err.message}`);
  } else {
    console.warn("[claude] Unexpected error:", (err as Error).message);
  }
  return { content: mockOutput(opts.userPrompt), real: false, inputTokens: 0, outputTokens: 0 };
}
```

**Timeout wrapper** — identical structure to existing code:
```typescript
if (opts.timeoutMs) {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => {
      const err = new Error(`Claude call timed out after ${opts.timeoutMs}ms`);
      (err as any).timeout = true;
      reject(err);
    }, opts.timeoutMs)
  );
  return await Promise.race([execute(), timeoutPromise]);
}
return await execute();
```

**Mock fallback** — update return shape only:
```typescript
return {
  content: mockOutput(opts.userPrompt),
  real: false,
  inputTokens: 0,
  outputTokens: 0,
};
```

**`mockOutput()` and `detectPhase()`** — no changes. Keep verbatim.

---

## Edge Cases & Empty States

1. **No auth token** — both env vars absent → skip SDK, return mock. Log: `[claude] No auth token found — using mock output`

2. **Invalid token (401)** — `Anthropic.APIError` with status 401 → log and return mock. Do not throw.

3. **Rate limit (429)** — `Anthropic.APIError` with status 429 → log and return mock. The caller's retry loop (e.g., `researcher.ts` `runStep`) handles re-queuing with its own backoff.

4. **`thinkingBudget` set, no thinking blocks returned** — `thinkingContent` is `undefined`. Normal. Callers using thinking must handle `undefined`.

5. **`thinkingBudget` < 1024** — clamp to 1024, log warning. Do not throw.

6. **`tools` is empty array** — do not forward (avoids SDK validation error for empty tools). Guard: `opts.tools && opts.tools.length > 0`.

7. **`stop_reason === "tool_use"` with no text blocks** — model signalled tool call intent, produced no text. `content` will be empty → triggers empty content guard → return mock. Full agentic tool loops are out of scope for C5-1.

8. **`thinkingBudget` set, `maxTokens` not set** — use `thinkingBudget + 1024` as floor for `max_tokens` to ensure there is room for both thinking and output tokens.

9. **Timeout fires mid-SDK-call** — `Promise.race` rejects. The SDK call continues in background (no cancel API). This is acceptable; the background call will resolve and be garbage-collected. The timeout error propagates via `.timeout = true` and the caller retries.

10. **`@anthropic-ai/sdk` import missing** — `bun run typecheck` fails before any runtime issue. The package must be added to `server/package.json` and `bun install` run before changing `claude.ts`.

---

## Design Decisions

**Per-call client construction, not a singleton**
Auth tokens are resolved from `process.env` at call time. A singleton would bake in startup-time env state, preventing token rotation without a process restart. SDK client construction is O(1) overhead.

**Return mock on empty text content, never throw**
Every agent runner reads `result.content` as a string immediately. Throwing on empty content requires all callers to add a new catch path. Mock fallback with a log warning is non-fatal, keeps the cycle running, and is visible in server logs.

**Clamp `thinkingBudget`, don't throw**
A caller passing `thinkingBudget: 512` should not crash the cycle. Clamping with a warning surfaces the misconfiguration without halting production.

**Join text blocks with `"\n"`**
The SDK returns interleaved text and thinking blocks. Joining all text blocks with a newline preserves the full agent output. Agent prompts don't rely on exact block boundaries.

**Token fields default to 0 in mock**
Budget accounting code can safely sum `inputTokens + outputTokens` without null checks. Mock cycles contribute zero cost, which is correct.

**`betas` attachment strategy**
Only attach the thinking beta when `thinkingBudget` is set. This avoids unexpected behaviour on non-thinking calls and keeps the default call path clean.
