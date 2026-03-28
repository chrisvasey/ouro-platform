/**
 * seed.ts — Seed data for Ouro Platform
 *
 * Creates:
 * - "Ouro Platform" project (the self-improvement project)
 * - All 6 agents for that project (idle status)
 * - A second demo project for testing project switcher
 * - Welcome inbox message from PM
 *
 * Run with: bun run seed
 *        or: POST /api/seed
 */

import {
  db,
  createProject,
  createAgent,
  sendInboxMessage,
  postFeedMessage,
  listProjects,
  AGENT_ROLES,
} from "./db.js";

export async function seed(): Promise<void> {
  // Idempotent — check if already seeded
  const existing = listProjects();
  const ouroExists = existing.some((p) => p.slug === "ouro-platform");

  let ouroProjectId: string;

  if (!ouroExists) {
    console.log("[seed] Creating Ouro Platform project...");
    const ouro = createProject(
      "Ouro Platform",
      "A self-improving AI software agency. The system runs a loop where specialised agents collaborate to build software — including Ouro itself."
    );
    ouroProjectId = ouro.id;

    // Create all 6 agents
    for (const role of AGENT_ROLES) {
      createAgent(ouroProjectId, role);
      console.log(`[seed] Created agent: ${role}`);
    }

    // Welcome inbox message from PM
    sendInboxMessage(
      ouroProjectId,
      "pm",
      "Welcome to Ouro",
      `Welcome to Ouro. I'm your Product Manager. When you reply to my messages, I'll understand your intent automatically — preferences you state will be remembered across all future cycles. Ready to start — hit Start Cycle and I'll kick things off.`
    );

    // Initial feed message
    postFeedMessage(
      ouroProjectId,
      "pm",
      "all",
      "Team assembled. Ouro Platform is ready for its first cycle. Waiting for client to start.",
      "note"
    );

    console.log(`[seed] Ouro Platform created (id: ${ouroProjectId})`);
  } else {
    ouroProjectId = existing.find((p) => p.slug === "ouro-platform")!.id;
    console.log(`[seed] Ouro Platform already exists (id: ${ouroProjectId}), skipping.`);
  }

  // Create a second demo project so the project switcher can be tested
  const demoExists = existing.some((p) => p.slug === "demo-project");
  if (!demoExists) {
    console.log("[seed] Creating Demo Project...");
    const demo = createProject(
      "Demo Project",
      "A placeholder project for testing the project switcher. Not a real project."
    );

    for (const role of AGENT_ROLES) {
      createAgent(demo.id, role);
    }

    sendInboxMessage(
      demo.id,
      "pm",
      "Demo Project ready",
      "This is a demo project. You can switch to it using the project selector in the top bar."
    );

    postFeedMessage(
      demo.id,
      "pm",
      "all",
      "Demo project initialised. No cycles have run yet.",
      "note"
    );

    console.log(`[seed] Demo Project created (id: ${demo.id})`);
  } else {
    console.log("[seed] Demo Project already exists, skipping.");
  }

  console.log("[seed] Done.");
}

// CLI entrypoint
if (import.meta.main) {
  await seed();
  process.exit(0);
}
