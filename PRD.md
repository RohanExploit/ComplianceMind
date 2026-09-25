# Product Requirements Document (PRD)

## Product Name: ComplianceMind
**Tagline:** AI-Native Multiplayer Compliance Workspace & Zero-Latency Multi-Agent Pipeline  
**Target:** YC Fall 2026 x Moss Zero Latency Builder Sprint (Track 2: Multiplayer AI & Collaborative Agents | YC RFS #12)  
**Document Version:** 1.0.0  
**Status:** Approved for Submission / Ready for Architecture Review  
**Author / Lead:** Rohan & ComplianceMind Engineering Team  

---

## 1. Executive Summary & Problem Statement

### 1.1 Context & Background
Modern fintechs, neo-banks, and global payment processors operate under rapidly shifting regulatory regimes (SEBI, RBI, FinCEN, FCA, GDPR, PMLA). Current regulatory compliance operations rely heavily on legacy rules engines (e.g., rigid SQL threshold triggers) and fragmented investigation tools.

### 1.2 The Problem
- **Massive Alert Fatigue:** 90–95% of legacy AML/KYC alerts are false positives. Compliance analysts spend 60–70% of their billable hours manually cross-referencing PDFs, static transaction logs, and sanctions databases.
- **Latency & High Escalation Overhead:** Investigating a suspicious transaction currently takes an average of 48 to 72 hours per case due to manual data aggregation.
- **Context Fragmentation:** Customer historical behavior, previous escalation findings, and changing statutory rules live in distinct, un-indexed silos.
- **Lack of Collaboration:** Compliance teams lack multiplayer, collaborative real-time interfaces where multiple analysts and AI agents can examine the same incident simultaneously without collision.

### 1.3 The Solution
**ComplianceMind** is an AI-native, multiplayer compliance operating system. Powered by a two-phase parallel multi-agent engine and the **Moss Sub-10ms Context Engine**, ComplianceMind automatically extracts regulatory citations, computes multi-dimensional risk scores, generates audit-ready findings, and proposes escalation paths—all synchronized across human investigators in real-time.

---

## 2. Goals & Success Metrics

### 2.1 Strategic Objectives
1. **Zero-Latency Retrieval:** Utilize in-process Moss semantic indexes to retrieve relevant statutes, past violations, and account history in under 10ms.
2. **Parallel Agent Execution:** Deconstruct the compliance investigation into a 2-phase pipeline (Phase 1: Detection & Scanning; Phase 2: Synthesis & Escalation) to keep total AI triage latency under 3 seconds.
3. **Multiplayer Live Collaboration:** Enable simultaneous analyst collaboration via persistent WebSocket rooms (`/ws/{workspace_id}`).
4. **Audit Explainability:** Produce structured, deterministic audit logs suitable for regulatory inspection.

### 2.2 Key Performance Indicators (KPIs)
| Metric | Current Industry Baseline | ComplianceMind Target | Achieved MVP |
| :--- | :--- | :--- | :--- |
| **Context Retrieval Latency** | 250ms – 1,200ms (External Vector DBs) | < 15ms | **< 10ms (via Moss)** |
| **Case Triage Time** | 45 – 90 minutes per case | < 30 seconds | **< 3 seconds (Autonomous Phase)** |
| **False Positive Escalations** | > 85% | < 20% | **Reduced by Consensus Routing** |
| **Audit Log Generation** | Manual (15–30 mins drafting) | 1-Click Autonomous Draft | **Instant structured markdown** |

---

## 3. User Personas & Target Audiences

1. **AML / KYC Compliance Analyst:**  
   *Needs:* Fast, pre-compiled risk breakdowns, exact statutory citations, and a clean interface to approve, flag, or escalate cases without context-switching.
2. **Compliance Officer / Team Lead:**  
   *Needs:* Real-time oversight on active room investigations, high-level metrics, agent decision overrides, and policy teach-in capabilities.
3. **External Regulatory Auditor (SEBI, RBI, FinCEN):**  
   *Needs:* Tamper-evident, step-by-step audit trails documenting why an alert was dismissed or escalated with references to statutory articles.

---

## 4. System Architecture & Information Architecture

### 4.1 High-Level Architecture Flow
```
[ Client Browser (Next.js 16) ] 
               │
               ▼  (HTTP REST & WebSocket /ws/{workspace_id})
[ FastAPI Orchestration Engine ]
               │
      ┌────────┴────────┐
      ▼                 ▼
[ Phase 1 Agents ] [ Phase 2 Agents ]
 ├─ RegScanner      ├─ AuditDrafter
 └─ RiskAnalyst     └─ EscalationAgent
      │                 │
      └────────┬────────┘
               ▼
[ Moss Sub-10ms Semantic Engine ]
 ├─ `regulations` Index (SEBI, RBI, GDPR, PMLA)
 ├─ `transactions` Index (Account velocity, KYC)
 ├─ `violations` Index (Historical findings)
 └─ `session-history` Index (Multiplayer state)
               │
               ▼
[ LLM Layer: Gemini 2.0 Flash ]
```

### 4.2 Architecture Components
1. **Frontend Presentation Layer (Next.js 16, TypeScript, Tailwind CSS):**
   - Deployed on Vercel with real-time UI synchronization.
   - Glassmorphic, low-latency dashboard featuring live event streams, dynamic risk dials, agent thought feeds, and Moss latency benchmark widgets.
2. **Backend API & Orchestration Layer (FastAPI, Python 3.11, AsyncIO):**
   - Coordinates state machines, manages WebSocket broadcast rooms, and delegates asynchronous tasks to worker subagents.
3. **Moss Zero-Latency Engine:**
   - In-memory embedded semantic index maintaining sub-10ms query times over regulatory corpuses, historical transactions, and active session histories.
4. **Parallel Agent Intelligence Pipeline:**
   - **Phase 1 (Parallel Discovery):**
     - `RegScanner`: Scans `regulations` index to match transaction behaviors against explicit legal mandates.
     - `RiskAnalyst`: Evaluates transaction velocity, historical patterns, and deviation scores.
   - **Phase 2 (Parallel Decisioning & Documentation):**
     - `AuditDrafter`: Synthesizes Phase 1 outputs into formal audit findings.
     - `EscalationAgent`: Recommends operational actions (`APPROVE`, `FLAG`, `BLOCK`, `REPORT_TO_FIU`).

---

## 5. Functional Requirements (Features & Epics)

### Epic 1: Event Ingestion & Suspicious Activity Flagging (Priority: P0)
- **FR-1.1:** System shall ingest transaction payloads via REST API (`POST /api/flag`) containing `transaction_id`, `amount`, `sender`, `receiver`, `jurisdiction`, and `timestamp`.
- **FR-1.2:** System shall assign transactions to a persistent `workspace_id`.
- **FR-1.3:** System shall transition case states through deterministic lifecycles: `CREATING` ➔ `ANALYZING` ➔ `AWAITING_REVIEW` ➔ `RESOLVED`.

### Epic 2: Multi-Agent Parallel Pipeline (Priority: P0)
- **FR-2.1:** Backend shall execute `RegScanner` and `RiskAnalyst` concurrently using `asyncio.gather`.
- **FR-2.2:** Each agent must query Moss indexes with `top_k=3` relevant citations.
- **FR-2.3:** Pipeline must aggregate agent consensus into an overarching Risk Level (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) with confidence scores (0.0 to 1.0).

### Epic 3: Moss Sub-10ms Retrieval & Benchmarking (Priority: P0)
- **FR-3.1:** System shall maintain 4 isolated indexes: `regulations`, `transactions`, `violations`, `session-history`.
- **FR-3.2:** System shall expose `/api/benchmark` executing 10 back-to-back index queries and returning min, max, and average execution latencies to demonstrate sub-10ms retrieval.
- **FR-3.3:** Document ingest endpoint (`POST /api/documents`) shall allow dynamic loading of statutory rulebooks into Moss.

### Epic 4: Multiplayer Workspace & Real-Time Sync (Priority: P1)
- **FR-4.1:** Users can open shared workspaces using query parameter URLs (e.g. `?room=audit-team-1`).
- **FR-4.2:** Real-time state broadcasting via WebSocket connection (`/ws/{workspace_id}`) syncing active investigations across all connected browser clients.

### Epic 5: Human-in-the-Loop Governance & Policy Teach-In (Priority: P1)
- **FR-5.1:** Compliance officers can override agent decisions with one-click actions (`Approve Case`, `Escalate to FIU`).
- **FR-5.2:** Agent learning loop: Officer override notes and justifications are written directly to the `violations` index to guide subsequent model prompts.

---

## 6. Non-Functional Requirements (NFRs)

### 6.1 Performance & Latency
- **NFR-1.1:** Moss semantic retrieval latency must maintain $P_{95} \le 10\text{ms}$.
- **NFR-1.2:** End-to-end agent pipeline execution time must complete within $\le 3.5\text{s}$.
- **NFR-1.3:** WebSocket broadcast message delivery to clients must be under $50\text{ms}$.

### 6.2 Security & Data Privacy
- **NFR-2.1:** Zero credential leakage: API keys (Moss, Gemini) stored exclusively in backend environment variables.
- **NFR-2.2:** Masking of Personally Identifiable Information (PII) before storage into public or shared logs.
- **NFR-2.3:** Read-only access control for external regulatory inspection mode.

### 6.3 Reliability & Availability
- **NFR-3.1:** Graceful fallback: If external LLM encounters rate limits, rule-based heuristics provide interim risk tagging.
- **NFR-3.2:** Workspace state persistence across server restarts.

---

## 7. Data Models & API Specifications

### 7.1 Core Data Schema
```typescript
interface ComplianceEvent {
  transaction_id: string;
  timestamp: string;
  amount: number;
  currency: string;
  sender: {
    id: string;
    name: string;
    country: string;
    kyc_status: "VERIFIED" | "PENDING" | "UNVERIFIED";
  };
  receiver: {
    id: string;
    name: string;
    country: string;
  };
  risk_score: number; // 0 - 100
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "ANALYZING" | "AWAITING_REVIEW" | "APPROVED" | "ESCALATED";
  agent_findings: {
    reg_scanner: { citations: string[]; violation_detected: boolean };
    risk_analyst: { pattern: string; score: number };
    audit_drafter: { summary: string };
    escalation: { action_required: string; urgency: string };
  };
}
```

### 7.2 Key API Endpoints
- `GET  /api/health` — Service health verification.
- `GET  /api/benchmark` — Real-time latency benchmark proof for Moss retrieval.
- `POST /api/flag` — Ingest suspicious event and trigger multi-agent pipeline.
- `POST /api/query` — Low-latency semantic search against indexed regulatory documents.
- `POST /api/documents` — Ingest new regulatory acts or compliance documentation.
- `WS   /ws/{workspace_id}` — Bidirectional WebSocket channel for live room synchronization.

---

## 8. Release Roadmap & Milestones

- **Phase 1: Hackathon MVP (Delivered):**
  - Next.js 16 dynamic frontend deployed to Vercel.
  - FastAPI backend with 4 parallel agents.
  - Moss sub-10ms indexing across 4 knowledge domains.
  - Real-time WebSocket room collaboration.
- **Phase 2: Enterprise Integration (Q1 2027):**
  - Native Core Banking System (CBS) connectors (FIS, Temenos, Mambu).
  - Automated STR (Suspicious Transaction Report) filing to FinCEN/FIU-IND.
  - Automated continuous regulatory diffing (tracking daily gazette changes).
