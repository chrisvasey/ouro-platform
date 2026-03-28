# Research Report

## Summary

This is a placeholder demo project used to validate the Ouro project switcher UI. No real product research is applicable. The sections below serve as a structural example of what a completed research report looks like for actual projects.

## Competitors

| Name | Description | What we can learn |
|------|-------------|-------------------|
| Linear | Project/issue tracking with a slick multi-workspace switcher | Keyboard-first switcher (Ctrl+K), instant switch with no loading state |
| Notion | Multi-workspace tool with sidebar project switching | Persistent sidebar context, avatar/icon per workspace for quick identification |
| Vercel | Multi-team dashboard with team switcher in top nav | Dropdown with search, recent items surfaced first |
| GitHub | Org/repo switcher in global nav | Flat list with fuzzy search; separates personal from org contexts |

## OSS / Libraries

| Library | Purpose | Verdict |
|---------|---------|---------|
| cmdk (npm) | Headless command-menu / switcher primitive, ~9k stars | ✅ use — perfect for keyboard-driven project switcher |
| fuse.js | Lightweight fuzzy search, ~17k stars | ✅ use — good for filtering project list client-side |
| @radix-ui/react-popover | Accessible popover/dropdown primitive | ✅ use — pairs well with cmdk for the switcher container |
| react-query / TanStack Query | Server state, caching, background refetch | ⚠️ maybe — useful if project list is fetched remotely and needs staleness handling |

## UI Patterns

- **Command palette switcher** — Ctrl+K or clicking the project name opens a searchable list; used by Linear, VS Code, Vercel. Feels fast and keyboard-friendly.
- **Persistent breadcrumb** — Show current project name in the top nav at all times so users always know where they are.
- **Recent projects first** — Sort by `last_accessed_at` rather than alphabetically; reduces cognitive load when switching frequently.
- **Visual identity per project** — Colour dot or initials avatar next to project name; makes scanning a long list faster.
- **Optimistic transition** — Switch the UI immediately on click, resolve data in background; avoid full-page loading spinners.

## Dev Patterns

- **URL-based project context** — Encode the project ID or slug in the URL path (`/projects/:slug/...`) so browser back/forward and shared links work correctly.
- **Single source of truth for active project** — Store selected project ID in a React context or URL param, not in multiple component states.
- **Slug over UUID in URLs** — Use human-readable slugs (already implemented in `db.ts:slugify`) for URLs; keep UUID as the internal primary key.
- **Lazy-load per-project data** — Only fetch agents/feed/tasks after a project is selected, not upfront for all projects.

## Risks

1. **No real project brief** — This is a demo; no actual product to research or build. Risk: wasted agent cycles. Mitigation: PM should gate cycles on a real description before running the full pipeline.
2. **Project switcher UX untested** — If the switcher is the feature under test, behaviour on edge cases (0 projects, 50+ projects, long names) should be explicitly verified. Mitigation: add specific test cases in the tester phase.
3. **Slug collisions** — The `slugify` function in `db.ts` does not handle duplicate slugs (e.g., two projects named "Demo"). Mitigation: add a uniqueness suffix (`demo-2`, `demo-3`) in `createProject`.

## Recommendations

1. **Use this demo cycle to validate the full pipeline end-to-end** — confirm researcher → designer → developer → tester → documenter all produce artifacts and post feed messages correctly.
2. **Implement slug collision handling in `db.ts`** before onboarding real users — low effort, high correctness value.
3. **Adopt `cmdk` for the project switcher component** if not already in use — it handles keyboard navigation, search, and accessibility out of the box.
4. **Enforce URL-based project context** early — retrofitting this later is painful; the slug field already exists in the schema.
5. **Add a "no project selected" empty state** in the UI — currently unclear what the app shows before a project is picked.
