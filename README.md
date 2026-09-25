# ⚖️ ComplianceMind — AI-Native Compliance Workspace

<div align="center">

**🏆 TOP 10 — YC Fall 2026 x Moss: Zero Latency Builder Sprint**

[![Moss](https://img.shields.io/badge/Powered%20by-Moss%20Sub--10ms-10b981?style=for-the-badge)](https://moss.dev)
[![Track](https://img.shields.io/badge/Track%202-Multiplayer%20AI-7c3aed?style=for-the-badge)](.)
[![RFS](https://img.shields.io/badge/YC%20RFS%20%2312-AI%20Compliance-fbbf24?style=for-the-badge)](.)

*Turning 72-hour manual compliance investigations into sub-3-second AI analyses.*

</div>

---

## The Problem

Compliance teams spend 60–70% of their time manually searching regulations, cross-referencing transaction logs, and writing audit reports. A single suspicious transaction investigation takes **48–72 hours**. 90–95% of AML alerts are false positives.

## The Solution

**ComplianceMind** is a real-time multiplayer workspace where compliance officers and AI agents collaborate on regulatory monitoring.

**Flag a suspicious event → 4 specialized agents analyze it in parallel using Moss semantic search across 5 compliance indexes → structured audit finding in under 3 seconds.**

---

## Architecture

```
Compliance Officers (Browser)         ?room=workspace-id (multiplayer)
         │                                     │
         └──────────── WebSocket ──────────────┘
                           │
                FastAPI Orchestration Engine (v2.0)
                           │
         ┌─────────────────┼─────────────────────┐
         │         PHASE 1: PARALLEL              │
    ┌────▼────┐                          ┌────────▼────────┐
    │RegScanner│                          │  RiskAnalyst    │
    │ (SEBI,   │                          │  (patterns,     │
    │  RBI,    │                          │   risk score,   │
    │  GDPR,   │                          │   history)      │
    │  PMLA…)  │                          │                 │
    └────┬─────┘                          └────────┬────────┘
         └──────────────┬─────────────────────────┘
                        │ phase1_summary
         ┌──────────────┼─────────────────────────┐
         │         PHASE 2: PARALLEL              │
    ┌────▼──────┐                       ┌──────────▼──────┐
    │AuditDrafter│                       │  Escalation     │
    │ (formal    │                       │  (APPROVE /     │
    │  finding,  │                       │   BLOCK /       │
    │  SLA)      │                       │   REPORT_FIU)   │
    └────┬──────┘                       └──────────┬──────┘
         └─────────────────┬────────────────────────┘
                           │
                ┌──────────▼──────────┐
                │  MOSS INDEXES        │  ← Sub-10ms retrieval
                │ regulations (18+)    │
                │ transactions (9+)    │
                │ violations           │
                │ session-history      │
                │ learned-rules ←NEW   │
                └──────────────────────┘
                           │
                  Gemini 2.0 Flash LLM
                  + Deterministic Fallback
```

---

## Key Features

### ⚡ Moss Sub-10ms Retrieval
- 5 domain-specific indexes: `regulations`, `transactions`, `violations`, `session-history`, `learned-rules`
- All queries achieve P95 ≤ 10ms via Moss in-process semantic search
- Each agent fires parallel index queries with `asyncio.gather`

### 🤝 True Multiplayer
- WebSocket rooms (`/ws/{workspace_id}`) — persistent, survive server restarts
- Presence tracking, live task sync, real-time agent result broadcast
- Share any workspace: `http://localhost:3000?room=your-team`

### 🧠 Human-in-the-Loop Learning
- Officers can correct agent decisions with "Teach Agent"
- Corrections are vectorized and stored in `learned-rules` Moss index
- All future agents query learned-rules with a 0.35 relevance boost — adaptive improvement

### 📋 Compliance Actions
- ✅ **Approve** — case closed, logged to audit trail
- 🚨 **Escalate to FIU** — logged to violations index, FIU-IND notification
- 📄 **Export STR** — one-click PMLA-compliant Suspicious Transaction Report
- 🧠 **Teach Agent** — add officer precedent to Moss memory

### 📊 Risk Dashboard
- Real-time risk distribution (Critical / High / Medium / Low)
- Jurisdiction exposure map (SEBI, RBI, GDPR, PMLA, etc.)
- Moss latency sparklines, agent pipeline visualization

---

## Quick Start

### Prerequisites
- Python 3.10+ | Node.js 20+
- **Moss account:** [moss.dev](https://moss.dev) for `MOSS_PROJECT_ID` + `MOSS_PROJECT_KEY`
- **LLM key:** via OpenAI-compatible proxy

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Set: MOSS_PROJECT_ID, MOSS_PROJECT_KEY, LLM_API_KEY
uvicorn app.main:app --reload --port 8001
```

### Frontend
```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 npm run dev
```

Open **http://localhost:3000**

Multiplayer: **http://localhost:3000?room=your-team**

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health + index stats |
| `/api/benchmark` | GET | 10-query Moss latency proof |
| `/api/leaderboard-proof` | GET | Full hackathon proof JSON |
| `/api/flag` | POST | Flag event → 4-agent pipeline |
| `/api/query` | POST | Direct Moss semantic search |
| `/api/documents` | POST | Upload regulation/transaction |
| `/api/feedback` | POST | Submit officer correction |
| `/api/analytics/risk-summary` | GET | Risk distribution dashboard |
| `/api/analytics/str-export/{id}` | GET | Generate FIU-IND STR report |
| `/api/analytics/leaderboard` | GET | Comprehensive perf benchmarks |
| `/api/analytics/audit-trail/{wid}` | GET | Complete audit trail |
| `/ws/{workspace_id}` | WS | Real-time multiplayer room |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 + TypeScript (glassmorphic UI) |
| Backend | FastAPI (Python 3.11) + asyncio |
| Retrieval | **Moss** (sub-10ms semantic search, 5 indexes) |
| Agents | 4-agent parallel orchestration (asyncio.gather) |
| LLM | Gemini 2.0 Flash + deterministic fallback |
| Real-time | WebSockets (per workspace room) |
| Reports | Markdown STR export (PMLA / FIU-IND format) |

---

## Moss Indexes

| Index | Content | Key Regulations |
|-------|---------|-----------------|
| `regulations` | 18+ statutory rules | SEBI, RBI, GDPR, PMLA, FEMA, Basel III, FinCEN, PCI-DSS |
| `transactions` | 9+ sample events | Insider trading, KYC alerts, structuring patterns, shell companies |
| `violations` | Agent findings (live) | Appended every analysis run |
| `session-history` | Workspace conversations | Per-room, persistent |
| `learned-rules` | Officer precedents | Human-taught, priority-boosted |

---

## Performance Results

```
Moss Benchmark (10 queries):
  avg:  2.8ms  ✅
  min:  1.2ms  ✅  
  max:  8.4ms  ✅
  all under 10ms: True ✅

4-Agent Pipeline (wall-clock):
  Phase 1 (RegScanner ∥ RiskAnalyst): ~1.2s
  Phase 2 (AuditDrafter ∥ Escalation): ~1.1s
  Total: ~2.3s (vs. 72-hour manual baseline)
```

---

## Documentation

- [`HACKATHON.md`](./HACKATHON.md) — Demo script, pitch guide, API reference
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Deep-dive system architecture  
- [`PRD.md`](./PRD.md) — Full Product Requirements Document
- [`CHECKPOINT.md`](./CHECKPOINT.md) — Development progress log

---

<div align="center">

Built for **YC Fall 2026 x Moss: Zero Latency Builder Sprint** 🏆  
**Selected: TOP 10** | Track 2: Multiplayer AI | YC RFS #12: AI-Native Compliance Infrastructure

</div>
