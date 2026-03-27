import { useEffect, useState } from "react";
import type { Agent } from "../types";
import { api } from "../api";
import { relativeTime } from "../utils";

interface AgentPanelProps {
  projectId: string;
  agentUpdates: Agent[];
}

const AGENT_EMOJI: Record<string, string> = {
  pm: "🧭",
  researcher: "🔬",
  designer: "🎨",
  developer: "👨‍💻",
  tester: "🧪",
  documenter: "📝",
};

const AGENT_LABEL: Record<string, string> = {
  pm: "Product Manager",
  researcher: "Researcher",
  designer: "Designer",
  developer: "Developer",
  tester: "Tester",
  documenter: "Documenter",
};

const ROLE_ORDER = ["pm", "researcher", "designer", "developer", "tester", "documenter"];

function StatusBadge({ status }: { status: Agent["status"] }) {
  if (status === "thinking") {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-blue-400">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        Thinking
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-amber-400">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
        Blocked
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-gray-500">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-600" />
      Idle
    </span>
  );
}

export function AgentPanel({ projectId, agentUpdates }: AgentPanelProps) {
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    api.agents.list(projectId).then(setAgents).catch(console.error);
  }, [projectId]);

  // Merge WS updates into local state
  useEffect(() => {
    if (agentUpdates.length === 0) return;
    setAgents((prev) => {
      const map = new Map(prev.map((a) => [a.role, a]));
      for (const update of agentUpdates) {
        const existing = map.get(update.role);
        if (existing) {
          map.set(update.role, { ...existing, ...update });
        }
      }
      return Array.from(map.values());
    });
  }, [agentUpdates]);

  const sorted = [...agents].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
  );

  return (
    <aside className="w-60 flex-shrink-0 border-r border-gray-800 flex flex-col overflow-y-auto">
      <div className="px-3 py-2.5 border-b border-gray-800">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Agents</h2>
      </div>
      <div className="flex flex-col gap-2 p-2">
        {sorted.length === 0 && (
          <p className="text-xs text-gray-600 p-2">No agents for this project.</p>
        )}
        {sorted.map((agent) => (
          <div
            key={agent.id}
            className={`rounded-lg p-3 border transition-colors ${
              agent.status === "thinking"
                ? "border-blue-800 bg-blue-950/30"
                : agent.status === "blocked"
                ? "border-amber-800 bg-amber-950/20"
                : "border-gray-800 bg-gray-900"
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-base leading-none">
                  {AGENT_EMOJI[agent.role] ?? "🤖"}
                </span>
                <span className="text-xs font-medium text-gray-300">
                  {AGENT_LABEL[agent.role] ?? agent.role}
                </span>
              </div>
              <StatusBadge status={agent.status as Agent["status"]} />
            </div>

            {agent.current_task && agent.status === "thinking" && (
              <p className="text-xs text-gray-500 leading-snug mt-1 truncate" title={agent.current_task}>
                {agent.current_task.slice(0, 60)}…
              </p>
            )}

            {agent.last_action_at && (
              <p className="text-xs text-gray-600 mt-1">
                {relativeTime(agent.last_action_at)}
              </p>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
