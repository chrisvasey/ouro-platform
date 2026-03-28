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
  postFeedMessage,
  setPreference,
  listCycles,
  insertEvent,
  type FeedMessage,
  type InboxMessage,
} from "./db.js";

import { runCycle, isCycleRunning, stopCycle, setBroadcastFn } from "./loop.js";
import { extractIntent, type Intent } from "./intent.js";

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
    async ({ params, body }) => {
      // Fetch the message before replying so we have context for intent extraction
      const messages = getInboxMessages(params.id);
      const inboxMessage = messages.find((m) => m.id === params.msgId);

      // ── IntentGate: extract structured intent from the reply ────────────────
      let intent: Intent = { type: "freeform", text: body.body };
      const hasToken = !!(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY);

      if (hasToken && inboxMessage) {
        try {
          intent = await extractIntent(
            body.body,
            `${inboxMessage.subject}: ${inboxMessage.body}`
          );
        } catch {
          // Claude unavailable or parse failure — fall back to freeform, skip feed post
        }
      }

      // ── Intent side-effects ─────────────────────────────────────────────────
      if (intent.type === "preference") {
        setPreference(params.id, intent.key, intent.value);
      } else if (intent.type === "approval") {
        const feedMsg = postFeedMessage(
          params.id,
          "pm",
          "all",
          `[PM → All] Client approved: ${intent.scope}. Continuing.`,
          "decision"
        );
        broadcastToProject(params.id, "feed_message", feedMsg);
      } else if (intent.type === "rejection") {
        const feedMsg = postFeedMessage(
          params.id,
          "pm",
          "all",
          `[PM → All] Client rejected ${intent.scope}: ${intent.reason}. Will address in next cycle.`,
          "note"
        );
        broadcastToProject(params.id, "feed_message", feedMsg);
      }

      // ── Persist reply + intent JSON ─────────────────────────────────────────
      replyToInboxMessage(params.msgId, body.body, JSON.stringify(intent));
      markInboxRead(params.msgId);
      insertEvent({ projectId: params.id, type: "human_input_received", payload: { inbox_message_id: params.msgId, intent_type: intent.type } });

      const updatedMessages = getInboxMessages(params.id);
      const msg = updatedMessages.find((m) => m.id === params.msgId);
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
  .post("/api/projects/:id/cycle/start", ({ params, set, error }) => {
    const project = getProject(params.id);
    if (!project) return error(404, { message: "Project not found" });

    // Kick off cycle asynchronously. The mutex inside runCycle serialises
    // concurrent requests — if one is already running it will throw and we log it.
    runCycle(params.id).catch((err: Error) => {
      if (err.message.includes("already running")) {
        // Expected — concurrent request, silently ignore
      } else {
        console.error(`[cycle] Unhandled cycle error for ${params.id}:`, err);
      }
    });

    // Respond immediately — cycle runs in background
    // If a cycle is already running the mutex will queue/reject it gracefully
    return { ok: true, message: isCycleRunning(params.id) ? "Cycle queued (another already running)" : "Cycle started" };
  })

  .post("/api/projects/:id/cycle/stop", ({ params, error }) => {
    const project = getProject(params.id);
    if (!project) return error(404, { message: "Project not found" });
    if (!isCycleRunning(params.id)) {
      return error(409, { message: "No cycle is running for this project" });
    }
    const accepted = stopCycle(params.id);
    if (!accepted) {
      return error(409, { message: "No cycle is running for this project" });
    }
    return { ok: true, message: "Stop signal sent — cycle will halt after the current phase" };
  })

  .get("/api/projects/:id/cycles", ({ params, error }) => {
    const project = getProject(params.id);
    if (!project) return error(404, { message: "Project not found" });
    return listCycles(params.id);
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
