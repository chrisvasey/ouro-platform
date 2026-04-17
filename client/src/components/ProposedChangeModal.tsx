import { useState } from "react";
import type { ProposedChange } from "../types";
import { api } from "../api";
import { DiffView } from "./DiffView";

interface ProposedChangeModalProps {
  projectId: string;
  change: ProposedChange;
  onResolved: (id: string) => void;
}

export function ProposedChangeModal({ projectId, change, onResolved }: ProposedChangeModalProps) {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"diff" | "full">("diff");

  async function handleApprove() {
    setLoading(true);
    try {
      await api.proposedChanges.approve(projectId, change.id);
      onResolved(change.id);
    } catch (err) {
      console.error("Approve failed:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    setLoading(true);
    try {
      await api.proposedChanges.reject(projectId, change.id);
      onResolved(change.id);
    } catch (err) {
      console.error("Reject failed:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop — intentionally non-dismissable for blocking changes */}
      <div className="fixed inset-0 bg-black/70 z-40" aria-hidden="true" />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposed-change-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-start justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
            <div>
              <h2
                id="proposed-change-title"
                className="text-sm font-semibold text-gray-100"
              >
                Proposed File Change
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Proposed by{" "}
                <span className="text-gray-400">{change.proposed_by}</span>
              </p>
            </div>
            <span className="text-xs text-amber-400 font-medium bg-amber-900/30 px-2 py-1 rounded">
              Pending approval
            </span>
          </div>

          {/* File path */}
          <div className="px-5 py-3 border-b border-gray-800 flex-shrink-0">
            <p className="text-xs text-gray-500 mb-1">Target file</p>
            <code className="text-sm text-blue-300 font-mono bg-gray-800 px-2 py-1 rounded break-all">
              {change.file_path}
            </code>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 px-5 pt-3 pb-0 border-b border-gray-800 flex-shrink-0">
            <button
              className={`text-xs px-3 py-1.5 rounded-t transition-colors ${
                activeTab === "diff"
                  ? "bg-gray-800 text-gray-100 border border-b-0 border-gray-700"
                  : "text-gray-500 hover:text-gray-300"
              }`}
              onClick={() => setActiveTab("diff")}
            >
              Diff
            </button>
            <button
              className={`text-xs px-3 py-1.5 rounded-t transition-colors ${
                activeTab === "full"
                  ? "bg-gray-800 text-gray-100 border border-b-0 border-gray-700"
                  : "text-gray-500 hover:text-gray-300"
              }`}
              onClick={() => setActiveTab("full")}
            >
              Full
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto max-h-[55vh] px-5 py-3">
            {activeTab === "diff" ? (
              <div>
                {(!change.original_content || change.original_content.trim() === "") && (
                  <div className="mb-2 text-xs text-amber-400 bg-amber-900/20 border border-amber-900/40 rounded px-3 py-1.5">
                    New file — all content is new
                  </div>
                )}
                <DiffView
                  oldContent={change.original_content ?? ""}
                  newContent={change.diff_content}
                  maxLines={200}
                />
              </div>
            ) : (
              <div>
                <p className="text-xs text-gray-500 mb-2">Proposed content</p>
                <pre className="text-xs text-gray-300 font-mono bg-gray-800/60 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  <code>{change.diff_content}</code>
                </pre>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700 flex-shrink-0">
            <button
              onClick={handleReject}
              disabled={loading}
              className="text-sm px-4 py-2 rounded font-medium transition-all bg-gray-800 hover:bg-red-900/60 text-gray-400 hover:text-red-300 border border-gray-700 hover:border-red-800 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={handleApprove}
              disabled={loading}
              className="text-sm px-4 py-2 rounded font-medium transition-all bg-green-700 hover:bg-green-600 text-white disabled:opacity-50"
            >
              {loading ? "Applying…" : "Approve"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
