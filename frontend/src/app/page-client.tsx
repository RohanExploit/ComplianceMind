"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";

interface AgentResponse {
  agent: string;
  role: string;
  content: string;
  retrieval_latency_ms: number;
  context_used: Array<{ source: string; text: string; score: number }>;
  task_id: string;
  timestamp: string;
}

interface Task {
  id: string;
  description: string;
  status: "analyzing" | "awaiting_review" | "approved" | "escalated";
  created_by: string;
  created_at: string;
}

interface Presence {
  user_id: string;
  name: string;
  joined_at: string;
}

type FeedItem =
  | { id: string; type: "user"; content: string; user: string; timestamp: string }
  | { id: string; type: "agent"; agent: string; role: string; content: string; latency_ms: number; context_used: AgentResponse["context_used"]; task_id: string; timestamp: string }
  | { id: string; type: "system"; content: string; timestamp: string }
  | { id: string; type: "task_event"; task_id: string; event: string; user?: string; timestamp: string };

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

const AGENT_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  scanner: { color: "#a78bfa", icon: "🔎", label: "Reg Scanner" },
  analyst: { color: "#22d3ee", icon: "📊", label: "Risk Analyst" },
  drafter: { color: "#fbbf24", icon: "📝", label: "Audit Drafter" },
  escalation: { color: "#f87171", icon: "🚨", label: "Escalation" },
};

const STATUS_STYLES: Record<Task["status"], { bg: string; text: string; label: string }> = {
  analyzing: { bg: "bg-violet-500/20 border-violet-500/30", text: "text-violet-300", label: "Analyzing" },
  awaiting_review: { bg: "bg-amber-500/20 border-amber-500/30", text: "text-amber-300", label: "Review Needed" },
  approved: { bg: "bg-emerald-500/20 border-emerald-500/30", text: "text-emerald-300", label: "Approved" },
  escalated: { bg: "bg-red-500/20 border-red-500/30", text: "text-red-300", label: "Escalated" },
};

const EXAMPLE_FLAGS = [
  "Director bought ₹1.8Cr NIFTY options 3 days before Q2 earnings announcement",
  "₹4.2Cr wire transfer to Cayman Islands without RBI approval",
  "PEP customer KYC not updated for 3 years — 3 large transactions this month",
  "Related party loan of ₹12Cr to subsidiary — no board approval documented",
];

function parseInline(str: string): (string | React.ReactNode)[] {
  const parts = str.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="px-1.5 py-0.5 rounded bg-white/10 text-violet-200 font-mono text-xs">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function FormattedMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;

        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={idx} className="font-bold text-violet-300 text-sm mt-3 mb-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
              {parseInline(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith("## ")) {
          return <h3 key={idx} className="font-bold text-white text-base mt-3 mb-1 border-b border-white/10 pb-1">{parseInline(trimmed.slice(3))}</h3>;
        }
        if (trimmed.startsWith("# ")) {
          return <h2 key={idx} className="font-extrabold text-white text-base mt-3 mb-1 tracking-tight">{parseInline(trimmed.slice(2))}</h2>;
        }

        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-2 text-[var(--text-secondary)]">
              <span className="text-violet-400 text-xs mt-1">•</span>
              <span>{parseInline(trimmed.slice(2))}</span>
            </div>
          );
        }

        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-2 text-[var(--text-secondary)]">
              <span className="text-cyan-400 font-mono text-xs mt-0.5">{numMatch[1]}.</span>
              <span>{parseInline(numMatch[2])}</span>
            </div>
          );
        }

        return <p key={idx} className="text-[var(--text-secondary)]">{parseInline(line)}</p>;
      })}
    </div>
  );
}

export default function WorkspacePage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("room") || "default";

  const [userName, setUserName] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [latencyLog, setLatencyLog] = useState<Array<{ agent: string; ms: number }>>([]);
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set());
  const [targetAgent, setTargetAgent] = useState<string | null>(null);
  const [benchmarkResult, setBenchmarkResult] = useState<null | { avg_ms: number; all_under_10ms: boolean; mode: string }>(null);
  const [learnedRules, setLearnedRules] = useState<Array<{ id: string; text: string; metadata?: any }>>([]);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<{ taskId: string; text: string } | null>(null);
  const [correctionInput, setCorrectionInput] = useState("");
  const [correctionType, setCorrectionType] = useState<"exception" | "false_positive" | "guideline">("exception");
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [feed]);

  useEffect(() => {
    fetch(`${API_BASE}/api/benchmark`).then(r => r.json()).then(d => setBenchmarkResult(d)).catch(() => {});
    fetch(`${API_BASE}/api/learned-rules/${workspaceId}`)
      .then(r => r.json())
      .then(d => { if (d.rules) setLearnedRules(d.rules); })
      .catch(() => {});
  }, [workspaceId]);

  const connectWs = useCallback((name: string) => {
    const wsUrl = API_BASE.replace("http", "ws") + `/ws/${workspaceId}`;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => { ws.send(JSON.stringify({ type: "join", name })); setWsConnected(true); };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "workspace_state": setPresence(data.presence || []); setTasks(data.tasks || []); break;
        case "presence":
          setPresence(data.presence || []);
          setFeed(prev => [...prev, { id: crypto.randomUUID(), type: "system", content: `${data.name} ${data.event === "joined" ? "joined" : "left"} the workspace`, timestamp: data.timestamp }]);
          break;
        case "task_created":
          setTasks(prev => [...prev, data.task]);
          setFeed(prev => [...prev, { id: crypto.randomUUID(), type: "task_event", task_id: data.task.id, event: "created", user: data.user, timestamp: data.timestamp }]);
          setActiveAgents(new Set(Object.keys(AGENT_CONFIG)));
          break;
        case "agent_response":
          setFeed(prev => [...prev, { id: crypto.randomUUID(), type: "agent", agent: data.agent, role: data.role, content: data.content, latency_ms: data.retrieval_latency_ms, context_used: data.context_used || [], task_id: data.task_id, timestamp: data.timestamp }]);
          setLatencyLog(prev => [...prev.slice(-29), { agent: data.agent, ms: data.retrieval_latency_ms }]);
          setActiveAgents(prev => {
            const next = new Set(prev);
            next.delete(data.role);
            if (next.size === 0) setIsLoading(false);
            return next;
          });
          break;
        case "task_updated":
          setTasks(prev => prev.map(t => t.id === data.task_id ? { ...t, status: data.status } : t));
          setIsLoading(false);
          setActiveAgents(new Set());
          break;
        case "rule_learned":
          setLearnedRules(prev => [{ id: data.rule_id, text: data.rule, metadata: { officer: data.officer, type: data.correction_type } }, ...prev]);
          setFeed(prev => [...prev, {
            id: crypto.randomUUID(),
            type: "system",
            content: `🧠 Precedent Learned: "${data.rule}" (Logged by ${data.officer} to Moss Memory)`,
            timestamp: data.timestamp
          }]);
          showToast(`🧠 Precedent indexed in Moss vector memory!`, "success");
          break;
        case "error":
          showToast(data.message || "An action error occurred.", "error");
          setIsLoading(false);
          setActiveAgents(new Set());
          break;
        case "chat":
          setFeed(prev => [...prev, { id: crypto.randomUUID(), type: "user", content: data.content, user: data.user, timestamp: data.timestamp }]);
          break;
      }
    };
    ws.onclose = () => {
      setWsConnected(false);
      setIsLoading(false);
      setActiveAgents(new Set());
      setTimeout(() => connectWs(name), 2000);
    };
    wsRef.current = ws;
  }, [workspaceId]);

  const handleJoin = () => { if (!userName.trim()) return; setHasJoined(true); connectWs(userName.trim()); };

  const flagEvent = useCallback(() => {
    if (!input.trim() || isLoading) return;
    const content = input.trim();
    setInput("");
    setIsLoading(true);
    setActiveAgents(new Set(Object.keys(AGENT_CONFIG)));
    setFeed(prev => [...prev, { id: crypto.randomUUID(), type: "user", content: `🚩 ${content}`, user: userName, timestamp: new Date().toISOString() }]);

    // Safety timeout: Never stay stuck in loading state longer than 18s
    const timer = setTimeout(() => {
      setIsLoading(false);
      setActiveAgents(new Set());
    }, 18000);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "flag", content, target_agent: targetAgent }));
    } else {
      // Resilient REST fallback
      fetch(`${API_BASE}/api/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: content,
          workspace_id: workspaceId,
          target_agent: targetAgent,
          run_full_pipeline: !targetAgent
        })
      })
      .then(r => r.json())
      .then(d => {
        clearTimeout(timer);
        setIsLoading(false);
        setActiveAgents(new Set());
        if (d.responses) {
          d.responses.forEach((res: any) => {
            setFeed(prev => [...prev, {
              id: crypto.randomUUID(),
              type: "agent",
              agent: res.agent,
              role: res.role,
              content: res.content,
              latency_ms: res.retrieval_latency_ms,
              context_used: res.context_used || [],
              task_id: d.task_id,
              timestamp: res.timestamp
            }]);
          });
        }
      })
      .catch(() => {
        clearTimeout(timer);
        setIsLoading(false);
        setActiveAgents(new Set());
      });
    }
  }, [input, isLoading, targetAgent, userName, workspaceId]);

  const approveTask = (taskId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "approve", task_id: taskId }));
  };

  const submitCorrection = async () => {
    if (!correctionInput.trim() || !correctionTarget) return;
    setIsSubmittingCorrection(true);
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "feedback",
          task_id: correctionTarget.taskId,
          content: correctionTarget.text,
          correction: correctionInput.trim(),
          correction_type: correctionType,
        }));
        showToast("Precedent recorded in Moss memory! All agents will apply this rule.", "success");
        setCorrectionTarget(null);
        setCorrectionInput("");
      } else {
        const res = await fetch(`${API_BASE}/api/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_id: correctionTarget.taskId,
            content: correctionTarget.text,
            correction: correctionInput.trim(),
            correction_type: correctionType,
            officer_name: userName || "Officer",
            workspace_id: workspaceId
          })
        });
        if (res.ok) {
          showToast("Precedent recorded in Moss memory! All agents will apply this rule.", "success");
          setCorrectionTarget(null);
          setCorrectionInput("");
        } else {
          showToast("Failed to save correction to Moss.", "error");
        }
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, "error");
    } finally {
      setIsSubmittingCorrection(false);
    }
  };

  const avgLatency = latencyLog.length > 0
    ? (latencyLog.reduce((s, l) => s + l.ms, 0) / latencyLog.length).toFixed(1)
    : benchmarkResult?.avg_ms?.toFixed(1) ?? "—";

  if (!hasJoined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-strong rounded-2xl p-8 w-full max-w-md border border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-white font-bold">CM</div>
            <div>
              <h1 className="text-xl font-bold">ComplianceMind</h1>
              <p className="text-xs text-[var(--text-muted)]">AI-Native Compliance Workspace · YC RFS #12</p>
            </div>
          </div>
          <div className="mb-4 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
            🔗 Workspace: <span className="font-mono font-semibold">{workspaceId}</span>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mb-5">
            Real-time compliance workspace. Flag suspicious events → 4 AI agents analyze in parallel using Moss semantic search. Share URL to collaborate with your team.
          </p>
          <input
            type="text" placeholder="Your name (e.g. Priya, CCO)"
            value={userName} onChange={e => setUserName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleJoin()}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500/50 mb-4"
          />
          <button onClick={handleJoin} disabled={!userName.trim()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-semibold text-sm disabled:opacity-30 cursor-pointer hover:opacity-90 transition-opacity">
            Join Workspace
          </button>
          <div className="mt-4 text-center">
            <p className="text-xs text-[var(--text-muted)]">
              Share link: <button onClick={() => navigator.clipboard.writeText(window.location.href)} className="text-violet-400 underline cursor-pointer">Copy URL</button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* LEFT SIDEBAR */}
      <aside className="w-72 glass-strong flex flex-col border-r border-white/5 overflow-hidden">
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold">CM</div>
              <span className="font-bold text-sm">ComplianceMind</span>
            </div>
            <div className={`w-2 h-2 rounded-full ${wsConnected ? "bg-emerald-400 pulse-emerald" : "bg-red-400"}`} />
          </div>
          <p className="text-[10px] text-[var(--text-muted)] font-mono">room: {workspaceId}</p>
        </div>

        <div className="px-4 pt-3 pb-2 border-b border-white/5">
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">Online ({presence.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {presence.map(p => (
              <div key={p.user_id} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-xs text-[var(--text-secondary)]">{p.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-4 pt-3 pb-2 border-b border-white/5">
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">AI Agents</p>
          <div className="space-y-1">
            {Object.entries(AGENT_CONFIG).map(([role, cfg]) => (
              <button key={role} onClick={() => setTargetAgent(targetAgent === role ? null : role)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all-smooth cursor-pointer ${targetAgent === role ? "bg-white/10 border border-white/10" : "hover:bg-white/5"}`}>
                <span>{cfg.icon}</span>
                <span style={{ color: cfg.color }} className="font-medium">{cfg.label}</span>
                {activeAgents.has(role) && <span className="ml-auto text-[10px] text-violet-300 animate-pulse">working…</span>}
              </button>
            ))}
          </div>
          {targetAgent && <button onClick={() => setTargetAgent(null)} className="text-[10px] text-violet-400 underline mt-1 cursor-pointer">← Full pipeline</button>}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4">
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">Tasks ({tasks.length})</p>
          {tasks.length === 0
            ? <p className="text-xs text-[var(--text-muted)] text-center mt-4">Flag a compliance event to create tasks</p>
            : <div className="space-y-2">{tasks.slice().reverse().map(task => {
                const style = STATUS_STYLES[task.status];
                return (
                  <div key={task.id} className={`p-2.5 rounded-xl border ${style.bg} fade-in-up`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[10px] font-mono ${style.text}`}>#{task.id}</span>
                      <span className={`text-[10px] font-semibold ${style.text}`}>{style.label}</span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-snug line-clamp-2">{task.description}</p>
                    {task.status === "awaiting_review" && (
                      <button onClick={() => approveTask(task.id)}
                        className="mt-2 w-full text-[10px] py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 transition-all-smooth cursor-pointer">
                        ✓ Approve Finding
                      </button>
                    )}
                  </div>
                );
              })}</div>
          }
        </div>

        {/* LEARNED PRECEDENTS / AUTO-IMPROVEMENT MEMORY */}
        <div className="border-t border-white/5 px-4 pt-3 pb-3 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest text-violet-400 font-semibold flex items-center gap-1">
              <span>🧠</span> Moss Precedents ({learnedRules.length})
            </p>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-mono">active</span>
          </div>
          {learnedRules.length === 0 ? (
            <p className="text-[11px] text-[var(--text-muted)] italic">No learned rules yet. Click "Teach Agent" on any response to add a precedent.</p>
          ) : (
            <div className="space-y-1.5">
              {learnedRules.map(r => (
                <div key={r.id} className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-xs">
                  <div className="flex items-center justify-between text-[10px] text-violet-300 mb-0.5">
                    <span className="font-semibold uppercase tracking-wider">{r.metadata?.type || "Exception"}</span>
                    <span>{r.metadata?.officer || "Officer"}</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-tight">{r.text.replace(/^\[.*?\]\s*/, "")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* MAIN FEED */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {toast && (
          <div className="absolute top-4 right-6 z-50 fade-in-up">
            <div className={`px-4 py-2.5 rounded-xl text-xs font-medium shadow-2xl flex items-center gap-2 border ${
              toast.type === "error"
                ? "bg-red-500/90 text-white border-red-400"
                : toast.type === "success"
                ? "bg-emerald-500/90 text-white border-emerald-400"
                : "bg-violet-600/90 text-white border-violet-400"
            }`}>
              <span>{toast.type === "error" ? "⚠️" : toast.type === "success" ? "✓" : "ℹ️"}</span>
              <span>{toast.message}</span>
            </div>
          </div>
        )}
        <header className="glass-strong border-b border-white/5 px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold">Compliance Feed</h2>
            <p className="text-xs text-[var(--text-muted)]">
              {targetAgent ? `→ ${AGENT_CONFIG[targetAgent]?.label} only` : "RegScanner ∥ RiskAnalyst → AuditDrafter ∥ Escalation (parallel)"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-emerald" />
              <span className="text-xs font-mono text-emerald-300">{avgLatency}ms</span>
            </div>
            <span className="text-xs text-[var(--text-muted)]">Powered by <span className="font-semibold text-white">Moss</span></span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {feed.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/30 to-red-500/30 flex items-center justify-center mb-4 border border-white/10"><span className="text-3xl">⚖️</span></div>
              <h3 className="text-lg font-bold mb-2">ComplianceMind</h3>
              <p className="text-sm text-[var(--text-secondary)] max-w-md mb-6">
                AI-Native Compliance Workspace (YC RFS #12). Flag a suspicious transaction — 4 agents analyze in parallel using Moss semantic search across regulations, transactions, and audit history.
              </p>
              <div className="grid grid-cols-1 gap-2 w-full max-w-lg">
                {EXAMPLE_FLAGS.map(ex => (
                  <button key={ex} onClick={() => setInput(ex)}
                    className="text-left p-3 rounded-xl glass hover:bg-white/10 transition-all-smooth text-xs text-[var(--text-secondary)] cursor-pointer">
                    🚩 {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {feed.map(item => {
            if (item.type === "system") return (
              <div key={item.id} className="text-center">
                <span className="text-[11px] text-[var(--text-muted)] bg-white/5 px-3 py-1 rounded-full">{item.content}</span>
              </div>
            );
            if (item.type === "task_event") return (
              <div key={item.id} className="text-center">
                <span className="text-[11px] text-violet-400 bg-violet-500/10 px-3 py-1 rounded-full border border-violet-500/20">⚡ Task #{item.task_id} created by {item.user}</span>
              </div>
            );
            if (item.type === "user") return (
              <div key={item.id} className="flex justify-end fade-in-up">
                <div className="max-w-2xl">
                  <p className="text-[11px] text-[var(--text-muted)] text-right mb-1">{item.user}</p>
                  <div className="bg-violet-500/15 border border-violet-500/20 rounded-2xl rounded-tr-md px-4 py-2.5">
                    <p className="text-sm">{item.content}</p>
                  </div>
                </div>
              </div>
            );
            const cfg = AGENT_CONFIG[item.role] || AGENT_CONFIG.scanner;
            return (
              <div key={item.id} className="flex gap-3 fade-in-up">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 mt-1"
                  style={{ background: `${cfg.color}22`, border: `1px solid ${cfg.color}44` }}>
                  {cfg.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md badge-${item.role}`}>{item.agent}</span>
                    <span className="text-xs font-mono text-emerald-400">⚡ {item.latency_ms}ms</span>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">#{item.task_id}</span>
                    <button
                      onClick={() => {
                        setCorrectionTarget({ taskId: item.task_id, text: item.content });
                        setCorrectionInput("");
                      }}
                      className="ml-auto text-[10px] px-2 py-0.5 rounded-md bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 border border-violet-500/20 transition-all-smooth cursor-pointer flex items-center gap-1"
                    >
                      <span>💡</span> Teach Agent
                    </button>
                  </div>
                  <div className="glass rounded-2xl rounded-tl-md px-4 py-3">
                    <FormattedMessage text={item.content} />
                  </div>
                  {item.context_used?.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-muted)] mr-1">🔍 Moss Context:</span>
                      {item.context_used.map((ctx, i) => (
                        <span key={i} title={ctx.text} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-cyan-300 font-mono">
                          <span>{ctx.source}</span>
                          <span className="text-emerald-400 font-semibold">{Math.round(ctx.score * 100)}%</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isLoading && (
            <div className="flex flex-col gap-3 fade-in-up mt-2">
              <div className="flex items-center gap-2 mb-1 pl-11">
                <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                <span className="text-xs font-semibold text-violet-300">Parallel Execution Engaged (asyncio.gather)</span>
              </div>
              <div className="flex gap-3 stagger-children">
                <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
                  <div className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                </div>
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Object.entries(AGENT_CONFIG).map(([role, cfg]) => {
                    if (!activeAgents.has(role)) return null;
                    return (
                      <div key={role} className="glass rounded-xl px-3 py-2 flex items-center gap-2 border-l-2" style={{ borderLeftColor: cfg.color }}>
                        <span className="text-sm">{cfg.icon}</span>
                        <span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
                        <span className="text-[10px] text-[var(--text-muted)] ml-auto cursor-blink">analyzing</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <div ref={feedEndRef} />
        </div>

        <div className="p-4 border-t border-white/5 flex-shrink-0">
          <div className="glass-strong rounded-2xl flex items-center gap-3 px-4 py-2">
            <span className="text-sm">🚩</span>
            <input type="text" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && flagEvent()}
              placeholder="Describe a suspicious transaction or compliance concern..."
              disabled={isLoading}
              className="flex-1 bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
            <button onClick={flagEvent} disabled={isLoading || !input.trim() || !wsConnected}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-red-600 text-white text-sm font-medium disabled:opacity-30 hover:opacity-90 transition-opacity cursor-pointer">
              Flag
            </button>
          </div>
        </div>
      </main>

      {/* RIGHT: Latency Dashboard */}
      <aside className="w-60 glass-strong flex flex-col border-l border-white/5 overflow-hidden">
        <div className="p-4 border-b border-white/5">
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Moss Latency</p>
        </div>
        <div className="p-4 flex-1 overflow-y-auto">
          <div className="mb-4">
            <div className="flex items-baseline gap-1.5 mb-0.5">
              <span className="text-2xl font-bold font-mono text-emerald-400">{avgLatency}</span>
              <span className="text-xs text-[var(--text-muted)]">ms avg</span>
            </div>
            {benchmarkResult && (
              <div className={`text-[10px] ${benchmarkResult.all_under_10ms ? "text-emerald-400" : "text-amber-400"}`}>
                {benchmarkResult.all_under_10ms ? "✅ All <10ms" : "⚠️ Some >10ms"} ({benchmarkResult.mode === "live_moss" ? "Live Moss" : "Mock"})
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            {latencyLog.slice(-20).map((log, i) => {
              const color = AGENT_CONFIG[log.agent.toLowerCase()]?.color || "#a78bfa";
              const icon = AGENT_CONFIG[log.agent.toLowerCase()]?.icon || "🤖";
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] w-5 text-center">{icon}</span>
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min((log.ms / 15) * 100, 100)}%`, backgroundColor: color, opacity: 0.8 }} />
                  </div>
                  <span className="text-[10px] w-10 font-mono text-right text-[var(--text-muted)]">{log.ms.toFixed(1)}ms</span>
                </div>
              );
            })}
          </div>
          {latencyLog.length === 0 && <p className="text-xs text-[var(--text-muted)] text-center mt-6">Flag an event to see live latency</p>}

          <div className="mt-6 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
            <p className="text-[10px] font-semibold text-emerald-400 mb-1.5">Moss Indexes</p>
            {["regulations", "transactions", "violations", "session-history", "learned-rules"].map(idx => (
              <div key={idx} className="flex justify-between items-center text-[10px] mb-1">
                <span className="text-[var(--text-muted)]">{idx}</span>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 rounded-xl bg-white/3 border border-white/5">
            <p className="text-[10px] font-semibold text-[var(--text-secondary)] mb-1.5">Share Workspace</p>
            <button onClick={() => navigator.clipboard.writeText(window.location.href)}
              className="w-full text-[10px] py-1.5 rounded-lg bg-white/5 border border-white/10 text-violet-400 hover:bg-white/10 transition-all-smooth cursor-pointer">
              📋 Copy Invite Link
            </button>
          </div>
        </div>
      </aside>

      {/* TEACH AGENT / AUTO-IMPROVEMENT MODAL */}
      {correctionTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 fade-in-up">
          <div className="glass-strong rounded-2xl p-6 w-full max-w-lg border border-white/10 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-sm">🧠</div>
                <div>
                  <h3 className="text-sm font-bold text-white">Teach Agent & Auto-Improve</h3>
                  <p className="text-[11px] text-[var(--text-muted)]">Save a precedent to Moss. All future agent scans will apply this rule.</p>
                </div>
              </div>
              <button onClick={() => setCorrectionTarget(null)} className="text-[var(--text-muted)] hover:text-white text-sm cursor-pointer">✕</button>
            </div>

            <div className="mb-3 p-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-[var(--text-secondary)]">
              <span className="text-[10px] uppercase font-mono tracking-wider text-violet-400 block mb-1">Target Context (#{correctionTarget.taskId}):</span>
              <p className="line-clamp-2 italic">{correctionTarget.text.slice(0, 150)}...</p>
            </div>

            <div className="mb-3">
              <label className="text-xs text-[var(--text-muted)] block mb-1.5 font-medium">Precedent Classification:</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "exception", label: "Rule Exception", desc: "Authorized waiver" },
                  { id: "false_positive", label: "False Positive", desc: "Legitimate activity" },
                  { id: "guideline", label: "Internal Policy", desc: "Company precedent" }
                ].map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setCorrectionType(t.id as any)}
                    className={`p-2 rounded-xl text-left border transition-all text-xs cursor-pointer ${
                      correctionType === t.id
                        ? "bg-violet-500/20 border-violet-500/50 text-violet-200"
                        : "bg-white/5 border-white/5 text-[var(--text-muted)] hover:bg-white/10"
                    }`}
                  >
                    <span className="font-semibold block">{t.label}</span>
                    <span className="text-[10px] opacity-75">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-[var(--text-muted)] block mb-1.5 font-medium">Officer Precedent / Feedback:</label>
              <textarea
                rows={3}
                placeholder="e.g. Pre-cleared under Board Resolution #8812. Exclude director ESOP allocations from blackout window."
                value={correctionInput}
                onChange={e => setCorrectionInput(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs outline-none focus:border-violet-500/50 text-white placeholder:text-[var(--text-muted)]"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setCorrectionTarget(null)}
                className="px-4 py-2 rounded-xl text-xs text-[var(--text-muted)] hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={!correctionInput.trim() || isSubmittingCorrection}
                onClick={submitCorrection}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer hover:opacity-90 transition-opacity flex items-center gap-1.5"
              >
                <span>🧠</span>
                <span>{isSubmittingCorrection ? "Indexing in Moss…" : "Ingest into Moss Memory"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
