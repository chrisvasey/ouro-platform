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
const BASE_WS = BASE_URL.replace(/^http/, "ws");

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

// ─── Server management ────────────────────────────────────────────────────────

let serverProc: ReturnType<typeof Bun.spawn> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<void> {
  if (await isServerUp()) return;

  console.log(chalk.dim("[ouro] Server not running — starting it..."));

  const serverEntry = new URL("./index.ts", import.meta.url).pathname;

  serverProc = Bun.spawn(["bun", "run", serverEntry], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });

  // Poll until ready (max 10 seconds)
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await isServerUp()) {
      console.log(chalk.dim("[ouro] Server ready."));
      return;
    }
  }

  throw new Error("Server failed to start within 10 seconds.");
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

// ─── WebSocket watch helpers ──────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  pm: "\x1b[34m",         // blue
  researcher: "\x1b[35m", // magenta
  designer: "\x1b[95m",   // bright magenta
  developer: "\x1b[36m",  // cyan
  tester: "\x1b[33m",     // yellow
  documenter: "\x1b[32m", // green
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? "\x1b[37m";
}

function wsTs(): string {
  return DIM + new Date().toLocaleTimeString() + RESET;
}

/**
 * Connect to WS and stream events for the given project.
 * Resolves when:
 *   - exitOnComplete=true and phase "complete" is received
 *   - exitOnComplete=false and the WS is closed / Ctrl+C
 */
function watchProject(project: Project, exitOnComplete: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE_WS}/ws`);
    let resolved = false;

    function done() {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve();
      }
    }

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "subscribe", projectId: project.id }));
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }

      switch (msg.event) {
        case "subscribed":
          console.log(`${wsTs()} Connected to ${BOLD}${project.name}${RESET}`);
          break;

        case "phase_change": {
          const phase = msg.data?.phase as string;
          if (phase === "complete") {
            console.log(`\n${wsTs()} ${BOLD}\x1b[32m✓ Cycle complete — all 6 phases done.${RESET}\n`);
            if (exitOnComplete) done();
          } else {
            console.log(`\n${wsTs()} ${BOLD}── Phase: ${phase.toUpperCase()} ──${RESET}`);
          }
          break;
        }

        case "agent_status": {
          const role = msg.data?.role as string;
          const status = msg.data?.status as string;
          const color = roleColor(role);
          if (status === "thinking") {
            process.stdout.write(`${wsTs()} ${color}${role}${RESET} thinking...`);
          } else if (status === "idle") {
            process.stdout.write(` ${DIM}done${RESET}\n`);
          } else if (status === "blocked") {
            process.stdout.write(` \x1b[31mBLOCKED\x1b[0m\n`);
          }
          break;
        }

        case "feed_message": {
          const content = (msg.data?.content as string) ?? "";
          const role = msg.data?.sender_role as string;
          const color = roleColor(role);
          const short = content.length > 160 ? content.slice(0, 157) + "…" : content;
          console.log(`${wsTs()} ${color}[${role}]${RESET} ${short}`);
          break;
        }

        case "inbox_message": {
          const subject = msg.data?.subject as string;
          console.log(`\n${wsTs()} \x1b[33m[inbox]\x1b[0m ${subject}`);
          if (exitOnComplete) done();
          break;
        }
      }
    });

    ws.addEventListener("error", (_ev: Event) => {
      if (!resolved) reject(new Error("WebSocket error"));
    });

    ws.addEventListener("close", () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    });
  });
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

  await ensureServer();
  const project = await resolveProject(slugOrId);

  if (action === "start") {
    const res = await fetch(`${BASE_URL}/api/projects/${project.id}/cycle/start`, {
      method: "POST",
    });
    const body = await res.json() as any;
    if (!res.ok) {
      if (res.status === 409) {
        console.log(chalk.yellow(`⚠`) + ` ${body.message} — attaching watch...`);
      } else {
        throw new Error(body.message ?? "Failed to start cycle");
      }
    } else {
      console.log(chalk.green("▶") + ` Cycle started for ${chalk.bold(project.name)}`);
    }
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
  await ensureServer();
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

async function cmdWatch(slugOrId: string, opts: { ws?: boolean } = {}): Promise<void> {
  await ensureServer();
  const project = await resolveProject(slugOrId);

  // --ws flag: use WebSocket streaming (real-time, blocks until closed)
  if (opts.ws) {
    console.log(chalk.dim(`[ouro] Watching ${project.name} — press Ctrl+C to stop.`));
    await watchProject(project, false);
    return;
  }

  // Default: polling dashboard (refreshes every 3s)
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
    ["watch <project> [--ws]", "Live agent status + feed panel; --ws for WebSocket stream"],
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
        console.error(chalk.red("Usage: ouro watch <project> [--ws]"));
        process.exit(1);
      }
      const useWs = args.includes("--ws");
      await cmdWatch(slugOrId, { ws: useWs });
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

main()
  .catch((err) => {
    console.error(chalk.red("Error:"), (err as Error).message);
    process.exit(1);
  })
  .finally(() => {
    // If we auto-spawned the server, leave it running for subsequent commands
    if (serverProc) {
      serverProc.unref();
    }
  });
