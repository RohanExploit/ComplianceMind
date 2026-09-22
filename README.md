# 🔍 ComplianceMind — AI-Native Compliance Workspace

> **YC Fall 2026 x Moss: Zero Latency Builder Sprint**  
> **Track 2: Multiplayer AI and Collaborative Agents**  
> **YC RFS #12: AI-Native Compliance Infrastructure**

---

## The Problem

Compliance teams spend 60-70% of their time manually searching regulations, cross-referencing transaction logs, and writing audit reports. Traditional tools are slow, siloed, and require an expert for every query.

## The Solution

**ComplianceMind** is a real-time multiplayer workspace where compliance officers and AI agents collaborate on regulatory monitoring. Flag a suspicious event → 4 specialized agents analyze it **in parallel** using Moss semantic search across regulation databases, transaction history, and audit trails — in under 10ms per retrieval.

---

## Architecture

```
Compliance Officers (Browser)    Workspace URL: /ws/{workspace_id}
        │                                │
        └──────────── WebSocket ─────────┘
                          │
               FastAPI Orchestration Layer
                          │
        ┌─────────────────┼────────────────┐
        │         PARALLEL PHASE 1         │
   ┌────▼────┐                      ┌──────▼──────┐
   │RegScanner│                      │ RiskAnalyst │
   │ (SEBI,  │                      │ (pattern    │
   │  RBI,   │                      │  matching,  │
   │  GDPR)  │                      │  risk score)│
   └────┬────┘                      └──────┬──────┘
        └─────────────┬────────────────────┘
                      │ Phase 1 results
        ┌─────────────┼────────────────┐
        │         PARALLEL PHASE 2     │
   ┌────▼────┐                  ┌──────▼──────┐
   │AuditDraft│                  │ Escalation  │
   │ (formal │                  │ (who to     │
   │  finding)│                  │  notify)    │
   └────┬────┘                  └──────┬──────┘
        └─────────────┬────────────────┘
                      │
              ┌───────▼────────┐
              │  MOSS INDEXES  │  ← Sub-10ms retrieval
              │ regulations    │
              │ transactions   │
              │ violations     │
              │ session-history│
              └────────────────┘
```

### Key Architecture Properties
- **Parallel agents**: Phase 1 (RegScanner ∥ RiskAnalyst) + Phase 2 (AuditDrafter ∥ Escalation)
- **Persistent workspaces**: Every document tagged with `workspace_id` — rooms survive restarts
- **Real multiplayer**: Multiple humans in one room via `?room=workspace-id` URL
- **Task lifecycle**: Creating → Analyzing → Awaiting Review → Approved/Escalated

---

## Quick Start

### Prerequisites
- Python 3.10+ | Node.js 20+
- Moss account: [moss.dev](https://moss.dev) for `project_id` + `project_key`
- Gemini API key: [Google AI Studio](https://aistudio.google.com/)

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env  # Fill in MOSS_PROJECT_ID, MOSS_PROJECT_KEY, GOOGLE_API_KEY
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Create a shared workspace
```
http://localhost:3000?room=my-team
```
Share this URL with teammates — everyone joins the same compliance workspace.

---

## Moss Integration

| Index | Content | Agents that read it |
|-------|---------|---------------------|
| `regulations` | SEBI, RBI, GDPR, FEMA, PMLA rules | RegScanner |
| `transactions` | Company transactions, KYC records | RiskAnalyst |
| `violations` | Agent findings, audit decisions | All agents |
| `session-history` | Human + agent conversation | All agents |

```python
# All 4 Moss indexes queried in parallel per agent:
results = await asyncio.gather(
    moss_service.query("regulations", query, top_k=3),
    moss_service.query("transactions", query, top_k=3),
    moss_service.query("violations", query, top_k=3),
)
# Total latency: <10ms (Moss in-process, no network hops)
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/benchmark` | GET | Run 10 Moss queries, return latency proof |
| `/api/flag` | POST | Flag a compliance event, trigger agents |
| `/api/query` | POST | Direct Moss semantic search |
| `/api/documents` | POST | Upload regulation/transaction to Moss |
| `/ws/{workspace_id}` | WS | Real-time multiplayer workspace |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 + TypeScript + Tailwind |
| Backend | FastAPI (Python) + asyncio |
| Retrieval | **Moss** (sub-10ms semantic search) |
| Agents | LangGraph-inspired parallel orchestration |
| LLM | Gemini 2.0 Flash |
| Real-time | WebSockets (per workspace room) |

---

Built for **YC Fall 2026 x Moss: Zero Latency Builder Sprint** 🏆  
Addresses **YC RFS #12: AI-Native Compliance Infrastructure**
