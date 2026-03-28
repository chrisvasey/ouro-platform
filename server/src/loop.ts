/**
 * loop.ts — Cycle orchestrator
 *
 * Runs one full cycle through all 6 phases serially:
 *   research → spec → design → build → test → review
 *
 * Each phase:
 * 1. Updates the project's current_phase
 * 2. Sets the responsible agent to 'thinking'
 * 3. Runs the agent (calls Claude) via runAgentWithTimeout
 * 4. Saves the output as an artifact
 * 5. Posts a feed message with a summary
 * 6. Sets the agent back to 'idle'
 *
 * Improvements:
 *
 * Todo Enforcer — phase timeout watchdog
 *   Every agent call is wrapped in a Promise.race() against PHASE_TIMEOUT_MS.
 *   On first timeout the phase is retried once. On second timeout an error
 *   artifact is saved and the loop continues rather than hanging forever.
 *
 * Ralph Loop — test retry logic
 *   After the test phase, the artifact is inspected for FAIL indicators. If
 *   the test failed and retryCount < 3 the cycle routes back to the build
 *   phase for fixes (up to 3 retries). After 3 retries the PM escalates to
 *   the client inbox and the cycle ends without running review.
 */

import {
  getProject,
  setProjectPhase,
  setProjectStatus,
  setAgentStatus,
  saveArtifact,
  postFeedMessage,
  sendInboxMessage,
  getArtifactByPhase,
} from "./db.js";

import { runResearcher } from "./agents/researcher.js";
import { runPM } from "./agents/pm.js";
import { runDesigner } from "./agents/designer.js";
import { runDeveloper } from "./agents/developer.js";
import { runTester } from "./agents/tester.js";
import { runDocumenter } from "./agents/documenter.js";

import type { AgentResult } from "./agents/base.js";

/** Each agent call has at most this long before it is considered timed out. */
const PHASE_TIMEOUT_MS = 5 * 60 * 1000;

// Map from phase name → agent role (for status updates)
const phaseToRole: Record<string, string> = {
  research: "researcher",
  spec: "pm",
  design: "designer",
  build: "developer",
  test: "tester",
  review: "documenter",
};

// Map from phase name → artifact filename
const phaseToFilename: Record<string, string> = {
  research: "research.md",
  spec: "spec.md",
  design: "design.md",
  build: "build.md",
  test: "test-report.md",
  review: "review.md",
};

// Map from phase name → task description sent to the agent
const phaseToTask: Record<string, string> = {
  research: "Research the project landscape: find competitors, relevant OSS libraries, UI patterns, and development patterns. Produce research.md.",
  spec: "Write user stories for the project with acceptance criteria. Produce spec.md.",
  design: "Read the user stories and research. Produce design.md with user flows, component tree, layout specs, component specs, and edge cases.",
  build: "Read the design spec. Produce build.md: a detailed implementation plan with file structure, key functions, data shapes, component breakdown, API contract, and commit plan.",
  test: "Read the user stories and implementation plan. Write test-report.md: test results per acceptance criterion, PASS/FAIL ratings, and any raised issues.",
  review: "Review all artifacts from this cycle. Update CLAUDE.md with decisions made, patterns established, and client preferences. Produce review.md summarising the cycle.",
};

/** Global state for currently running cycles (projectId → running) */
const runningCycles = new Set<string>();

/** Event emitter for broadcasting real-time updates */
type BroadcastFn = (projectId: string, event: string, data: unknown) => void;
let broadcast: BroadcastFn = () => {};

export function setBroadcastFn(fn: BroadcastFn): void {
  broadcast = fn;
}

export function isCycleRunning(projectId: string): boolean {
  return runningCycles.has(projectId);
}

/**
 * Run one full cycle for a project.
 * Resolves when all phases complete (or after escalation). Rejects only on
 * unexpected setup errors (project not found, already running).
 */
export async function runCycle(projectId: string): Promise<void> {
  if (runningCycles.has(projectId)) {
    throw new Error(`Cycle already running for project ${projectId}`);
  }

  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  runningCycles.add(projectId);

  // Per-cycle state — reset on every call, never persisted
  let retryCount = 0;
  let lastResult: AgentResult | null = null;
  let testPassed = false;

  /**
   * Run a single phase: update agent/project status, call the agent with the
   * timeout wrapper, save the artifact, post a feed summary.
   *
   * Never throws — all errors are caught and reflected as blocked-agent status
   * so the caller can decide what to do next.
   */
  async function runPhaseStep(phase: string): Promise<void> {
    const role = phaseToRole[phase];
    const filename = phaseToFilename[phase];
    const taskDescription = phaseToTask[phase];

    setProjectPhase(projectId, phase);
    broadcast(projectId, "phase_change", { phase });

    setAgentStatus(projectId, role, "thinking", taskDescription);
    broadcast(projectId, "agent_status", { role, status: "thinking", current_task: taskDescription });

    console.log(`[loop] [${project!.name}] Phase: ${phase} → ${role} thinking...`);

    try {
      const result = await runAgentWithTimeout(phase, projectId, taskDescription);
      lastResult = result;

      saveArtifact(projectId, phase, filename, result.content);

      const feedMsg = postFeedMessage(
        projectId,
        role,
        "all",
        `[${phase.toUpperCase()} COMPLETE] ${result.summary}`,
        "handoff"
      );
      broadcast(projectId, "feed_message", feedMsg);

      console.log(`[loop] [${project!.name}] Phase ${phase} complete.`);
    } catch (err) {
      console.error(`[loop] [${project!.name}] Phase ${phase} failed:`, err);

      setAgentStatus(projectId, role, "blocked", `Error in ${phase} phase`);
      broadcast(projectId, "agent_status", { role, status: "blocked" });

      const feedMsg = postFeedMessage(
        projectId,
        role,
        "all",
        `[${phase.toUpperCase()} ERROR] ${(err as Error).message}. Agent blocked.`,
        "escalate"
      );
      broadcast(projectId, "feed_message", feedMsg);
    } finally {
      setAgentStatus(projectId, role, "idle");
      broadcast(projectId, "agent_status", { role, status: "idle", current_task: null });
    }
  }

  try {
    // ── Phases 1–4: research → spec → design → build ──────────────────────────
    for (const phase of ["research", "spec", "design", "build"] as const) {
      await runPhaseStep(phase);
    }

    // ── Phase 5: test with Ralph Loop retry logic ──────────────────────────────
    do {
      await runPhaseStep("test");

      // Parse the saved artifact for FAIL indicators.
      // Default to "FAIL" when the artifact is missing (agent errored out).
      const testArtifact = getArtifactByPhase(projectId, "test");
      const content = testArtifact?.content ?? "FAIL";
      const isFail = /FAIL|❌|overall status: FAIL/i.test(content);

      if (!isFail) {
        testPassed = true;
        break;
      }

      if (retryCount >= 3) {
        // Max retries exhausted — escalate to client inbox
        const escalateFeedMsg = postFeedMessage(
          projectId,
          "pm",
          "inbox",
          "[PM → Inbox] Tests failed after 3 attempts. Escalating to client.",
          "escalate"
        );
        broadcast(projectId, "feed_message", escalateFeedMsg);

        const escalateInboxMsg = sendInboxMessage(
          projectId,
          "pm",
          "Build blocked — tests failing",
          `Tests have failed after 3 retry attempts.\n\nLatest test report:\n\n${content.slice(0, 1000)}`
        );
        broadcast(projectId, "inbox_message", escalateInboxMsg);
        break;
      }

      // Route back to build for another attempt
      retryCount++;
      const retryFeedMsg = postFeedMessage(
        projectId,
        "pm",
        "developer",
        `[PM → Developer] Tests failed (attempt ${retryCount}/3). Routing back to build phase for fixes.`,
        "handoff"
      );
      broadcast(projectId, "feed_message", retryFeedMsg);

      await runPhaseStep("build");
    } while (true);

    // ── Phase 6: review (only when tests passed) ───────────────────────────────
    if (testPassed) {
      await runPhaseStep("review");
    }

    // ── Cycle complete ─────────────────────────────────────────────────────────
    if (testPassed) {
      const cycleSummary = lastResult
        ? lastResult.summary
        : "Cycle complete. All phases ran. Check the feed for details.";

      const inboxMsg = sendInboxMessage(
        projectId,
        "pm",
        "Cycle complete",
        `All 6 phases completed for project "${project!.name}".\n\n${cycleSummary}\n\nCheck the feed for full details of each phase. Artifacts saved: research.md, spec.md, design.md, build.md, test-report.md, review.md (CLAUDE.md).`
      );
      broadcast(projectId, "inbox_message", inboxMsg);
    }

    setProjectPhase(projectId, "complete");
    broadcast(projectId, "phase_change", { phase: "complete" });

    console.log(`[loop] [${project!.name}] Cycle complete.`);
  } finally {
    runningCycles.delete(projectId);
  }
}

/**
 * Wrap an agent call with a configurable timeout (PHASE_TIMEOUT_MS).
 *
 * - First timeout: posts a feed warning and retries once with the same limit.
 * - Second timeout: posts a feed warning, saves an error artifact so the test
 *   retry logic can detect the failure, then re-throws so the outer catch in
 *   runPhaseStep can set the agent to blocked and continue.
 */
async function runAgentWithTimeout(
  phase: string,
  projectId: string,
  taskDescription: string
): Promise<AgentResult> {
  const makeTimeoutPromise = () =>
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Phase ${phase} timed out after ${PHASE_TIMEOUT_MS / 1000}s`)),
        PHASE_TIMEOUT_MS
      )
    );

  const isTimeoutError = (err: unknown): boolean =>
    err instanceof Error && err.message.includes("timed out after");

  // First attempt
  try {
    return await Promise.race([
      runAgent(phase, projectId, taskDescription),
      makeTimeoutPromise(),
    ]);
  } catch (firstErr) {
    if (!isTimeoutError(firstErr)) throw firstErr;

    // First timeout — warn and retry once
    const warnMsg = postFeedMessage(
      projectId,
      "pm",
      "all",
      `[PM → All] ⚠️ ${phase} phase timed out. Retrying once...`,
      "note"
    );
    broadcast(projectId, "feed_message", warnMsg);

    // Second attempt
    try {
      return await Promise.race([
        runAgent(phase, projectId, taskDescription),
        makeTimeoutPromise(),
      ]);
    } catch (secondErr) {
      if (!isTimeoutError(secondErr)) throw secondErr;

      // Double timeout — save error artifact then give up on this phase
      const failMsg = postFeedMessage(
        projectId,
        "pm",
        "all",
        `[PM → All] ⚠️ ${phase} phase failed twice. Skipping to next phase with error artifact.`,
        "note"
      );
      broadcast(projectId, "feed_message", failMsg);

      const filename = phaseToFilename[phase] ?? `${phase}.md`;
      saveArtifact(
        projectId,
        phase,
        filename,
        `# Phase Error\n\noverall status: FAIL\n\nPhase \`${phase}\` timed out after two attempts (${PHASE_TIMEOUT_MS / 1000}s each).`
      );

      throw secondErr;
    }
  }
}

/** Dispatch to the correct agent based on phase name. */
async function runAgent(
  phase: string,
  projectId: string,
  taskDescription: string
): Promise<AgentResult> {
  switch (phase) {
    case "research":
      return runResearcher(projectId, taskDescription);
    case "spec":
      return runPM(projectId, taskDescription);
    case "design":
      return runDesigner(projectId, taskDescription);
    case "build":
      return runDeveloper(projectId, taskDescription);
    case "test":
      return runTester(projectId, taskDescription);
    case "review":
      return runDocumenter(projectId, taskDescription);
    default:
      throw new Error(`Unknown phase: ${phase}`);
  }
}
