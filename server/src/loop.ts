/**
 * loop.ts — Cycle orchestrator
 *
 * Runs one full cycle through all 6 phases serially:
 *   research → spec → design → build → test → review
 *
 * Each phase:
 * 1. Updates the project's current_phase
 * 2. Sets the responsible agent to 'thinking'
 * 3. Runs the agent (calls Claude)
 * 4. Saves the output as an artifact
 * 5. Posts a feed message with a summary
 * 6. Sets the agent back to 'idle'
 *
 * For MVP: Developer and Tester agents produce markdown plans, not real code
 * or Playwright runs. See developer.ts and tester.ts for TODO comments.
 */

import {
  getProject,
  setProjectPhase,
  setProjectStatus,
  setAgentStatus,
  saveArtifact,
  postFeedMessage,
  sendInboxMessage,
} from "./db.js";

import { runResearcher } from "./agents/researcher.js";
import { runPM } from "./agents/pm.js";
import { runDesigner } from "./agents/designer.js";
import { runDeveloper } from "./agents/developer.js";
import { runTester } from "./agents/tester.js";
import { runDocumenter } from "./agents/documenter.js";

import type { AgentResult } from "./agents/base.js";

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
 * Resolves when all phases complete. Rejects if any phase throws.
 */
export async function runCycle(projectId: string): Promise<void> {
  if (runningCycles.has(projectId)) {
    throw new Error(`Cycle already running for project ${projectId}`);
  }

  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  runningCycles.add(projectId);

  try {
    const phases = ["research", "spec", "design", "build", "test", "review"] as const;
    let lastResult: AgentResult | null = null;

    for (const phase of phases) {
      const role = phaseToRole[phase];
      const filename = phaseToFilename[phase];
      const taskDescription = getPhaseTask(phase, project);

      // Update project phase
      setProjectPhase(projectId, phase);
      broadcast(projectId, "phase_change", { phase });

      // Set agent to thinking
      setAgentStatus(projectId, role, "thinking", taskDescription);
      broadcast(projectId, "agent_status", { role, status: "thinking", current_task: taskDescription });

      console.log(`[loop] [${project.name}] Phase: ${phase} → ${role} thinking...`);

      // Run the agent
      try {
        const result = await runAgent(phase, projectId, taskDescription);
        lastResult = result;

        // Save artifact
        saveArtifact(projectId, phase, filename, result.content);

        // Post feed summary
        const feedMsg = postFeedMessage(
          projectId,
          role,
          "all",
          `[${phase.toUpperCase()} COMPLETE] ${result.summary}`,
          "handoff"
        );
        broadcast(projectId, "feed_message", feedMsg);

        console.log(`[loop] [${project.name}] Phase ${phase} complete.`);
      } catch (err) {
        // Agent threw — mark as blocked, post to feed, continue
        console.error(`[loop] [${project.name}] Phase ${phase} failed:`, err);
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
      }

      // Set agent back to idle
      setAgentStatus(projectId, role, "idle");
      broadcast(projectId, "agent_status", { role, status: "idle", current_task: null });
    }

    // Cycle complete — PM sends inbox summary
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

    // Mark project as back to active (not in a phase)
    setProjectPhase(projectId, "complete");
    broadcast(projectId, "phase_change", { phase: "complete" });

    console.log(`[loop] [${project.name}] Cycle complete.`);
  } finally {
    runningCycles.delete(projectId);
  }
}

/** Dispatch to the correct agent based on phase */
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
