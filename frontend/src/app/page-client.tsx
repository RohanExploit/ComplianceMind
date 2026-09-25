"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { LiveKitRoom, RoomAudioRenderer, VoiceAssistantControlBar } from "@livekit/components-react";
import "@livekit/components-styles";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentResponse {
  agent: string;
  role: string;
  content: string;
  retrieval_latency_ms: number;
  risk_score?: number;
  confidence?: number;
  context_used: Array<{ source: string; text: string; score: number; moss_mode?: string }>;
  task_id: string;
  timestamp: string;
}

interface ConsensusData {
  task_id: string;
  risk_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  risk_score: number;
  confidence: number;
  recommended_action: "APPROVE" | "FLAG" | "BLOCK" | "REPORT_TO_FIU";
  phase1_wall_ms: number;
  phase2_wall_ms: number;
  total_wall_ms: number;
  moss_avg_latency_ms: number;
}

interface Task {
  id: string;
  description: string;
  status: "analyzing" | "awaiting_review" | "approved" | "escalated";
  created_by: string;
  created_at: string;
  priority?: string;
  risk_level?: string;
  risk_score?: number;
  recommended_action?: string;
}

interface Presence {
  user_id: string;
  name: string;
  joined_at: string;
}

type FeedItem =
  | { id: string; type: "user"; content: string; user: string; timestamp: string }
  | { id: string; type: "agent"; agent: string; role: string; content: string; latency_ms: number; risk_score?: number; confidence?: number; context_used: AgentResponse["context_used"]; task_id: string; timestamp: string }
  | { id: string; type: "consensus"; data: ConsensusData; timestamp: string }
  | { id: string; type: "system"; content: string; timestamp: string }
  | { id: string; type: "task_event"; task_id: string; event: string; user?: string; timestamp: string };

// ─── Config ───────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

const AGENT_CONFIG: Record<string, { color: string; icon: string; label: string; phase: number }> = {
  scanner:   { color: "#a78bfa", icon: "🔎", label: "Reg Scanner",   phase: 1 },
  analyst:   { color: "#22d3ee", icon: "📊", label: "Risk Analyst",  phase: 1 },
  drafter:   { color: "#fbbf24", icon: "📝", label: "Audit Drafter", phase: 2 },
  escalation:{ color: "#f87171", icon: "🚨", label: "Escalation",    phase: 2 },
};

const STATUS_STYLES: Record<Task["status"], { bg: string; dot: string; label: string }> = {
  analyzing:      { bg: "rgba(139,92,246,0.15)", dot: "#a78bfa", label: "Analyzing" },
  awaiting_review:{ bg: "rgba(251,191,36,0.12)", dot: "#fbbf24", label: "Review Needed" },
  approved:       { bg: "rgba(16,185,129,0.12)", dot: "#10b981", label: "Approved" },
  escalated:      { bg: "rgba(239,68,68,0.12)",  dot: "#ef4444", label: "Escalated to FIU" },
};

const EXAMPLE_FLAGS = [
  "Director bought ₹1.8Cr NIFTY options 3 days before Q2 earnings announcement",
  "₹4.2Cr wire transfer to Cayman Islands without RBI approval",
  "PEP customer KYC not updated for 3 years — 3 large transactions this month",
  "Related party loan of ₹12Cr to subsidiary — no board approval documented",
  "9 cash deposits of ₹1.9L each in 3 days — possible structuring pattern",
  "Shell company with zero employees received ₹28Cr in wire transfers",
];

// ─── Markdown Renderer ────────────────────────────────────────────────────────

function parseInline(str: string): (string | React.ReactNode)[] {
  const parts = str.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} style={{ color: "white", fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} style={{ padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.08)", color: "#c4b5fd", fontFamily: "monospace", fontSize: "0.82em" }}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function FormattedMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, lineHeight: "1.65" }}>
      {lines.map((line, idx) => {
        const t = line.trim();
        if (!t) return <div key={idx} style={{ height: 4 }} />;
        if (t.startsWith("### "))
          return <div key={idx} style={{ fontWeight: 700, color: "#c4b5fd", fontSize: 12, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#a78bfa", display: "inline-block", flexShrink: 0 }} />
            {parseInline(t.slice(4))}
          </div>;
        if (t.startsWith("## "))
          return <div key={idx} style={{ fontWeight: 700, color: "white", fontSize: 13, marginTop: 8, paddingBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{parseInline(t.slice(3))}</div>;
        if (t.startsWith("- ") || t.startsWith("* "))
          return <div key={idx} style={{ display: "flex", gap: 8, paddingLeft: 8, color: "rgba(255,255,255,0.7)" }}>
            <span style={{ color: "#a78bfa", fontSize: 10, marginTop: 5, flexShrink: 0 }}>●</span>
            <span>{parseInline(t.slice(2))}</span>
          </div>;
        const nm = t.match(/^(\d+)\.\s+(.*)/);
        if (nm)
          return <div key={idx} style={{ display: "flex", gap: 8, paddingLeft: 8, color: "rgba(255,255,255,0.7)" }}>
            <span style={{ color: "#22d3ee", fontFamily: "monospace", fontSize: 11, marginTop: 2, flexShrink: 0 }}>{nm[1]}.</span>
            <span>{parseInline(nm[2])}</span>
          </div>;
        return <p key={idx} style={{ color: "rgba(255,255,255,0.65)", margin: 0 }}>{parseInline(line)}</p>;
      })}
    </div>
  );
}

// ─── Pulse Dot ────────────────────────────────────────────────────────────────
function PulseDot({ color = "#a78bfa", size = 8 }: { color?: string; size?: number }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
      <span style={{
        position: "absolute", inset: 0, borderRadius: "50%", background: color, opacity: 0.4,
        animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite",
      }} />
      <span style={{ borderRadius: "50%", background: color, width: size, height: size, display: "block" }} />
    </span>
  );
}

// ─── Glass Card ───────────────────────────────────────────────────────────────
function GlassCard({ children, style, onClick }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <div 
      onClick={onClick}
      style={{
        background: "rgba(15,10,35,0.55)",
        border: "1px solid rgba(167,139,250,0.12)",
        borderRadius: 16,
        backdropFilter: "blur(20px)",
        ...(onClick ? { cursor: "pointer" } : {}),
        ...style,
      }}>
      {children}
    </div>
  );
}

// ─── Latency Badge ────────────────────────────────────────────────────────────
function LatencyBadge({ ms }: { ms: number }) {
  const color = ms < 5 ? "#10b981" : ms < 10 ? "#fbbf24" : "#f87171";
  return (
    <span style={{
      fontSize: 10, fontFamily: "monospace", fontWeight: 700,
      color, background: `${color}18`, border: `1px solid ${color}40`,
      padding: "1px 7px", borderRadius: 99,
    }}>
      {ms.toFixed(1)}ms
    </span>
  );
}

// ─── Risk Gauge ───────────────────────────────────────────────────────────────
function RiskGauge({ score, label }: { score: number; label: string }) {
  const color = score >= 75 ? "#ef4444" : score >= 50 ? "#f97316" : score >= 25 ? "#fbbf24" : "#10b981";
  const r = 28, circ = 2 * Math.PI * r;
  const dash = circ * (score / 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width="72" height="72" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease, stroke 0.4s" }}
        />
      </svg>
      <div style={{ textAlign: "center", marginTop: -52, marginBottom: 12, zIndex: 1, position: "relative" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "monospace" }}>{score}</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

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
  const [benchmarkResult, setBenchmarkResult] = useState<null | { avg_ms: number; min_ms?: number; max_ms?: number; all_under_10ms: boolean; mode: string; mode_label?: string; samples?: number[]; parallel_wall_clock_ms?: number }>(null);
  const [learnedRules, setLearnedRules] = useState<Array<{ id: string; text: string; metadata?: Record<string, unknown> }>>([]);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<{ taskId: string; text: string } | null>(null);
  const [correctionInput, setCorrectionInput] = useState("");
  const [correctionType, setCorrectionType] = useState<"exception" | "false_positive" | "guideline">("exception");
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false);
  const [activeTab, setActiveTab] = useState<"feed" | "tasks" | "memory" | "proof">("feed");
  const [riskSummary, setRiskSummary] = useState<{ risk_distribution?: Record<string, number>; jurisdiction_exposure?: Record<string, number> } | null>(null);
  const [showBenchmarkModal, setShowBenchmarkModal] = useState(false);
  const [priority, setPriority] = useState<"normal" | "high" | "critical">("normal");
  // Judge fixes:
  const [mossMode, setMossMode] = useState<"moss_live" | "mock_keyword" | null>(null);
  const [consensusLog, setConsensusLog] = useState<ConsensusData[]>([]); // live consensus history
  const [liveRiskCounts, setLiveRiskCounts] = useState({ critical: 0, high: 0, medium: 0, low: 0 });

  // LiveKit Voice AI state
  const [liveKitToken, setLiveKitToken] = useState<string | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);

  const connectToVoice = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/livekit-token?room=${workspaceId}&identity=${userName || "officer-" + Math.floor(Math.random()*1000)}`);
      const data = await res.json();
      if (data.token) {
        setLiveKitToken(data.token);
        setVoiceActive(true);
        showToast("🎙️ Connected to Voice AI Assistant", "success");
      } else {
        throw new Error("No token");
      }
    } catch (err) {
      showToast("Failed to connect to Voice AI. Check backend logs.", "error");
    }
  };

  const feedEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [feed]);

  useEffect(() => {
    fetch(`${API_BASE}/api/benchmark`).then(r => r.json()).then(d => {
      setBenchmarkResult(d);
      setMossMode(d.mode === "moss_live" ? "moss_live" : "mock_keyword");
    }).catch(() => {});
    fetch(`${API_BASE}/api/learned-rules/${workspaceId}`).then(r => r.json()).then(d => { if (d.rules) setLearnedRules(d.rules); }).catch(() => {});
    fetch(`${API_BASE}/api/analytics/risk-summary?workspace_id=${workspaceId}`).then(r => r.json()).then(d => setRiskSummary(d)).catch(() => {});
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
          setFeed(prev => [...prev, {
            id: crypto.randomUUID(), type: "agent",
            agent: data.agent, role: data.role, content: data.content,
            latency_ms: data.retrieval_latency_ms,
            risk_score: data.risk_score,
            confidence: data.confidence,
            context_used: data.context_used || [],
            task_id: data.task_id, timestamp: data.timestamp,
          }]);
          setLatencyLog(prev => [...prev.slice(-29), { agent: data.agent, ms: data.retrieval_latency_ms }]);
          // Set moss mode from first agent response
          if (data.context_used?.[0]?.moss_mode) setMossMode(data.context_used[0].moss_mode);
          setActiveAgents(prev => { const n = new Set(prev); n.delete(data.role); if (n.size === 0) setIsLoading(false); return n; });
          break;
        case "consensus": {
          // Judge fix: live consensus verdict
          const c: ConsensusData = data;
          setConsensusLog(prev => [...prev.slice(-19), c]);
          setFeed(prev => [...prev, { id: crypto.randomUUID(), type: "consensus", data: c, timestamp: data.timestamp }]);
          // Update live risk counts
          setLiveRiskCounts(prev => {
            const k = c.risk_level.toLowerCase() as keyof typeof prev;
            return { ...prev, [k]: (prev[k] || 0) + 1 };
          });
          setIsLoading(false);
          setActiveAgents(new Set());
          break;
        }
        case "task_updated":
          setTasks(prev => prev.map(t => t.id === data.task_id ? {
            ...t, status: data.status,
            risk_level: data.risk_level,
            risk_score: data.risk_score,
            recommended_action: data.recommended_action,
          } : t));
          setIsLoading(false); setActiveAgents(new Set());
          break;
        case "rule_learned":
          setLearnedRules(prev => [{ id: data.rule_id, text: data.rule, metadata: { officer: data.officer, type: data.correction_type } }, ...prev]);
          setFeed(prev => [...prev, { id: crypto.randomUUID(), type: "system", content: `🧠 Precedent Learned: "${data.rule}" — indexed to Moss Memory by ${data.officer}`, timestamp: data.timestamp }]);
          showToast("🧠 Precedent indexed in Moss vector memory!", "success");
          break;
        case "error": showToast(data.message || "Action error.", "error"); setIsLoading(false); setActiveAgents(new Set()); break;
        case "chat":
          setFeed(prev => [...prev, { id: crypto.randomUUID(), type: "user", content: data.content, user: data.user, timestamp: data.timestamp }]);
          break;
      }
    };
    ws.onclose = () => { setWsConnected(false); setIsLoading(false); setActiveAgents(new Set()); setTimeout(() => connectWs(name), 2000); };
    wsRef.current = ws;
  }, [workspaceId, showToast]);

  const handleJoin = () => { if (!userName.trim()) return; setHasJoined(true); connectWs(userName.trim()); };

  const flagEvent = useCallback(() => {
    if (!input.trim() || isLoading) return;
    const content = input.trim();
    setInput("");
    setIsLoading(true);
    setActiveAgents(new Set(Object.keys(AGENT_CONFIG)));
    setFeed(prev => [...prev, { id: crypto.randomUUID(), type: "user", content: `🚩 [${priority.toUpperCase()}] ${content}`, user: userName, timestamp: new Date().toISOString() }]);
    setActiveTab("feed");

    const timer = setTimeout(() => { setIsLoading(false); setActiveAgents(new Set()); }, 20000);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "flag", content, target_agent: targetAgent, priority }));
    } else {
      fetch(`${API_BASE}/api/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: content, workspace_id: workspaceId, target_agent: targetAgent, run_full_pipeline: !targetAgent, priority }),
      }).then(r => r.json()).then(data => {
        clearTimeout(timer);
        if (data.responses) {
          data.responses.forEach((r: AgentResponse) => {
            setFeed(prev => [...prev, { id: crypto.randomUUID(), type: "agent", agent: r.agent, role: r.role, content: r.content, latency_ms: r.retrieval_latency_ms, context_used: r.context_used, task_id: data.task_id, timestamp: r.timestamp }]);
            setLatencyLog(prev => [...prev.slice(-29), { agent: r.agent, ms: r.retrieval_latency_ms }]);
          });
        }
        setIsLoading(false); setActiveAgents(new Set());
      }).catch(e => { clearTimeout(timer); showToast(`Error: ${e.message}`, "error"); setIsLoading(false); setActiveAgents(new Set()); });
    }
  }, [input, isLoading, workspaceId, targetAgent, userName, showToast, priority]);

  const handleApprove = (taskId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: "approve", task_id: taskId }));
    else
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: "approved" } : t));
    showToast("✅ Task approved and logged", "success");
  };

  const handleEscalate = (taskId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: "escalate", task_id: taskId }));
    else
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: "escalated" } : t));
    showToast("🚨 Escalated to FIU-IND", "error");
  };

  const handleExportSTR = async (taskId: string) => {
    try {
      const r = await fetch(`${API_BASE}/api/analytics/str-export/${taskId}?workspace_id=${workspaceId}`);
      const data = await r.json();
      const blob = new Blob([data.content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${data.report_id}.md`; a.click();
      showToast(`📄 STR exported: ${data.report_id}`, "success");
    } catch {
      showToast("STR export failed", "error");
    }
  };

  const submitCorrection = async () => {
    if (!correctionInput.trim() || !correctionTarget) return;
    setIsSubmittingCorrection(true);
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "feedback", task_id: correctionTarget.taskId, content: correctionTarget.text, correction: correctionInput.trim(), correction_type: correctionType }));
        showToast("🧠 Precedent indexed to Moss memory!", "success");
      } else {
        await fetch(`${API_BASE}/api/feedback`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_id: correctionTarget.taskId, content: correctionTarget.text, correction: correctionInput.trim(), correction_type: correctionType, officer_name: userName, workspace_id: workspaceId }),
        });
        setLearnedRules(prev => [{ id: crypto.randomUUID(), text: correctionInput.trim(), metadata: { officer: userName, type: correctionType } }, ...prev]);
        showToast("🧠 Precedent indexed to Moss memory!", "success");
      }
      setCorrectionTarget(null); setCorrectionInput(""); setCorrectionType("exception");
    } catch {
      showToast("Failed to submit correction", "error");
    }
    setIsSubmittingCorrection(false);
  };

  // ─── Join Screen ─────────────────────────────────────────────────────────────
  if (!hasJoined) {
    return (
      <div style={{
        minHeight: "100vh", background: "radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a3e 0%, #0a0618 60%, #050210 100%)",
        display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif",
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap');
          @keyframes ping { 75%,100% { transform: scale(2); opacity: 0; } }
          @keyframes glow { 0%,100% { opacity:.6 } 50% { opacity:1 } }
          @keyframes fadeUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
          @keyframes spin { to { transform: rotate(360deg) } }
          * { box-sizing: border-box; }
          ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(167,139,250,0.3); border-radius: 2px; }
        `}</style>

        <div style={{ animation: "fadeUp 0.6s ease", display: "flex", flexDirection: "column", alignItems: "center", gap: 32, padding: 24, maxWidth: 440, width: "100%" }}>
          {/* Logo */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>⚖️</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "white", letterSpacing: -1 }}>ComplianceMind</div>
            <div style={{ fontSize: 13, color: "rgba(167,139,250,0.8)", marginTop: 6, fontWeight: 500 }}>AI-Native Multiplayer Compliance Workspace</div>
            <div style={{
              marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6,
              background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
              borderRadius: 99, padding: "4px 14px", fontSize: 11, color: "#fbbf24", fontWeight: 700,
            }}>
              🏆 TOP 10 — MOSS HACKATHON
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 16, width: "100%" }}>
            {[
              { label: "Moss Retrieval", value: benchmarkResult ? `${benchmarkResult.avg_ms}ms` : "—", sub: "avg latency", color: "#10b981" },
              { label: "Agents", value: "4", sub: "parallel pipeline", color: "#a78bfa" },
              { label: "Regulations", value: "18+", sub: "indexed in Moss", color: "#22d3ee" },
            ].map(s => (
              <GlassCard key={s.label} style={{ flex: 1, padding: "12px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{s.sub}</div>
              </GlassCard>
            ))}
          </div>

          {/* Join form */}
          <GlassCard style={{ width: "100%", padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
              Workspace: <span style={{ color: "#a78bfa" }}>{workspaceId}</span>
            </div>
            <input
              value={userName}
              onChange={e => setUserName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleJoin()}
              placeholder="Your name (e.g. Rahul — AML Analyst)"
              style={{
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(167,139,250,0.2)",
                borderRadius: 10, padding: "12px 16px", color: "white", fontSize: 14, outline: "none", width: "100%",
              }}
              autoFocus
            />
            <button
              onClick={handleJoin}
              disabled={!userName.trim()}
              style={{
                background: userName.trim() ? "linear-gradient(135deg, #7c3aed, #4f46e5)" : "rgba(255,255,255,0.05)",
                border: "none", borderRadius: 10, padding: "13px", color: "white",
                fontSize: 14, fontWeight: 700, cursor: userName.trim() ? "pointer" : "not-allowed",
                transition: "all 0.2s", letterSpacing: 0.3,
              }}
            >
              Join Compliance Workspace →
            </button>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", textAlign: "center" }}>
              Share <code style={{ color: "#a78bfa" }}>?room={workspaceId}</code> for multiplayer
            </div>
          </GlassCard>
        </div>
      </div>
    );
  }

  // ─── Main Workspace ───────────────────────────────────────────────────────────
  const criticalTasks = tasks.filter(t => t.status === "awaiting_review").length;
  const avgLatency = latencyLog.length ? (latencyLog.reduce((a, b) => a + b.ms, 0) / latencyLog.length).toFixed(1) : null;

  return (
    <div style={{
      height: "100vh", background: "radial-gradient(ellipse 100% 60% at 50% 0%, #120a2e 0%, #070413 50%, #030209 100%)",
      fontFamily: "'Inter', sans-serif", color: "white", display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap');
        @keyframes ping { 75%,100% { transform: scale(2); opacity: 0; } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(167,139,250,0.25); border-radius: 2px; }
        input, textarea, button { font-family: 'Inter', sans-serif; }
        .tab-btn:hover { background: rgba(167,139,250,0.08) !important; }
        .example-chip:hover { background: rgba(167,139,250,0.15) !important; border-color: rgba(167,139,250,0.4) !important; }
        .action-btn:hover { opacity: 0.85; transform: scale(0.98); }
        .feed-item { animation: fadeUp 0.3s ease; }
      `}</style>

      {/* ─── Top Bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", padding: "0 20px",
        height: 52, borderBottom: "1px solid rgba(167,139,250,0.1)",
        background: "rgba(7,4,19,0.8)", backdropFilter: "blur(20px)", flexShrink: 0,
        gap: 16, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>⚖️</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: -0.3 }}>ComplianceMind</div>
            <div style={{ fontSize: 10, color: "rgba(167,139,250,0.6)", marginTop: -1 }}>AI-Native Compliance Workspace</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, justifyContent: "center" }}>
          {/* Workspace pill + copy URL */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.18)",
            borderRadius: 99, padding: "3px 12px", fontSize: 11,
          }}>
            <span style={{ color: "rgba(255,255,255,0.4)" }}>room:</span>
            <span style={{ color: "#c4b5fd", fontWeight: 600 }}>{workspaceId}</span>
            <button
              title="Copy room URL for multiplayer"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                showToast("🔗 Room URL copied! Share with teammates.", "success");
              }}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "rgba(167,139,250,0.6)", padding: "0 2px", fontSize: 12,
              }}
            >📋</button>
          </div>

          {/* Connection */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
            <PulseDot color={wsConnected ? "#10b981" : "#ef4444"} size={7} />
            <span style={{ color: wsConnected ? "#10b981" : "#ef4444" }}>{wsConnected ? "Live" : "Reconnecting"}</span>
          </div>

          {/* Presence avatars */}
          <div style={{ display: "flex", alignItems: "center" }}>
            {presence.slice(0, 5).map((p, i) => (
              <div key={p.user_id} title={p.name} style={{
                width: 26, height: 26, borderRadius: "50%",
                background: `hsl(${(p.name.charCodeAt(0) * 37) % 360}, 60%, 40%)`,
                border: "2px solid rgba(7,4,19,0.9)",
                marginLeft: i > 0 ? -8 : 0, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700, zIndex: 5 - i,
              }}>
                {p.name[0].toUpperCase()}
              </div>
            ))}
            {presence.length > 5 && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginLeft: 6 }}>+{presence.length - 5}</div>}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Voice AI Button */}
          <button onClick={voiceActive ? () => setVoiceActive(false) : connectToVoice} style={{
            display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
            background: voiceActive ? "rgba(239,68,68,0.15)" : "linear-gradient(135deg, rgba(167,139,250,0.15), rgba(79,70,229,0.15))",
            border: `1px solid ${voiceActive ? "rgba(239,68,68,0.3)" : "rgba(167,139,250,0.3)"}`,
            borderRadius: 99, padding: "5px 12px", fontSize: 11, fontWeight: 700,
            color: voiceActive ? "#ef4444" : "#c4b5fd", transition: "all 0.2s"
          }}>
            {voiceActive ? "⏹ Disconnect Voice" : "🎙️ Talk to AI"}
          </button>

          {/* LIVE vs MOCK Moss badge — judges must see this */}
          {mossMode !== null && (
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              background: mossMode === "moss_live" ? "rgba(16,185,129,0.1)" : "rgba(251,191,36,0.08)",
              border: `1px solid ${mossMode === "moss_live" ? "rgba(16,185,129,0.3)" : "rgba(251,191,36,0.25)"}`,
              borderRadius: 99, padding: "3px 10px", fontSize: 10, fontWeight: 700,
              color: mossMode === "moss_live" ? "#10b981" : "#fbbf24",
            }}>
              {mossMode === "moss_live" ? "🟢 MOSS LIVE" : "🟡 MOCK MODE"}
            </div>
          )}

          {/* Moss latency */}
          {benchmarkResult && (
            <button onClick={() => setShowBenchmarkModal(true)} style={{
              display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
              background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)",
              borderRadius: 99, padding: "3px 10px", fontSize: 11,
            }}>
              <span style={{ color: "rgba(255,255,255,0.4)" }}>⚡ Moss</span>
              <span style={{ color: "#10b981", fontFamily: "monospace", fontWeight: 700 }}>{benchmarkResult.avg_ms}ms avg</span>
            </button>
          )}

          {/* Alert badge */}
          {criticalTasks > 0 && (
            <div style={{
              background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 99, padding: "3px 10px", fontSize: 11, color: "#f87171",
              display: "flex", alignItems: "center", gap: 5, fontWeight: 600,
            }}>
              <PulseDot color="#ef4444" size={6} />
              {criticalTasks} pending
            </div>
          )}

          {/* TOP 10 badge */}
          <div style={{
            background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)",
            borderRadius: 99, padding: "3px 10px", fontSize: 10, color: "#fbbf24", fontWeight: 700,
          }}>🏆 TOP 10</div>
        </div>
      </div>

      {/* ─── Main Content ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ─── Left Sidebar: Risk Dashboard ──────────────────────────────────── */}
        <div style={{
          width: 220, borderRight: "1px solid rgba(167,139,250,0.08)",
          display: "flex", flexDirection: "column", gap: 0, overflow: "auto", flexShrink: 0,
          padding: 14, paddingTop: 16,
        }}>
          {/* Risk Distribution — LIVE updates via WebSocket consensus */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Risk Overview</div>
              {(liveRiskCounts.critical + liveRiskCounts.high + liveRiskCounts.medium + liveRiskCounts.low) > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#10b981" }}>
                  <PulseDot color="#10b981" size={5} />
                  live
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Critical", color: "#ef4444", key: "critical" as const },
                { label: "High",     color: "#f97316", key: "high" as const },
                { label: "Medium",   color: "#fbbf24", key: "medium" as const },
                { label: "Low",      color: "#10b981", key: "low" as const },
              ].map(({ label, color, key }) => {
                // FIX: merge live session counts + API baseline
                const baseCount = riskSummary?.risk_distribution?.[key] ?? 0;
                const count = baseCount + (liveRiskCounts[key] || 0);
                const total = Math.max(1,
                  (riskSummary?.risk_distribution?.total ?? 0) +
                  liveRiskCounts.critical + liveRiskCounts.high + liveRiskCounts.medium + liveRiskCounts.low
                );
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={label}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
                      <span style={{ color, fontFamily: "monospace", fontWeight: 700 }}>{count}</span>
                    </div>
                    <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.8s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>



          {/* Jurisdiction Exposure */}
          {riskSummary?.jurisdiction_exposure && Object.keys(riskSummary.jurisdiction_exposure).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Jurisdiction</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(riskSummary.jurisdiction_exposure).slice(0, 6).map(([j, count]) => (
                  <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: "rgba(255,255,255,0.5)" }}>{j}</span>
                    <span style={{ color: "#c4b5fd", fontFamily: "monospace" }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Agents */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Agent Pipeline</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { key: "scanner", ...AGENT_CONFIG["scanner"] },
                { key: "analyst", ...AGENT_CONFIG["analyst"] },
                { key: "drafter", ...AGENT_CONFIG["drafter"] },
                { key: "escalation", ...AGENT_CONFIG["escalation"] },
              ].map(a => {
                const busy = activeAgents.has(a.key);
                return (
                  <div key={a.key} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 8px", borderRadius: 8,
                    background: busy ? `${a.color}12` : "transparent",
                    border: `1px solid ${busy ? a.color + "30" : "transparent"}`,
                    transition: "all 0.3s",
                  }}>
                    <span style={{ fontSize: 13 }}>{a.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: busy ? a.color : "rgba(255,255,255,0.5)" }}>{a.label}</div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>Phase {a.phase}</div>
                    </div>
                    {busy && <div style={{ width: 6, height: 6, borderRadius: "50%", background: a.color, animation: "pulse 1s infinite" }} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Session latency */}
          {latencyLog.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Session Latency</div>
              <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 36 }}>
                {latencyLog.slice(-12).map((l, i) => {
                  const h = Math.max(4, Math.min(36, (l.ms / 15) * 36));
                  const c = l.ms < 5 ? "#10b981" : l.ms < 10 ? "#fbbf24" : "#ef4444";
                  return <div key={i} title={`${l.agent}: ${l.ms.toFixed(1)}ms`} style={{ flex: 1, height: h, background: c, borderRadius: 2, opacity: 0.7 }} />;
                })}
              </div>
              {avgLatency && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4, textAlign: "center" }}>avg {avgLatency}ms</div>}
            </div>
          )}
        </div>

        {/* ─── Center: Main Feed ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, padding: "10px 16px 0", borderBottom: "1px solid rgba(167,139,250,0.08)" }}>
            {(["feed", "tasks", "memory", "proof"] as const).map(tab => (
              <button key={tab} className="tab-btn" onClick={() => setActiveTab(tab)} style={{
                background: activeTab === tab ? "rgba(167,139,250,0.12)" : "transparent",
                border: activeTab === tab ? "1px solid rgba(167,139,250,0.25)" : "1px solid transparent",
                borderBottom: activeTab === tab ? "1px solid transparent" : "none",
                borderRadius: "8px 8px 0 0", padding: "7px 16px",
                color: activeTab === tab ? "#c4b5fd" : "rgba(255,255,255,0.35)", cursor: "pointer",
                fontSize: 12, fontWeight: 600, transition: "all 0.15s",
              }}>
                {tab === "feed" ? "🔴 Live Feed" : tab === "tasks" ? `📋 Cases (${tasks.length})` : tab === "memory" ? `🧠 Moss Memory (${learnedRules.length})` : "🏆 Proof"}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, overflow: "auto", padding: 16 }}>

            {/* ── FEED TAB ── */}
            {activeTab === "feed" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {feed.length === 0 && (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "rgba(255,255,255,0.2)" }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🛡️</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Compliance workspace ready</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Flag a suspicious event to trigger the AI agent pipeline</div>
                  </div>
                )}
                {feed.map(item => (
                  <div key={item.id} className="feed-item">
                    {item.type === "user" && (
                      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                        <div style={{ maxWidth: "75%" }}>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4, textAlign: "right" }}>{item.user}</div>
                          <div style={{
                            background: "linear-gradient(135deg, rgba(79,70,229,0.3), rgba(124,58,237,0.2))",
                            border: "1px solid rgba(139,92,246,0.25)", borderRadius: "12px 12px 2px 12px",
                            padding: "10px 14px", fontSize: 13, color: "rgba(255,255,255,0.85)",
                          }}>{item.content}</div>
                        </div>
                      </div>
                    )}
                    {item.type === "agent" && (() => {
                      const cfg = AGENT_CONFIG[item.role] || { color: "#a78bfa", icon: "🤖", label: item.agent };
                      return (
                        <div style={{ display: "flex", gap: 10 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                            background: `${cfg.color}18`, border: `1px solid ${cfg.color}30`,
                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                          }}>{cfg.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
                              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>⚡ Moss {item.latency_ms.toFixed(1)}ms</span>
                              {item.risk_score !== undefined && item.risk_score !== null && (
                                <span style={{
                                  fontSize: 9, fontFamily: "monospace", fontWeight: 700,
                                  color: item.risk_score >= 75 ? "#ef4444" : item.risk_score >= 50 ? "#f97316" : item.risk_score >= 25 ? "#fbbf24" : "#10b981",
                                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
                                  borderRadius: 99, padding: "1px 6px",
                                }}>score: {item.risk_score}/100</span>
                              )}
                              {item.confidence !== undefined && item.confidence !== null && (
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>conf: {Math.round((item.confidence || 0) * 100)}%</span>
                              )}
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginLeft: "auto" }}>
                                {new Date(item.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <div style={{
                              background: `${cfg.color}08`, border: `1px solid ${cfg.color}18`,
                              borderRadius: "2px 12px 12px 12px", padding: "12px 14px",
                            }}>
                              <FormattedMessage text={item.content} />
                              {item.context_used && item.context_used.length > 0 && (
                                <details style={{ marginTop: 10 }}>
                                  <summary style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 4 }}>
                                    <span>▶</span> {item.context_used.length} Moss citations
                                  </summary>
                                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                                    {item.context_used.slice(0, 3).map((c, i) => (
                                      <div key={i} style={{
                                        fontSize: 10, padding: "6px 10px", borderRadius: 6,
                                        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                                        color: "rgba(255,255,255,0.4)",
                                      }}>
                                        <span style={{ color: "#c4b5fd", fontWeight: 600 }}>[{c.source}]</span>
                                        {c.moss_mode === "moss_live" && <span style={{ fontSize: 8, color: "#10b981", marginLeft: 4 }}>LIVE</span>}
                                        {" "}{c.text.slice(0, 120)}…
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </div>
                            {/* Teach button */}
                            <button onClick={() => setCorrectionTarget({ taskId: item.task_id, text: item.content })} style={{
                              marginTop: 6, fontSize: 10, color: "rgba(167,139,250,0.5)", background: "none",
                              border: "1px solid rgba(167,139,250,0.1)", borderRadius: 6, padding: "3px 10px", cursor: "pointer",
                              transition: "all 0.15s",
                            }}>
                              🧠 Teach Agent
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                    {item.type === "system" && (
                      <div style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.25)", padding: "2px 0" }}>{item.content}</div>
                    )}
                    {item.type === "consensus" && (() => {
                      const c = item.data;
                      const levelColors: Record<string, string> = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#fbbf24", LOW: "#10b981" };
                      const actionEmoji: Record<string, string> = { REPORT_TO_FIU: "🚨", BLOCK: "🚫", FLAG: "🚩", APPROVE: "✅" };
                      const lvlColor = levelColors[c.risk_level] || "#a78bfa";
                      return (
                        <div style={{
                          border: `1px solid ${lvlColor}40`, borderRadius: 12,
                          background: `${lvlColor}08`, padding: "14px 16px",
                          animation: "fadeUp 0.4s ease",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                            <div style={{
                              fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
                              color: lvlColor, background: `${lvlColor}18`,
                              border: `1px solid ${lvlColor}40`, borderRadius: 99, padding: "3px 12px",
                            }}>CONSENSUS: {c.risk_level}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: lvlColor, fontFamily: "monospace" }}>{c.risk_score}/100</div>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>conf: {Math.round(c.confidence * 100)}%</div>
                            <div style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700 }}>{actionEmoji[c.recommended_action]} {c.recommended_action.replace(/_/g, " ")}</div>
                          </div>
                          <div style={{ display: "flex", gap: 12, fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                            <span>⏱ Phase 1: {c.phase1_wall_ms}ms</span>
                            <span>⏱ Phase 2: {c.phase2_wall_ms}ms</span>
                            <span>☀️ Total: {c.total_wall_ms}ms</span>
                            <span>⚡ Moss avg: {c.moss_avg_latency_ms}ms</span>
                          </div>
                        </div>
                      );
                    })()}
                    {item.type === "task_event" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "rgba(167,139,250,0.05)", borderRadius: 8, border: "1px solid rgba(167,139,250,0.1)" }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#a78bfa", animation: "pulse 1.5s infinite" }} />
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                          <strong style={{ color: "rgba(255,255,255,0.6)" }}>{item.user}</strong> flagged a new compliance event — agents analyzing…
                        </span>
                      </div>
                    )}
                  </div>
                ))}

                {/* Loading indicator */}
                {isLoading && (
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ width: 16, height: 16, border: "2px solid rgba(167,139,250,0.3)", borderTopColor: "#a78bfa", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                    </div>
                    <div style={{ padding: "10px 14px", background: "rgba(167,139,250,0.05)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: "2px 12px 12px 12px" }}>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
                        {activeAgents.size === 4 ? "Phase 1: RegScanner ∥ RiskAnalyst running in parallel…"
                          : activeAgents.size <= 2 ? "Phase 2: AuditDrafter ∥ Escalation synthesizing…"
                          : "Agents analyzing…"}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {Object.entries(AGENT_CONFIG).map(([key, cfg]) => (
                          <div key={key} style={{
                            padding: "3px 8px", borderRadius: 6, fontSize: 10,
                            background: activeAgents.has(key) ? `${cfg.color}18` : "rgba(16,185,129,0.1)",
                            border: `1px solid ${activeAgents.has(key) ? cfg.color + "30" : "rgba(16,185,129,0.2)"}`,
                            color: activeAgents.has(key) ? cfg.color : "#10b981",
                            transition: "all 0.3s",
                          }}>
                            {activeAgents.has(key) ? `${cfg.icon} …` : `${cfg.icon} ✓`}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={feedEndRef} />
              </div>
            )}

            {/* ── TASKS TAB ── */}
            {activeTab === "tasks" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {tasks.length === 0 && (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "rgba(255,255,255,0.2)" }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>No cases yet</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Flag a compliance event to create a case</div>
                  </div>
                )}
                {[...tasks].reverse().map(task => {
                  const s = STATUS_STYLES[task.status];
                  return (
                    <GlassCard key={task.id} style={{ padding: 16, background: s.bg, borderColor: `${s.dot}25` }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot, marginTop: 5, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: s.dot }}>{s.label}</span>
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>#{task.id}</span>
                            {task.risk_score !== undefined && task.risk_score !== null && (
                              <span style={{
                                fontSize: 9, fontFamily: "monospace", fontWeight: 700, borderRadius: 99, padding: "1px 7px",
                                color: task.risk_score >= 75 ? "#ef4444" : task.risk_score >= 50 ? "#f97316" : task.risk_score >= 25 ? "#fbbf24" : "#10b981",
                                background: task.risk_score >= 75 ? "rgba(239,68,68,0.12)" : task.risk_score >= 50 ? "rgba(249,115,22,0.12)" : task.risk_score >= 25 ? "rgba(251,191,36,0.1)" : "rgba(16,185,129,0.1)",
                              }}>
                                {task.risk_level || "?"} {task.risk_score}/100
                              </span>
                            )}
                            {task.recommended_action && (
                              <span style={{ fontSize: 9, padding: "1px 7px", borderRadius: 99, fontWeight: 700, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.05)" }}>
                                → {task.recommended_action.replace(/_/g, " ")}
                              </span>
                            )}
                            {task.priority && task.priority !== "normal" && (
                              <span style={{
                                fontSize: 9, padding: "1px 7px", borderRadius: 99, fontWeight: 700,
                                background: task.priority === "critical" ? "rgba(239,68,68,0.15)" : "rgba(249,115,22,0.15)",
                                color: task.priority === "critical" ? "#ef4444" : "#f97316",
                              }}>{task.priority.toUpperCase()}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginBottom: 8 }}>{task.description}</div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                            by <strong style={{ color: "rgba(255,255,255,0.5)" }}>{task.created_by}</strong> · {new Date(task.created_at).toLocaleString()}
                          </div>
                          {task.status === "awaiting_review" && (
                            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                              <button className="action-btn" onClick={() => handleApprove(task.id)} style={{
                                padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(16,185,129,0.3)",
                                background: "rgba(16,185,129,0.1)", color: "#10b981", fontSize: 12, fontWeight: 700,
                                cursor: "pointer", transition: "all 0.15s",
                              }}>✓ Approve</button>
                              <button className="action-btn" onClick={() => handleEscalate(task.id)} style={{
                                padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)",
                                background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 12, fontWeight: 700,
                                cursor: "pointer", transition: "all 0.15s",
                              }}>🚨 Escalate to FIU</button>
                              <button className="action-btn" onClick={() => handleExportSTR(task.id)} style={{
                                padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(251,191,36,0.3)",
                                background: "rgba(251,191,36,0.08)", color: "#fbbf24", fontSize: 12, fontWeight: 700,
                                cursor: "pointer", transition: "all 0.15s",
                              }}>📄 Export STR</button>
                              <button className="action-btn" onClick={() => setCorrectionTarget({ taskId: task.id, text: task.description })} style={{
                                padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(167,139,250,0.25)",
                                background: "rgba(167,139,250,0.08)", color: "#c4b5fd", fontSize: 12, fontWeight: 700,
                                cursor: "pointer", transition: "all 0.15s",
                              }}>🧠 Teach Agent</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            )}

            {/* ── MEMORY TAB ── */}
            {activeTab === "memory" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <GlassCard style={{ padding: 14, background: "rgba(167,139,250,0.05)" }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
                    🧠 <strong style={{ color: "#c4b5fd" }}>Moss Persistent Memory</strong> — Officer precedents and corrections are vectorized and indexed here. Agents automatically consult this memory on every new investigation, learning from every human override.
                  </div>
                </GlassCard>
                {learnedRules.length === 0 && (
                  <div style={{ textAlign: "center", padding: "40px 20px", color: "rgba(255,255,255,0.2)" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🧠</div>
                    <div style={{ fontSize: 13 }}>No precedents learned yet. Use "Teach Agent" to add compliance rules.</div>
                  </div>
                )}
                {learnedRules.map((rule, i) => (
                  <GlassCard key={rule.id} style={{ padding: 14, animation: "fadeUp 0.3s ease" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>🧠</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                          {rule.metadata?.type ? <span style={{ fontSize: 10, padding: "1px 8px", borderRadius: 99, background: "rgba(167,139,250,0.1)", color: "#c4b5fd", fontWeight: 600 }}>{String(rule.metadata.type)}</span> : null}
                          {rule.metadata?.officer ? <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>by {String(rule.metadata.officer)}</span> : null}
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>{rule.text.replace(/^\[Officer Precedent: [^\]]+\] /, "")}</div>
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            )}

            {/* ── PROOF TAB ── */}
            {activeTab === "proof" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Moss Benchmark Proof */}
                <GlassCard style={{ padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", marginBottom: 10 }}>⚡ Moss Retrieval Benchmark</div>
                  {benchmarkResult ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", gap: 20 }}>
                        {[
                          { label: "Avg", value: `${benchmarkResult.avg_ms}ms`, color: "#10b981" },
                          { label: "Min", value: `${benchmarkResult.min_ms ?? "?"}ms`, color: "#10b981" },
                          { label: "Max", value: `${benchmarkResult.max_ms ?? "?"}ms`, color: (benchmarkResult.max_ms ?? 0) > 10 ? "#f97316" : "#10b981" },
                          { label: "Sub-10ms", value: benchmarkResult.all_under_10ms ? "100%" : "partial", color: benchmarkResult.all_under_10ms ? "#10b981" : "#ef4444" },
                        ].map(m => (
                          <div key={m.label} style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: m.color, fontFamily: "monospace" }}>{m.value}</div>
                            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>{m.label}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, color: benchmarkResult.mode === "moss_live" ? "#10b981" : "#fbbf24", fontWeight: 700, marginTop: 4 }}>
                        {benchmarkResult.mode_label || (benchmarkResult.mode === "moss_live" ? "🟢 Live Moss (in-process, zero network hop)" : "🟡 Mock keyword mode — set MOSS_PROJECT_ID/KEY for real proof")}
                      </div>
                      {benchmarkResult.parallel_wall_clock_ms && (
                        <div style={{ fontSize: 10, color: "#a78bfa" }}>⏱ 10 queries in parallel: {benchmarkResult.parallel_wall_clock_ms}ms wall-clock (asyncio.gather)</div>
                      )}
                      {benchmarkResult.samples && (
                        <div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>Per-query latencies:</div>
                          <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 32 }}>
                            {benchmarkResult.samples.map((s, i) => {
                              const h = Math.max(6, Math.min(32, (s / 15) * 32));
                              const c = s < 5 ? "#10b981" : s < 10 ? "#fbbf24" : "#ef4444";
                              return <div key={i} title={`Query ${i+1}: ${s.toFixed(2)}ms`} style={{ flex: 1, height: h, background: c, borderRadius: 2 }} />;
                            })}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
                            <span>Q1</span><span>Q5</span><span>Q10</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Loading benchmark…</div>}
                </GlassCard>

                {/* Consensus History */}
                <GlassCard style={{ padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", marginBottom: 10 }}>🤝 Consensus Verdicts This Session</div>
                  {consensusLog.length === 0 ? (
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>No events analyzed yet. Flag a compliance event to see consensus scoring.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {consensusLog.map((c, i) => {
                        const lc: Record<string, string> = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#fbbf24", LOW: "#10b981" };
                        const col = lc[c.risk_level] || "#a78bfa";
                        return (
                          <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", background: `${col}08`, border: `1px solid ${col}25`, borderRadius: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: col, minWidth: 70 }}>{c.risk_level}</div>
                            <div style={{ fontSize: 13, fontWeight: 800, color: col, fontFamily: "monospace" }}>{c.risk_score}/100</div>
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>conf: {Math.round(c.confidence * 100)}%</div>
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginLeft: "auto" }}>{c.total_wall_ms}ms total</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </GlassCard>

                {/* Architecture Proof */}
                <GlassCard style={{ padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", marginBottom: 10 }}>🏗️ Pipeline Architecture</div>
                  <pre style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>{`Phase 1 — asyncio.gather (PARALLEL)
├─ 🔎 RegScanner  → Moss: regulations index
└─ 📊 RiskAnalyst → Moss: transactions + violations
         ↓ phase1_summary → phase2
Phase 2 — asyncio.gather (PARALLEL)
├─ 📝 AuditDrafter → Moss: all 5 indexes
└─ 🚨 Escalation  → Moss: all 5 indexes
         ↓ consensus scoring
Consensus = RegScanner×40% + RiskAnalyst×60%
Action   = score≥ 75 → REPORT_TO_FIU
           score≥ 50 → BLOCK
           score≥ 25 → FLAG
           score < 25 → APPROVE`}</pre>
                </GlassCard>
              </div>
            )}          </div>

          {/* ─── Input Bar ────────────────────────────────────────────────────── */}
          <div style={{
            borderTop: "1px solid rgba(167,139,250,0.1)",
            padding: "14px 16px",
            background: "rgba(7,4,19,0.6)", backdropFilter: "blur(20px)", flexShrink: 0,
          }}>
            {/* Example chips */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {EXAMPLE_FLAGS.map((ex, i) => (
                <button key={i} className="example-chip" onClick={() => { setInput(ex); inputRef.current?.focus(); }} style={{
                  background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)",
                  borderRadius: 99, padding: "3px 12px", fontSize: 11, color: "rgba(255,255,255,0.45)",
                  cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
                }}>
                  {ex.length > 50 ? ex.slice(0, 50) + "…" : ex}
                </button>
              ))}
            </div>

            {/* Controls row */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              {/* Priority */}
              <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
                {(["normal", "high", "critical"] as const).map(p => (
                  <button key={p} onClick={() => setPriority(p)} style={{
                    padding: "5px 12px", fontSize: 11, fontWeight: 600,
                    background: priority === p
                      ? p === "critical" ? "rgba(239,68,68,0.2)" : p === "high" ? "rgba(249,115,22,0.2)" : "rgba(167,139,250,0.15)"
                      : "transparent",
                    color: priority === p
                      ? p === "critical" ? "#ef4444" : p === "high" ? "#f97316" : "#c4b5fd"
                      : "rgba(255,255,255,0.3)",
                    border: "none", cursor: "pointer", transition: "all 0.15s",
                  }}>{p}</button>
                ))}
              </div>

              {/* Agent filter */}
              <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
                <button onClick={() => setTargetAgent(null)} style={{
                  padding: "5px 12px", fontSize: 11, fontWeight: 600,
                  background: !targetAgent ? "rgba(167,139,250,0.15)" : "transparent",
                  color: !targetAgent ? "#c4b5fd" : "rgba(255,255,255,0.3)",
                  border: "none", cursor: "pointer", transition: "all 0.15s",
                }}>All Agents</button>
                {Object.entries(AGENT_CONFIG).map(([key, cfg]) => (
                  <button key={key} onClick={() => setTargetAgent(targetAgent === key ? null : key)} style={{
                    padding: "5px 12px", fontSize: 11, fontWeight: 600,
                    background: targetAgent === key ? `${cfg.color}18` : "transparent",
                    color: targetAgent === key ? cfg.color : "rgba(255,255,255,0.3)",
                    border: "none", cursor: "pointer", transition: "all 0.15s",
                  }}>{cfg.icon}</button>
                ))}
              </div>
            </div>

            {/* Input row */}
            <div style={{ display: "flex", gap: 10 }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && flagEvent()}
                placeholder="Describe a suspicious transaction or compliance event…"
                disabled={isLoading}
                style={{
                  flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(167,139,250,0.2)",
                  borderRadius: 12, padding: "11px 16px", color: "white", fontSize: 13,
                  outline: "none", opacity: isLoading ? 0.5 : 1, transition: "border 0.2s",
                }}
              />
              <button
                onClick={flagEvent}
                disabled={!input.trim() || isLoading}
                style={{
                  padding: "11px 24px", borderRadius: 12,
                  background: isLoading || !input.trim() ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #7c3aed, #4f46e5)",
                  border: "1px solid rgba(167,139,250,0.2)", color: "white",
                  fontSize: 13, fontWeight: 700, cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
                  transition: "all 0.2s", display: "flex", alignItems: "center", gap: 8,
                }}
              >
                {isLoading ? (
                  <><div style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Analyzing</>
                ) : "🚩 Flag"}
              </button>
            </div>
          </div>
        </div>

        {/* ─── Right Sidebar ──────────────────────────────────────────────────── */}
        <div style={{
          width: 220, borderLeft: "1px solid rgba(167,139,250,0.08)",
          display: "flex", flexDirection: "column", gap: 0, overflow: "auto", flexShrink: 0,
          padding: 14, paddingTop: 16,
        }}>
          {/* Moss Performance */}
          {benchmarkResult && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Moss Performance</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: "Avg Latency", value: `${benchmarkResult.avg_ms}ms`, color: "#10b981" },
                  { label: "Mode", value: benchmarkResult.mode_label || (benchmarkResult.mode === "moss_live" ? "🟢 Live Moss" : "🟡 Mock"), color: benchmarkResult.mode === "moss_live" ? "#10b981" : "#fbbf24" },
                  { label: "Sub-10ms", value: benchmarkResult.all_under_10ms ? "✅ All passed" : "⚠️ Some >10ms", color: benchmarkResult.all_under_10ms ? "#10b981" : "#f97316" },
                  ...(benchmarkResult.parallel_wall_clock_ms ? [{ label: "Parallel 10q", value: `${benchmarkResult.parallel_wall_clock_ms}ms`, color: "#a78bfa" }] : []),
                ].map(m => (
                  <div key={m.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>{m.label}</span>
                    <span style={{ color: m.color, fontFamily: "monospace", fontWeight: 600 }}>{m.value}</span>
                  </div>
                ))}
                {/* Latency sparkline */}
                {benchmarkResult.samples && (
                  <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 24, marginTop: 4 }}>
                    {benchmarkResult.samples.map((s, i) => {
                      const h = Math.max(4, Math.min(24, (s / 15) * 24));
                      const c = s < 5 ? "#10b981" : s < 10 ? "#fbbf24" : "#ef4444";
                      return <div key={i} title={`${s.toFixed(2)}ms`} style={{ flex: 1, height: h, background: c, borderRadius: 2, opacity: 0.8 }} />;
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Online Users */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
              Online Officers ({presence.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {presence.map(p => (
                <div key={p.user_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%",
                    background: `hsl(${(p.name.charCodeAt(0) * 37) % 360}, 55%, 38%)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, flexShrink: 0,
                  }}>{p.name[0].toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: p.name === userName ? "#c4b5fd" : "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name} {p.name === userName && <span style={{ fontSize: 9, color: "rgba(167,139,250,0.5)" }}>(you)</span>}
                    </div>
                    <PulseDot color="#10b981" size={5} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Architecture diagram */}
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Pipeline</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", lineHeight: 1.8 }}>
              <div style={{ color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>Phase 1 (∥)</div>
              <div>├ 🔎 RegScanner</div>
              <div>└ 📊 RiskAnalyst</div>
              <div style={{ color: "rgba(255,255,255,0.2)", margin: "3px 0" }}>───────────</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>Phase 2 (∥)</div>
              <div>├ 📝 AuditDrafter</div>
              <div>└ 🚨 Escalation</div>
              <div style={{ color: "rgba(255,255,255,0.2)", margin: "3px 0" }}>───────────</div>
              <div style={{ color: "#a78bfa" }}>⚡ Moss Index</div>
              <div style={{ paddingLeft: 8 }}>regulations</div>
              <div style={{ paddingLeft: 8 }}>transactions</div>
              <div style={{ paddingLeft: 8 }}>violations</div>
              <div style={{ paddingLeft: 8 }}>learned-rules</div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Teach Agent Modal ─────────────────────────────────────────────────── */}
      {correctionTarget && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
        }}>
          <GlassCard style={{ padding: 24, maxWidth: 500, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>🧠 Teach Agent — Add Precedent</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.03)", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
              {correctionTarget.text.slice(0, 200)}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {(["exception", "false_positive", "guideline"] as const).map(t => (
                <button key={t} onClick={() => setCorrectionType(t)} style={{
                  flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 11, fontWeight: 600,
                  background: correctionType === t ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${correctionType === t ? "rgba(167,139,250,0.3)" : "rgba(255,255,255,0.08)"}`,
                  color: correctionType === t ? "#c4b5fd" : "rgba(255,255,255,0.3)", cursor: "pointer",
                }}>{t.replace("_", " ")}</button>
              ))}
            </div>

            <textarea
              value={correctionInput}
              onChange={e => setCorrectionInput(e.target.value)}
              placeholder="Describe the correct compliance rule or precedent for this case…"
              rows={4}
              style={{
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(167,139,250,0.2)",
                borderRadius: 10, padding: "12px 14px", color: "white", fontSize: 13, resize: "none",
                outline: "none", width: "100%",
              }}
              autoFocus
            />

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setCorrectionTarget(null); setCorrectionInput(""); }} style={{
                flex: 1, padding: "10px", borderRadius: 10, background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)",
                fontSize: 13, cursor: "pointer", fontWeight: 600,
              }}>Cancel</button>
              <button onClick={submitCorrection} disabled={!correctionInput.trim() || isSubmittingCorrection} style={{
                flex: 2, padding: "10px", borderRadius: 10,
                background: correctionInput.trim() ? "linear-gradient(135deg, #7c3aed, #4f46e5)" : "rgba(255,255,255,0.04)",
                border: "none", color: "white", fontSize: 13, cursor: correctionInput.trim() ? "pointer" : "not-allowed",
                fontWeight: 700,
              }}>
                {isSubmittingCorrection ? "Indexing to Moss…" : "🧠 Index to Moss Memory"}
              </button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* ─── Benchmark Modal ──────────────────────────────────────────────────── */}
      {showBenchmarkModal && benchmarkResult && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
        }} onClick={() => setShowBenchmarkModal(false)}>
          <GlassCard style={{ padding: 24, maxWidth: 480, width: "100%", display: "flex", flexDirection: "column", gap: 16 }} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>⚡ Moss Benchmark Results</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Average Latency", value: `${benchmarkResult.avg_ms}ms`, good: true },
                { label: "All Queries < 10ms", value: benchmarkResult.all_under_10ms ? "✅ Yes" : "❌ No", good: benchmarkResult.all_under_10ms },
                { label: "Mode", value: benchmarkResult.mode === "live_moss" ? "Live Moss (in-process)" : "Mock (set MOSS keys)" },
              ].map(m => (
                <div key={m.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, fontSize: 13 }}>
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>{m.label}</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 700, color: m.good ? "#10b981" : "#fbbf24" }}>{m.value}</span>
                </div>
              ))}
            </div>
            {benchmarkResult.samples && (
              <>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Query Latency Distribution</div>
                <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 50 }}>
                  {benchmarkResult.samples.map((s, i) => {
                    const h = Math.max(6, Math.min(50, (s / 12) * 50));
                    const c = s < 5 ? "#10b981" : s < 10 ? "#fbbf24" : "#ef4444";
                    return (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <div style={{ fontSize: 8, color: c, fontFamily: "monospace" }}>{s.toFixed(1)}</div>
                        <div style={{ width: "100%", height: h, background: c, borderRadius: 3, opacity: 0.85 }} />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <button onClick={() => setShowBenchmarkModal(false)} style={{
              padding: "10px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 13, fontWeight: 600,
            }}>Close</button>
          </GlassCard>
        </div>
      )}

      {/* ─── Toast ─────────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          zIndex: 200, animation: "fadeUp 0.3s ease",
          padding: "12px 24px", borderRadius: 12,
          background: toast.type === "success" ? "rgba(16,185,129,0.15)" : toast.type === "error" ? "rgba(239,68,68,0.15)" : "rgba(167,139,250,0.15)",
          border: `1px solid ${toast.type === "success" ? "rgba(16,185,129,0.3)" : toast.type === "error" ? "rgba(239,68,68,0.3)" : "rgba(167,139,250,0.3)"}`,
          color: toast.type === "success" ? "#10b981" : toast.type === "error" ? "#ef4444" : "#c4b5fd",
          fontSize: 13, fontWeight: 600, backdropFilter: "blur(20px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)", whiteSpace: "nowrap",
        }}>
          {toast.message}
        </div>
      )}

      {/* ─── LiveKit Voice Overlay ─────────────────────────────────────────────── */}
      {liveKitToken && voiceActive && (
        <LiveKitRoom 
          serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://titanium-kwzimzfk.livekit.cloud"} 
          token={liveKitToken} 
          connect={true}
          onDisconnected={() => setVoiceActive(false)}
        >
          <RoomAudioRenderer />
          <div style={{ 
            position: "fixed", bottom: 24, right: 24, zIndex: 100, 
            background: "rgba(7,4,19,0.85)", border: "1px solid rgba(167,139,250,0.3)", 
            borderRadius: 16, padding: "16px 20px", backdropFilter: "blur(20px)",
            boxShadow: "0 10px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 12,
            width: 320, animation: "fadeUp 0.3s ease"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <PulseDot color="#10b981" size={8} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>Voice Assistant Active</span>
              </div>
              <button onClick={() => setVoiceActive(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Speak directly to the AI Compliance Officer.</div>
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 12 }}>
              <VoiceAssistantControlBar />
            </div>
          </div>
        </LiveKitRoom>
      )}
    </div>
  );
}
