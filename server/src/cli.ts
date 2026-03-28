#!/usr/bin/env bun
/**
 * cli.ts — Ouro Platform CLI
 *
 * Usage: bun server/src/cli.ts <command> [args]
 *   Or: bun run ouro <command> [args]
 */

import chalk from "chalk";
import { spawnSync } from "child_process";

const BASE_URL = process.env.OURO_URL ?? "http://localhost:3007";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  status: string;
  current_phase: string | null;
  created_at: number;
}

interface Agent {
  id: string;
  project_id: string;
  role: string;
  status: "idle" | "thinking" | "blocked";
  current_task: string | null;
  last_action_at: number | null;
}

interface FeedMessage {
  id: string;
  project_id: string;
  sender_role: string;
  recipient: string;
  content: string;
  message_type: string;
  created_at: number;
}

interface InboxMessage {
  id: string;
  project_id: string;
  sender_role: string;
  subject: string;
  body: string;
  is_read: number;
  replied_at: number | null;
  reply_body: string | null;
  created_at: number;
}

interface Artifact {
  id: string;
  project_id: string;
  phase: string;
  filename: string;
  content: string;
  version: number;
  created_at: number;
}

interface ReplyResponse {
  ok?: boolean;
  intent?: { type: string; key: string; value: string } | null;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Display helpers ──────────────────────────────────────────────────────────

const AGENT_EMOJI: Record<string, string> = {
  pm: "🧭",
  researcher: "🔬",
  designer: "🎨",
  developer: "👨‍💻",
  tester: "🧪",
  documenter: "📝",
};

const AGENT_SHORT: Record<string, string> = {
  pm: "PM",
  researcher: "Re",
  designer: "De",
  developer: "Dev",
  tester: "Te",
  documenter: "Do",
};

const AGENT_DISPLAY: Record<string, string> = {
  pm: "PM",
  researcher: "Researcher",
  designer: "Designer",
  developer: "Developer",
  tester: "Tester",
  documenter: "Documenter",
};

function agentEmoji(role: string): string {
  return AGENT_EMOJI[role] ?? "🤖";
}

function agentShort(role: string): string {
  return AGENT_SHORT[role] ?? role;
}

function agentDisplay(role: string): string {
  return AGENT_DISPLAY[role] ?? role;
}

function statusColor(status: string): string {
  if (status === "thinking") return chalk.yellow(status);
  if (status === "blocked") return chalk.red(status);
  return chalk.dim(status);
}

function phaseColor(phase: string | null): string {
  if (!phase) return chalk.dim("idle");
  if (phase === "complete") return chalk.green(phase);
  return chalk.cyan(phase);
}

function formatTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}

async function resolveProject(slugOrId: string): Promise<Project> {
  const projects = await get<Project[]>("/api/projects");
  const found = projects.find((p) => p.id === slugOrId || p.slug === slugOrId);
  if (!found) {
    throw new Error(
      `Project not found: "${slugOrId}". Run 'ouro projects' to list available projects.`
    );
  }
  return found;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdStatus(): Promise<void> {
  let healthy = false;
  try {
    await get<{ ok: boolean }>("/health");
    healthy = true;
  } catch {
    // server offline
  }

  console.log();
  const header = chalk.bold.yellow("⚡ Ouro Platform") + chalk.dim(` — ${BASE_URL}`);
  if (!healthy) {
    console.log(header + " " + chalk.red("[OFFLINE]"));
    console.log();
    return;
  }
  console.log(header);
  console.log();

  let projects: Project[];
  try {
    projects = await get<Project[]>("/api/projects");
  } catch (err) {
    console.error(chalk.red("Failed to fetch projects:"), (err as Error).message);
    return;
  }

  console.log(chalk.bold(`Projects (${projects.length})`));

  for (const project of projects) {
    let agents: Agent[] = [];
    try {
      agents = await get<Agent[]>(`/api/projects/${project.id}/agents`);
    } catch {
      // ignore
    }

    const allIdle = agents.length === 0 || agents.every((a) => a.status === "idle");
    const phase = project.current_phase;
    const phasePart = `[${phaseColor(phase)}]`;
    const namePart = chalk.white(project.name.padEnd(22));

    let agentPart: string;
    if (allIdle) {
      agentPart = chalk.dim("all idle");
    } else {
      agentPart = agents
        .map((a) => {
          const emoji = agentEmoji(a.role);
          const short = agentShort(a.role);
          const st =
            a.status === "thinking"
              ? chalk.yellow(a.status)
              : a.status === "blocked"
                ? chalk.red(a.status)
                : chalk.dim("idle");
          return `${emoji} ${short}:${st}`;
        })
        .join("  ");
    }

    console.log(`  ${chalk.green("●")} ${namePart} ${phasePart.padEnd(12)}  ${agentPart}`);
  }
  console.log();
}

async function cmdProjects(): Promise<void> {
  const projects = await get<Project[]>("/api/projects");

  console.log();
  console.log(chalk.bold("Projects"));
  console.log(chalk.dim("─".repeat(90)));
  console.log(
    chalk.dim(
      "  " +
        "ID      ".padEnd(10) +
        "Name".padEnd(26) +
        "Slug".padEnd(26) +
        "Phase".padEnd(12) +
        "Status".padEnd(12) +
        "Created"
    )
  );
  console.log(chalk.dim("─".repeat(90)));

  for (const p of projects) {
    const date = new Date(p.created_at).toLocaleDateString();
    console.log(
      "  " +
        chalk.cyan(p.id.slice(0, 8)).padEnd(10) +
        chalk.white(p.name).padEnd(26) +
        chalk.dim((p.slug ?? "—").padEnd(26)) +
        phaseColor(p.current_phase).padEnd(12) +
        chalk.dim(p.status.padEnd(12)) +
        chalk.dim(date)
    );
  }
  console.log();
}

async function cmdCycle(slugOrId: string, action: string): Promise<void> {
  if (action !== "start" && action !== "stop") {
    console.error(chalk.red(`Unknown cycle action: "${action}". Use start or stop.`));
    process.exit(1);
  }

  const project = await resolveProject(slugOrId);

  if (action === "start") {
    await post(`/api/projects/${project.id}/cycle/start`);
    console.log(chalk.green("▶") + ` Cycle started for ${chalk.bold(project.name)}`);
  } else {
    await post(`/api/projects/${project.id}/cycle/stop`);
    console.log(chalk.yellow("■") + ` Cycle stopped for ${chalk.bold(project.name)}`);
  }
}

function formatFeedLine(msg: FeedMessage): string {
  const time = chalk.dim(formatTime(msg.created_at));
  const emoji = agentEmoji(msg.sender_role);
  const sender = chalk.cyan(agentDisplay(msg.sender_role).padEnd(12));
  const recip = msg.recipient === "all" ? "All" : agentDisplay(msg.recipient);
  const arrow = chalk.dim("→");
  const recipPart = chalk.dim(recip.padEnd(8));
  const typePart = chalk.dim(`[${msg.message_type}]`.padEnd(12));
  const content = truncate(msg.content, 80);
  return `${time}  ${emoji} ${sender} ${arrow} ${recipPart}  ${typePart}  ${content}`;
}

async function cmdFeed(
  slugOrId: string,
  opts: { limit: number; follow: boolean }
): Promise<void> {
  const project = await resolveProject(slugOrId);

  const messages = await get<FeedMessage[]>(
    `/api/projects/${project.id}/feed?limit=${opts.limit}`
  );
  // Server returns newest-first; reverse for chronological display
  const sorted = [...messages].reverse();

  for (const msg of sorted) {
    console.log(formatFeedLine(msg));
  }

  if (!opts.follow) return;

  let lastId = sorted.length > 0 ? sorted[sorted.length - 1].id : null;
  console.log(chalk.dim("\n--- following feed (Ctrl+C to exit) ---\n"));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));

    try {
      const fresh = await get<FeedMessage[]>(`/api/projects/${project.id}/feed?limit=100`);
      const freshSorted = [...fresh].reverse();

      let printing = lastId === null;
      for (const msg of freshSorted) {
        if (msg.id === lastId) {
          printing = true;
          continue;
        }
        if (printing) {
          console.log(formatFeedLine(msg));
          lastId = msg.id;
        }
      }
    } catch {
      // server temporarily unavailable — keep trying
    }
  }
}

async function cmdInbox(slugOrId: string): Promise<void> {
  const project = await resolveProject(slugOrId);
  const messages = await get<InboxMessage[]>(`/api/projects/${project.id}/inbox`);

  console.log();
  console.log(chalk.bold(`Inbox — ${project.name}`));
  console.log(chalk.dim("─".repeat(80)));

  if (messages.length === 0) {
    console.log(chalk.dim("  No messages."));
  }

  for (const msg of messages) {
    const readMark = msg.is_read ? chalk.dim("✓") : chalk.green("●");
    const readLabel = msg.is_read ? chalk.dim("[read]  ") : chalk.bold("[unread]");
    const sender = chalk.cyan(agentDisplay(msg.sender_role).padEnd(14));
    const subject = `"${truncate(msg.subject, 50)}"`;
    const ago = chalk.dim(timeAgo(msg.created_at));

    console.log(`  ${readMark} ${readLabel}  ${sender}  ${subject}  ${ago}`);
    if (msg.reply_body) {
      console.log(`    ${chalk.dim("↳ You: " + truncate(msg.reply_body, 60))}`);
    }
  }
  console.log();
}

async function cmdReply(slugOrId: string, msgId: string, replyText: string): Promise<void> {
  const project = await resolveProject(slugOrId);
  const result = await post<ReplyResponse>(
    `/api/projects/${project.id}/inbox/${msgId}/reply`,
    { body: replyText }
  );

  let line = chalk.green("✓") + " Reply sent.";
  if (result.intent) {
    const { type, key, value } = result.intent;
    line += ` Intent: ${chalk.cyan(type)} — ${chalk.dim(key)}: ${chalk.white(value)}`;
  }
  console.log(line);
}

async function cmdCreate(name: string, description: string): Promise<void> {
  const project = await post<Project>("/api/projects", { name, description });
  console.log(chalk.green("✓") + " Project created:");
  console.log(`  id:   ${chalk.cyan(project.id)}`);
  console.log(`  slug: ${chalk.cyan(project.slug ?? "—")}`);
  console.log(`  name: ${chalk.white(project.name)}`);
}

async function cmdArtifacts(slugOrId: string, phase?: string): Promise<void> {
  const project = await resolveProject(slugOrId);

  if (phase) {
    // Pipe-friendly: print raw artifact content to stdout
    const artifact = await get<Artifact>(`/api/projects/${project.id}/artifacts/${phase}`);
    process.stdout.write(artifact.content);
    if (!artifact.content.endsWith("\n")) process.stdout.write("\n");
    return;
  }

  const artifacts = await get<Artifact[]>(`/api/projects/${project.id}/artifacts`);

  console.log();
  console.log(chalk.bold(`Artifacts — ${project.name}`));
  console.log(chalk.dim("─".repeat(70)));

  if (artifacts.length === 0) {
    console.log(chalk.dim("  No artifacts yet."));
  }

  for (const a of artifacts) {
    const date = chalk.dim(new Date(a.created_at).toLocaleString());
    console.log(
      `  ${chalk.cyan(a.phase.padEnd(10))}  ` +
        `${a.filename.padEnd(20)}  ` +
        `${chalk.dim("v" + a.version)}  ` +
        date
    );
  }
  console.log();
}

async function cmdLogs(lines: number): Promise<void> {
  const result = spawnSync(
    "journalctl",
    ["--user", "-u", "ouro-platform.service", "-n", String(lines), "--no-pager"],
    { encoding: "utf8" }
  );

  if (result.error) {
    console.error(chalk.red("Failed to run journalctl:"), result.error.message);
    console.error(chalk.dim("Is the ouro-platform systemd service installed?"));
    return;
  }

  const output = (result.stdout ?? "") + (result.status !== 0 ? result.stderr ?? "" : "");
  for (const line of output.split("\n")) {
    // Strip systemd prefix (e.g. "Mar 27 10:32:14 host ouro[pid]: MESSAGE")
    const match = line.match(/\]: (.+)$/);
    if (match) {
      console.log(match[1]);
    } else if (line.trim()) {
      console.log(chalk.dim(line));
    }
  }
}

function renderWatch(project: Project, agents: Agent[], feed: FeedMessage[]): void {
  const isRunning =
    project.current_phase &&
    project.current_phase !== "complete" &&
    project.current_phase !== "idle";

  const cycleStatus = isRunning
    ? chalk.yellow(`Cycle running — phase: ${project.current_phase}`)
    : chalk.dim("No active cycle");

  console.log(chalk.bold.yellow("⚡ Ouro Platform") + " — " + cycleStatus);
  console.log();

  console.log(chalk.bold("Agents"));
  for (const agent of agents) {
    const emoji = agentEmoji(agent.role);
    const name = chalk.white(agentDisplay(agent.role).padEnd(12));
    const st = statusColor(agent.status).padEnd(10);
    let task: string;
    if (agent.current_task) {
      task = chalk.dim(`"${truncate(agent.current_task, 50)}"`);
    } else if (agent.last_action_at) {
      task = chalk.dim(`Last active ${timeAgo(agent.last_action_at)}`);
    } else {
      task = chalk.dim("Waiting");
    }
    console.log(`  ${emoji} ${name}  ${st}  ${task}`);
  }
  console.log();

  // Feed shows oldest-first (server returns newest-first so reverse, take last 8)
  const feedSlice = [...feed].reverse().slice(-8);
  console.log(chalk.bold(`Feed (last ${feedSlice.length})`));
  for (const msg of feedSlice) {
    const time = chalk.dim(new Date(msg.created_at).toTimeString().slice(0, 5));
    const emoji = agentEmoji(msg.sender_role);
    const recip = msg.recipient === "all" ? "All" : agentShort(msg.recipient);
    const content = truncate(msg.content, 72);
    console.log(`  ${time}  ${emoji} ${chalk.dim("→")} ${chalk.dim(recip.padEnd(6))}  ${content}`);
  }
  console.log();
  console.log(chalk.dim("Press Ctrl+C to exit"));
}

async function cmdWatch(slugOrId: string): Promise<void> {
  const project = await resolveProject(slugOrId);

  async function refresh(): Promise<void> {
    let freshProject: Project = project;
    let agents: Agent[] = [];
    let feed: FeedMessage[] = [];

    try {
      freshProject = await get<Project>(`/api/projects/${project.id}`);
    } catch {
      // keep stale
    }
    try {
      agents = await get<Agent[]>(`/api/projects/${project.id}/agents`);
    } catch {
      // ignore
    }
    try {
      feed = await get<FeedMessage[]>(`/api/projects/${project.id}/feed?limit=20`);
    } catch {
      // ignore
    }

    process.stdout.write("\x1B[2J\x1B[0f");
    renderWatch(freshProject, agents, feed);
  }

  await refresh();
  const interval = setInterval(refresh, 3000);

  process.on("SIGINT", () => {
    clearInterval(interval);
    console.log();
    process.exit(0);
  });
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log();
  console.log(chalk.bold("ouro") + " — Ouro Platform CLI");
  console.log();
  console.log("Usage: " + chalk.cyan("ouro <command> [args]"));
  console.log();
  console.log("Commands:");
  const cmds: [string, string][] = [
    ["status", "Show overall system status"],
    ["projects", "List all projects (id, name, slug, phase, status)"],
    ["cycle <project> start|stop", "Start or stop a cycle for a project"],
    ["feed <project> [--limit N] [--follow]", "Show feed messages; --follow streams live"],
    ["inbox <project>", "Show inbox messages with read/unread indicator"],
    ['reply <project> <msg-id> "<text>"', "Reply to an inbox message"],
    ['create "<name>" "<description>"', "Create a new project"],
    ["artifacts <project> [phase]", "List artifacts, or print phase content to stdout"],
    ["logs [--lines N]", "Show ouro-platform systemd service logs"],
    ["watch <project>", "Live agent status + feed panel (refreshes every 3s)"],
  ];
  for (const [cmd, desc] of cmds) {
    console.log(`  ${chalk.cyan(cmd.padEnd(42))}  ${chalk.dim(desc)}`);
  }
  console.log();
  console.log(`Server: ${chalk.dim(BASE_URL)}  ${chalk.dim("(set OURO_URL to override)")}`);
  console.log();
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case "status":
      await cmdStatus();
      break;

    case "projects":
      await cmdProjects();
      break;

    case "cycle": {
      const slugOrId = args[0];
      const action = args[1];
      if (!slugOrId || !action) {
        console.error(chalk.red("Usage: ouro cycle <project> start|stop"));
        process.exit(1);
      }
      await cmdCycle(slugOrId, action);
      break;
    }

    case "feed": {
      const slugOrId = args[0];
      if (!slugOrId) {
        console.error(chalk.red("Usage: ouro feed <project> [--limit N] [--follow]"));
        process.exit(1);
      }
      const limitIdx = args.indexOf("--limit");
      const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? "20", 10) : 20;
      const follow = args.includes("--follow");
      await cmdFeed(slugOrId, { limit, follow });
      break;
    }

    case "inbox": {
      const slugOrId = args[0];
      if (!slugOrId) {
        console.error(chalk.red("Usage: ouro inbox <project>"));
        process.exit(1);
      }
      await cmdInbox(slugOrId);
      break;
    }

    case "reply": {
      const slugOrId = args[0];
      const msgId = args[1];
      const replyText = args[2];
      if (!slugOrId || !msgId || !replyText) {
        console.error(chalk.red('Usage: ouro reply <project> <msg-id> "<text>"'));
        process.exit(1);
      }
      await cmdReply(slugOrId, msgId, replyText);
      break;
    }

    case "create": {
      const name = args[0];
      const description = args[1] ?? "";
      if (!name) {
        console.error(chalk.red('Usage: ouro create "<name>" "<description>"'));
        process.exit(1);
      }
      await cmdCreate(name, description);
      break;
    }

    case "artifacts": {
      const slugOrId = args[0];
      if (!slugOrId) {
        console.error(chalk.red("Usage: ouro artifacts <project> [phase]"));
        process.exit(1);
      }
      const phase = args[1];
      await cmdArtifacts(slugOrId, phase);
      break;
    }

    case "logs": {
      const linesIdx = args.indexOf("--lines");
      const lines = linesIdx !== -1 ? parseInt(args[linesIdx + 1] ?? "50", 10) : 50;
      await cmdLogs(lines);
      break;
    }

    case "watch": {
      const slugOrId = args[0];
      if (!slugOrId) {
        console.error(chalk.red("Usage: ouro watch <project>"));
        process.exit(1);
      }
      await cmdWatch(slugOrId);
      break;
    }

    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

    default:
      console.error(chalk.red(`Unknown command: "${command}"`));
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red("Error:"), (err as Error).message);
  process.exit(1);
});
