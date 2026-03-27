/**
 * index.ts — Elysia HTTP server + WebSocket
 *
 * Provides all REST API routes and a WebSocket endpoint for real-time
 * feed updates.
 */

import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";

import {
  listProjects,
  createProject,
  getProject,
  getFeedMessages,
  getInboxMessages,
  replyToInboxMessage,
  markInboxRead,
  getAgentsForProject,
  listArtifacts,
  getArtifactByPhase,
  type FeedMessage,
  type InboxMessage,
} from "./db.js";

import { runCycle, isCycleRunning, setBroadcastFn } from "./loop.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ─── WebSocket client registry ────────────────────────────────────────────────

type WsClient = { send: (data: string) => void; projectId?: string };
const wsClients = new Set<WsClient>();

function broadcastToProject(projectId: string, event: string, data: unknown): void {
  const payload = JSON.stringify({ event, projectId, data });
  for (const client of wsClients) {
    // Send to clients subscribed to this project, or to all if no filter
    if (!client.projectId || client.projectId === projectId) {
      try {
        client.send(payload);
      } catch {
        wsClients.delete(client);
      }
    }
  }
}

// Wire the broadcast function into the loop
setBroadcastFn(broadcastToProject);

// ─── App ─────────────────────────────────────────────────────────────────────

const app = new Elysia()
  .use(cors({ origin: true }))

  // ── Health ──
  .get("/health", () => ({ ok: true, ts: Date.now() }))

  // ── Projects ──
  .get("/api/projects", () => listProjects())

  .post(
    "/api/projects",
    ({ body }) => {
      const project = createProject(body.name, body.description);
      return project;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
      }),
    }
  )

  .get("/api/projects/:id", ({ params, error }) => {
    const project = getProject(params.id);
    if (!project) return error(404, { message: "Project not found" });
    return project;
  })

  // ── Feed ──
  .get("/api/projects/:id/feed", ({ params, query }) => {
    const limit = parseInt(query.limit ?? "50", 10);
    const messages = getFeedMessages(params.id, limit);
    // Return newest-first (already sorted by db)
    return messages;
  })

  // ── Inbox ──
  .get("/api/projects/:id/inbox", ({ params }) => {
    return getInboxMessages(params.id);
  })

  .post(
    "/api/projects/:id/inbox/:msgId/reply",
    ({ params, body }) => {
      replyToInboxMessage(params.msgId, body.body);
      markInboxRead(params.msgId);
      const messages = getInboxMessages(params.id);
      const msg = messages.find((m) => m.id === params.msgId);
      return msg ?? { ok: true };
    },
    {
      body: t.Object({
        body: t.String({ minLength: 1 }),
      }),
    }
  )

  // ── Agents ──
  .get("/api/projects/:id/agents", ({ params }) => {
    return getAgentsForProject(params.id);
  })

  // ── Artifacts ──
  .get("/api/projects/:id/artifacts", ({ params }) => {
    return listArtifacts(params.id);
  })

  .get("/api/projects/:id/artifacts/:phase", ({ params, error }) => {
    const artifact = getArtifactByPhase(params.id, params.phase);
    if (!artifact) return error(404, { message: "Artifact not found" });
    return artifact;
  })

  // ── Cycle ──
  .post("/api/projects/:id/cycle/start", ({ params, error }) => {
    const project = getProject(params.id);
    if (!project) return error(404, { message: "Project not found" });
    if (isCycleRunning(params.id)) {
      return error(409, { message: "Cycle already running for this project" });
    }

    // Kick off cycle asynchronously — don't await so the HTTP response returns immediately
    runCycle(params.id).catch((err) => {
      console.error(`[cycle] Unhandled cycle error for ${params.id}:`, err);
    });

    return { ok: true, message: "Cycle started" };
  })

  // ── Seed endpoint (convenience) ──
  .post("/api/seed", async () => {
    const { seed } = await import("./seed.js");
    await seed();
    return { ok: true, message: "Seed complete" };
  })

  // ── WebSocket ──
  .ws("/ws", {
    open(ws) {
      const client: WsClient = {
        send: (data: string) => ws.send(data),
      };
      wsClients.add(client);

      // Send a connected ack
      ws.send(JSON.stringify({ event: "connected", data: { clientCount: wsClients.size } }));

      // Store client ref on the ws object for cleanup
      (ws as unknown as { _client: WsClient })._client = client;
    },

    message(ws, message) {
      // Allow clients to subscribe to a specific project
      try {
        const msg = typeof message === "string" ? JSON.parse(message) : message;
        if (msg.type === "subscribe" && msg.projectId) {
          const client = (ws as unknown as { _client: WsClient })._client;
          if (client) client.projectId = msg.projectId;
          ws.send(JSON.stringify({ event: "subscribed", data: { projectId: msg.projectId } }));
        }
      } catch {
        // Ignore parse errors
      }
    },

    close(ws) {
      const client = (ws as unknown as { _client: WsClient })._client;
      if (client) wsClients.delete(client);
    },
  })

  .listen(PORT);

console.log(`[ouro] Server running on http://localhost:${PORT}`);
console.log(`[ouro] WebSocket available at ws://localhost:${PORT}/ws`);

export type App = typeof app;
