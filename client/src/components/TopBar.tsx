import React, { useState } from "react";
import type { Project } from "../types";
import { api } from "../api";

interface TopBarProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  onProjectsChange: (projects: Project[]) => void;
  cycleRunning: boolean;
  onStartCycle: () => void;
  onStopCycle: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  research: "Research",
  spec: "Spec",
  design: "Design",
  build: "Build",
  test: "Test",
  review: "Review",
  complete: "Complete",
};

const PHASE_COLOURS: Record<string, string> = {
  research: "bg-purple-900 text-purple-300",
  spec: "bg-blue-900 text-blue-300",
  design: "bg-pink-900 text-pink-300",
  build: "bg-cyan-900 text-cyan-300",
  test: "bg-yellow-900 text-yellow-300",
  review: "bg-green-900 text-green-300",
  complete: "bg-gray-800 text-gray-400",
};

export function TopBar({
  projects,
  selectedProject,
  onSelectProject,
  onProjectsChange,
  cycleRunning,
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
      // Seed agents for new project via server seed — or just add to list
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
  const phaseLabel = phase ? (PHASE_LABELS[phase] ?? phase) : null;
  const phaseClass = phase ? (PHASE_COLOURS[phase] ?? "bg-gray-800 text-gray-400") : null;

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

      {/* Phase badge */}
      {phaseLabel && phaseClass && (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${phaseClass}`}>
          {phaseLabel}
        </span>
      )}

      <div className="flex-1" />

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
