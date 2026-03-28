import { useEffect, useRef, useState } from "react";
import type { FeedMessage } from "../types";
import { relativeTime } from "../utils";

interface FeedPanelProps {
  messages: FeedMessage[];
  onPhaseClick?: (phase: string) => void;
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

const PHASE_ORDER = ["research", "spec", "design", "build", "test", "review"];

const PHASE_EMOJI: Record<string, string> = {
  research: "🔬",
  spec: "📋",
  design: "🎨",
  build: "🏗️",
  test: "🧪",
  review: "📝",
};

const PHASE_SHORT: Record<string, string> = {
  research: "Research",
  spec: "Spec",
  design: "Design",
  build: "Build",
  test: "Test",
  review: "Review",
};

/** Extract the completed phase name from a "[PHASE COMPLETE] …" handoff message, or null. */
function extractCompletedPhase(msg: FeedMessage): string | null {
  if (msg.message_type !== "handoff") return null;
  const match = msg.content.match(/^\[(\w+) COMPLETE\]/);
  if (!match) return null;
  const phase = match[1].toLowerCase();
  return PHASE_ORDER.includes(phase) ? phase : null;
}

// ─── Cycle grouping ───────────────────────────────────────────────────────────

interface CycleGroup {
  index: number;
  messages: FeedMessage[];
  completedPhases: string[];
  startedAt: number;
}

function buildCycle(index: number, messages: FeedMessage[]): CycleGroup {
  const completedPhases = messages
    .map(extractCompletedPhase)
    .filter((p): p is string => p !== null);
  return { index, messages, completedPhases, startedAt: messages[0]?.created_at ?? 0 };
}

/**
 * Group chronological messages into cycles.
 * A new cycle begins at each [RESEARCH COMPLETE] handoff message.
 */
function groupIntoCycles(chronological: FeedMessage[]): CycleGroup[] {
  const cycles: CycleGroup[] = [];
  let current: FeedMessage[] = [];

  for (const msg of chronological) {
    if (extractCompletedPhase(msg) === "research" && current.length > 0) {
      cycles.push(buildCycle(cycles.length, current));
      current = [msg];
    } else {
      current.push(msg);
    }
  }

  if (current.length > 0) cycles.push(buildCycle(cycles.length, current));
  return cycles;
}

// ─── CycleTimeline ────────────────────────────────────────────────────────────

function CycleTimeline({
  cycles,
  onPhaseClick,
}: {
  cycles: CycleGroup[];
  onPhaseClick?: (phase: string) => void;
}) {
  const historyCycles = cycles.filter((c) => c.completedPhases.length > 0);
  const [collapsed, setCollapsed] = useState(true);
  const [expandedCycles, setExpandedCycles] = useState<Set<number>>(new Set());

  if (historyCycles.length === 0) return null;

  function toggleCycle(idx: number) {
    setExpandedCycles((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <div className="border-t border-gray-800 flex-shrink-0">
      {/* Timeline header toggle */}
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-900/50 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex items-center gap-1.5">
          <span className="font-semibold uppercase tracking-wider">Cycle History</span>
          <span className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-xs">
            {historyCycles.length}
          </span>
        </div>
        <span className="text-gray-600">{collapsed ? "▸" : "▾"}</span>
      </button>

      {!collapsed && (
        <div className="overflow-y-auto max-h-64 px-3 pb-3 flex flex-col gap-2">
          {[...historyCycles].reverse().map((cycle) => {
            const isExpanded = expandedCycles.has(cycle.index);
            const date = new Date(cycle.startedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
            const time = new Date(cycle.startedAt).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            });
            const isComplete = cycle.completedPhases.includes("review");

            return (
              <div
                key={cycle.index}
                className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden"
              >
                {/* Cycle summary row */}
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800/50 transition-colors"
                  onClick={() => toggleCycle(cycle.index)}
                >
                  <span
                    className={`text-xs font-semibold w-14 text-left ${
                      isComplete ? "text-green-400" : "text-gray-400"
                    }`}
                  >
                    Cycle {cycle.index + 1}
                  </span>

                  {/* Phase completion chips */}
                  <div className="flex items-center gap-0.5 flex-1">
                    {PHASE_ORDER.map((phase) => {
                      const done = cycle.completedPhases.includes(phase);
                      return (
                        <span
                          key={phase}
                          title={PHASE_SHORT[phase]}
                          className={`inline-block rounded-sm text-[9px] px-1 py-0.5 font-mono ${
                            done
                              ? "bg-blue-900/60 text-blue-300"
                              : "bg-gray-800 text-gray-700"
                          }`}
                        >
                          {phase.slice(0, 1).toUpperCase()}
                        </span>
                      );
                    })}
                  </div>

                  <span className="text-[10px] text-gray-600 whitespace-nowrap">
                    {date} {time}
                  </span>
                  <span className="text-gray-600 text-xs ml-1">{isExpanded ? "▾" : "▸"}</span>
                </button>

                {/* Expanded phase detail */}
                {isExpanded && (
                  <div className="border-t border-gray-800 divide-y divide-gray-800/60">
                    {cycle.messages
                      .filter((m) => extractCompletedPhase(m) !== null)
                      .map((msg) => {
                        const phase = extractCompletedPhase(msg)!;
                        const summary = msg.content.replace(/^\[\w+ COMPLETE\]\s*/, "");
                        return (
                          <div
                            key={msg.id}
                            className="flex items-start gap-2 px-3 py-2 hover:bg-gray-800/40 cursor-pointer group"
                            onClick={() => onPhaseClick?.(phase)}
                            title={`View ${phase} artifact`}
                          >
                            <span className="text-sm flex-shrink-0 mt-0.5">
                              {PHASE_EMOJI[phase] ?? "📄"}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-xs font-medium text-blue-400 capitalize">
                                  {phase}
                                </span>
                                <span className="text-[10px] text-gray-600">
                                  {relativeTime(msg.created_at)}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 truncate" title={summary}>
                                {summary.slice(0, 100)}
                              </p>
                            </div>
                            <span className="text-[10px] text-gray-700 group-hover:text-gray-400 flex-shrink-0 transition-colors">
                              view →
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── FeedPanel ────────────────────────────────────────────────────────────────

export function FeedPanel({ messages, onPhaseClick }: FeedPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const chronological = [...messages].reverse();
  const cycles = groupIntoCycles(chronological);

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
          <FeedMessageRow
            key={msg.id}
            msg={msg}
            isLast={i === chronological.length - 1}
            onPhaseClick={onPhaseClick}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Collapsible cycle history timeline below the live feed */}
      <CycleTimeline cycles={cycles} onPhaseClick={onPhaseClick} />
    </main>
  );
}

// ─── FeedMessageRow ───────────────────────────────────────────────────────────

function FeedMessageRow({
  msg,
  isLast,
  onPhaseClick,
}: {
  msg: FeedMessage;
  isLast: boolean;
  onPhaseClick?: (phase: string) => void;
}) {
  const emoji = ROLE_EMOJI[msg.sender_role] ?? "🤖";
  const roleClass = ROLE_COLOUR[msg.sender_role] ?? "bg-gray-800 text-gray-400";
  const typeClass = TYPE_COLOUR[msg.message_type] ?? "bg-gray-800 text-gray-500";
  const phase = extractCompletedPhase(msg);
  const isClickable = phase !== null && onPhaseClick != null;

  return (
    <div
      className={`py-3 ${!isLast ? "border-b border-gray-800/50" : ""} ${
        isClickable
          ? "cursor-pointer hover:bg-gray-900/60 -mx-4 px-4 rounded transition-colors group"
          : ""
      }`}
      onClick={isClickable ? () => onPhaseClick!(phase!) : undefined}
      title={isClickable ? `Click to view ${phase} artifact` : undefined}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${roleClass}`}>
          {emoji} {msg.sender_role}
        </span>
        <span className="text-xs text-gray-600">→</span>
        <span className="text-xs text-gray-500">{msg.recipient}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ml-1 ${typeClass}`}>
          {msg.message_type}
        </span>
        {isClickable && (
          <span className="text-[10px] text-gray-700 group-hover:text-blue-400 transition-colors ml-1">
            view artifact →
          </span>
        )}
        <span className="text-xs text-gray-700 ml-auto">{relativeTime(msg.created_at)}</span>
      </div>
      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
        {msg.content}
      </p>
    </div>
  );
}
