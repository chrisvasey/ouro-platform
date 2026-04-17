/**
 * developer.ts — Developer agent
 *
 * Produces a detailed implementation plan (build.md), then executes it
 * by spawning Claude Code CLI in the project workspace directory.
 *
 * Uses a 5-step sequential pipeline:
 *   1. Task decomposition  (~500 token input → numbered task list)
 *   2. Architecture decisions  (task list → data shapes, API contract, file tree)
 *   3. Implementation plan per task chunk  (groups of 6 tasks → impl notes)
 *   4. Assemble final build.md  (all outputs → complete artifact)
 *   5. Execute via Claude Code CLI  (spawn `claude --print` in project workspace)
 *
 * Step 5 spawns Claude Code CLI with --print --permission-mode bypassPermissions
 * in the project workspace directory, passing build.md as the task prompt.
 * After execution, it does a `git add -A && git commit` to capture changes.
 */

import { join } from "node:path";
import { runClaude } from "../claude.js";
import { loadPrompt } from "../prompts.js";
import { getArtifactByPhase, getProject } from "../db.js";
import { buildContextBlock, extractSummary, emitAgentStarted, emitAgentCompleted, emitAgentFailed, dispatchToolUses, isSelfModPath, waitForProposedChangeResolution, getBaseBroadcast, type AgentResult } from "./base.js";
import { createProposedChange } from "../db.js";

/** Per-step timeout: 240 seconds. Each micro-call has its own independent budget. */
const STEP_TIMEOUT_MS = 240_000;

/** Claude Code execution timeout: 10 minutes */
const EXECUTE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Resolve the filesystem workspace directory for a project.
 * For the self-referential ouro-platform project, this is ~/ouro-platform.
 * For other projects, defaults to ~/workspaces/<slug>.
 */
function resolveWorkspaceDir(slug: string | null): string {
  const home = process.env.HOME ?? "/home/lucial";
  if (!slug) return join(home, "workspaces", "unknown");
  if (slug === "ouro-platform") return join(home, "ouro-platform");
  return join(home, "workspaces", slug);
}

/**
 * Run Claude Code CLI in a workspace directory with a given prompt.
 * Returns { output, filesChanged, commitSha, success }.
 */
async function executeWithClaudeCode(
  workspaceDir: string,
  prompt: string,
  projectId: string,
  agentRole: string,
  cycleId?: string,
  onProgress?: (msg: string) => void
): Promise<{ output: string; filesChanged: number; commitSha: string | null; success: boolean }> {
  const token =
    process.env.CLAUDE_CODE_OAUTH_TOKEN ??
    process.env.CLAUDE_OAUTH_TOKEN ??
    process.env.ANTHROPIC_API_KEY;

  if (!token) {
    console.warn("[developer] No auth token — skipping code execution");
    return { output: "(No auth token — code execution skipped)", filesChanged: 0, commitSha: null, success: false };
  }

  onProgress?.("[Developer → All] Starting Claude Code execution...");
  console.log(`[developer] Step 5: Running Claude Code in ${workspaceDir}`);

  const proc = Bun.spawn(
    [
      "claude",
      "--print",
      "--permission-mode", "bypassPermissions",
      "--output-format", "text",
      prompt,
    ],
    {
      cwd: workspaceDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: token,
        CLAUDE_CODE_OAUTH_TOKEN: token,
      },
    }
  );

  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, EXECUTE_TIMEOUT_MS);

  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timeoutHandle);

  if (timedOut) {
    console.warn("[developer] Claude Code execution timed out after 10 minutes");
    return { output: "(Claude Code execution timed out after 10 minutes)", filesChanged: 0, commitSha: null, success: false };
  }

  if (exitCode !== 0) {
    console.warn(`[developer] Claude Code exited ${exitCode}`);
    // Still try to commit whatever was written
  }

  // Count staged changes and commit
  let filesChanged = 0;
  let commitSha: string | null = null;

  try {
    // Check if this is a git repo
    const gitCheck = Bun.spawn(["git", "rev-parse", "--git-dir"], {
      cwd: workspaceDir, stdout: "pipe", stderr: "pipe",
    });
    await gitCheck.exited;

    if (gitCheck.exitCode === 0) {
      // Count changed files
      const statusProc = Bun.spawn(["git", "status", "--porcelain"], {
        cwd: workspaceDir, stdout: "pipe", stderr: "pipe",
      });
      const statusOut = await new Response(statusProc.stdout).text();
      await statusProc.exited;
      const changedLines = statusOut.trim().split("\n").filter(l => l.trim());
      filesChanged = changedLines.length;

      if (filesChanged > 0) {
        // Partition changed files: guarded (server/src/) vs normal
        const relPaths = changedLines.map((l) => l.slice(3).trim());
        const guardedFiles = relPaths.filter((p) => isSelfModPath(p) || p.startsWith("server/src/"));
        const normalFiles = relPaths.filter((p) => !isSelfModPath(p) && !p.startsWith("server/src/"));

        // Self-mod gate: propose each guarded file and await approval/rejection
        for (const rel of guardedFiles) {
          const absPath = join(workspaceDir, rel);
          let content = "";
          try {
            content = await Bun.file(absPath).text();
          } catch {
            // File deleted or unreadable — skip
            continue;
          }
          const change = createProposedChange(projectId, agentRole, absPath, content, cycleId);
          const broadcast = getBaseBroadcast();
          broadcast(projectId, "proposed_change", change);
          broadcast(projectId, "agent_status", { role: agentRole, status: "blocked", current_task: `Awaiting self-mod approval: ${rel}` });
          const resolution = await waitForProposedChangeResolution(change.id);
          broadcast(projectId, "proposed_change_resolved", { id: change.id, status: resolution });
          broadcast(projectId, "agent_status", { role: agentRole, status: "thinking", current_task: null });
          if (resolution === "APPROVED") {
            const stageProc = Bun.spawn(["git", "add", rel], { cwd: workspaceDir, stdout: "pipe", stderr: "pipe" });
            await stageProc.exited;
          } else {
            // Revert rejected file
            const revertProc = Bun.spawn(["git", "checkout", "HEAD", "--", rel], { cwd: workspaceDir, stdout: "pipe", stderr: "pipe" });
            await revertProc.exited;
          }
        }

        // Stage normal (non-guarded) files directly
        for (const rel of normalFiles) {
          const stageProc = Bun.spawn(["git", "add", rel], { cwd: workspaceDir, stdout: "pipe", stderr: "pipe" });
          await stageProc.exited;
        }

        const commitMsg = `feat(ouro): cycle auto-implementation — ${filesChanged} file(s) changed`;
        const commitProc = Bun.spawn(
          ["git", "commit", "-m", commitMsg, "--author", "Ouro Agent <ouro@ouro.platform>"],
          { cwd: workspaceDir, stdout: "pipe", stderr: "pipe",
            env: { ...process.env, GIT_AUTHOR_NAME: "Ouro Agent", GIT_COMMITTER_NAME: "Ouro Agent",
                   GIT_AUTHOR_EMAIL: "ouro@ouro.platform", GIT_COMMITTER_EMAIL: "ouro@ouro.platform" } }
        );
        const commitOut = await new Response(commitProc.stdout).text();
        await commitProc.exited;

        if (commitProc.exitCode === 0) {
          const shaMatch = commitOut.match(/\[[\w/]+ ([a-f0-9]+)\]/);
          commitSha = shaMatch?.[1] ?? null;
          onProgress?.(`[Developer → All] Committed ${filesChanged} file(s) changed — ${commitSha ?? "no SHA"}`);
          console.log(`[developer] Committed: ${filesChanged} files, SHA ${commitSha}`);

          // Push to origin/dev so self-improvement loop doesn't lose work on reset
          try {
            const pushProc = Bun.spawn(["git", "push", "origin", "dev"], {
              cwd: workspaceDir, stdout: "pipe", stderr: "pipe",
              env: { ...process.env },
            });
            await pushProc.exited;
            if (pushProc.exitCode === 0) {
              console.log(`[developer] Pushed commit ${commitSha} to origin/dev`);
            } else {
              const pushErr = await new Response(pushProc.stderr).text();
              console.warn(`[developer] Push to origin/dev failed: ${pushErr.slice(0, 200)}`);
            }
          } catch (pushErr) {
            console.warn("[developer] Push error:", (pushErr as Error).message);
          }
        }
      } else {
        console.log("[developer] No file changes after execution");
        onProgress?.("[Developer → All] Execution complete — no file changes detected");
      }
    }
  } catch (gitErr) {
    console.warn("[developer] Git commit failed:", (gitErr as Error).message);
  }

  return {
    output: stdout.slice(0, 4000), // cap at 4KB for artifact
    filesChanged,
    commitSha,
    success: exitCode === 0,
  };
}

interface StepResult { content: string; inputTokens: number; outputTokens: number; costUsd: number; toolUses: Array<{ id: string; name: string; input: unknown }> }

/**
 * Run a single Claude micro-call with one automatic retry on timeout.
 * If both attempts time out, returns an empty string and logs a warning so
 * the pipeline can continue with whatever partial data it has.
 */
async function runStep(opts: Parameters<typeof runClaude>[0]): Promise<StepResult> {
  const attempt = async (): Promise<StepResult> => {
    const result = await runClaude({ ...opts, timeoutMs: STEP_TIMEOUT_MS });
    return { content: result.content, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0, costUsd: result.costUsd, toolUses: result.toolUses };
  };

  try {
    return await attempt();
  } catch (err) {
    if ((err as { timeout?: boolean }).timeout) {
      console.warn("[developer] Step timed out — retrying once...");
      try {
        return await attempt();
      } catch {
        console.warn("[developer] Step timed out again — continuing with empty output");
        return { content: "", inputTokens: 0, outputTokens: 0, costUsd: 0, toolUses: [] };
      }
    }
    throw err;
  }
}

/** Extract numbered task lines (e.g. "1. [file] — [task]") from free-form text */
function parseTaskLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\./.test(l));
}

/** Split an array into chunks of the given size */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Run the Developer agent.
 *
 * @param projectId       - ID of the project being built
 * @param taskDescription - High-level task from the loop orchestrator
 * @param onFeed          - Optional callback to post incremental progress messages
 *                          to the feed as each step completes. The loop passes a
 *                          function that writes to the DB and broadcasts over WS.
 */
export async function runDeveloper(
  projectId: string,
  taskDescription: string,
  onFeed?: (message: string) => void,
  cycleId?: string
): Promise<AgentResult> {
  const meta = { projectId, cycleId, agentRole: "developer" };
  emitAgentStarted(meta, taskDescription);

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  try {
    const systemPrompt = loadPrompt("developer");

    const project = getProject(projectId);
    const workspaceDir = resolveWorkspaceDir(project?.slug ?? null);

    const designArtifact = getArtifactByPhase(projectId, "design");
    const specArtifact = getArtifactByPhase(projectId, "spec");

    // Trim artifacts to keep per-step token counts manageable
    const specContent = (specArtifact?.content ?? "").slice(0, 2000);
    const designContent = (designArtifact?.content ?? "").slice(0, 2000);

    // Build the standard context block (project name, phase, CLAUDE.md, recent feed)
    const contextBlock = buildContextBlock(projectId, taskDescription);

    // ─── Step 1: Task decomposition ───────────────────────────────────────────
    console.log("[developer] Step 1: Task decomposition...");

    const step1Prompt = [
      contextBlock,
      "",
      "You are a senior developer. Read these user stories and design spec.",
      "Output ONLY a numbered task list — one line per task, in implementation order.",
      "No prose, no explanations. Format: `1. [component/file] — [what to build]`",
      "",
      specContent ? `## User Stories:\n${specContent}` : "(No spec available)",
      "",
      designContent ? `## Design Spec:\n${designContent}` : "(No design available)",
    ].join("\n");

    const step1 = await runStep({ systemPrompt, userPrompt: step1Prompt });
    totalInput += step1.inputTokens; totalOutput += step1.outputTokens; totalCost += step1.costUsd;
    await dispatchToolUses(projectId, step1.toolUses, "developer", cycleId);
    const taskList = step1.content;
    const taskLines = parseTaskLines(taskList);
    const taskCount = taskLines.length > 0 ? taskLines.length : "several";
    onFeed?.(`[Developer → All] Task breakdown ready — ${taskCount} tasks identified`);
    console.log(`[developer] Step 1 complete — ${taskCount} tasks`);

    // ─── Step 2: Architecture decisions ───────────────────────────────────────
    console.log("[developer] Step 2: Architecture decisions...");

    const step2Prompt = [
      contextBlock,
      "",
      "You are a senior developer. Given these tasks, define:",
      "(1) data shapes as TypeScript interfaces,",
      "(2) API contract as route list with method/path/body/response,",
      "(3) file structure as a tree.",
      "Be concise — bullet points only.",
      "",
      "## Tasks:",
      taskList || "(No tasks — use reasonable defaults based on project context)",
    ].join("\n");

    const step2 = await runStep({ systemPrompt, userPrompt: step2Prompt });
    totalInput += step2.inputTokens; totalOutput += step2.outputTokens; totalCost += step2.costUsd;
    await dispatchToolUses(projectId, step2.toolUses, "developer", cycleId);
    const architectureDoc = step2.content;
    console.log("[developer] Step 2 complete");

    // ─── Step 3: Implementation plan per task chunk ───────────────────────────
    console.log("[developer] Step 3: Implementation plan per task chunk...");

    // Fall back to a single synthetic chunk if step 1 returned no parseable lines
    const chunks =
      taskLines.length > 0 ? chunkArray(taskLines, 6) : [["(implement core application features)"]];

    const implementationNotes: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const startIdx = i * 3 + 1;
      const endIdx = startIdx + chunk.length - 1;

      const step3Prompt = [
        contextBlock,
        "",
        `You are a senior developer. For each of these ${chunk.length} task(s), write:`,
        "filename, function signature, 3-5 bullet points of what it does. No code. Be specific.",
        "",
        "## Tasks:",
        chunk.join("\n"),
        "",
        "## Architecture:",
        architectureDoc,
      ].join("\n");

      const step3 = await runStep({ systemPrompt, userPrompt: step3Prompt });
      totalInput += step3.inputTokens; totalOutput += step3.outputTokens; totalCost += step3.costUsd;
      await dispatchToolUses(projectId, step3.toolUses, "developer", cycleId);
      implementationNotes.push(step3.content);
      onFeed?.(`[Developer → All] Tasks ${startIdx}–${endIdx} planned`);
      console.log(`[developer] Step 3 chunk ${i + 1}/${chunks.length} complete`);
      await new Promise(r => setTimeout(r, 2500)); // rate limit buffer
    }

    // ─── Step 4: Assemble build.md ─────────────────────────────────────────────
    console.log("[developer] Step 4: Assembling build.md...");

    const allNotes = implementationNotes.join("\n\n---\n\n");

    const step4Prompt = [
      contextBlock,
      "",
      "You are a senior developer. Assemble a complete build.md from these inputs.",
      "Include: ## Overview, ## Architecture (data shapes + API + file structure),",
      "## Implementation Plan (per component), ## Commit Plan (conventional commits in order).",
      "Be specific but concise.",
      "",
      "## Task List:",
      taskList,
      "",
      "## Architecture:",
      architectureDoc,
      "",
      "## Implementation Notes:",
      allNotes,
    ].join("\n");

    const step4 = await runStep({ systemPrompt, userPrompt: step4Prompt });
    totalInput += step4.inputTokens; totalOutput += step4.outputTokens; totalCost += step4.costUsd;
    await dispatchToolUses(projectId, step4.toolUses, "developer", cycleId);
    onFeed?.("[Developer → All] build.md assembled — implementation plan complete");
    console.log("[developer] Step 4 complete — build.md ready");

    const buildPlan =
      step4.content ||
      "# Build Plan\n\n(Developer agent timed out on all steps — see server logs for details.)";

    // ─── Step 5: Execute via Claude Code CLI ───────────────────────────────────
    console.log("[developer] Step 5: Executing via Claude Code CLI...");

    const executePrompt = [
      "You are implementing a software feature. Read the build plan below and implement it.",
      "Make the minimum changes required to satisfy the acceptance criteria.",
      "Do not ask questions — just implement. Commit nothing (the caller will commit).",
      "",
      "## Build Plan:",
      buildPlan.slice(0, 6000),
    ].join("\n");

    let executionResult: { output: string; filesChanged: number; commitSha: string | null; success: boolean };
    try {
      executionResult = await executeWithClaudeCode(workspaceDir, executePrompt, projectId, "developer", cycleId, onFeed);
    } catch (execErr) {
      console.warn("[developer] Step 5 execution error:", (execErr as Error).message);
      executionResult = {
        output: `Execution error: ${(execErr as Error).message}`,
        filesChanged: 0,
        commitSha: null,
        success: false,
      };
    }

    // Append execution summary to build artifact
    const executionSummary = executionResult.success || executionResult.filesChanged > 0
      ? `\n\n---\n\n## Execution Result\n\n` +
        `- **Files changed:** ${executionResult.filesChanged}\n` +
        `- **Commit SHA:** ${executionResult.commitSha ?? "(none)"}\n` +
        `- **Status:** ${executionResult.success ? "✅ Success" : "⚠️ Partial"}\n\n` +
        `### Claude Code Output\n\n\`\`\`\n${executionResult.output}\n\`\`\``
      : `\n\n---\n\n## Execution Result\n\n⚠️ No file changes detected. Claude Code ran but made no modifications.\n\n` +
        `\`\`\`\n${executionResult.output}\n\`\`\``;

    const content = buildPlan + executionSummary;
    const summary = executionResult.filesChanged > 0
      ? `${executionResult.filesChanged} files changed — commit ${executionResult.commitSha ?? "(no SHA)"}`
      : extractSummary(buildPlan);

    emitAgentCompleted(meta, { inputTokens: totalInput, outputTokens: totalOutput, costUsd: totalCost });
    return { content, summary };
  } catch (err) {
    emitAgentFailed(meta, err as Error);
    throw err;
  }
}
