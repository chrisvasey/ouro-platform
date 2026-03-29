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

// ─── Simple line diff ─────────────────────────────────────────────────────────

interface DiffLine {
  type: "added" | "removed" | "context";
  content: string;
}

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Build LCS length table
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "context", content: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      result.unshift({ type: "added", content: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", content: oldLines[i - 1] });
      i--;
    }
  }

  return result;
}

function DiffView({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const lines = computeLineDiff(oldContent, newContent);

  return (
    <pre className="text-xs font-mono leading-relaxed overflow-x-auto">
      {lines.map((line, idx) => {
        if (line.type === "added") {
          return (
            <div key={idx} className="bg-green-950/40 text-green-300">
              <span className="select-none text-green-500 mr-1">+</span>
              {line.content}
            </div>
          );
        }
        if (line.type === "removed") {
          return (
            <div key={idx} className="bg-red-950/40 text-red-300 line-through decoration-red-700/40">
              <span className="select-none text-red-500 mr-1">-</span>
              {line.content}
            </div>
          );
        }
        return (
          <div key={idx} className="text-gray-500">
            <span className="select-none mr-1"> </span>
            {line.content}
          </div>
        );
      })}
    </pre>
  );
}

export function ArtifactDrawer({ projectId, phase, onClose }: ArtifactDrawerProps) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [versions, setVersions] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setArtifact(null);
    setVersions([]);
    setShowDiff(false);

    Promise.all([
      api.artifacts.getByPhase(projectId, phase),
      api.artifacts.versions(projectId, phase),
    ])
      .then(([art, vers]) => {
        setArtifact(art);
        setVersions(vers);
      })
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

  const hasPreviousVersion = versions.length >= 2;
  const previousArtifact = hasPreviousVersion ? versions[1] : null;

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
          <div className="flex items-center gap-2">
            {/* Diff toggle — only when multiple versions exist */}
            {hasPreviousVersion && !loading && !error && (
              <button
                onClick={() => setShowDiff((v) => !v)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  showDiff
                    ? "bg-blue-900/50 border-blue-700 text-blue-300"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
                }`}
                title={showDiff ? "Show content" : "Show diff from previous version"}
              >
                {showDiff ? "Content" : "Diff"}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-200 transition-colors p-1.5 rounded hover:bg-gray-800 text-sm font-medium"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
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

          {artifact && !showDiff && (
            <pre className="text-sm text-gray-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
              {artifact.content}
            </pre>
          )}

          {artifact && showDiff && previousArtifact && (
            <div>
              <p className="text-xs text-gray-600 mb-3">
                Showing changes from version {previousArtifact.version} → {artifact.version}
              </p>
              <DiffView
                oldContent={previousArtifact.content}
                newContent={artifact.content}
              />
            </div>
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
