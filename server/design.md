# Design Specification — Ouro Platform Cycle 3

*Prepared by: Designer agent | Date: 2026-03-28*

> **Carry-forward note:** Cycle 2 design carries forward with three targeted corrections: (1) ThoughtLogPanel copy updated for adaptive thinking — panel is now "Claude's Reasoning" (Story 3 / GH#2); (2) ArtifactDiffView re-themed for `react-diff-view` replacing `git-diff-view` (Story 6 / GH#3); (3) BlockerModal reply flow annotated with IntentGate server-side processing (Story 16). No structural changes to component tree, layout specs, or other component specs.

---

## User Flows

### Flow 1 — Monitor a running cycle

1. User opens the dashboard with a project selected.
2. **CycleProgressBar** is pinned below TopBar showing all 6 steps. The active step pulses blue.
3. **AgentRail** (left sidebar) shows all 6 agent cards. The active agent's card has a blue border and pulsing dot.
4. Feed stream shows live messages in the center panel.
5. When a phase completes: the step turns green, elapsed time + token count + USD cost appear below the step label.
6. **CycleCostSummary** (right end of CycleProgressBar) updates the running total in real time.
7. User can click a completed step's artifact link (↗) to jump to ArtifactView for that phase.

---

### Flow 2 — Respond to a blocking inbox message

1. Cycle is running. An agent posts a `blocks_cycle = 1` inbox message (human-input request, budget exceeded, or self-mod proposal).
2. **BlockerModal** immediately appears as a full-screen overlay with backdrop.
3. Modal shows: type badge, subject, body. For self-mod proposals, an inline diff view appears below the body.
4. For human-input type: a reply textarea is visible below the body.
5. User types a reply and clicks "Submit reply" — or clicks "APPROVE" / "REJECT" for self-mod proposals.
6. Submit button disabled while request is in flight; shows spinner.
7. On success: modal closes, cycle resumes. Feed message appears confirming the reply.
8. If multiple blocking messages are queued: next modal appears immediately. Counter "1 of N blockers" in header.

**Decision points:**
- User clicks REJECT on self-mod: modal closes, cycle terminates with "Rejected by user" in the feed.
- Network error on submit: inline error below actions; modal stays open.
- **IntentGate (server-side, Story 16):** For `human_input` blocker replies, the server passes the reply text through `extractIntent()` before resuming the cycle. The UI does not change — the user types a natural-language reply as before. The cycle runner then branches on the extracted intent: `adjust_budget` updates the preference and continues; `stop_cycle` halts; `retry` re-queues the failed phase. This is invisible to the user but means the reply textarea should carry placeholder copy that hints at valid actions, e.g. `"e.g. Continue, Stop cycle, Retry, Increase budget to $20…"`

---

### Flow 3 — Review artifact diff between cycles

1. User clicks the "Artifacts" tab in the center panel tab bar.
2. **ArtifactView** renders. Six phase sub-tabs appear: research | spec | design | build | test | review. Tabs without an artifact for the current cycle are visually dimmed.
3. User clicks a phase tab (e.g., "design"). Latest artifact content renders in markdown.
4. User clicks the "Diff" toggle in the ArtifactToolbar. The view switches to **ArtifactDiffView** (react-diff-view).
5. Default diff: current cycle vs previous cycle. The **CycleSelector** dropdown (left of toolbar) lets the user pick "Cycle N vs Cycle N-1".
6. If no previous cycle exists, the Diff toggle is disabled with tooltip "Available from cycle 2 onwards".
7. Copy button copies raw artifact text. Download button downloads as a `.md` file named `{phase}-cycle{N}.md`.

---

### Flow 4 — Inspect agent thought log

1. User spots an AgentCard with a ∨ expand chevron at the bottom. The chevron is only present when thought entries exist for this agent in the current cycle.
2. User clicks the card (or the chevron). The **ThoughtLogPanel** slides open below the card body.
3. A list of thought entries is shown, each with an abbreviated summary and a timestamp.
4. User clicks "Expand" on an entry. The full `<thinking>` block text appears in a monospace scrollable box.
5. User clicks "Expand" again or clicks the card header to collapse.
6. Multiple cards can be expanded simultaneously; no accordion restriction.

---

### Flow 5 — Token cost & budget monitoring

1. After each phase completes, the CycleProgressBar step shows: `2m 14s · 1.2K · $0.18`.
2. Running total in CycleCostSummary: "Total: 4,821 tokens · $0.87".
3. When spend reaches 80% of daily budget: total text turns amber; a **PinnedBlockerBanner** appears above the feed: "Budget warning: $8.12 of $10.00 used today."
4. At 100%: cycle halts, BlockerModal fires with type "Budget exceeded", spend breakdown in body, no reply field — just a "Dismiss & close cycle" button.
5. To adjust budget: user clicks "Settings" tab in the right panel → BudgetInput → Save.
6. Budget check is per project per calendar day (UTC). New day resets the counter.

---

### Flow 6 — SSE reconnection

1. Network drops. WS closes.
2. A **ReconnectBanner** appears at the top of the center panel (not the pinned error area): "Connection lost — reconnecting…" with a spinner.
3. WS reconnects after 3s. Server sends a full state snapshot before resuming deltas.
4. ReconnectBanner changes to "Reconnected" for 2 seconds, then auto-dismisses.
5. Feed is fully up to date; no blank state.

---

## Component Tree

```
App
├── BlockerModal (portal, fixed, z-50)          — conditional, mounts when queue.length > 0
│   ├── BlockerModalBackdrop
│   └── BlockerModalDialog
│       ├── BlockerModalHeader
│       │   ├── BlockerTypeBadge
│       │   └── BlockerSubject
│       ├── BlockerModalBody (scrollable)
│       │   ├── BlockerBodyText
│       │   └── BlockerDiffView?             — only for proposed_changes type
│       ├── BlockerReplyArea?                 — only for human_input type
│       │   └── BlockerReplyTextarea
│       └── BlockerModalActions
│           ├── BlockerCounterLabel?          — "1 of N blockers"
│           ├── BlockerRejectButton?
│           ├── BlockerApproveButton?
│           └── BlockerSubmitButton?
│
├── TopBar                                       — unchanged from Cycle 1
│   ├── TopBarLogo
│   ├── TopBarDivider
│   ├── ProjectSwitcherTrigger
│   ├── PhaseBadge
│   ├── TopBarSpacer
│   └── CycleControls
│
├── CycleProgressBar                             — new, pinned below TopBar
│   ├── CycleProgressStep × 6                   — research/spec/design/build/test/review
│   │   ├── StepConnector (line before step, hidden on first)
│   │   ├── StepIndicator (icon circle)
│   │   ├── StepLabel
│   │   └── StepMeta?                           — elapsed · tokens · cost · artifact link
│   └── CycleCostSummary
│
└── MainLayout (flex row, flex-1)
    ├── AgentRail (left, w-64)
    │   ├── AgentRailHeader
    │   └── AgentCard × 6
    │       ├── AgentCardHeader
    │       │   ├── AgentRoleIcon
    │       │   ├── AgentRoleName
    │       │   └── StatusBadge
    │       ├── AgentCardTask?               — visible when thinking
    │       ├── AgentCardMeta
    │       │   ├── AgentLastActionTime
    │       │   └── AgentTokenBadge?         — phase token count
    │       └── ThoughtLogPanel?             — expanded state only
    │           ├── ThoughtEntry × N
    │           │   ├── ThoughtSummary
    │           │   ├── ThoughtTimestamp
    │           │   ├── ThoughtExpandButton
    │           │   └── ThoughtFullText?     — expanded state only
    │           └── ThoughtLogEmpty?
    │
    ├── CenterPanel (flex-1)
    │   ├── CenterPanelTabs                  — [Feed | Artifacts]
    │   ├── ReconnectBanner?                 — ws reconnection state
    │   ├── PinnedBlockerBanner × N?         — non-modal warnings (budget, retry)
    │   ├── FeedView                         — active when Feed tab
    │   │   ├── FeedMessage × N
    │   │   │   ├── FeedMessageHeader
    │   │   │   │   ├── FeedSenderLabel
    │   │   │   │   ├── FeedRecipientLabel
    │   │   │   │   ├── FeedTypeBadge
    │   │   │   │   └── FeedTimestamp
    │   │   │   ├── FeedMessageContent       — react-markdown
    │   │   │   └── FeedToolCallBlock?       — collapsible, for tool_call events
    │   │   │       ├── ToolCallHeader (tool name, chevron)
    │   │   │       └── ToolCallDetail?      — JSON, syntax-highlighted, expanded state
    │   │   └── FeedEmpty
    │   └── ArtifactView                     — active when Artifacts tab
    │       ├── ArtifactPhaseTabs            — research/spec/design/build/test/review
    │       ├── ArtifactToolbar
    │       │   ├── CycleSelector
    │       │   ├── ViewToggle               — [Rendered | Diff]
    │       │   ├── ArtifactToolbarSpacer
    │       │   ├── ArtifactCopyButton
    │       │   └── ArtifactDownloadButton
    │       ├── ArtifactRendered             — react-markdown, visible in Rendered mode
    │       ├── ArtifactDiffView             — react-diff-view, visible in Diff mode
    │       └── ArtifactEmpty?               — when no artifact for selected phase+cycle
    │
    └── RightPanel (w-72)
        ├── RightPanelTabs                   — [Inbox | Settings]
        ├── InboxView                        — active when Inbox tab
        │   ├── InboxMessage × N
        │   │   ├── InboxMessageHeader
        │   │   ├── InboxMessageBody
        │   │   └── InboxReplyForm?          — when not yet replied
        │   └── InboxEmpty
        └── SettingsView                     — active when Settings tab
            ├── SettingsBudgetSection
            │   ├── BudgetSectionLabel
            │   ├── BudgetInputGroup
            │   │   ├── BudgetCurrencyPrefix
            │   │   ├── BudgetInput
            │   │   └── BudgetInputSuffix
            │   ├── BudgetHelperText
            │   ├── BudgetError?
            │   └── BudgetSaveButton
            └── SettingsSelfModSection
                ├── SelfModSectionLabel
                ├── SelfModStatusBadge       — always-enabled green badge
                └── SelfModHelperText
```

---

## Layout Specs

### App shell

| Layer | Class | Height |
|---|---|---|
| TopBar | `h-12 flex-shrink-0` | 48px |
| CycleProgressBar | `h-14 flex-shrink-0` | 56px |
| MainLayout | `flex-1 flex overflow-hidden` | remaining |

### CycleProgressBar

| Property | Value |
|---|---|
| Height | `h-14` |
| Background | `bg-gray-900` |
| Border | `border-b border-gray-800` |
| Padding | `px-4` |
| Alignment | `flex items-center` |

StepIndicator circle:

| Property | Value |
|---|---|
| Size | `w-6 h-6` (24px) |
| Border radius | `rounded-full` |
| Font | `text-[10px] font-semibold` |

StepConnector line:

| Property | Value |
|---|---|
| Width | `flex-1` (grows to fill between steps) |
| Height | `h-px` |
| Colour | `bg-gray-800` |
| Min width | `min-w-[12px]` |

StepMeta text:

| Property | Value |
|---|---|
| Position | absolute, `top-full mt-0.5`, centred under step |
| Font | `text-[9px] text-gray-500 whitespace-nowrap` |
| Artifact link | `text-blue-400 hover:text-blue-300` |

CycleCostSummary:

| Property | Value |
|---|---|
| Margin | `ml-auto pl-6` |
| Font | `text-xs text-gray-400` |
| Value font | `text-xs text-gray-200` |
| Budget warning | `text-amber-400` when >80% of daily budget |

### AgentRail

| Property | Value |
|---|---|
| Width | `w-64 flex-shrink-0` |
| Border | `border-r border-gray-800` |
| Overflow | `overflow-y-auto` |
| Padding | `p-2` gap `gap-2 flex-col flex` |

Header:

| Property | Value |
|---|---|
| Height | `h-9` |
| Padding | `px-3` |
| Border | `border-b border-gray-800` |
| Label | `text-xs font-semibold text-gray-500 uppercase tracking-wider` |

AgentCard:

| Property | Value |
|---|---|
| Border radius | `rounded-lg` |
| Padding | `p-3` |
| Border | `border` (colour varies by state) |
| Transition | `transition-colors duration-150` |

AgentTokenBadge:

| Property | Value |
|---|---|
| Font | `text-[9px] text-gray-600` |
| Background | `bg-gray-800 px-1 py-0.5 rounded` |
| Position | bottom-right of card footer row |

### CenterPanel

| Property | Value |
|---|---|
| Flex | `flex-1 flex flex-col overflow-hidden` |

CenterPanelTabs bar:

| Property | Value |
|---|---|
| Height | `h-9` |
| Background | `bg-gray-900` |
| Border | `border-b border-gray-800` |
| Padding | `px-2` |
| Gap | `gap-1` |

Tab button:

| State | Class |
|---|---|
| Default | `px-3 h-full text-sm text-gray-500 border-b-2 border-transparent` |
| Active | `text-gray-200 border-b-2 border-blue-500` |
| Hover | `text-gray-300` |

PinnedBlockerBanner:

| Property | Value |
|---|---|
| Background | `bg-amber-950/15` |
| Border | `border-b border-amber-900/40` |
| Padding | `px-4 py-1.5` |
| Font | `text-xs text-amber-400` |
| Max stack | 3 banners visible; "and N more" if exceeded |

ReconnectBanner:

| Property | Value |
|---|---|
| Background | `bg-gray-800` |
| Border | `border-b border-gray-700` |
| Padding | `px-4 py-1.5` |
| Font | `text-xs text-gray-400` |

Feed scroll area:

| Property | Value |
|---|---|
| Flex | `flex-1 overflow-y-auto` |
| Padding | `p-3` |
| Direction | newest at top (prepend on WS event) |

### ArtifactView layout

| Property | Value |
|---|---|
| Flex | `flex-1 flex flex-col overflow-hidden` |

ArtifactPhaseTabs:

| Property | Value |
|---|---|
| Height | `h-8` |
| Background | `bg-gray-950` |
| Border | `border-b border-gray-800` |
| Overflow | `overflow-x-auto` scrollbar hidden |

ArtifactToolbar:

| Property | Value |
|---|---|
| Height | `h-9` |
| Background | `bg-gray-900` |
| Border | `border-b border-gray-800` |
| Padding | `px-3` |
| Gap | `gap-2` |

ViewToggle pair:

| Property | Value |
|---|---|
| Container | `flex rounded overflow-hidden border border-gray-700` |
| Button | `px-2.5 py-1 text-xs` |
| Active | `bg-gray-700 text-gray-200` |
| Inactive | `bg-transparent text-gray-500 hover:text-gray-300` |

### RightPanel

| Property | Value |
|---|---|
| Width | `w-72 flex-shrink-0` |
| Border | `border-l border-gray-800` |
| Flex | `flex flex-col overflow-hidden` |

RightPanelTabs identical to CenterPanelTabs spec.

SettingsView padding: `p-4 flex flex-col gap-6 overflow-y-auto`

BudgetInputGroup:

| Property | Value |
|---|---|
| Container | `flex items-center gap-1.5` |
| Prefix/suffix | `text-sm text-gray-500` |
| Input | `w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 focus:border-gray-500 focus:outline-none` |

### BlockerModal

| Property | Value |
|---|---|
| Backdrop | `fixed inset-0 z-50 bg-gray-950/85 flex items-center justify-center` |
| Dialog | `w-[620px] max-w-[92vw] max-h-[82vh] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden` |
| Header | `px-6 py-4 border-b border-gray-800` |
| Body | `px-6 py-4 flex-1 overflow-y-auto` |
| Reply area | `px-6 py-3 border-t border-gray-800` |
| Actions | `px-6 py-4 border-t border-gray-800 flex items-center justify-end gap-3` |

BlockerTypeBadge colours:

| Type | Badge |
|---|---|
| human_input | `bg-blue-900 text-blue-300 border-blue-700` |
| budget_exceeded | `bg-amber-900 text-amber-300 border-amber-700` |
| proposed_changes | `bg-violet-900 text-violet-300 border-violet-700` |
| phase_escalated | `bg-red-900 text-red-300 border-red-700` |

BlockerDiffView height: `max-h-52 overflow-y-auto border border-gray-800 rounded mt-3`

Reply textarea: `w-full bg-gray-800 border border-gray-700 rounded p-2.5 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none resize-none h-20` — placeholder varies by `blocker_sub_type` (see BlockerModal component spec)

### Colour token reference

| Token | Hex | Usage |
|---|---|---|
| `bg-gray-950` | `#030712` | App background |
| `bg-gray-900` | `#111827` | TopBar, panels, dialogs |
| `bg-gray-800` | `#1f2937` | Inputs, item hover |
| `bg-gray-700` | `#374151` | Active toggle buttons |
| `border-gray-800` | `#1f2937` | Panel borders, dividers |
| `text-gray-100` | `#f3f4f6` | Primary text |
| `text-gray-300` | `#d1d5db` | Body text, artifact content |
| `text-gray-500` | `#6b7280` | Labels, placeholders |
| `blue-500` | `#3b82f6` | Active tab underline |
| `blue-700` | `#1d4ed8` | Submit buttons |
| `blue-950/30` | — | AgentCard thinking bg |
| `green-800` | `#166534` | Complete step, approve button |
| `amber-800/40` | — | Budget warning banner border |
| `amber-950/15` | — | Budget warning banner bg |
| `red-900` | `#7f1d1d` | Failed step, reject button bg |
| `violet-900` | `#4c1d95` | Self-mod badge bg |

---

## Component Specs

---

### CycleProgressBar

**Appearance**
`h-14 border-b border-gray-800 bg-gray-900 flex items-center px-4`

**StepIndicator states**

| State | Circle classes |
|---|---|
| pending | `border border-gray-700 bg-gray-900 text-gray-600` |
| active | `border border-blue-500 bg-blue-950 text-blue-400 animate-pulse` |
| active-parallel | same as active; two steps pulse simultaneously |
| complete | `bg-green-800 border border-green-700 text-green-200` + `✓` |
| failed | `bg-red-900 border border-red-700 text-red-300` + `✗` |
| skipped | `border border-gray-700 bg-gray-900 text-gray-500 opacity-40` + `/` |

**StepMeta** (rendered only after phase completes):
Format: `2m 14s · 1.2K · $0.18`
Artifact link: `↗` icon, `text-blue-400`, click jumps to ArtifactView filtered to that phase.
Phase retry counter (when retrying, visible during active state only): `retry 2/3` in `text-[9px] text-amber-500`

**CycleCostSummary states**:
- No cycle: hidden
- Running: "Total: 1,234 tokens · $0.43" — values update on each phase_completed event
- Budget warning (>80%): values in `text-amber-400`
- Stopped / complete: static display of final values

**Interactions**:
- Clicking a completed step's artifact link: sets active tab to "Artifacts" and filters to that phase.
- No other click targets — bar is display-only except artifact links.

**Data it needs**:
- `cyclePhaseStates: Record<string, PhaseState>` — keyed by phase name
- `phaseMeta: Record<string, { elapsed_ms, token_count, cost_usd, artifact_id }>` — populated as phases complete
- `totalTokens: number`
- `totalCostUsd: number`
- `budgetDailyUsd: number`

---

### AgentCard

**Appearance**
`rounded-lg p-3 border transition-colors cursor-pointer select-none`

State-based classes:
- thinking: `border-blue-800 bg-blue-950/30`
- blocked: `border-amber-800 bg-amber-950/20`
- idle: `border-gray-800 bg-gray-900`

**Header row** (`flex items-center justify-between mb-1`):
- Left: emoji (`text-base`) + role label (`text-xs font-medium text-gray-300`)
- Right: `StatusBadge`

**Task row** (only when thinking and `current_task` non-null):
`text-xs text-gray-500 leading-snug truncate mt-1` max-width `calc(100% - 8px)`, `title` attribute set for full text

**Footer row** (`flex items-center justify-between mt-1.5`):
- Left: `AgentLastActionTime` — `text-[10px] text-gray-600`
- Right: `AgentTokenBadge?` — `text-[9px] bg-gray-800 text-gray-600 px-1 py-0.5 rounded` shows token count for this agent's last phase; hidden if 0

**ThoughtLogToggle** (bottom of card, only when thoughts exist):
`flex items-center justify-center w-full pt-1.5 mt-1.5 border-t border-gray-800 text-[10px] text-gray-600 hover:text-gray-400`
Label: `∨ Reasoning (N)` when collapsed, `∧ Hide reasoning` when expanded
`title` tooltip on the toggle button: "Summarised by the model — not raw internal thoughts."

**ThoughtLogPanel** (expanded, renders inside the card below toggle):
Panel header: `text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5` — "Claude's Reasoning"
`mt-2 space-y-1.5 max-h-48 overflow-y-auto`

ThoughtEntry:
- Container: `py-1.5 border-b border-gray-900 last:border-0`
- Summary: `text-xs text-gray-400 leading-snug`
- Timestamp: `text-[10px] text-gray-600 mt-0.5`
- Expand button: `text-[10px] text-blue-400 hover:text-blue-300 mt-0.5`
- Full text (expanded): `font-mono text-xs text-gray-500 bg-gray-950/60 p-2 rounded mt-1 max-h-36 overflow-y-auto`

**Interactions**:
- Click card header row: toggle ThoughtLogPanel (if thoughts exist)
- Click ThoughtEntry "Expand": toggle full text inline; other entries unaffected

**Data it needs**:
- `agent: Agent` — from existing type + new `token_count?: number`
- `thoughts: ThoughtEntry[]` — new, from events table `event_type = 'thinking'`

---

### StatusBadge

Unchanged from current implementation, extended with `done` state:

| Status | Classes |
|---|---|
| idle | `text-gray-500` + gray dot |
| thinking | `text-blue-400` + pulsing blue dot |
| blocked | `text-amber-400` + amber dot |
| done | `text-green-500` + green dot |

---

### CenterPanelTabs / RightPanelTabs

**Appearance**
`flex h-9 items-end border-b border-gray-800 bg-gray-900 px-2 gap-1`

Tab button: `px-3 h-full flex items-center text-sm border-b-2 transition-colors`
- Default: `text-gray-500 border-transparent hover:text-gray-300`
- Active: `text-gray-200 border-blue-500`

Badge on Inbox tab (unread count): `ml-1.5 text-[10px] bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded-full`

**Interactions**:
- Click tab: switch visible panel
- No keyboard shortcuts required for MVP (arrow keys within the tab bar are a stretch goal)

**Data it needs**:
- `activeTab: string`
- `onTabChange: (tab: string) => void`
- `inboxUnreadCount?: number` — for Inbox badge

---

### PinnedBlockerBanner

**Appearance**
`bg-amber-950/15 border-b border-amber-900/40 px-4 py-1.5 flex items-center gap-2`

Icon: `▲` triangle `text-amber-500 text-[10px]`
Text: `text-xs text-amber-400`
Dismiss: `×` `ml-auto text-amber-700 hover:text-amber-500 text-sm cursor-pointer`

Multiple banners: each renders as a separate row. Max 3 visible at once; if more, last row reads "and N more warnings" with a `text-amber-600` colour.

Banner types and messages:

| Type | Message |
|---|---|
| budget_warning | "Budget warning: $8.12 of $10.00 used today" |
| phase_retry | "Spec phase failed — retry 2/3 in progress" |
| sse_reconnecting | "Connection lost — reconnecting…" (with spinner) |

**States**:
- Dismissed: removed from list; stored in component state, not persisted
- SSE reconnecting: auto-dismisses 2s after reconnect, replaced by "Reconnected" flash

**Data it needs**:
- `banners: Banner[]` — derived from WS events + budget state

---

### ReconnectBanner

**Appearance**
`bg-gray-800 border-b border-gray-700 px-4 py-1.5 flex items-center gap-2`
Spinner: 12px spinning circle `text-gray-500`
Text: `text-xs text-gray-400`

States: reconnecting → reconnected (2s) → hidden

---

### BlockerModal

**Backdrop**
`fixed inset-0 z-50 bg-gray-950/85 backdrop-blur-sm flex items-center justify-center`

**Dialog**
`w-[620px] max-w-[92vw] max-h-[82vh] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden`

**Header** (`px-6 py-4 border-b border-gray-800 flex items-start gap-3`):
- `BlockerTypeBadge`: `text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border`
- Subject: `text-base font-semibold text-gray-100 leading-tight flex-1`
- Counter (if queue > 1): `ml-auto text-xs text-gray-500 whitespace-nowrap` — "1 of 3"

**Body** (`px-6 py-4 flex-1 overflow-y-auto min-h-0`):
- Body text: `text-sm text-gray-300 leading-relaxed`
- Spend table (budget_exceeded type): 2-col table `text-xs`; left `text-gray-500`, right `text-gray-200 font-mono`
- BlockerDiffView (proposed_changes type): `mt-4 border border-gray-800 rounded overflow-hidden max-h-56`

**Reply area** (human_input type only, `px-6 py-3 border-t border-gray-800`):
- Label: `text-xs font-medium text-gray-400 mb-1.5`
- Textarea: `w-full bg-gray-800 border border-gray-700 rounded p-2.5 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none resize-none h-20`
- Textarea `placeholder` text varies by blocker sub-type:
  - `budget_warning` reply: `"e.g. Continue, Increase budget to $20, Stop cycle…"`
  - `phase_escalated` reply: `"e.g. Retry, Skip this phase, Stop cycle…"`
  - Generic `human_input`: `"Type your reply…"`
- Helper line below textarea: `text-[10px] text-gray-600 mt-1` — "Your reply will be interpreted automatically." (IntentGate hint)
- Inline error: `text-xs text-red-400 mt-1`

**Actions** (`px-6 py-4 border-t border-gray-800 flex items-center gap-3`):

proposed_changes type:
- `BlockerRejectButton`: `border border-red-800 text-red-400 hover:bg-red-950/40 px-4 py-1.5 text-sm rounded transition-colors`
- `BlockerApproveButton`: `bg-green-800 text-green-100 hover:bg-green-700 px-4 py-1.5 text-sm rounded transition-colors`

human_input type:
- `BlockerSubmitButton`: `bg-blue-700 text-white hover:bg-blue-600 px-4 py-1.5 text-sm rounded disabled:opacity-40 transition-colors`

budget_exceeded type:
- `BlockerDismissButton`: `border border-gray-700 text-gray-400 hover:bg-gray-800 px-4 py-1.5 text-sm rounded` — dismisses and marks cycle as stopped

**States**:
- Idle: buttons enabled
- Submitting: all buttons disabled; active button shows 12px spinner replacing label
- Error: inline `text-xs text-red-400` above actions row; buttons re-enabled

**Interactions**:
- `Escape` key: no effect (modal must be explicitly resolved)
- Click backdrop: no effect (same reason)
- Tab/Shift-Tab: focus trapped within dialog

**Data it needs**:
- `message: InboxMessage & { blocks_cycle: 1; blocker_sub_type?: 'budget_warning' | 'phase_escalated' | 'human_input'; proposed_diff?: string; spend_summary?: SpendSummary }`
- `queueLength: number`
- `onSubmitReply: (reply: string) => Promise<void>` — server calls `extractIntent()` on this reply; UI does not need to handle the branching
- `onApprove: () => Promise<void>`
- `onReject: () => Promise<void>`

---

### ArtifactPhaseTabs

**Appearance**
`flex border-b border-gray-800 bg-gray-950 overflow-x-auto`

Phase tab button: `px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors`
- Has artifact: `text-gray-400 border-transparent hover:text-gray-200`
- Active: `text-gray-200 border-blue-500`
- No artifact: `text-gray-600 border-transparent cursor-default` — click has no effect

**Data it needs**:
- `phases: string[]` — `['research', 'spec', 'design', 'build', 'test', 'review']`
- `activePhase: string`
- `artifactsByPhase: Record<string, boolean>` — true if artifact exists
- `onPhaseChange: (phase: string) => void`

---

### ArtifactToolbar

**Appearance**
`h-9 border-b border-gray-800 bg-gray-900 flex items-center px-3 gap-2`

**CycleSelector**:
`bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-2 py-1 focus:outline-none focus:border-gray-500`
Options labelled: "Cycle 1", "Cycle 2", etc. Selected cycle is the "new" side of the diff.

**ViewToggle**:
`flex rounded border border-gray-700 overflow-hidden`
- Rendered button: `px-2.5 py-1 text-xs`
- Diff button: `px-2.5 py-1 text-xs`
- Active: `bg-gray-700 text-gray-200`
- Inactive: `text-gray-500 hover:text-gray-300`
- Diff button is `disabled opacity-40 cursor-not-allowed` when only 1 cycle exists

**ArtifactCopyButton** / **ArtifactDownloadButton**:
`ml-auto` / `ml-1`
`text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors`

**States**:
- Rendered mode: ArtifactRendered visible, ArtifactDiffView hidden
- Diff mode: ArtifactDiffView visible, ArtifactRendered hidden
- Diff disabled (only 1 cycle): ViewToggle Diff button dimmed; hover shows `title="Available from cycle 2 onwards"`

**Data it needs**:
- `cycles: { id: string; label: string }[]`
- `selectedCycleId: string`
- `activeView: 'rendered' | 'diff'`
- `onCycleChange: (id: string) => void`
- `onViewChange: (view: 'rendered' | 'diff') => void`
- `onCopy: () => void`
- `onDownload: () => void`

---

### ArtifactRendered

**Appearance**
`px-6 py-5 flex-1 overflow-y-auto text-sm text-gray-300 leading-relaxed`

Markdown element overrides (Tailwind prose-like, custom):

| Element | Classes |
|---|---|
| h1 | `text-base font-semibold text-gray-100 mt-5 mb-2` |
| h2 | `text-sm font-semibold text-gray-200 mt-4 mb-1.5 border-b border-gray-800 pb-1` |
| h3 | `text-sm font-medium text-gray-300 mt-3 mb-1` |
| p | `mb-3` |
| ul/ol | `mb-3 pl-5 space-y-1` |
| li | `text-gray-300` |
| code (inline) | `font-mono text-[11px] bg-gray-800 text-gray-300 px-1 py-0.5 rounded` |
| pre (block) | `bg-gray-950 border border-gray-800 rounded p-3 text-[11px] font-mono overflow-x-auto mb-3` |
| table | `w-full text-xs border-collapse mb-3` |
| th | `text-left text-gray-500 font-medium px-3 py-1.5 border-b border-gray-800` |
| td | `px-3 py-1.5 border-b border-gray-900 text-gray-400` |
| blockquote | `border-l-2 border-gray-700 pl-3 text-gray-500 italic` |
| a | `text-blue-400 hover:text-blue-300 underline` |
| hr | `border-gray-800 my-4` |

**Data it needs**:
- `content: string` — raw markdown

---

### ArtifactDiffView

**Appearance**
Wrapper: `flex-1 overflow-y-auto` (fills remaining height)

Uses **`react-diff-view`** (imported from `react-diff-view/esm`). Import the base stylesheet (`react-diff-view/style/index.css`), then override with the following CSS class rules scoped under `.artifact-diff-view`:

| CSS selector | Rule |
|---|---|
| `.diff-line-add` | `background: rgba(22, 101, 52, 0.25)` |
| `.diff-code-add` | `background: rgba(22, 101, 52, 0.12)` |
| `.diff-gutter-add` | `background: rgba(22, 101, 52, 0.50); color: #4b5563` |
| `.diff-line-delete` | `background: rgba(127, 29, 29, 0.25)` |
| `.diff-code-delete` | `background: rgba(127, 29, 29, 0.12)` |
| `.diff-gutter-delete` | `background: rgba(127, 29, 29, 0.50); color: #4b5563` |
| `.diff-gutter-normal` | `background: transparent; color: #4b5563` |
| `.diff-line-normal` | `background: transparent` |
| `.diff-code-edit` | `font-family: ui-monospace, monospace; font-size: 11px; color: #d1d5db` |
| `.diff-widget-content` | `background: #030712` (gray-950) |

**Usage:** parse the unified diff string with `parseDiff(diffStr)` from `react-diff-view`, then render `<Diff viewType="unified">` with `<Hunk>` children. Wrap with `<div className="artifact-diff-view">` for scoped overrides.

**ArtifactEmpty** (no artifact for selection):
`flex-1 flex items-center justify-center text-sm text-gray-600`
"No artifact generated for this phase in the selected cycle."

**States**:
- Loading artifact: skeleton lines `h-3 bg-gray-800 rounded animate-pulse` — 8 lines varying width
- No previous version (diff mode): `text-center py-12 text-sm text-gray-600` — "No previous version to compare"

**Data it needs**:
- `diffContent: string` — unified diff string from `artifacts.diff_from_previous` (produced server-side by `diff.createPatch()`); passed directly to `parseDiff()`
- `filename: string` — e.g., `design.md` (used as the Diff `gutterType` label)

---

### FeedMessage (upgraded)

**Appearance** (unchanged from Cycle 1 except FeedToolCallBlock addition)

**FeedTypeBadge** new type: `tool_call`
`bg-gray-800 text-gray-500 border border-gray-700`

**FeedToolCallBlock** (appended below FeedMessageContent when `message_type === 'tool_call'` or event has tool_call payload):

Container: `mt-2 border border-gray-800 rounded overflow-hidden`

Header (always visible, clickable):
`flex items-center gap-2 px-3 py-1.5 bg-gray-900 cursor-pointer hover:bg-gray-800 transition-colors`
- Icon: `⚙` `text-gray-500 text-xs`
- Tool name: `font-mono text-xs text-gray-400`
- Args preview (collapsed): `text-xs text-gray-600 truncate flex-1` — first 50 chars of stringified args
- Chevron: `text-gray-600 transition-transform` rotates 180° when expanded

Detail (expanded):
`px-3 py-2 text-[11px] font-mono text-gray-500 bg-gray-950 max-h-56 overflow-y-auto`
Rendered as pretty-printed JSON with syntax highlighting via rehype-highlight.

**States**:
- Collapsed: shows header only
- Expanded: shows header + detail block

**Interactions**:
- Click header: toggle expanded state
- Independent per message — no accordion

---

### InboxView

Unchanged from Cycle 1. The `blocks_cycle=1` messages will be intercepted and shown as BlockerModal before reaching InboxView; they are also listed in InboxView in a dimmed "Active blockers" section at the top after resolution.

New: resolved blocker messages get a `resolved` visual state:
`border-green-900/40 bg-green-950/10` with `text-[10px] text-green-600` sub-label "Cycle resumed"

---

### SettingsView

**Appearance**
`p-4 flex flex-col gap-6 overflow-y-auto text-sm`

**BudgetSection**

Label: `text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2`
Text: "Daily Token Budget"

InputGroup: `flex items-center gap-1.5`
- `$` prefix: `text-sm text-gray-500`
- Input: `w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 text-right focus:border-gray-500 focus:outline-none` — type `number`, min `0.01`, step `0.01`
- `/day` suffix: `text-sm text-gray-500`

Helper text: `text-xs text-gray-600 mt-1` — "Cycle stops and notifies you when exceeded."
Error: `text-xs text-red-400 mt-1`

SaveButton:
- Default: `text-xs bg-blue-700 text-white hover:bg-blue-600 px-3 py-1.5 rounded mt-2 disabled:opacity-40`
- Disabled when value unchanged or invalid
- Saving: spinner replacing text, disabled

**SelfModSection**

Label: same style as BudgetSection label.
Text: "Self-Modification Gate"

Status row: `flex items-center gap-2 mt-1`
- Badge: `text-[10px] bg-green-900 text-green-400 border border-green-800 px-1.5 py-0.5 rounded font-medium` — "ENABLED"
- Description: `text-xs text-gray-500`

Helper text: `text-xs text-gray-600 mt-1` — "Changes to /server/src/ require your approval. Scope can be extended to include prompts/."

**Data it needs**:
- `budgetDailyUsd: number`
- `onSaveBudget: (usd: number) => Promise<void>`
- `selfModEnabled: boolean` — read-only, always true for MVP

---

## Edge Cases

1. **No cycles run yet**: CycleProgressBar shows all 6 steps as pending gray. CycleCostSummary hidden. No stale data is shown. ArtifactView's all phase tabs are dimmed.

2. **Parallel phases active (research + design-draft)**: Two steps pulse simultaneously in the progress bar. The design step label reads "design (draft)" when in the early-draft phase and "design (final)" when in the refinement phase. Step meta shows both phase's timing stacked or as separate entries.

3. **Phase retrying**: Step returns to pulsing-active with a `retry 2/3` sub-label in amber. The step does not flash red until the 3rd failure.

4. **Phase fails all 3 retries and escalates**: Step turns red with `✗` and sub-label "Escalated". BlockerModal fires with `phase_escalated` type. The cycle progress bar does not advance past this step until the blocker is resolved or dismissed.

5. **Budget exceeded mid-phase**: The active step turns amber (not red — it's a controlled stop). CycleCostSummary turns amber. BlockerModal fires with `budget_exceeded` type, spend table in body, and a single "Dismiss & close cycle" action. No reply field.

6. **Multiple blocking messages queue up**: BlockerModal shows one at a time. Counter "1 of 3" in header. Resolving one immediately shows the next. Queue is ordered by `created_at` ascending.

7. **Self-modification diff is very long (>200 lines)**: BlockerDiffView inside the modal is capped at `max-h-56` with scroll. The dialog does not grow taller than `max-h-[82vh]`. The body section scrolls independently.

8. **Phase tab has no artifact**: Tab is visible but uses `text-gray-600 cursor-default`. Clicking it does nothing. Content area shows ArtifactEmpty. CycleSelector remains functional in case a prior cycle has this artifact.

9. **Artifact Diff: first cycle only**: The ViewToggle Diff button is `disabled opacity-40 cursor-not-allowed`. A `title` tooltip reads "Available from cycle 2 onwards". No diff mode is accessible.

10. **No thoughts recorded for an agent**: The ThoughtLogToggle chevron is not rendered on AgentCard. The card is not expandable. This is the default state for agents not yet run in the current cycle.

11. **Token count zero on a completed phase**: StepMeta shows `— · —` instead of "0 tokens · $0.00" to distinguish "not yet run" from "ran but had no tokens" (which shouldn't happen but avoids confusion).

12. **More than 3 PinnedBlockerBanners**: Display the 3 highest-priority banners. Priority order: budget_warning > phase_retry > sse_reconnecting. A final collapsed row: `text-[10px] text-gray-600` — "and 2 more warnings". No expand action for MVP.

13. **AgentCard current_task overflow**: Text truncated at one line with CSS `truncate`. Full text available via native `title` attribute on the task `<p>` element.

14. **BlockerModal reply submitted empty**: Submit button is `disabled` when textarea is empty (no content after trim). If the user somehow triggers submit with empty content (e.g., programmatically), an inline error reads "A reply is required."

15. **Budget input: value ≤ 0 or non-numeric**: SaveButton is `disabled`. Inline error: "Budget must be greater than $0." Input border turns `border-red-700`.

16. **WS reconnection: feed items arrived while disconnected**: Server sends a full state snapshot on reconnect. Client replaces its feed state with the snapshot. Duplicate detection uses `id` field. No duplicates are shown.

17. **ArtifactView during active cycle**: Content updates in real-time when an agent saves a new artifact version during the cycle. The ArtifactRendered view re-renders; if the user is in Diff mode and watching the same phase, the diff updates. A `text-[10px] text-blue-400` label "Updated just now" flashes for 3 seconds.

18. **CycleProgressBar: step has artifact link but the artifact record is missing**: Link `↗` is rendered with `text-gray-600 cursor-not-allowed` and `title="Artifact not saved"`. Click does nothing.

19. **AgentRail: agents not yet loaded**: Six skeleton cards are shown: `h-[74px] rounded-lg border border-gray-800 bg-gray-900 animate-pulse`. Skeleton count is fixed at 6 (one per agent role).

20. **Project switched while BlockerModal is open**: BlockerModal closes immediately (the blocker belongs to the previous project). The queue is flushed. The new project's state is loaded clean.

21. **Settings tab: save succeeds**: BudgetInput resets to saved value. SaveButton returns to default. A temporary `text-xs text-green-500` inline confirmation "Saved" appears for 2 seconds.

22. **CycleCostSummary: day boundary crossed mid-cycle**: Daily budget counter resets to zero at UTC midnight. An active cycle that spans midnight uses the new day's budget counter going forward; prior-day spend is not retroactively cancelled.

23. **ArtifactDiffView: identical artifact between cycles**: `diff.createPatch()` returns an empty diff string. `parseDiff('')` returns an empty hunks array. Diff view shows a centred `text-sm text-gray-600` message: "No changes between these cycles." This is a valid state and must not show an error.

24. **Thought log panel open on the AgentCard of an active agent**: As new `thinking` events arrive via WS, new ThoughtEntry rows prepend to the list. The scroll position does not auto-scroll if the user has scrolled up; it stays put. An unread indicator `text-[9px] text-blue-400` reads "N new" at the top of the panel if new thoughts arrived off-screen.
