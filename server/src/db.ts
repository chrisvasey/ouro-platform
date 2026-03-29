import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = process.env.DATABASE_URL ?? join(import.meta.dir, "../../ouro.db");

export const db = new Database(DB_PATH, { create: true });

// Enable WAL mode for better concurrent read performance
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");

// ─── Schema ──────────────────────────────────────────────────────────────────

db.run(`
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE,
    description TEXT,
    status      TEXT DEFAULT 'active',
    current_phase TEXT,
    created_at  INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS agents (
    id            TEXT PRIMARY KEY,
    project_id    TEXT,
    role          TEXT,
    status        TEXT DEFAULT 'idle',
    current_task  TEXT,
    last_action_at INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS feed_messages (
    id           TEXT PRIMARY KEY,
    project_id   TEXT,
    sender_role  TEXT,
    recipient    TEXT,
    content      TEXT,
    message_type TEXT,
    created_at   INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id                TEXT PRIMARY KEY,
    project_id        TEXT,
    sender_role       TEXT,
    subject           TEXT,
    body              TEXT,
    is_read           INTEGER DEFAULT 0,
    replied_at        INTEGER,
    reply_body        TEXT,
    reply_intent_json TEXT,
    created_at        INTEGER
  )
`);

// Migrate existing databases that pre-date the reply_intent_json column
try {
  db.run("ALTER TABLE inbox_messages ADD COLUMN reply_intent_json TEXT");
} catch {
  // Column already exists — ignore
}

// Migrate: add blocks_cycle — 0=non-blocking, 1=blocks loop until replied
try {
  db.run("ALTER TABLE inbox_messages ADD COLUMN blocks_cycle INTEGER NOT NULL DEFAULT 0");
} catch {
  // Column already exists — ignore
}

// Artifact versioning columns (Cycle 8)
try { db.run("ALTER TABLE artifacts ADD COLUMN cycle_id TEXT"); } catch { /* already exists */ }
try { db.run("ALTER TABLE artifacts ADD COLUMN previous_version_id TEXT"); } catch { /* already exists */ }
try { db.run("ALTER TABLE artifacts ADD COLUMN diff_from_previous TEXT"); } catch { /* already exists */ }

db.run(`
  CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    project_id   TEXT,
    assigned_to  TEXT,
    title        TEXT,
    description  TEXT,
    status       TEXT DEFAULT 'pending',
    priority     INTEGER DEFAULT 50,
    created_at   INTEGER,
    completed_at INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS artifacts (
    id         TEXT PRIMARY KEY,
    project_id TEXT,
    phase      TEXT,
    filename   TEXT,
    content    TEXT,
    version    INTEGER DEFAULT 1,
    created_at INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS preferences (
    id         TEXT PRIMARY KEY,
    project_id TEXT,
    key        TEXT,
    value      TEXT,
    created_at INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS cycles (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL,
    status         TEXT DEFAULT 'running',
    started_at     INTEGER NOT NULL,
    ended_at       INTEGER,
    phase_outcomes TEXT DEFAULT '[]'
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    cycle_id    TEXT,
    event_type  TEXT NOT NULL,
    agent_role  TEXT,
    payload     TEXT NOT NULL DEFAULT '{}',
    token_count INTEGER NOT NULL DEFAULT 0,
    cost_usd    REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  )
`);

try { db.run("CREATE INDEX IF NOT EXISTS idx_events_project_id ON events (project_id)"); } catch { /* already exists */ }
try { db.run("CREATE INDEX IF NOT EXISTS idx_events_cycle_id ON events (cycle_id)"); } catch { /* already exists */ }
try { db.run("CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type)"); } catch { /* already exists */ }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function newId(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Projects ────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  status: string;
  current_phase: string | null;
  created_at: number;
}

export function createProject(name: string, description?: string): Project {
  const id = newId();
  const slug = slugify(name);
  const project = { id, name, slug, description: description ?? null, status: "active", current_phase: null, created_at: now() };
  db.run(
    `INSERT INTO projects (id, name, slug, description, status, current_phase, created_at)
     VALUES (?, ?, ?, ?, 'active', NULL, ?)`,
    [id, name, slug, description ?? null, now()]
  );
  return project;
}

export function getProject(id: string): Project | null {
  return db.query<Project, [string]>("SELECT * FROM projects WHERE id = ?").get(id);
}

export function listProjects(): Project[] {
  return db.query<Project, []>("SELECT * FROM projects ORDER BY created_at DESC").all();
}

export function setProjectPhase(projectId: string, phase: string): void {
  db.run("UPDATE projects SET current_phase = ? WHERE id = ?", [phase, projectId]);
}

export function setProjectStatus(projectId: string, status: string): void {
  db.run("UPDATE projects SET status = ? WHERE id = ?", [status, projectId]);
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  project_id: string;
  role: string;
  status: string;
  current_task: string | null;
  last_action_at: number | null;
}

export const AGENT_ROLES = ["pm", "researcher", "designer", "developer", "tester", "documenter"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export function createAgent(projectId: string, role: AgentRole): Agent {
  const id = newId();
  db.run(
    `INSERT INTO agents (id, project_id, role, status, current_task, last_action_at)
     VALUES (?, ?, ?, 'idle', NULL, NULL)`,
    [id, projectId, role]
  );
  return { id, project_id: projectId, role, status: "idle", current_task: null, last_action_at: null };
}

export function getAgentsForProject(projectId: string): Agent[] {
  return db.query<Agent, [string]>("SELECT * FROM agents WHERE project_id = ?").all(projectId);
}

export function setAgentStatus(projectId: string, role: string, status: string, currentTask?: string): void {
  db.run(
    "UPDATE agents SET status = ?, current_task = ?, last_action_at = ? WHERE project_id = ? AND role = ?",
    [status, currentTask ?? null, now(), projectId, role]
  );
}

// ─── Feed messages ───────────────────────────────────────────────────────────

export interface FeedMessage {
  id: string;
  project_id: string;
  sender_role: string;
  recipient: string;
  content: string;
  message_type: string;
  created_at: number;
}

export function postFeedMessage(
  projectId: string,
  senderRole: string,
  recipient: string,
  content: string,
  messageType: string
): FeedMessage {
  const id = newId();
  const ts = now();
  db.run(
    `INSERT INTO feed_messages (id, project_id, sender_role, recipient, content, message_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, projectId, senderRole, recipient, content, messageType, ts]
  );
  return { id, project_id: projectId, sender_role: senderRole, recipient, content, message_type: messageType, created_at: ts };
}

export function getFeedMessages(projectId: string, limit = 50): FeedMessage[] {
  return db
    .query<FeedMessage, [string, number]>(
      "SELECT * FROM feed_messages WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(projectId, limit);
}

// ─── Inbox messages ──────────────────────────────────────────────────────────

export interface InboxMessage {
  id: string;
  project_id: string;
  sender_role: string;
  subject: string;
  body: string;
  is_read: number;
  replied_at: number | null;
  reply_body: string | null;
  reply_intent_json: string | null;
  blocks_cycle: number;
  created_at: number;
}

export function sendInboxMessage(
  projectId: string,
  senderRole: string,
  subject: string,
  body: string,
  blocksCycle = 0
): InboxMessage {
  const id = newId();
  const ts = now();
  db.run(
    `INSERT INTO inbox_messages (id, project_id, sender_role, subject, body, is_read, replied_at, reply_body, reply_intent_json, blocks_cycle, created_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?)`,
    [id, projectId, senderRole, subject, body, blocksCycle, ts]
  );
  return { id, project_id: projectId, sender_role: senderRole, subject, body, is_read: 0, replied_at: null, reply_body: null, reply_intent_json: null, blocks_cycle: blocksCycle, created_at: ts };
}

export function getInboxMessages(projectId: string): InboxMessage[] {
  return db
    .query<InboxMessage, [string]>(
      "SELECT * FROM inbox_messages WHERE project_id = ? ORDER BY created_at DESC"
    )
    .all(projectId);
}

export function replyToInboxMessage(msgId: string, replyBody: string, intentJson?: string): void {
  db.run(
    "UPDATE inbox_messages SET reply_body = ?, replied_at = ?, is_read = 1, reply_intent_json = ? WHERE id = ?",
    [replyBody, now(), intentJson ?? null, msgId]
  );
}

export function markInboxRead(msgId: string): void {
  db.run("UPDATE inbox_messages SET is_read = 1 WHERE id = ?", [msgId]);
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  project_id: string;
  assigned_to: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  created_at: number;
  completed_at: number | null;
}

export function createTask(
  projectId: string,
  assignedTo: string,
  title: string,
  description?: string,
  priority = 50
): Task {
  const id = newId();
  const ts = now();
  db.run(
    `INSERT INTO tasks (id, project_id, assigned_to, title, description, status, priority, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`,
    [id, projectId, assignedTo, title, description ?? null, priority, ts]
  );
  return { id, project_id: projectId, assigned_to: assignedTo, title, description: description ?? null, status: "pending", priority, created_at: ts, completed_at: null };
}

export function getTasksForProject(projectId: string): Task[] {
  return db.query<Task, [string]>("SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at ASC").all(projectId);
}

// ─── Artifacts ───────────────────────────────────────────────────────────────

export interface Artifact {
  id: string;
  project_id: string;
  phase: string;
  filename: string;
  content: string;
  version: number;
  created_at: number;
  cycle_id: string | null;
  previous_version_id: string | null;
  diff_from_previous: string | null;
}

export async function saveArtifact(
  projectId: string,
  phase: string,
  filename: string,
  content: string,
  cycleId?: string
): Promise<Artifact> {
  // Increment version if artifact already exists
  const existing = db
    .query<{ version: number; id: string; content: string }, [string, string, string]>(
      "SELECT version, id, content FROM artifacts WHERE project_id = ? AND phase = ? AND filename = ? ORDER BY version DESC LIMIT 1"
    )
    .get(projectId, phase, filename);

  const version = existing ? existing.version + 1 : 1;
  const id = newId();
  const ts = now();
  const cycle_id = cycleId ?? null;

  let previous_version_id: string | null = null;
  let diff_from_previous: string | null = null;

  if (version > 1 && existing) {
    previous_version_id = existing.id;

    // Generate unified diff between previous and current content
    const tmpA = `/tmp/ouro-diff-a-${id}`;
    const tmpB = `/tmp/ouro-diff-b-${id}`;
    try {
      await Bun.write(tmpA, existing.content);
      await Bun.write(tmpB, content);

      const diffProc = Bun.spawn(["diff", "-u", tmpA, tmpB], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [diffOut, exitCode] = await Promise.all([
        new Response(diffProc.stdout).text(),
        diffProc.exited,
      ]);

      // diff exits 0 = identical, 1 = differ, ≥2 = error
      if (exitCode <= 1) {
        diff_from_previous = diffOut || null;
      } else {
        console.warn(`[db] diff exited ${exitCode} for ${filename} — skipping diff`);
      }
    } catch (err) {
      console.warn("[db] diff generation failed:", (err as Error).message);
    } finally {
      try { await Bun.file(tmpA).exists() && Bun.spawn(["rm", "-f", tmpA]); } catch { /* ignore */ }
      try { await Bun.file(tmpB).exists() && Bun.spawn(["rm", "-f", tmpB]); } catch { /* ignore */ }
    }
  }

  db.run(
    `INSERT INTO artifacts (id, project_id, phase, filename, content, version, created_at, cycle_id, previous_version_id, diff_from_previous)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, projectId, phase, filename, content, version, ts, cycle_id, previous_version_id, diff_from_previous]
  );
  return { id, project_id: projectId, phase, filename, content, version, created_at: ts, cycle_id, previous_version_id, diff_from_previous };
}

export function listArtifacts(projectId: string): Artifact[] {
  // Latest version of each artifact only
  return db
    .query<Artifact, [string]>(
      `SELECT a.* FROM artifacts a
       INNER JOIN (
         SELECT project_id, filename, MAX(version) as max_version
         FROM artifacts WHERE project_id = ?
         GROUP BY project_id, filename
       ) latest ON a.project_id = latest.project_id AND a.filename = latest.filename AND a.version = latest.max_version
       ORDER BY a.phase, a.filename`
    )
    .all(projectId);
}

export function getArtifactByPhase(projectId: string, phase: string): Artifact | null {
  return db
    .query<Artifact, [string, string]>(
      "SELECT * FROM artifacts WHERE project_id = ? AND phase = ? ORDER BY version DESC LIMIT 1"
    )
    .get(projectId, phase);
}

export function getArtifactByFilename(projectId: string, filename: string): Artifact | null {
  return db
    .query<Artifact, [string, string]>(
      "SELECT * FROM artifacts WHERE project_id = ? AND filename = ? ORDER BY version DESC LIMIT 1"
    )
    .get(projectId, filename);
}

export function getArtifactHistory(projectId: string, phase: string, filename: string): Artifact[] {
  return db
    .query<Artifact, [string, string, string]>(
      "SELECT * FROM artifacts WHERE project_id = ? AND phase = ? AND filename = ? ORDER BY version ASC"
    )
    .all(projectId, phase, filename);
}

// ─── Preferences ─────────────────────────────────────────────────────────────

export function setPreference(projectId: string, key: string, value: string): void {
  const existing = db
    .query<{ id: string }, [string, string]>("SELECT id FROM preferences WHERE project_id = ? AND key = ?")
    .get(projectId, key);
  if (existing) {
    db.run("UPDATE preferences SET value = ? WHERE id = ?", [value, existing.id]);
  } else {
    db.run(
      "INSERT INTO preferences (id, project_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)",
      [newId(), projectId, key, value, now()]
    );
  }
}

export function getPreference(projectId: string, key: string): string | null {
  const row = db
    .query<{ value: string }, [string, string]>("SELECT value FROM preferences WHERE project_id = ? AND key = ?")
    .get(projectId, key);
  return row?.value ?? null;
}

// ─── Cycles ──────────────────────────────────────────────────────────────────

export interface PhaseOutcome {
  phase: string;
  status: "complete" | "error" | "stopped";
  started_at: number;
  ended_at: number;
}

export interface CycleRun {
  id: string;
  project_id: string;
  status: "running" | "complete" | "stopped" | "error";
  started_at: number;
  ended_at: number | null;
  phase_outcomes: PhaseOutcome[];
}

interface CycleRow {
  id: string;
  project_id: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  phase_outcomes: string;
}

function parseCycleRow(row: CycleRow): CycleRun {
  return {
    ...row,
    status: row.status as CycleRun["status"],
    phase_outcomes: JSON.parse(row.phase_outcomes ?? "[]") as PhaseOutcome[],
  };
}

export function createCycleRecord(projectId: string): CycleRun {
  const id = newId();
  const ts = now();
  db.run(
    `INSERT INTO cycles (id, project_id, status, started_at, ended_at, phase_outcomes)
     VALUES (?, ?, 'running', ?, NULL, '[]')`,
    [id, projectId, ts]
  );
  return { id, project_id: projectId, status: "running", started_at: ts, ended_at: null, phase_outcomes: [] };
}

export function updateCycleRecord(
  cycleId: string,
  status: CycleRun["status"],
  phaseOutcomes: PhaseOutcome[],
  endedAt?: number
): void {
  db.run(
    `UPDATE cycles SET status = ?, phase_outcomes = ?, ended_at = ? WHERE id = ?`,
    [status, JSON.stringify(phaseOutcomes), endedAt ?? null, cycleId]
  );
}

export function listCycles(projectId: string): CycleRun[] {
  const rows = db
    .query<CycleRow, [string]>(
      "SELECT * FROM cycles WHERE project_id = ? ORDER BY started_at DESC"
    )
    .all(projectId);
  return rows.map(parseCycleRow);
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type EventType =
  | "phase_started"
  | "phase_completed"
  | "agent_started"
  | "agent_completed"
  | "agent_failed"
  | "error"
  | "human_input_requested"
  | "human_input_received";

export interface InsertEventParams {
  projectId: string;
  cycleId?: string;
  type: EventType;
  agentRole?: string;
  payload: Record<string, unknown>;
  tokenCount?: number;
  costUsd?: number;
}

export interface Event {
  id: string;
  project_id: string;
  cycle_id: string | null;
  type: EventType;
  agent_role: string | null;
  payload: Record<string, unknown>;
  token_count: number;
  cost_usd: number;
  created_at: number;
}

interface DbEvent {
  id: string;
  project_id: string;
  cycle_id: string | null;
  event_type: string;
  agent_role: string | null;
  payload: string;
  token_count: number;
  cost_usd: number;
  created_at: number;
}

function parseEventRow(row: DbEvent): Event {
  return {
    id: row.id,
    project_id: row.project_id,
    cycle_id: row.cycle_id,
    type: row.event_type as EventType,
    agent_role: row.agent_role,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    token_count: row.token_count,
    cost_usd: row.cost_usd,
    created_at: row.created_at,
  };
}

export function insertEvent(params: InsertEventParams): Event {
  const id = newId();
  const ts = now();
  const tokenCount = params.tokenCount ?? 0;
  const costUsd = params.costUsd ?? 0;
  db.run(
    `INSERT INTO events (id, project_id, cycle_id, event_type, agent_role, payload, token_count, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, params.projectId, params.cycleId ?? null, params.type, params.agentRole ?? null, JSON.stringify(params.payload), tokenCount, costUsd, ts]
  );
  return {
    id,
    project_id: params.projectId,
    cycle_id: params.cycleId ?? null,
    type: params.type,
    agent_role: params.agentRole ?? null,
    payload: params.payload,
    token_count: tokenCount,
    cost_usd: costUsd,
    created_at: ts,
  };
}

export function getEvents(projectId: string, cycleId?: string): Event[] {
  const rows = cycleId
    ? db.query<DbEvent, [string, string]>(
        "SELECT * FROM events WHERE project_id = ? AND cycle_id = ? ORDER BY created_at ASC"
      ).all(projectId, cycleId)
    : db.query<DbEvent, [string]>(
        "SELECT * FROM events WHERE project_id = ? ORDER BY created_at ASC"
      ).all(projectId);
  return rows.map(parseEventRow);
}

// ─── CLI entrypoint (bun run src/db.ts --reset) ──────────────────────────────

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.includes("--reset")) {
    console.log("Dropping and recreating database...");
    const tables = ["projects", "agents", "feed_messages", "inbox_messages", "tasks", "artifacts", "preferences", "cycles", "events"];
    for (const table of tables) {
      db.run(`DROP TABLE IF EXISTS ${table}`);
    }
    console.log("Tables dropped. Re-run to recreate.");
    process.exit(0);
  }
}
