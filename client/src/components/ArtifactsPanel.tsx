import { useState } from "react";
import type { Artifact } from "../types";
import { relativeTime } from "../utils";

const PHASE_NAMES: Record<string, string> = {
  research: "Research Report",
  spec: "PM Spec",
  design: "Design Spec",
  build: "Build Plan",
  test: "Test Report",
  review: "Review",
};

const PHASE_ROLES: Record<string, string> = {
  research: "researcher",
  spec: "pm",
  design: "designer",
  build: "developer",
  test: "tester",
  review: "documenter",
};

const ROLE_COLOUR: Record<string, string> = {
  pm: "bg-blue-900 text-blue-300",
  researcher: "bg-purple-900 text-purple-300",
  designer: "bg-pink-900 text-pink-300",
  developer: "bg-cyan-900 text-cyan-300",
  tester: "bg-yellow-900 text-yellow-300",
  documenter: "bg-green-900 text-green-300",
};

interface ArtifactsPanelProps {
  projectId: string;
  artifacts: Artifact[];
  initialIds: Set<string>;
  onPhaseClick: (phase: string) => void;
  loading?: boolean;
}

interface ArtifactRowProps {
  artifact: Artifact;
  isNew: boolean;
  onClick: () => void;
}

function ArtifactRow({ artifact, isNew, onClick }: ArtifactRowProps) {
  const role = PHASE_ROLES[artifact.phase] ?? "pm";
  const roleClass = ROLE_COLOUR[role] ?? "bg-gray-800 text-gray-400";
  const name = PHASE_NAMES[artifact.phase] ?? artifact.filename;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-800/40 transition-colors duration-[2000ms] border-l-2 ${
        isNew ? "border-amber-500 bg-gray-900" : "border-transparent"
      }`}
      onClick={onClick}
    >
      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${roleClass}`}>
        {role}
      </span>
      <span className="text-xs text-gray-300 flex-1 truncate">{name}</span>
      <span className="text-[10px] text-gray-600 flex-shrink-0">{relativeTime(artifact.created_at)}</span>
    </div>
  );
}

function ArtifactEmptyState() {
  return (
    <div className="flex items-center justify-center h-16">
      <span className="text-gray-600 text-xs">No artifacts yet</span>
    </div>
  );
}

export function ArtifactsPanel({ artifacts, initialIds, onPhaseClick, loading }: ArtifactsPanelProps) {
  // Deduplicate by phase — show latest per phase
  const byPhase = new Map<string, Artifact>();
  for (const a of artifacts) {
    const existing = byPhase.get(a.phase);
    if (!existing || a.version > existing.version) {
      byPhase.set(a.phase, a);
    }
  }
  const deduplicated = [...byPhase.values()].sort((a, b) => b.created_at - a.created_at);

  return (
    <div className="flex flex-col bg-gray-950 border-t border-gray-800 flex-1 min-h-0">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2 flex-shrink-0">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Artifacts</h2>
        {deduplicated.length > 0 && (
          <span className="text-xs bg-gray-800 text-gray-400 font-medium px-1.5 py-0.5 rounded-full leading-none">
            {deduplicated.length}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <>
            <div className="h-8 rounded bg-gray-800 animate-pulse mx-3 my-1" />
            <div className="h-8 rounded bg-gray-800 animate-pulse mx-3 my-1" />
            <div className="h-8 rounded bg-gray-800 animate-pulse mx-3 my-1" />
          </>
        ) : deduplicated.length === 0 ? (
          <ArtifactEmptyState />
        ) : (
          deduplicated.map((artifact) => (
            <ArtifactRow
              key={artifact.id}
              artifact={artifact}
              isNew={!initialIds.has(artifact.id)}
              onClick={() => onPhaseClick(artifact.phase)}
            />
          ))
        )}
      </div>
    </div>
  );
}
