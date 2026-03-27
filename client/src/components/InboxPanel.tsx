import { useState } from "react";
import type { InboxMessage } from "../types";
import { api } from "../api";
import { relativeTime } from "../utils";

interface InboxPanelProps {
  projectId: string;
  messages: InboxMessage[];
  onMessagesChange: (messages: InboxMessage[]) => void;
}

const ROLE_EMOJI: Record<string, string> = {
  pm: "🧭",
  researcher: "🔬",
  designer: "🎨",
  developer: "👨‍💻",
  tester: "🧪",
  documenter: "📝",
};

export function InboxPanel({ projectId, messages, onMessagesChange }: InboxPanelProps) {
  const unreadCount = messages.filter((m) => !m.is_read).length;

  return (
    <aside className="w-80 flex-shrink-0 flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Inbox</h2>
        {unreadCount > 0 && (
          <span className="text-xs bg-blue-600 text-white font-medium px-1.5 py-0.5 rounded-full leading-none">
            {unreadCount}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-gray-700 text-sm">
            <span className="text-2xl mb-1">📭</span>
            <p>No messages</p>
          </div>
        )}
        {messages.map((msg) => (
          <InboxItem
            key={msg.id}
            projectId={projectId}
            message={msg}
            onUpdate={(updated) => {
              onMessagesChange(messages.map((m) => (m.id === updated.id ? updated : m)));
            }}
          />
        ))}
      </div>
    </aside>
  );
}

function InboxItem({
  projectId,
  message,
  onUpdate,
}: {
  projectId: string;
  message: InboxMessage;
  onUpdate: (msg: InboxMessage) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const emoji = ROLE_EMOJI[message.sender_role] ?? "🤖";
  const isRead = Boolean(message.is_read);

  async function handleReply() {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      const updated = await api.inbox.reply(projectId, message.id, replyText.trim());
      onUpdate(updated as InboxMessage);
      setReplyText("");
    } catch (err) {
      console.error("Reply failed:", err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className={`border-b border-gray-800 transition-colors ${
        !isRead ? "bg-gray-900/50" : ""
      }`}
    >
      {/* Header row — click to expand */}
      <button
        className="w-full px-3 py-3 flex items-start gap-2 text-left hover:bg-gray-800/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Unread dot */}
        <span
          className={`mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${
            !isRead ? "bg-blue-500" : "bg-transparent"
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs text-gray-400">
              {emoji} {message.sender_role}
            </span>
            <span className="text-xs text-gray-600 ml-auto flex-shrink-0">
              {relativeTime(message.created_at)}
            </span>
          </div>
          <p className={`text-sm truncate ${!isRead ? "text-gray-200 font-medium" : "text-gray-400"}`}>
            {message.subject}
          </p>
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-3 pb-3">
          <div className="bg-gray-800/50 rounded p-3 mb-3">
            <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
              {message.body}
            </p>
          </div>

          {/* Reply section */}
          {message.reply_body ? (
            <div className="border-t border-gray-700 pt-2">
              <p className="text-xs text-gray-600 mb-1">Your reply:</p>
              <p className="text-sm text-gray-400 whitespace-pre-wrap">{message.reply_body}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <textarea
                rows={3}
                placeholder="Reply…"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    handleReply();
                  }
                }}
              />
              <button
                onClick={handleReply}
                disabled={sending || !replyText.trim()}
                className="self-end text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1 rounded transition-colors"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
