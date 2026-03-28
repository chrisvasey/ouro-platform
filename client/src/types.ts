export interface Project {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  status: string;
  current_phase: string | null;
  created_at: number;
}

export interface Agent {
  id: string;
  project_id: string;
  role: string;
  status: "idle" | "thinking" | "blocked";
  current_task: string | null;
  last_action_at: number | null;
}

export interface FeedMessage {
  id: string;
  project_id: string;
  sender_role: string;
  recipient: string;
  content: string;
  message_type: "handoff" | "question" | "decision" | "note" | "escalate";
  created_at: number;
}

export interface InboxMessage {
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

export interface Artifact {
  id: string;
  project_id: string;
  phase: string;
  filename: string;
  content: string;
  version: number;
  created_at: number;
}

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

export type WsEvent =
  | { event: "connected"; data: { clientCount: number } }
  | { event: "subscribed"; data: { projectId: string } }
  | { event: "feed_message"; projectId: string; data: FeedMessage }
  | { event: "inbox_message"; projectId: string; data: InboxMessage }
  | { event: "agent_status"; projectId: string; data: { role: string; status: string; current_task?: string | null } }
  | { event: "phase_change"; projectId: string; data: { phase: string } }
  | { event: "cycle_update"; projectId: string; data: { cycleId: string; status: string } };
