import React, { useEffect, useRef, useState } from "react";
import type { CycleRun, Project, SpendData } from "../types";
import { api } from "../api";

interface TopBarProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  onProjectsChange: (projects: Project[]) => void;
  cycleRunning: boolean;
  cycleHistory: CycleRun[];
  onStartCycle: () => void;
  onStopCycle: () => void;
}

const PHASE_ORDER = ["research", "spec", "design", "build", "test", "review"];

const PHASE_LABELS: Record<string, string> = {
  research: "Research",
  spec: "Spec",
  design: "Design",
  build: "Build",
  test: "Test",
  review: "Review",
  complete: "Complete",
};

function spendColour(pct: number): string {
  if (pct >= 100) return "text-red-400 font-bold";
  if (pct >= 80) return "text-orange-400 font-medium";
  if (pct >= 50) return "text-amber-400";
  return "text-gray-500";
}

function SpendIndicator({ projectId }: { projectId: string }) {
  const [spend, setSpend] = useState<SpendData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function fetchSpend() {
    api.spend.get(projectId).then(setSpend).catch(() => {});
  }

  useEffect(() => {
    fetchSpend();
    intervalRef.current = setInterval(fetchSpend, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [projectId]);

  if (!spend) return null;

  const pct = spend.budgetLimit > 0 ? (spend.spendToday / spend.budgetLimit) * 100 : 0;
  const cls = spendColour(pct);

  return (
    <span className={`text-xs tabular-nums ${cls}`} title="Daily spend vs budget">
      ${spend.spendToday.toFixed(2)} / ${spend.budgetLimit.toFixed(2)} today
    </span>
  );
}

interface PhaseStepBarProps {
  currentPhase: string | null;
  cycleHistory: CycleRun[];
}

function PhaseStepBar({ currentPhase, cycleHistory }: PhaseStepBarProps) {
  // Determine phase statuses from the latest cycle (if any)
  const latestCycle = cycleHistory[0] ?? null;
  const outcomeMap = new Map(
    (latestCycle?.phase_outcomes ?? []).map((o) => [o.phase, o.status])
  );

  const currentIdx = currentPhase ? PHASE_ORDER.indexOf(currentPhase) : -1;

  return (
    <div className="flex items-center gap-0.5">
      {PHASE_ORDER.map((phase, idx) => {
        const outcome = outcomeMap.get(phase);
        const isActive = phase === currentPhase;
        const isCompleted = outcome === "complete" || (!isActive && currentIdx > idx && currentIdx !== -1);
        const isFailed = outcome === "error";

        let icon: React.ReactNode = null;
        let labelClass = "text-gray-600";

        if (isActive) {
          labelClass = "text-white font-bold";
        } else if (isFailed) {
          icon = <span className="text-red-400 mr-0.5">✗</span>;
          labelClass = "text-red-400";
        } else if (isCompleted) {
          icon = <span className="text-green-400 mr-0.5">✓</span>;
          labelClass = "text-green-400";
        }

        return (
          <React.Fragment key={phase}>
            {idx > 0 && (
              <span className="text-gray-700 text-[10px] mx-0.5">›</span>
            )}
            <span className={`text-[11px] flex items-center ${labelClass}`}>
              {icon}
              {PHASE_LABELS[phase]}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function TopBar({
  projects,
  selectedProject,
  onSelectProject,
  onProjectsChange,
  cycleRunning,
  cycleHistory,
  onStartCycle,
  onStopCycle,
}: TopBarProps) {
  const [showNewProject, setShowNewProject] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const project = await api.projects.create(newName.trim(), newDesc.trim() || undefined);
      const updated = await api.projects.list();
      onProjectsChange(updated);
      onSelectProject(project);
      setNewName("");
      setNewDesc("");
      setShowNewProject(false);
    } catch (err) {
      console.error("Failed to create project:", err);
    } finally {
      setCreating(false);
    }
  }

  const phase = selectedProject?.current_phase;

  return (
    <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-4 flex-shrink-0">
      {/* Logo */}
      <span className="text-gray-100 font-semibold tracking-tight text-sm">
        🔄 Ouro
      </span>

      <div className="w-px h-5 bg-gray-700" />

      {/* Project switcher */}
      <div className="flex items-center gap-2">
        <select
          className="bg-gray-800 text-gray-200 text-sm border border-gray-700 rounded px-2 py-1 cursor-pointer focus:outline-none focus:border-gray-500"
          value={selectedProject?.id ?? ""}
          onChange={(e) => {
            const p = projects.find((p) => p.id === e.target.value);
            if (p) onSelectProject(p);
          }}
        >
          {projects.length === 0 && (
            <option value="" disabled>No projects</option>
          )}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <button
          onClick={() => setShowNewProject((v) => !v)}
          className="text-gray-500 hover:text-gray-300 text-sm px-1.5 py-0.5 rounded hover:bg-gray-800 transition-colors"
          title="New project"
        >
          +
        </button>
      </div>

      {/* Phase step bar — shown when a cycle is active */}
      {(phase || cycleHistory.length > 0) && selectedProject && (
        <div className="flex items-center">
          <PhaseStepBar
            currentPhase={phase ?? null}
            cycleHistory={cycleHistory}
          />
        </div>
      )}

      <div className="flex-1" />

      {/* Spend indicator */}
      {selectedProject && (
        <SpendIndicator projectId={selectedProject.id} />
      )}

      {/* Cycle control buttons */}
      {selectedProject && !cycleRunning && (
        <button
          onClick={onStartCycle}
          className="text-sm px-3 py-1.5 rounded font-medium transition-all bg-blue-600 hover:bg-blue-500 text-white"
        >
          Start Cycle
        </button>
      )}
      {selectedProject && cycleRunning && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Running…
          </span>
          <button
            onClick={onStopCycle}
            className="text-sm px-3 py-1.5 rounded font-medium transition-all bg-gray-800 hover:bg-red-900 text-gray-400 hover:text-red-300 border border-gray-700 hover:border-red-800"
            title="Stop after current phase completes"
          >
            Stop
          </button>
        </div>
      )}

      {/* New project form (inline dropdown) */}
      {showNewProject && (
        <div className="absolute top-12 left-32 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-4 w-72">
          <h3 className="text-sm font-medium text-gray-200 mb-3">New Project</h3>
          <form onSubmit={handleCreateProject} className="flex flex-col gap-2">
            <input
              autoFocus
              type="text"
              placeholder="Project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-gray-500"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-gray-500"
            />
            <div className="flex gap-2 justify-end mt-1">
              <button
                type="button"
                onClick={() => setShowNewProject(false)}
                className="text-sm text-gray-500 hover:text-gray-300 px-2 py-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1 rounded"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </header>
  );
}
