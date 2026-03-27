import type { Agent, Artifact, FeedMessage, InboxMessage, Project } from "./types";

// In production (base: '/ouro/'), BASE_URL is '/ouro/' → BASE becomes '/ouro/api'.
// In dev (base: '/'),            BASE_URL is '/'       → BASE becomes '/api'.
const BASE = `${import.meta.env.BASE_URL}api`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  projects: {
    list: () => get<Project[]>("/projects"),
    get: (id: string) => get<Project>(`/projects/${id}`),
    create: (name: string, description?: string) =>
      post<Project>("/projects", { name, description }),
  },
  feed: {
    list: (projectId: string, limit = 50) =>
      get<FeedMessage[]>(`/projects/${projectId}/feed?limit=${limit}`),
  },
  inbox: {
    list: (projectId: string) =>
      get<InboxMessage[]>(`/projects/${projectId}/inbox`),
    reply: (projectId: string, msgId: string, body: string) =>
      post<InboxMessage>(`/projects/${projectId}/inbox/${msgId}/reply`, { body }),
  },
  agents: {
    list: (projectId: string) =>
      get<Agent[]>(`/projects/${projectId}/agents`),
  },
  artifacts: {
    list: (projectId: string) =>
      get<Artifact[]>(`/projects/${projectId}/artifacts`),
    getByPhase: (projectId: string, phase: string) =>
      get<Artifact>(`/projects/${projectId}/artifacts/${phase}`),
  },
  cycle: {
    start: (projectId: string) =>
      post<{ ok: boolean; message: string }>(`/projects/${projectId}/cycle/start`),
  },
  seed: () => post<{ ok: boolean; message: string }>("/seed"),
};
