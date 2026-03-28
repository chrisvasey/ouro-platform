/**
 * cli.ts — Ouro CLI
 *
 * Commands:
 *   ouro cycle <slug> start        — Start a cycle (blocks until complete)
 *   ouro watch <slug>              — Watch live cycle events via WebSocket
 *   ouro artifacts <slug> [phase]  — List artifacts or print one by phase
 *
 * The CLI auto-starts the server if localhost:3001 is not responding.
 * It also auto-seeds if the requested project doesn't exist yet.
 */

const BASE_HTTP = process.env.OURO_URL ?? "http://localhost:3001";
const BASE_WS = BASE_HTTP.replace(/^http/, "ws");

// ─── Server management ────────────────────────────────────────────────────────

let serverProc: ReturnType<typeof Bun.spawn> | null = null;

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_HTTP}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<void> {
  if (await isServerUp()) return;

  console.log("[ouro] Server not running — starting it...");

  // Resolve path relative to this file's directory
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
      console.log("[ouro] Server ready.");
      return;
    }
  }

  throw new Error("Server failed to start within 10 seconds.");
}

// ─── Project lookup ───────────────────────────────────────────────────────────

async function listProjects(): Promise<any[]> {
  const res = await fetch(`${BASE_HTTP}/api/projects`);
  if (!res.ok) throw new Error("Failed to list projects");
  return res.json();
}

async function findProject(slug: string): Promise<any> {
  let projects = await listProjects();
  let project = projects.find((p: any) => p.slug === slug);

  if (!project) {
    // Try seeding once
    console.log("[ouro] Project not found — running seed...");
    await fetch(`${BASE_HTTP}/api/seed`, { method: "POST" });
    projects = await listProjects();
    project = projects.find((p: any) => p.slug === slug);
  }

  if (!project) {
    throw new Error(`Project not found: "${slug}". Available: ${projects.map((p: any) => p.slug).join(", ")}`);
  }

  return project;
}

// ─── Watch helpers ────────────────────────────────────────────────────────────

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

function ts(): string {
  return DIM + new Date().toLocaleTimeString() + RESET;
}

/**
 * Connect to WS and stream events for the given project.
 * Resolves when:
 *   - exitOnComplete=true and phase "complete" is received
 *   - exitOnComplete=false and the WS is closed / Ctrl+C
 */
function watchProject(project: any, exitOnComplete: boolean): Promise<void> {
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
          console.log(`${ts()} Connected to ${BOLD}${project.name}${RESET}`);
          break;

        case "phase_change": {
          const phase = msg.data?.phase as string;
          if (phase === "complete") {
            console.log(`\n${ts()} ${BOLD}\x1b[32m✓ Cycle complete — all 6 phases done.${RESET}\n`);
            if (exitOnComplete) done();
          } else {
            console.log(`\n${ts()} ${BOLD}── Phase: ${phase.toUpperCase()} ──${RESET}`);
          }
          break;
        }

        case "agent_status": {
          const role = msg.data?.role as string;
          const status = msg.data?.status as string;
          const color = roleColor(role);
          if (status === "thinking") {
            process.stdout.write(`${ts()} ${color}${role}${RESET} thinking...`);
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
          console.log(`${ts()} ${color}[${role}]${RESET} ${short}`);
          break;
        }

        case "inbox_message": {
          const subject = msg.data?.subject as string;
          console.log(`\n${ts()} \x1b[33m[inbox]\x1b[0m ${subject}`);
          if (exitOnComplete) done();
          break;
        }
      }
    });

    ws.addEventListener("error", (ev: Event) => {
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

async function cmdCycle(slug: string, action: string): Promise<void> {
  if (action !== "start") {
    console.error("Usage: ouro cycle <slug> start");
    process.exit(1);
  }

  await ensureServer();
  const project = await findProject(slug);

  // Start the cycle
  const res = await fetch(`${BASE_HTTP}/api/projects/${project.id}/cycle/start`, {
    method: "POST",
  });

  const body = await res.json() as any;
  if (!res.ok) {
    // 409 = already running — still watch
    if (res.status === 409) {
      console.log(`[ouro] ${body.message} — attaching watch...`);
    } else {
      throw new Error(body.message ?? "Failed to start cycle");
    }
  } else {
    console.log(`[ouro] Cycle started for: ${BOLD}${project.name}${RESET}`);
  }

  // Watch until complete
  await watchProject(project, true);
}

async function cmdWatch(slug: string): Promise<void> {
  await ensureServer();
  const project = await findProject(slug);
  console.log(`[ouro] Watching ${BOLD}${project.name}${RESET} — press Ctrl+C to stop.`);
  await watchProject(project, false);
}

async function cmdArtifacts(slug: string, phase?: string): Promise<void> {
  await ensureServer();
  const project = await findProject(slug);

  if (!phase) {
    const res = await fetch(`${BASE_HTTP}/api/projects/${project.id}/artifacts`);
    const artifacts = await res.json() as any[];
    if (artifacts.length === 0) {
      console.log("No artifacts yet. Run a cycle first.");
      return;
    }
    console.log(`Artifacts for ${project.name}:`);
    for (const a of artifacts) {
      console.log(`  ${a.phase.padEnd(12)} ${a.filename} (v${a.version})`);
    }
    return;
  }

  const res = await fetch(`${BASE_HTTP}/api/projects/${project.id}/artifacts/${phase}`);
  if (!res.ok) {
    console.error(`No artifact found for phase: ${phase}`);
    process.exit(1);
  }

  const artifact = await res.json() as any;
  console.log(artifact.content);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const [, , command, slug, ...rest] = process.argv;

if (!command || !slug) {
  console.error("Usage:");
  console.error("  ouro cycle    <slug> start   — Run a full cycle");
  console.error("  ouro watch    <slug>          — Watch live events");
  console.error("  ouro artifacts <slug> [phase] — View artifacts");
  process.exit(1);
}

try {
  switch (command) {
    case "cycle":
      await cmdCycle(slug, rest[0] ?? "");
      break;
    case "watch":
      await cmdWatch(slug);
      break;
    case "artifacts":
      await cmdArtifacts(slug, rest[0]);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
} catch (err: any) {
  console.error(`[ouro] Error: ${err.message}`);
  process.exit(1);
} finally {
  // If we spawned the server, leave it running for subsequent commands
  if (serverProc) {
    serverProc.unref();
  }
}
