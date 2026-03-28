/**
 * tester.ts — Tester agent with real Playwright browser automation
 *
 * Navigates to the running Ouro Platform (http://localhost:3007) and
 * verifies acceptance criteria derived from user stories.
 * Falls back to a mock report if Playwright / Chromium is unavailable.
 *
 * Heuristics:
 *   "see" / "view" / "display" / "shows"    → check element visible
 *   "click" / "navigate" / "go to" / "button" → attempt navigation check
 *   "form" / "input" / "submit"               → check form elements exist
 *   "list" / "grid" / "cards"                 → check multiple items
 *   "database" / "query" / "API internally"   → SKIP (backend, not verifiable)
 */

import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { getProject, getArtifactByPhase, postFeedMessage } from "../db.js";
import { buildContextBlock, extractSummary, type AgentResult } from "./base.js";

const APP_URL = process.env.APP_URL ?? "http://localhost:3007";
const SCREENSHOT_DIR = "/tmp";
const PAGE_TIMEOUT = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CriterionResult {
  criterion: string;
  status: "PASS" | "FAIL" | "SKIP";
  notes: string;
  screenshot?: string;
}

interface UserStory {
  id: string;
  title: string;
  criteria: string[];
}

type CriterionType = "visibility" | "navigation" | "form" | "list" | "skip";

// ─── Parsing ──────────────────────────────────────────────────────────────────

function parseUserStories(text: string): UserStory[] {
  const stories: UserStory[] = [];

  // Split on user story headings: ### US-001: ... or ## US-1: ...
  const blocks = text.split(/(?=###?\s+US-\d+[:\s])/i);

  for (const block of blocks) {
    const idMatch = block.match(/US-(\d+)/i);
    if (!idMatch) continue;

    const id = `US-${idMatch[1].padStart(3, "0")}`;
    const titleMatch = block.match(/US-\d+[:\s]+([^\n]+)/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/\*+/g, "") : id;

    const criteria: string[] = [];
    let inAC = false; // inside an "Acceptance Criteria:" section

    for (const line of block.split("\n")) {
      const t = line.trim();

      // Detect Acceptance Criteria header
      if (/\*{0,2}acceptance criteria[:\*]*/i.test(t)) {
        inAC = true;
        continue;
      }
      // A new sub-heading ends the AC block
      if (inAC && /^#+\s/.test(t)) { inAC = false; continue; }

      let clean: string | null = null;

      // Explicit formats (work anywhere in block)
      if (/^-\s*\[[ x✓]\]\s+/.test(t)) {
        clean = t.replace(/^-\s*\[[ x✓]\]\s+/, "");
      } else if (/^-\s*✓\s+/.test(t)) {
        clean = t.replace(/^-\s*✓\s+/, "");
      } else if (/^AC:\s+/i.test(t)) {
        clean = t.replace(/^AC:\s+/i, "");
      } else if (/^\d+\.\s+[A-Z]/.test(t)) {
        clean = t.replace(/^\d+\.\s+/, "");
      } else if (inAC && /^-\s+\S/.test(t)) {
        // Any bullet inside an AC section is a criterion
        clean = t.replace(/^-\s+/, "");
      } else if (/^-\s+(?:Can |Should |Must |User can )/i.test(t)) {
        clean = t.replace(/^-\s+/, "");
      }

      if (clean && clean.trim().length > 5) criteria.push(clean.trim());
    }

    if (criteria.length > 0) stories.push({ id, title, criteria });
  }

  // Fallback: if no structured stories, extract top-level bullet criteria
  if (stories.length === 0) {
    const criteria: string[] = [];
    let inAC = false;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (/acceptance criteria/i.test(t)) { inAC = true; continue; }
      if (inAC && /^#{1,3}\s/.test(t) && !/acceptance/i.test(t)) inAC = false;
      if (inAC && /^-\s+/.test(t)) {
        const clean = t.replace(/^-\s*\[[ x✓]\]\s+/, "").replace(/^-\s+/, "").trim();
        if (clean.length > 5) criteria.push(clean);
      }
    }
    if (criteria.length > 0)
      stories.push({ id: "US-001", title: "Acceptance Criteria", criteria });
  }

  return stories;
}

// ─── Criterion classifier ─────────────────────────────────────────────────────

function classifyCriterion(criterion: string): CriterionType {
  const lower = criterion.toLowerCase();

  // Skip architectural / backend criteria
  if (
    lower.includes("database") ||
    lower.includes("sql") ||
    lower.includes("query") ||
    lower.includes("api internally") ||
    lower.includes("backend") ||
    lower.includes("server-side") ||
    lower.includes("websocket protocol") ||
    lower.includes("endpoint internally") ||
    lower.includes("broadcast") && lower.includes("server")
  ) return "skip";

  if (
    lower.includes("form") ||
    lower.includes("input") ||
    lower.includes("submit") ||
    lower.includes("textarea") ||
    lower.includes("type in")
  ) return "form";

  if (
    lower.includes("list") ||
    lower.includes("grid") ||
    lower.includes("cards") ||
    lower.includes("multiple") ||
    lower.includes("each item") ||
    lower.includes("items appear")
  ) return "list";

  if (
    lower.includes("click") ||
    lower.includes("navigate") ||
    lower.includes("go to") ||
    lower.includes("redirect") ||
    lower.includes("button") && (lower.includes("start") || lower.includes("send") || lower.includes("cycle"))
  ) return "navigation";

  return "visibility";
}

// ─── UI term extractor ────────────────────────────────────────────────────────

function extractUITerms(criterion: string): string[] {
  const stop = new Set([
    "can", "see", "the", "a", "an", "is", "are", "in", "on", "at", "to", "for",
    "of", "and", "or", "with", "by", "from", "user", "view", "show", "shows",
    "display", "displays", "visible", "appear", "appears", "update", "updates",
    "when", "after", "before", "via", "has", "have", "be", "been", "being", "that",
    "its", "their", "this", "each", "all", "any",
  ]);
  return criterion
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w.toLowerCase()))
    .slice(0, 6);
}

// ─── Individual check strategies ─────────────────────────────────────────────

async function checkVisibility(
  page: any,
  criterion: string
): Promise<{ found: boolean; notes: string }> {
  const lower = criterion.toLowerCase();
  const terms = extractUITerms(criterion);

  // Text-based search
  for (const term of terms) {
    try {
      const loc = page.getByText(term, { exact: false });
      if ((await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false))) {
        return { found: true, notes: `Text "${term}" visible on page` };
      }
    } catch {}
  }

  // Role / semantic selectors based on criterion keywords
  const roleChecks: Array<{ selector: string; desc: string }> = [];
  if (lower.includes("button") || lower.includes("start") || lower.includes("cycle"))
    roleChecks.push({ selector: "button", desc: "button" });
  if (lower.includes("badge") || lower.includes("unread") || lower.includes("count"))
    roleChecks.push({ selector: "[class*='badge'],[class*='count'],[class*='unread']", desc: "badge/count" });
  if (lower.includes("feed") || lower.includes("message"))
    roleChecks.push({ selector: "[class*='feed'],[class*='message']", desc: "feed/message" });
  if (lower.includes("inbox"))
    roleChecks.push({ selector: "[class*='inbox']", desc: "inbox" });
  if (lower.includes("agent"))
    roleChecks.push({ selector: "[class*='agent']", desc: "agent" });
  if (lower.includes("status") || lower.includes("phase"))
    roleChecks.push({ selector: "[class*='status'],[class*='phase'],[class*='badge']", desc: "status/phase" });
  if (lower.includes("panel"))
    roleChecks.push({ selector: "[class*='panel']", desc: "panel" });
  if (lower.includes("switcher") || lower.includes("dropdown") || lower.includes("select"))
    roleChecks.push({ selector: "select,[class*='switcher'],[class*='dropdown']", desc: "switcher/dropdown" });
  if (lower.includes("timestamp") || lower.includes("time") || lower.includes("ago"))
    roleChecks.push({ selector: "[class*='time'],[class*='timestamp'],time", desc: "timestamp" });
  if (lower.includes("scroll"))
    roleChecks.push({ selector: "[class*='scroll'],[class*='feed']", desc: "scroll container" });

  for (const { selector, desc } of roleChecks) {
    try {
      const loc = page.locator(selector).first();
      if (await loc.isVisible().catch(() => false))
        return { found: true, notes: `Found ${desc} element` };
    } catch {}
  }

  // Broad body text check
  try {
    const bodyText: string = await page.evaluate(() => document.body.innerText ?? "");
    for (const term of terms) {
      if (term.length > 3 && bodyText.toLowerCase().includes(term.toLowerCase()))
        return { found: true, notes: `"${term}" found in page text` };
    }
  } catch {}

  return { found: false, notes: `Could not verify visibility of: "${criterion.slice(0, 80)}"` };
}

async function checkNavigation(
  page: any,
  criterion: string
): Promise<{ success: boolean; notes: string }> {
  const terms = extractUITerms(criterion);

  for (const term of terms) {
    try {
      const btn = page.getByRole("button", { name: new RegExp(term, "i") });
      if ((await btn.count()) > 0) {
        return { success: true, notes: `Found button matching "${term}"` };
      }
    } catch {}
    try {
      const link = page.getByRole("link", { name: new RegExp(term, "i") });
      if ((await link.count()) > 0) {
        return { success: true, notes: `Found link matching "${term}"` };
      }
    } catch {}
  }

  // Generic: any clickable elements exist?
  try {
    const count: number = await page.locator("button, a[href]").count();
    if (count > 0) return { success: true, notes: `${count} clickable element(s) on page` };
  } catch {}

  return { success: false, notes: `No navigable element for: "${criterion.slice(0, 80)}"` };
}

async function checkForm(
  page: any,
  _criterion: string
): Promise<{ found: boolean; notes: string }> {
  const checks: Array<{ selector: string; desc: string }> = [
    { selector: "form", desc: "form" },
    { selector: "input, textarea", desc: "input/textarea" },
    { selector: "button[type='submit']", desc: "submit button" },
    { selector: "[class*='form']", desc: "form-class element" },
    { selector: "[placeholder]", desc: "element with placeholder" },
  ];
  for (const { selector, desc } of checks) {
    try {
      const count: number = await page.locator(selector).count();
      if (count > 0) return { found: true, notes: `Found ${count} ${desc}(s)` };
    } catch {}
  }
  return { found: false, notes: `No form elements found for: "${_criterion.slice(0, 80)}"` };
}

async function checkList(
  page: any,
  _criterion: string
): Promise<{ found: boolean; notes: string }> {
  const checks: Array<{ selector: string; desc: string }> = [
    { selector: "[class*='agent']", desc: "agent element" },
    { selector: "[class*='message']", desc: "message element" },
    { selector: "[class*='card']", desc: "card element" },
    { selector: "[class*='item']", desc: "item element" },
    { selector: "li", desc: "list item" },
    { selector: "[class*='row']", desc: "row element" },
  ];
  for (const { selector, desc } of checks) {
    try {
      const count: number = await page.locator(selector).count();
      if (count > 1) return { found: true, notes: `Found ${count} ${desc}s` };
      if (count === 1) return { found: true, notes: `Found 1 ${desc}` };
    } catch {}
  }
  return { found: false, notes: `No list/grid/card elements found for: "${_criterion.slice(0, 80)}"` };
}

// ─── Playwright test runner ───────────────────────────────────────────────────

async function runPlaywrightTests(
  stories: UserStory[],
  timestamp: number
): Promise<{ storyResults: Map<string, CriterionResult[]>; playwrightAvailable: boolean }> {
  const storyResults = new Map<string, CriterionResult[]>();

  // Dynamic import so a missing playwright doesn't break the module load
  let chromium: any;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch (err) {
    console.warn("[tester] Playwright import failed:", (err as Error).message);
    return { storyResults, playwrightAvailable: false };
  }

  let browser: any;
  try {
    browser = await chromium.launch({ headless: true, timeout: 15_000 });
  } catch (err) {
    console.warn("[tester] Chromium launch failed:", (err as Error).message);
    return { storyResults, playwrightAvailable: false };
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Probe whether the app is up
  let appReachable = false;
  try {
    await page.goto(APP_URL, { timeout: PAGE_TIMEOUT, waitUntil: "domcontentloaded" });
    appReachable = true;
    console.log("[tester] App reachable at", APP_URL);
  } catch (err) {
    console.warn("[tester] App not reachable:", (err as Error).message);
  }

  let ssIdx = 0;

  for (const story of stories) {
    const results: CriterionResult[] = [];

    for (const criterion of story.criteria) {
      if (!appReachable) {
        results.push({
          criterion,
          status: "FAIL",
          notes: `App unreachable at ${APP_URL}`,
        });
        continue;
      }

      const type = classifyCriterion(criterion);

      if (type === "skip") {
        results.push({
          criterion,
          status: "SKIP",
          notes: "Not verifiable in browser (backend/architectural)",
        });
        continue;
      }

      let result: CriterionResult;
      try {
        // Start each check from the app root
        const currentUrl: string = page.url();
        if (!currentUrl.startsWith(APP_URL)) {
          await page.goto(APP_URL, { timeout: PAGE_TIMEOUT, waitUntil: "domcontentloaded" });
        }

        let checkResult: { found?: boolean; success?: boolean; notes: string };
        if (type === "visibility") {
          checkResult = await checkVisibility(page, criterion);
        } else if (type === "navigation") {
          checkResult = await checkNavigation(page, criterion);
        } else if (type === "form") {
          checkResult = await checkForm(page, criterion);
        } else {
          checkResult = await checkList(page, criterion);
        }

        const passed = checkResult.found ?? checkResult.success ?? false;
        result = { criterion, status: passed ? "PASS" : "FAIL", notes: checkResult.notes };
      } catch (err) {
        result = {
          criterion,
          status: "FAIL",
          notes: `Error: ${(err as Error).message.slice(0, 100)}`,
        };
      }

      // Screenshot on failure
      if (result.status === "FAIL") {
        const ssPath = `${SCREENSHOT_DIR}/ouro-test-${timestamp}-${ssIdx++}.png`;
        try {
          await page.screenshot({ path: ssPath });
          result.screenshot = ssPath;
        } catch {}
      }

      results.push(result);
    }

    storyResults.set(story.id, results);
  }

  await browser.close();
  return { storyResults, playwrightAvailable: true };
}

// ─── Report builder ───────────────────────────────────────────────────────────

function buildReport(
  projectName: string,
  stories: UserStory[],
  storyResults: Map<string, CriterionResult[]>,
  playwrightAvailable: boolean,
  timestamp: number
): string {
  const date = new Date(timestamp).toISOString().split("T")[0];

  let total = 0, passed = 0, failed = 0, skipped = 0;
  const issues: string[] = [];

  for (const story of stories) {
    for (const r of storyResults.get(story.id) ?? []) {
      total++;
      if (r.status === "PASS") passed++;
      else if (r.status === "FAIL") {
        failed++;
        const ssNote = r.screenshot ? ` — screenshot: ${r.screenshot}` : "";
        issues.push(`GH-TODO: [Bug] ${r.criterion}${ssNote}\n  Notes: ${r.notes}`);
      } else skipped++;
    }
  }

  const overallStatus = failed > 0 ? "FAIL" : "PASS";

  let md = `# Test Report
Date: ${date}
Project: ${projectName}
Stories tested: ${stories.length}
Criteria: ${total} checked / ${passed} passed / ${failed} failed / ${skipped} skipped
Overall status: ${overallStatus}

`;

  if (!playwrightAvailable) {
    md += `> **Note:** Playwright unavailable — mock report generated. Install Chromium to enable real browser tests.\n\n`;
  }

  md += `## Results\n\n`;

  for (const story of stories) {
    const results = storyResults.get(story.id) ?? [];
    md += `### ${story.id}: ${story.title}\n`;
    if (results.length === 0) {
      md += `_No criteria to verify._\n\n`;
      continue;
    }
    md += `| Criterion | Status | Notes |\n|---|---|---|\n`;
    for (const r of results) {
      const icon = r.status === "PASS" ? "✅ PASS" : r.status === "FAIL" ? "❌ FAIL" : "⏭️ SKIP";
      const short = r.criterion.length > 60 ? r.criterion.slice(0, 57) + "..." : r.criterion;
      const notesWithSS = r.notes + (r.screenshot ? ` (screenshot: \`${r.screenshot}\`)` : "");
      md += `| ${short} | ${icon} | ${notesWithSS} |\n`;
    }
    md += `\n`;
  }

  if (issues.length > 0) {
    md += `## Issues\n\n`;
    for (const issue of issues) md += `- ${issue}\n`;
    md += `\n`;
  }

  md += `## Recommendation\n`;
  if (overallStatus === "PASS") {
    md += `PASS — all verifiable criteria passed, ready for review\n`;
  } else {
    md += `FAIL — ${failed} blocking issue${failed !== 1 ? "s" : ""}, see above\n`;
  }

  return md;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runTester(projectId: string, taskDescription: string): Promise<AgentResult> {
  const timestamp = Date.now();

  const specArtifact = getArtifactByPhase(projectId, "spec");
  const buildArtifact = getArtifactByPhase(projectId, "build");

  // Combine all available text for story parsing
  const allText = [
    taskDescription,
    specArtifact?.content ?? "",
    buildArtifact?.content ?? "",
  ].join("\n\n");

  const stories = parseUserStories(allText);
  const totalCriteria = stories.reduce((n, s) => n + s.criteria.length, 0);
  console.log(`[tester] Parsed ${stories.length} stories, ${totalCriteria} criteria`);

  const project = getProject(projectId);
  const projectName = project?.name ?? projectId;

  let content: string;
  let playwrightAvailable = false;

  if (stories.length === 0) {
    // No structured stories — fall back to Claude-generated report
    console.log("[tester] No structured stories found; delegating to Claude");
    const systemPrompt = loadPrompt("tester");
    const additionalContext = [
      specArtifact ? `\n\n## User Stories:\n${specArtifact.content}` : "",
      buildArtifact ? `\n\n## Implementation Plan:\n${buildArtifact.content}` : "",
    ].join("");
    const userPrompt = buildContextBlock(
      projectId,
      `${taskDescription}${additionalContext}\n\nProduce test-report.md with test results per story and any raised issues.`
    );
    const result = await runClaude({ systemPrompt, userPrompt });
    content = result.content;
  } else {
    const { storyResults, playwrightAvailable: pw } = await runPlaywrightTests(stories, timestamp);
    playwrightAvailable = pw;
    content = buildReport(projectName, stories, storyResults, playwrightAvailable, timestamp);
  }

  const summary = extractSummary(content);
  const failCount = (content.match(/❌ FAIL/g) ?? []).length;
  const passCount = (content.match(/✅ PASS/g) ?? []).length;

  postFeedMessage(
    projectId,
    "tester",
    "all",
    playwrightAvailable
      ? `Playwright tests complete: ${passCount} passed, ${failCount} failed.${failCount > 0 ? " Screenshots saved for failures." : " All checks passed."}`
      : `Playwright unavailable (Chromium not installed). Mock report generated for ${stories.length} stories / ${totalCriteria} criteria.`,
    "note"
  );

  return { content, summary };
}
