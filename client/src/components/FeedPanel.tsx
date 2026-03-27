import { useEffect, useRef } from "react";
import type { FeedMessage } from "../types";
import { relativeTime } from "../utils";

interface FeedPanelProps {
  messages: FeedMessage[];
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

export function FeedPanel({ messages }: FeedPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

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
