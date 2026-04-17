interface DiffLine {
  type: "added" | "removed" | "context";
  content: string;
}

interface DiffViewProps {
  oldContent: string;
  newContent: string;
  maxLines?: number;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
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

export function DiffView({ oldContent, newContent, maxLines }: DiffViewProps) {
  const lines = computeLineDiff(oldContent, newContent);
  const [showAll, setShowAll] = React.useState(false);

  let visibleLines: (DiffLine | { type: "collapsed"; count: number; key: string })[] = lines;

  if (maxLines && !showAll && lines.length > maxLines * 2) {
    // Find changed line indices
    const changedIndices = lines
      .map((l, i) => (l.type !== "context" ? i : -1))
      .filter((i) => i >= 0);

    if (changedIndices.length === 0) {
      visibleLines = lines;
    } else {
      const CONTEXT = 5;
      const keep = new Set<number>();
      for (const idx of changedIndices) {
        for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(lines.length - 1, idx + CONTEXT); k++) {
          keep.add(k);
        }
      }

      const collapsed: typeof visibleLines = [];
      let collapseStart = -1;
      let collapseCount = 0;

      for (let k = 0; k < lines.length; k++) {
        if (keep.has(k)) {
          if (collapseCount > 0) {
            collapsed.push({ type: "collapsed", count: collapseCount, key: `c-${collapseStart}` });
            collapseCount = 0;
          }
          collapsed.push(lines[k]);
        } else {
          if (collapseCount === 0) collapseStart = k;
          collapseCount++;
        }
      }
      if (collapseCount > 0) {
        collapsed.push({ type: "collapsed", count: collapseCount, key: `c-${collapseStart}` });
      }
      visibleLines = collapsed;
    }
  }

  return (
    <div>
      <pre className="text-xs font-mono leading-relaxed overflow-x-auto">
        {visibleLines.map((line, idx) => {
          if ("key" in line && line.type === "collapsed") {
            return (
              <div key={line.key} className="text-gray-600 text-xs py-1 px-2 bg-gray-900/50 select-none">
                ── {line.count} unchanged lines ──
              </div>
            );
          }
          const l = line as DiffLine;
          if (l.type === "added") {
            return (
              <div key={idx} className="bg-green-950/40 text-green-300">
                <span className="select-none text-green-500 mr-1">+</span>
                {l.content}
              </div>
            );
          }
          if (l.type === "removed") {
            return (
              <div key={idx} className="bg-red-950/40 text-red-300 line-through decoration-red-700/40">
                <span className="select-none text-red-500 mr-1">-</span>
                {l.content}
              </div>
            );
          }
          return (
            <div key={idx} className="text-gray-500">
              <span className="select-none mr-1"> </span>
              {l.content}
            </div>
          );
        })}
      </pre>
      {maxLines && !showAll && lines.length > maxLines * 2 && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Show all {lines.length} lines
        </button>
      )}
    </div>
  );
}

// React import needed for useState
import React from "react";
