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
  createCycleRecord,
  updateCycleRecord,
  insertEvent,
  type PhaseOutcome,
} from "./db.js";

import { runResearcher } from "./agents/researcher.js";
import { runPM } from "./agents/pm.js";
import { runDesigner } from "./agents/designer.js";
import { runDeveloper } from "./agents/developer.js";
import { runTester } from "./agents/tester.js";
import { runDocumenter } from "./agents/documenter.js";

import type { AgentResult } from "./agents/base.js";

/** Each agent call has at most this long before it is considered timed out. */
// Per-phase timeout budgets — build takes longer due to multi-step chunking
const PHASE_TIMEOUTS: Record<string, number> = {
  research:  12 * 60 * 1000,  // 12 min — 3 web searches × 2-3 min each + synthesis
  build:     25 * 60 * 1000,  // 25 min — multi-step: decompose + arch + N chunks + assemble (150s/step × retries)
  design:     8 * 60 * 1000,  //  8 min — 3 steps × 2 min each
  spec:       4 * 60 * 1000,  //  4 min
  test:       5 * 60 * 1000,  //  5 min — Playwright runs
  review:     4 * 60 * 1000,  //  4 min
};
const DEFAULT_PHASE_TIMEOUT = 5 * 60 * 1000;
const getPhaseTimeout = (phase: string) => PHASE_TIMEOUTS[phase] ?? DEFAULT_PHASE_TIMEOUT;

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

/** Build a project-specific task description for the given phase */
function getPhaseTask(phase: string, project: { name: string; description: string | null }): string {
  const brief = `${project.name}${project.description ? ` — ${project.description}` : ""}`;
  const tasks: Record<string, string> = {
    research: `Research the following product and identify competitors, patterns, and recommendations: ${brief}`,
    spec: `Write user stories and acceptance criteria for the following product: ${brief}. Reference the research artifact for context.`,
    design: `Create a design spec for: ${brief}. Reference user stories and research.`,
    build: "Read the design spec. Produce build.md: a detailed implementation plan with file structure, key functions, data shapes, component breakdown, API contract, and commit plan.",
    test: "Read the user stories and implementation plan. Write test-report.md: test results per acceptance criterion, PASS/FAIL ratings, and any raised issues.",
    review: "Review all artifacts from this cycle. Update CLAUDE.md with decisions made, patterns established, and client preferences. Produce review.md summarising the cycle.",
  };
  return tasks[phase] ?? `Complete the ${phase} phase for: ${brief}`;
}

/** Global state for currently running cycles (projectId → running) */
const runningCycles = new Set<string>();

/** Project IDs that have been requested to stop after the current phase */
const stoppingCycles = new Set<string>();

/**
 * Per-project mutex: maps projectId → tail of the promise chain.
 * Every cycle start chains onto the previous promise for that project,
 * guaranteeing at most one active cycle per project at any time.
 */
const cycleMutex = new Map<string, Promise<void>>();

/**
 * Acquire a mutex for a project. Returns a release function.
 * Callers must call release() in a finally block.
 */
function acquireMutex(projectId: string): Promise<() => void> {
  let release!: () => void;
  const current = cycleMutex.get(projectId) ?? Promise.resolve();
  const next = current.then(
    () => new Promise<void>((resolve) => { release = resolve; })
  );
  cycleMutex.set(projectId, next.catch(() => {})); // swallow so chain never breaks
  return current.then(() => release);
}

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
 * Request a graceful stop of a running cycle.
 * The cycle will finish its current phase and then halt.
 * Returns false if no cycle is running for the project.
 */
export function stopCycle(projectId: string): boolean {
  if (!runningCycles.has(projectId)) return false;
  stoppingCycles.add(projectId);
  return true;
}

/**
 * Run one full cycle for a project.
 * Resolves when all phases complete (or after escalation) or the cycle is stopped.
 * Rejects only on unexpected setup errors (project not found, already running).
 */
export async function runCycle(projectId: string): Promise<void> {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // Acquire per-project mutex — prevents concurrent cycles even under
  // rapid-fire requests (resolves the TOCTOU race on runningCycles).
  const release = await acquireMutex(projectId);

  // Re-check inside the mutex (another caller may have started between
  // the HTTP handler check and acquiring the lock).
  if (runningCycles.has(projectId)) {
    release();
    throw new Error(`Cycle already running for project ${projectId}`);
  }

  runningCycles.add(projectId);

  // Per-cycle state — reset on every call, never persisted
  let retryCount = 0;
  let lastResult: AgentResult | null = null;
  let testPassed = false;

  // Create a cycle history record
  const cycleRecord = createCycleRecord(projectId);
  const phaseOutcomes: PhaseOutcome[] = [];

  /**
   * Run a single phase: update agent/project status, call the agent with the
   * timeout wrapper, save the artifact, post a feed summary, record outcome.
   *
   * Never throws — all errors are caught and reflected as blocked-agent status
   * so the caller can decide what to do next.
   */
  async function runPhaseStep(phase: string): Promise<void> {
    const role = phaseToRole[phase];
    const filename = phaseToFilename[phase];
    const taskDescription = getPhaseTask(phase, project);
    const phaseStartedAt = Date.now();

    insertEvent({ projectId, cycleId: cycleRecord.id, type: "phase_started", agentRole: role, payload: { phase, role } });

    setProjectPhase(projectId, phase);
    broadcast(projectId, "phase_change", { phase });

    setAgentStatus(projectId, role, "thinking", taskDescription);
    broadcast(projectId, "agent_status", { role, status: "thinking", current_task: taskDescription });

    console.log(`[loop] [${project.name}] Phase: ${phase} → ${role} thinking...`);

    let phaseStatus: PhaseOutcome["status"] = "complete";
    try {
      // Callback for agents to post incremental feed messages during their work
      const onFeed = (message: string): void => {
        const feedMsg = postFeedMessage(projectId, role, "all", message, "note");
        broadcast(projectId, "feed_message", feedMsg);
      };
      const result = await runAgentWithTimeout(phase, projectId, taskDescription, onFeed, cycleRecord.id);
      lastResult = result;

      await saveArtifact(projectId, phase, filename, result.content, cycleRecord.id);

      const feedMsg = postFeedMessage(
        projectId,
        role,
        "all",
        `[${phase.toUpperCase()} COMPLETE] ${result.summary}`,
        "handoff"
      );
      broadcast(projectId, "feed_message", feedMsg);
      insertEvent({ projectId, cycleId: cycleRecord.id, type: "phase_completed", agentRole: role, payload: { phase, role, artifact_filename: filename } });

      console.log(`[loop] [${project.name}] Phase ${phase} complete.`);
    } catch (err) {
      phaseStatus = "error";
      console.error(`[loop] [${project.name}] Phase ${phase} failed:`, err);

      insertEvent({ projectId, cycleId: cycleRecord.id, type: "error", agentRole: role, payload: { phase, role, error: (err as Error).message } });

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
      // Record phase outcome and persist intermediate progress
      phaseOutcomes.push({
        phase,
        status: phaseStatus,
        started_at: phaseStartedAt,
        ended_at: Date.now(),
      });
      updateCycleRecord(cycleRecord.id, "running", phaseOutcomes);

      setAgentStatus(projectId, role, "idle");
      broadcast(projectId, "agent_status", { role, status: "idle", current_task: null });
    }
  }

  /** Returns true if a stop was requested (and clears the flag). */
  function checkStop(): boolean {
    if (stoppingCycles.has(projectId)) {
      stoppingCycles.delete(projectId);
      return true;
    }
    return false;
  }

  try {
    let stopped = false;

    // ── Phases 1–4: research → spec → design → build ──────────────────────────
    for (const phase of ["research", "spec", "design", "build"] as const) {
      if (checkStop()) { stopped = true; break; }
      await runPhaseStep(phase);
    }

    // ── Phase 5: test with Ralph Loop retry logic ──────────────────────────────
    if (!stopped) {
      do {
        if (checkStop()) { stopped = true; break; }
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
          insertEvent({ projectId, cycleId: cycleRecord.id, type: "human_input_requested", payload: { inbox_message_id: escalateInboxMsg.id } });
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

        if (checkStop()) { stopped = true; break; }
        await runPhaseStep("build");
      } while (true);
    }

    // ── Phase 6: review (only when tests passed) ───────────────────────────────
    if (!stopped && testPassed) {
      if (checkStop()) {
        stopped = true;
      } else {
        await runPhaseStep("review");
      }
    }

    if (stopped) {
      // Cycle was stopped by request
      updateCycleRecord(cycleRecord.id, "stopped", phaseOutcomes, Date.now());

      setProjectPhase(projectId, "complete");
      broadcast(projectId, "phase_change", { phase: "complete" });

      const feedMsg = postFeedMessage(
        projectId,
        "pm",
        "all",
        `[CYCLE STOPPED] Cycle was stopped after ${phaseOutcomes.length} phase(s). Completed phases: ${phaseOutcomes.map((p) => p.phase).join(", ") || "none"}.`,
        "note"
      );
      broadcast(projectId, "feed_message", feedMsg);

      broadcast(projectId, "cycle_update", { cycleId: cycleRecord.id, status: "stopped" });

      console.log(`[loop] [${project.name}] Cycle stopped.`);
    } else {
      // ── Cycle complete ─────────────────────────────────────────────────────────
      if (testPassed) {
        const cycleSummary = lastResult
          ? lastResult.summary
          : "Cycle complete. All phases ran. Check the feed for details.";

        const inboxMsg = sendInboxMessage(
          projectId,
          "pm",
          "Cycle complete",
          `All 6 phases completed for project "${project.name}".\n\n${cycleSummary}\n\nCheck the feed for full details of each phase. Artifacts saved: research.md, spec.md, design.md, build.md, test-report.md, review.md (CLAUDE.md).`
        );
        broadcast(projectId, "inbox_message", inboxMsg);
      }

      setProjectPhase(projectId, "complete");
      broadcast(projectId, "phase_change", { phase: "complete" });

      updateCycleRecord(cycleRecord.id, "complete", phaseOutcomes, Date.now());
      broadcast(projectId, "cycle_update", { cycleId: cycleRecord.id, status: "complete" });

      console.log(`[loop] [${project.name}] Cycle complete.`);
    }
  } catch (err) {
    // Unexpected top-level error
    updateCycleRecord(cycleRecord.id, "error", phaseOutcomes, Date.now());
    broadcast(projectId, "cycle_update", { cycleId: cycleRecord.id, status: "error" });
    throw err;
  } finally {
    runningCycles.delete(projectId);
    release();
    stoppingCycles.delete(projectId);
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
  taskDescription: string,
  onFeed?: (message: string) => void,
  cycleId?: string
): Promise<AgentResult> {
  const phaseTimeout = getPhaseTimeout(phase);
  const makeTimeoutPromise = () =>
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Phase ${phase} timed out after ${phaseTimeout / 1000}s`)),
        phaseTimeout
      )
    );

  const isTimeoutError = (err: unknown): boolean =>
    err instanceof Error && err.message.includes("timed out after");

  // First attempt
  try {
    return await Promise.race([
      runAgent(phase, projectId, taskDescription, onFeed, cycleId),
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
        runAgent(phase, projectId, taskDescription, onFeed, cycleId),
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
      await saveArtifact(
        projectId,
        phase,
        filename,
        `# Phase Error\n\noverall status: FAIL\n\nPhase \`${phase}\` timed out after two attempts (${phaseTimeout / 1000}s each).`,
        cycleId
      );

      throw secondErr;
    }
  }
}

/** Dispatch to the correct agent based on phase name. */
async function runAgent(
  phase: string,
  projectId: string,
  taskDescription: string,
  onFeed?: (message: string) => void,
  cycleId?: string
): Promise<AgentResult> {
  switch (phase) {
    case "research":
      return runResearcher(projectId, taskDescription, onFeed, cycleId);
    case "spec":
      return runPM(projectId, taskDescription, cycleId);
    case "design":
      return runDesigner(projectId, taskDescription, onFeed, cycleId);
    case "build":
      return runDeveloper(projectId, taskDescription, onFeed, cycleId);
    case "test":
      return runTester(projectId, taskDescription, cycleId);
    case "review":
      return runDocumenter(projectId, taskDescription, cycleId);
    default:
      throw new Error(`Unknown phase: ${phase}`);
  }
}
