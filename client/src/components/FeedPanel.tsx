import { useEffect, useRef, useState } from "react";
import type { CycleRun, FeedMessage, PhaseOutcome } from "../types";
import { relativeTime } from "../utils";

interface FeedPanelProps {
  messages: FeedMessage[];
  cycleHistory: CycleRun[];
}

const ROLE_EMOJI: Record<string, string> = {
  pm: "🧭",
  researcher: "🔬",
  designer: "🎨",
  developer: "👨‍💻",
  tester: "🧪",
  documenter: "📝",
};

const ROLE_COLOUR: Record<string, string> = {
  pm: "bg-blue-900 text-blue-300",
  researcher: "bg-purple-900 text-purple-300",
  designer: "bg-pink-900 text-pink-300",
  developer: "bg-cyan-900 text-cyan-300",
  tester: "bg-yellow-900 text-yellow-300",
  documenter: "bg-green-900 text-green-300",
};

const TYPE_COLOUR: Record<string, string> = {
  handoff: "bg-blue-900/60 text-blue-400",
  question: "bg-amber-900/60 text-amber-400",
  decision: "bg-green-900/60 text-green-400",
  note: "bg-gray-800 text-gray-500",
  escalate: "bg-red-900/60 text-red-400",
};

const CYCLE_STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  running:  { dot: "bg-blue-400 animate-pulse", label: "text-blue-400" },
  complete: { dot: "bg-green-500",              label: "text-green-400" },
  stopped:  { dot: "bg-yellow-500",             label: "text-yellow-400" },
  error:    { dot: "bg-red-500",                label: "text-red-400" },
};

const PHASE_OUTCOME_STYLE: Record<string, string> = {
  complete: "text-green-400",
  error:    "text-red-400",
  stopped:  "text-yellow-400",
};

const PHASE_OUTCOME_ICON: Record<string, string> = {
  complete: "✓",
  error:    "✗",
  stopped:  "■",
};

const ALL_PHASES = ["research", "spec", "design", "build", "test", "review"];

export function FeedPanel({ messages, cycleHistory }: FeedPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Feed is returned newest-first from API; reverse to show oldest-first in panel
  const chronological = [...messages].reverse();

  return (
    <main className="flex-1 flex flex-col overflow-hidden border-r border-gray-800">
      <div className="px-4 py-2.5 border-b border-gray-800 flex-shrink-0">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Feed</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-0">
        {chronological.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-700 text-sm">
            <span className="text-3xl mb-2">📡</span>
            <p>No messages yet. Start a cycle to see activity.</p>
          </div>
        )}

        {chronological.map((msg, i) => (
          <FeedMessageRow key={msg.id} msg={msg} isLast={i === chronological.length - 1} />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Collapsible cycle history */}
      <div className="flex-shrink-0 border-t border-gray-800">
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-gray-900 transition-colors text-left"
        >
          <span className="text-xs text-gray-600 transition-transform duration-150" style={{ display: "inline-block", transform: historyOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
            ▶
          </span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Cycle History
          </span>
          {cycleHistory.length > 0 && (
            <span className="text-xs text-gray-600 ml-1">({cycleHistory.length})</span>
          )}
        </button>

        {historyOpen && (
          <div className="max-h-64 overflow-y-auto border-t border-gray-800/60">
            {cycleHistory.length === 0 ? (
              <div className="px-4 py-3 text-xs text-gray-600">No cycles run yet.</div>
            ) : (
              cycleHistory.map((cycle, idx) => (
                <CycleHistoryRow key={cycle.id} cycle={cycle} number={cycleHistory.length - idx} />
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function FeedMessageRow({ msg, isLast }: { msg: FeedMessage; isLast: boolean }) {
  const emoji = ROLE_EMOJI[msg.sender_role] ?? "🤖";
  const roleClass = ROLE_COLOUR[msg.sender_role] ?? "bg-gray-800 text-gray-400";
  const typeClass = TYPE_COLOUR[msg.message_type] ?? "bg-gray-800 text-gray-500";

  return (
    <div className={`py-3 ${!isLast ? "border-b border-gray-800/50" : ""}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${roleClass}`}>
          {emoji} {msg.sender_role}
        </span>
        <span className="text-xs text-gray-600">→</span>
        <span className="text-xs text-gray-500">{msg.recipient}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ml-1 ${typeClass}`}>
          {msg.message_type}
        </span>
        <span className="text-xs text-gray-700 ml-auto">{relativeTime(msg.created_at)}</span>
      </div>
      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
        {msg.content}
      </p>
    </div>
  );
}

function CycleHistoryRow({ cycle, number }: { cycle: CycleRun; number: number }) {
  const style = CYCLE_STATUS_STYLE[cycle.status] ?? CYCLE_STATUS_STYLE.error;

  // Build a phase grid: one cell per phase, showing outcome or pending
  const outcomeMap = new Map<string, PhaseOutcome>(
    cycle.phase_outcomes.map((o) => [o.phase, o])
  );

  const durationMs = cycle.ended_at ? cycle.ended_at - cycle.started_at : null;
  const durationStr = durationMs !== null
    ? durationMs < 60_000
      ? `${Math.round(durationMs / 1000)}s`
      : `${Math.round(durationMs / 60_000)}m`
    : null;

  return (
    <div className="px-4 py-2.5 border-b border-gray-800/50 last:border-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs text-gray-500 font-medium">#{number}</span>
        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`} />
        <span className={`text-xs font-medium ${style.label}`}>{cycle.status}</span>
        <span className="text-xs text-gray-700 ml-auto">{relativeTime(cycle.started_at)}</span>
        {durationStr && (
          <span className="text-xs text-gray-700">{durationStr}</span>
        )}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {ALL_PHASES.map((phase) => {
          const outcome = outcomeMap.get(phase);
          if (!outcome) {
            // Not reached
            return (
              <span key={phase} className="text-xs text-gray-700 px-1.5 py-0.5 rounded bg-gray-800/40">
                {phase}
              </span>
            );
          }
          const icon = PHASE_OUTCOME_ICON[outcome.status] ?? "?";
          const cls = PHASE_OUTCOME_STYLE[outcome.status] ?? "text-gray-500";
          return (
            <span key={phase} className={`text-xs px-1.5 py-0.5 rounded bg-gray-800/60 ${cls}`} title={outcome.status}>
              {phase} {icon}
            </span>
          );
        })}
      </div>
    </div>
  );
}
