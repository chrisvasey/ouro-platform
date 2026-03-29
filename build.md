# Implementation Plan — Cycle 10 (Attempt 3)

**Developer:** Ouro Developer Agent | **Date:** 2026-03-29 | **Cycle:** 10
**Status:** Re-issued after test failures (attempts 1 and 2/3). All 12 Playwright failures stem from unimplemented features — no code was written in either prior attempt (developer timed out). This plan is unchanged from agents/build.md; the task list is the authoritative numbered sequence.

---

## Numbered Task List

1. [server/src/db.ts] — Add idempotent `ALTER TABLE feed_messages ADD COLUMN thinking_content TEXT` migration (try/catch)
2. [server/src/db.ts] — Add idempotent `ALTER TABLE cycles ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0` migration (try/catch)
3. [server/src/db.ts] — Export `DAILY_BUDGET_LIMIT = 10.0` constant and `dailySpend(projectId): number` helper (SUM events.cost_usd since UTC midnight)
4. [server/src/db.ts] — Export `addCycleCost(cycleId, delta): void` helper (atomic `UPDATE cycles SET cost_usd = cost_usd + ?`)
5. [server/src/db.ts] — Add `cost_usd: number` to `CycleRow`, `CycleRun` interfaces and `parseCycleRow` return
6. [server/src/db.ts] — Add `thinking_content: string | null` to `FeedMessage` interface; add optional 6th param `thinkingContent?` to `postFeedMessage`; update INSERT and return object
7. [server/src/claude.ts] — Add `thinkingContent?: string` to `ClaudeRunResult`; collect `b.type === "thinking"` blocks in parse loop; join with `\n\n`; return in result object
8. [server/src/agents/base.ts] — Add `costUsd: number` (required) and `thinkingContent?: string` to `AgentResult` interface
9. [server/src/agents/researcher.ts] — Return `costUsd: totalCost` in final return object
10. [server/src/agents/pm.ts] — Return `costUsd: result.costUsd` in final return object
11. [server/src/agents/designer.ts] — Return `costUsd: totalCost` in final return object
12. [server/src/agents/developer.ts] — Return `costUsd: totalCost` in final return object
13. [server/src/agents/tester.ts] — Track `totalCost`, return `costUsd: totalCost` in final return object
14. [server/src/agents/documenter.ts] — Return `costUsd: result.costUsd` in final return object
15. [server/src/loop.ts] — Import `addCycleCost`, `dailySpend`, `DAILY_BUDGET_LIMIT`; add `broadcastSpendUpdate()` helper; after each phase call `addCycleCost` + `broadcastSpendUpdate`; pass `result.thinkingContent` to handoff `postFeedMessage`
16. [server/src/loop.ts] — Add budget gate at top of `runCycle()`: if `dailySpend >= DAILY_BUDGET_LIMIT`, send blocking inbox message and throw
17. [server/src/index.ts] — Add `GET /api/projects/:id/spend/today` route returning `{ spend: dailySpend(id), limit: DAILY_BUDGET_LIMIT }`; extend import from db.js
18. [server/src/index.ts] — Extend `GET /api/projects/:id/cycles` to include `cost_usd` from cycles table (rename to `total_cost_usd` in response)
19. [client/src/types.ts] — Add `thinking_content: string | null` to `FeedMessage`; add `blocks_cycle: number` to `InboxMessage`; add `total_cost_usd?: number` to `CycleRun`; add `SpendResponse` interface; add `spend_updated` to `WsEvent` union
20. [client/src/api.ts] — Add `spend.today(projectId)` method calling `GET /projects/:id/spend/today`
21. [client/src/App.tsx] — Add `dailySpend` state + initial fetch + 30s poll + `spend_updated` WS handler; derive `budgetHalted`, `hasBlocker`, `unreadInboxCount`; pass new props to `<TopBar>`
22. [client/src/components/TopBar.tsx] — Add inline `SpendIndicator` component (4 colour thresholds, division-by-zero guard); add inline `InboxBadge` component (blue/amber dot, `onInboxClick`); add 6 new props to `TopBarProps`; render between spacer and cycle button; disable Start Cycle button when `budgetHalted`
23. [client/src/components/FeedPanel.tsx] — Add inline `ReasoningToggle` component (`isOpen` state, monospace box, `max-h-48` scroll); render after message body when `msg.thinking_content` is truthy
24. [client/src/components/FeedPanel.tsx] — Add cost badge to `CycleHistoryRow`: render `$X.XX` span when `cycle.total_cost_usd > 0`
25. [client/src/components/ArtifactDrawer.tsx] — Add inline `MarkdownContent` component (`renderMarkdown` line-by-line state machine for headings/lists/code/hr/paragraphs; `applyInline` for bold and inline-code); replace `<pre>` with `<MarkdownContent content={artifact.content} />`

---

## Root Cause of Test Failures (Attempts 1 and 2)

All 12 Playwright failures are **unimplemented features** — the developer timed out in both prior attempts and wrote no code. The acceptance criteria being tested are:

- SpendIndicator not present in TopBar → `$X.XX / $10.00 today` missing from DOM
- ReasoningToggle not present in FeedMessageRow → `▸ Reasoning` button missing
- MarkdownContent not used in ArtifactDrawer → artifact rendered as `<pre>`, headings not styled
- InboxBadge not present in TopBar → inbox badge missing
- `thinking_content` column absent → server returns 500 or null on feed queries
- Budget-halted Start Cycle button not implemented → button always enabled

No logic fixes are needed — all 25 tasks above must be executed in order.

---

## Commit Plan

```
fix(db): migrate feed_messages.thinking_content and cycles.cost_usd columns
feat(db): add DAILY_BUDGET_LIMIT, dailySpend(), addCycleCost() helpers
feat(db): add thinking_content to FeedMessage and postFeedMessage
feat(claude): extract thinking blocks into thinkingContent on ClaudeRunResult
feat(agents): add costUsd to AgentResult; return from all six agents
feat(loop): accumulate cycle cost, spend broadcast, budget gate, thinkingContent handoff
feat(server): GET /api/projects/:id/spend/today + extend cycles with total_cost_usd
feat(types): thinking_content, blocks_cycle, total_cost_usd, SpendResponse, spend_updated
feat(api): add spend.today()
feat(app): daily spend state, polling, WS handler, budget/blocker derived values
feat(topbar): SpendIndicator, InboxBadge, budget-halted StartCycleButton
feat(feed): ReasoningToggle in FeedMessageRow + cost in CycleHistoryRow
feat(ui): MarkdownContent replaces <pre> in ArtifactDrawer
```
