/**
 * intent.ts — Structured intent extraction from client replies
 *
 * Parses a client reply into one of five structured intent types so the
 * platform can act on preferences, approvals, rejections, and questions
 * automatically rather than treating every reply as raw freeform text.
 */

import { runClaude } from "./claude.js";

export type Intent =
  | { type: "preference"; key: string; value: string }
  | { type: "approval"; scope: string }
  | { type: "rejection"; scope: string; reason: string }
  | { type: "question"; text: string }
  | { type: "freeform"; text: string };

/**
 * Extract structured intent from a client reply.
 *
 * Calls Claude with a short prompt and parses the JSON response into one of
 * the five Intent types. Falls back to `{ type: "freeform", text: replyText }`
 * on any parse failure or if Claude is unavailable.
 *
 * @param replyText - The raw text the client sent
 * @param context   - Context string (e.g. "subject: body" of the parent message)
 */
export async function extractIntent(replyText: string, context: string): Promise<Intent> {
  const result = await runClaude({
    systemPrompt:
      'You extract structured intent from client replies to an AI software agency. ' +
      'Reply with a single JSON object matching one of these types: ' +
      '{"preference": {"key": string, "value": string}}, ' +
      '{"approval": {"scope": string}}, ' +
      '{"rejection": {"scope": string, "reason": string}}, ' +
      '{"question": {"text": string}}, ' +
      '{"freeform": {"text": string}}. ' +
      'Be concise. Output only valid JSON with no markdown fences.',
    userPrompt: `Context: ${context}\nReply: ${replyText}`,
    maxTokens: 256,
  });

  return parseIntentResponse(result.content, replyText);
}

/**
 * Parse Claude's JSON response into an Intent, handling both the nested
 * format Claude is prompted to use  (`{"preference": {...}}`) and the flat
 * discriminated-union format (`{"type": "preference", "key": ..., "value": ...}`).
 */
function parseIntentResponse(raw: string, fallbackText: string): Intent {
  // Strip markdown code fences if Claude included them despite instructions
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { type: "freeform", text: fallbackText };
  }

  if (!parsed || typeof parsed !== "object") {
    return { type: "freeform", text: fallbackText };
  }

  const obj = parsed as Record<string, unknown>;

  // ── Flat discriminated-union format ─────────────────────────────────────────
  if (typeof obj.type === "string") {
    if (obj.type === "preference" && typeof obj.key === "string" && typeof obj.value === "string") {
      return { type: "preference", key: obj.key, value: obj.value };
    }
    if (obj.type === "approval" && typeof obj.scope === "string") {
      return { type: "approval", scope: obj.scope };
    }
    if (obj.type === "rejection" && typeof obj.scope === "string") {
      return { type: "rejection", scope: obj.scope, reason: typeof obj.reason === "string" ? obj.reason : "" };
    }
    if (obj.type === "question" && typeof obj.text === "string") {
      return { type: "question", text: obj.text };
    }
    if (obj.type === "freeform") {
      return { type: "freeform", text: typeof obj.text === "string" ? obj.text : fallbackText };
    }
  }

  // ── Nested object format (as prompted) ──────────────────────────────────────
  if (obj.preference && typeof obj.preference === "object") {
    const p = obj.preference as Record<string, unknown>;
    if (typeof p.key === "string" && typeof p.value === "string") {
      return { type: "preference", key: p.key, value: p.value };
    }
  }

  if (obj.approval && typeof obj.approval === "object") {
    const a = obj.approval as Record<string, unknown>;
    if (typeof a.scope === "string") {
      return { type: "approval", scope: a.scope };
    }
  }

  if (obj.rejection && typeof obj.rejection === "object") {
    const r = obj.rejection as Record<string, unknown>;
    if (typeof r.scope === "string") {
      return { type: "rejection", scope: r.scope, reason: typeof r.reason === "string" ? r.reason : "" };
    }
  }

  if (obj.question && typeof obj.question === "object") {
    const q = obj.question as Record<string, unknown>;
    if (typeof q.text === "string") {
      return { type: "question", text: q.text };
    }
  }

  if (obj.freeform && typeof obj.freeform === "object") {
    const f = obj.freeform as Record<string, unknown>;
    return { type: "freeform", text: typeof f.text === "string" ? f.text : fallbackText };
  }

  return { type: "freeform", text: fallbackText };
}
