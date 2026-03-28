import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, FeedMessage, InboxMessage, Project, WsEvent } from "./types";
import { api } from "./api";
import { TopBar } from "./components/TopBar";
import { AgentPanel, type AgentActionEntry } from "./components/AgentPanel";
import { FeedPanel } from "./components/FeedPanel";
import { InboxPanel } from "./components/InboxPanel";
import { ArtifactDrawer } from "./components/ArtifactDrawer";

const WS_URL = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [feedMessages, setFeedMessages] = useState<FeedMessage[]>([]);
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);
  const [agentUpdates, setAgentUpdates] = useState<Agent[]>([]);
  const [cycleRunning, setCycleRunning] = useState(false);

  // Agent action history for sparklines: role → last 5 entries
  const [agentHistory, setAgentHistory] = useState<Record<string, AgentActionEntry[]>>({});

  // Artifact drawer state: which phase to show (null = closed)
  const [artifactDrawerPhase, setArtifactDrawerPhase] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const currentProjectIdRef = useRef<string | null>(null);

  // ── Load initial projects ──────────────────────────────────────────────────

  useEffect(() => {
    api.projects.list().then((ps) => {
      setProjects(ps);
      if (ps.length > 0) setSelectedProject(ps[0]);
    }).catch(console.error);
  }, []);

  // ── Load project data when selection changes ───────────────────────────────

  useEffect(() => {
    if (!selectedProject) return;
    currentProjectIdRef.current = selectedProject.id;

    setFeedMessages([]);
    setInboxMessages([]);
    setAgentUpdates([]);
    setAgentHistory({});
    setArtifactDrawerPhase(null);

    // Subscribe WS to this project
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", projectId: selectedProject.id }));
    }

    Promise.all([
      api.feed.list(selectedProject.id),
      api.inbox.list(selectedProject.id),
    ]).then(([feed, inbox]) => {
      if (currentProjectIdRef.current === selectedProject.id) {
        setFeedMessages(feed);
        setInboxMessages(inbox);
      }
    }).catch(console.error);
  }, [selectedProject?.id]);

  // ── WebSocket ──────────────────────────────────────────────────────────────

  const connectWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      // Subscribe to current project
      if (currentProjectIdRef.current) {
        ws.send(JSON.stringify({ type: "subscribe", projectId: currentProjectIdRef.current }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data as string) as WsEvent;
        handleWsEvent(payload);
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      // Reconnect after 3 seconds
      setTimeout(connectWs, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connectWs();
    return () => {
      wsRef.current?.close();
    };
  }, [connectWs]);

  function handleWsEvent(payload: WsEvent) {
    const pid = currentProjectIdRef.current;

    if (payload.event === "feed_message") {
      if (payload.projectId !== pid) return;
      setFeedMessages((prev) => {
        // Prepend (API returns newest-first)
        if (prev.some((m) => m.id === payload.data.id)) return prev;
        return [payload.data, ...prev];
      });
    }

    if (payload.event === "inbox_message") {
      if (payload.projectId !== pid) return;
      setInboxMessages((prev) => {
        if (prev.some((m) => m.id === payload.data.id)) return prev;
        return [payload.data, ...prev];
      });
    }

    if (payload.event === "agent_status") {
      if (payload.projectId !== pid) return;
      const { role, status } = payload.data;

      // Update live agent state
      setAgentUpdates([payload.data as unknown as Agent]);

      // Append to sparkline history (keep last 5 per role)
      setAgentHistory((prev) => {
        const existing = prev[role] ?? [];
        const entry: AgentActionEntry = { status, ts: Date.now() };
        return {
          ...prev,
          [role]: [...existing.slice(-4), entry],
        };
      });
    }

    if (payload.event === "phase_change") {
      if (payload.projectId !== pid) return;
      setSelectedProject((prev) =>
        prev ? { ...prev, current_phase: payload.data.phase } : prev
      );
      if (payload.data.phase === "complete" || !payload.data.phase) {
        setCycleRunning(false);
      }
    }
  }

  // ── Start cycle ────────────────────────────────────────────────────────────

  async function handleStartCycle() {
    if (!selectedProject || cycleRunning) return;
    setCycleRunning(true);
    try {
      await api.cycle.start(selectedProject.id);
    } catch (err) {
      console.error("Failed to start cycle:", err);
      setCycleRunning(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      <TopBar
        projects={projects}
        selectedProject={selectedProject}
        onSelectProject={setSelectedProject}
        onProjectsChange={setProjects}
        cycleRunning={cycleRunning}
        onStartCycle={handleStartCycle}
      />

      <div className="flex-1 flex overflow-hidden">
        <AgentPanel
          projectId={selectedProject?.id ?? ""}
          agentUpdates={agentUpdates}
          agentHistory={agentHistory}
        />

        <FeedPanel
          messages={feedMessages}
          onPhaseClick={(phase) => setArtifactDrawerPhase(phase)}
        />

        {selectedProject && (
          <InboxPanel
            projectId={selectedProject.id}
            messages={inboxMessages}
            onMessagesChange={setInboxMessages}
          />
        )}
      </div>

      {/* Artifact drawer — right-side overlay when a phase is clicked */}
      {artifactDrawerPhase && selectedProject && (
        <ArtifactDrawer
          projectId={selectedProject.id}
          phase={artifactDrawerPhase}
          onClose={() => setArtifactDrawerPhase(null)}
        />
      )}
    </div>
  );
}
