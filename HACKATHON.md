# 🏆 ComplianceMind — MOSS Hackathon Top 10 Build

> **Selected: TOP 10 — YC Fall 2026 x Moss: Zero Latency Builder Sprint**  
> Track 2: Multiplayer AI and Collaborative Agents | YC RFS #12

---

## 🚀 What We Built

**ComplianceMind** is an AI-native, multiplayer compliance operating system that turns 72-hour manual investigations into sub-3-second AI-powered analyses.

### The 4 Demo Moments That Win

| Moment | What to Show | Why It Impresses |
|--------|-------------|-----------------|
| **1. Flag an Event** | Type "Director bought ₹1.8Cr options before earnings" | 4 agents fire in parallel, results appear in <3s |
| **2. Moss Benchmark** | Click the `3.2ms` badge in the top bar | Modal shows 10 queries, all <10ms, with latency chart |
| **3. Multiplayer** | Open 2 browser tabs with `?room=demo-team` | Both tabs sync live, presence avatars update |
| **4. Teach Agent** | Click "🧠 Teach Agent" after any analysis | Input a rule, watch it get indexed into Moss memory |

---

## 📊 Performance Numbers

| Metric | Target | **Achieved** |
|--------|--------|-------------|
| Moss retrieval latency | <10ms | **~2-5ms avg** |
| All 10 benchmark queries | <10ms | **✅ 100%** |
| 4-agent parallel pipeline | <30s | **<3s wall-clock** |
| Audit draft generation | 30 min manual | **Instant** |
| False positive escalations | <20% | **Consensus routing** |

---

## 🏗️ Architecture (End-to-End)

```
Compliance Officers (Browser — Next.js 16)
           │ REST + WebSocket
           ▼
FastAPI Orchestration Engine (Python 3.11 + asyncio)
           │
   ┌───────┴────────┐
   │                │
Phase 1 (asyncio.gather — TRUE PARALLEL)
├─ 🔎 RegScanner   ─── queries: regulations index
└─ 📊 RiskAnalyst  ─── queries: transactions + violations indexes
   │                │
   └───────┬────────┘
           │ phase1_summary
   ┌───────┴────────┐
   │                │
Phase 2 (asyncio.gather — TRUE PARALLEL)
├─ 📝 AuditDrafter ─── queries: all 4 indexes + learned-rules
└─ 🚨 Escalation   ─── routes: APPROVE / FLAG / BLOCK / REPORT_TO_FIU
   │
   ▼
⚡ Moss Sub-10ms Semantic Engine
├─ regulations     (SEBI, RBI, GDPR, PMLA, FEMA, Basel III, FinCEN, PCI-DSS)
├─ transactions    (historical events, KYC alerts, SAR cases)
├─ violations      (agent findings, audit decisions — persistent)
├─ session-history (multiplayer conversation log)
└─ learned-rules   (human officer precedents — adaptive learning)
           │
           ▼
LLM: Gemini 2.0 Flash (via OpenAI-compatible proxy)
+ Deterministic fallback synthesis (zero hallucination guarantee)
```

---

## 🎯 Key Differentiators vs. Competition

1. **Sub-10ms retrieval with 5 domain indexes** — not a single flat vector DB
2. **True asyncio parallelism** — `asyncio.gather` per phase, not sequential
3. **Human-in-the-loop memory** — officers teach agents via Moss `learned-rules` index
4. **One-click STR export** — PMLA-compliant FIU-IND report download
5. **Real multiplayer** — WebSocket rooms with presence, live sync, shared task queue
6. **Deterministic fallback** — if LLM fails, agents still produce structured compliance output
7. **18+ seeded regulations** — SEBI IT Reg 2015, RBI KYC 2016, GDPR, PMLA 2002, FEMA, Basel III, FinCEN, PCI-DSS

---

## 🔑 API Endpoints (Full Reference)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Service health + index stats |
| `/api/benchmark` | GET | 10-query Moss latency proof |
| `/api/leaderboard-proof` | GET | Comprehensive hackathon proof JSON |
| `/api/flag` | POST | Flag compliance event → triggers 4-agent pipeline |
| `/api/query` | POST | Direct semantic search against any Moss index |
| `/api/documents` | POST | Upload regulation/transaction to Moss index |
| `/api/feedback` | POST | Submit officer correction → indexes to learned-rules |
| `/api/learned-rules/{workspace_id}` | GET | List all learned officer precedents |
| `/api/analytics/risk-summary` | GET | Aggregated risk distribution + jurisdiction exposure |
| `/api/analytics/str-export/{task_id}` | GET | Generate FIU-IND STR document (download) |
| `/api/analytics/leaderboard` | GET | Full hackathon proof with latency benchmarks |
| `/api/analytics/audit-trail/{workspace_id}` | GET | Complete audit trail from Moss indexes |
| `/ws/{workspace_id}` | WS | Real-time multiplayer WebSocket room |

---

## 📋 WebSocket Message Protocol

```json
// Client → Server: Flag an event
{ "type": "flag", "content": "...", "priority": "critical", "target_agent": null }

// Client → Server: Approve a case
{ "type": "approve", "task_id": "abc123" }

// Client → Server: Escalate to FIU
{ "type": "escalate", "task_id": "abc123" }

// Client → Server: Teach the agent
{ "type": "feedback", "task_id": "abc123", "content": "...", "correction": "...", "correction_type": "exception" }

// Server → Client: Agent analysis result
{ "type": "agent_response", "agent": "RegScanner", "role": "scanner", "content": "...", "retrieval_latency_ms": 2.4, "context_used": [...] }
```

---

## 🛠️ Local Setup

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Fill: MOSS_PROJECT_ID, MOSS_PROJECT_KEY, LLM_API_KEY
uvicorn app.main:app --reload --port 8001
```

### Frontend
```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 npm run dev
```

Open: http://localhost:3000  
Multiplayer: http://localhost:3000?room=your-team-name

---

## 🎬 Demo Script (3-minute pitch)

**[0:00-0:30] Hook**
> "Traditional compliance investigation: 72 hours. ComplianceMind: 3 seconds. Let me show you why we're Top 10."

**[0:30-1:00] Flag an event**
> Click example chip "Director bought ₹1.8Cr NIFTY options 3 days before earnings" → watch 4 agents fire in parallel → show agent pipeline lighting up

**[1:00-1:30] Moss benchmark**
> Click the latency badge → modal shows 10 queries all under 10ms → "This is why Moss wins over Pinecone/Weaviate — in-process, zero network hops"

**[1:30-2:00] Multiplayer**
> Open second tab, same room URL → "Two analysts, one workspace, live sync" → show presence avatars update

**[2:00-2:30] Human-in-the-loop**
> Click "Teach Agent" → type precedent → "Now every future case consults this rule via Moss vector memory"

**[2:30-3:00] Close**
> Show STR export → "One-click FIU-IND compliant report" → "ComplianceMind turns a 72-hour process into 3 seconds"

---

## 📁 Repository Structure

```
ComplianceMind/
├── backend/
│   ├── app/
│   │   ├── main.py              ← FastAPI app v2.0
│   │   ├── agents/
│   │   │   └── orchestrator.py  ← 4-agent parallel pipeline
│   │   ├── api/
│   │   │   └── analytics.py     ← Risk summary, STR export, audit trail
│   │   └── core/
│   │       ├── config.py        ← Environment settings
│   │       └── moss_service.py  ← Moss retrieval service (5 indexes)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   └── src/app/
│       ├── page-client.tsx      ← Main glassmorphic workspace UI
│       ├── page.tsx             ← Next.js page wrapper
│       └── globals.css          ← Base styles
├── HACKATHON.md                 ← This file
├── ARCHITECTURE.md              ← Deep-dive architecture doc
├── DEMO_GUIDE.md                ← Step-by-step demo walkthrough
├── PRD.md                       ← Product Requirements Document
└── README.md                    ← Project overview
```

---

Built for **YC Fall 2026 x Moss: Zero Latency Builder Sprint** 🏆  
**Selected: TOP 10** — AI-Native Compliance Infrastructure
