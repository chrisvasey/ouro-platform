import { useEffect, useState } from "react";
import type { Artifact } from "../types";
import { api } from "../api";

const PHASE_EMOJI: Record<string, string> = {
  research: "🔬",
  spec: "📋",
  design: "🎨",
  build: "🏗️",
  test: "🧪",
  review: "📝",
};

const PHASE_LABEL: Record<string, string> = {
  research: "Research",
  spec: "Spec",
  design: "Design",
  build: "Build",
  test: "Test Report",
  review: "Review",
};

interface ArtifactDrawerProps {
  projectId: string;
  phase: string;
  onClose: () => void;
}

export function ArtifactDrawer({ projectId, phase, onClose }: ArtifactDrawerProps) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setArtifact(null);
    api.artifacts
      .getByPhase(projectId, phase)
      .then(setArtifact)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId, phase]);

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside className="fixed right-0 top-0 bottom-0 w-[520px] max-w-[90vw] bg-gray-900 border-l border-gray-700 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0 bg-gray-900">
          <div className="flex items-center gap-2.5">
            <span className="text-xl leading-none">{PHASE_EMOJI[phase] ?? "📄"}</span>
            <div>
              <h2 className="text-sm font-semibold text-gray-100">
                {PHASE_LABEL[phase] ?? phase} Artifact
              </h2>
              {artifact && (
                <p className="text-xs text-gray-500">
                  {artifact.filename} · version {artifact.version}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors p-1.5 rounded hover:bg-gray-800 text-sm font-medium"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center gap-2 text-gray-500 text-sm mt-4">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              Loading artifact…
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-950/40 border border-red-900 text-red-400 text-sm">
              <p className="font-medium mb-1">Artifact not available</p>
              <p className="text-red-500/80">{error}</p>
            </div>
          )}

          {artifact && (
            <pre className="text-sm text-gray-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
              {artifact.content}
            </pre>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2.5 border-t border-gray-800 flex-shrink-0 bg-gray-900/80">
          <p className="text-xs text-gray-600">Press Esc or click outside to close</p>
        </div>
      </aside>
    </>
  );
}
