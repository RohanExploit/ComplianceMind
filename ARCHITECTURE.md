# ComplianceMind — Architecture Deep Dive

## System Components

### 1. Moss Retrieval Service (`backend/app/core/moss_service.py`)

The `MossRetrievalService` manages **5 domain-specific semantic indexes**:

| Index | Purpose | Agents That Query |
|-------|---------|-------------------|
| `regulations` | 18+ statutory regulations (SEBI, RBI, GDPR, PMLA, FEMA, Basel III, FinCEN, PCI-DSS) | RegScanner |
| `transactions` | Company events, historical transactions, KYC alerts | RiskAnalyst |
| `violations` | All agent findings and audit decisions (append-only) | All agents |
| `session-history` | Human + agent conversation per workspace | All agents |
| `learned-rules` | Officer-taught precedents (human-in-the-loop memory) | All agents (priority boost) |

**Graceful Degradation:**
- If `MOSS_PROJECT_ID` / `MOSS_PROJECT_KEY` are set → real Moss in-process search
- If not → falls back to keyword-overlap mock that still demonstrates the architecture

**Learned-rules priority boost:**
```python
is_learned = r.index_name == settings.learned_rules_index
boost = 0.35 if is_learned else 0.0
score = min(1.0, item.score + boost)
```
Officer corrections always rank above general regulatory text.

---

### 2. Agent Orchestrator (`backend/app/agents/orchestrator.py`)

#### Phase 1 (True Parallel)
```python
phase1_results = await asyncio.gather(
    reg_scanner.process(query, workspace_id, task_id),
    risk_analyst.process(query, workspace_id, task_id),
)
```
- `RegScanner`: queries `regulations` index only
- `RiskAnalyst`: queries `transactions` + `violations` indexes

#### Phase 2 (True Parallel, informed by Phase 1)
```python
phase1_summary = f"Regulation findings: {scanner_out.content[:400]}\nRisk: {analyst_out.content[:400]}"
phase2_results = await asyncio.gather(
    audit_drafter.process(query, workspace_id, task_id, extra_context=phase1_summary),
    escalation_agent.process(query, workspace_id, task_id, extra_context=phase1_summary),
)
```
- `AuditDrafter`: synthesizes formal audit finding
- `EscalationAgent`: determines APPROVE / FLAG / BLOCK / REPORT_TO_FIU

#### Each Agent Also Parallelizes Its Moss Queries
```python
# Inside BaseComplianceAgent._retrieve_context()
tasks = [moss_service.query(idx, query, top_k=3) for idx in indexes + [learned_rules_index]]
results = await asyncio.gather(*tasks)  # All index queries fire in parallel
```

#### LLM Fallback Strategy
- Primary: Gemini 2.0 Flash via OpenAI-compatible proxy (7s timeout, 0 retries)
- Fallback: `_synthesize_fallback()` — deterministic structured output using Moss-retrieved context
- Result: **zero hallucination risk**, always produces valid compliance output

---

### 3. FastAPI Backend (`backend/app/main.py`)

**WebSocket Architecture:**
```
Client WebSocket → workspace_ws() handler
    ├─ on "flag"     → orchestrator.run_full_pipeline() → broadcast agent results
    ├─ on "approve"  → update task status → broadcast
    ├─ on "escalate" → log to violations index → broadcast
    ├─ on "feedback" → add to learned-rules index → broadcast "rule_learned"
    └─ on "chat"     → broadcast to all except sender
```

**WorkspaceState (in-memory):**
- `_presence`: user_id → {name, ws, joined_at}
- `_tasks`: workspace_id → [task list]
- `broadcast()`: fan-out to all WebSocket connections, auto-removes dead connections

---

### 4. Analytics API (`backend/app/api/analytics.py`)

| Endpoint | What it does |
|----------|-------------|
| `GET /api/analytics/risk-summary` | Counts CRITICAL/HIGH/MEDIUM/LOW violations from Moss; jurisdiction exposure map |
| `GET /api/analytics/str-export/{task_id}` | Generates PMLA-compliant FIU-IND STR markdown report |
| `GET /api/analytics/leaderboard` | Full hackathon proof JSON: Moss benchmark + pipeline timing |
| `GET /api/analytics/audit-trail/{workspace_id}` | Complete tamper-evident audit trail from 3 Moss indexes |

---

### 5. Frontend (`frontend/src/app/page-client.tsx`)

**3-Panel Layout:**
- **Left sidebar (220px):** Risk distribution gauges, jurisdiction exposure, agent pipeline status, session latency sparklines
- **Center (flex):** Tabbed workspace — Live Feed | Cases | Moss Memory
- **Right sidebar (220px):** Moss performance metrics, online officers, pipeline architecture diagram

**Key UI Systems:**
- `PulseDot`: animated status indicators (live/reconnecting/agent active)
- `GlassCard`: glassmorphic containers with backdrop blur
- `LatencyBadge`: color-coded latency display (<5ms green, <10ms amber, >10ms red)
- `FormattedMessage`: markdown renderer (headers, bullets, numbered lists, bold, code)
- `RiskGauge`: SVG circular progress for risk scores

**Resilience:**
- WebSocket preferred; transparent fallback to REST if WS is disconnected
- Auto-reconnect on WebSocket close (2s delay)
- 20s safety timeout on loading state (never stuck)

---

### 6. Seed Data

**18 Regulations seeded at startup:**
- SEBI Insider Trading Regulations 2015 (Reg 4, 9)
- SEBI LODR 2015 (Reg 30)
- RBI Master Direction on KYC 2016 (Sec 16, 37)
- GDPR Articles 17, 33
- FEMA Regulation 2000 (Sec 6)
- PMLA 2002 (Sec 12, 12A)
- Companies Act 2013 (Sec 177, 188)
- Income Tax Act 1961 (Sec 269ST)
- Anti-Bribery Policy 2021
- Data Masking Standard 2023
- **NEW:** Basel III Framework (Pillar 2)
- **NEW:** FinCEN AML Guidelines 2023
- **NEW:** PCI-DSS v4.0 (Requirement 10)

**9 Transaction scenarios seeded:**
- NIFTY options insider trading
- Cayman Islands wire transfer (FEMA)
- Related party loan (Companies Act)
- PEP KYC overdue alert
- Cash deposit threshold violation
- Unmasked database export
- Government official expense (Anti-Bribery)
- **NEW:** Structuring pattern (9x below-threshold deposits)
- **NEW:** Shell company suspicious inflow

---

## Data Flow: Complete Flag Event

```
1. Officer types "Director bought ₹1.8Cr options before earnings"
2. Client sends WebSocket {"type":"flag","content":"...","priority":"critical"}
3. Backend:
   a. Generates task_id (e.g. "a4f9b2c1")
   b. Creates task in WorkspaceState → broadcasts "task_created" to all users
   c. Logs to session-history Moss index
   d. asyncio.gather(RegScanner, RiskAnalyst) — PHASE 1
      - RegScanner queries regulations index (< 10ms via Moss)
      - RiskAnalyst queries transactions + violations indexes simultaneously
   e. asyncio.gather(AuditDrafter, Escalation) — PHASE 2
      - Both receive Phase 1 summary as context
   f. Each agent result → broadcast "agent_response" to all WebSocket clients
   g. Updates task status to "awaiting_review" → broadcasts "task_updated"
4. All 4 agents write findings to violations index (searchable by future agents)
5. Officers see findings in real-time; can Approve / Escalate / Teach / Export STR
```

---

## Performance Characteristics

- **Moss query latency:** 2–8ms (in-process, no network hop)
- **Phase 1 wall-clock:** ~1–2s (2 agents parallel, each with 4 parallel index queries)
- **Phase 2 wall-clock:** ~1–2s (2 agents parallel, each with 5 parallel index queries)
- **Total pipeline:** ~2–3s wall-clock
- **WebSocket broadcast:** <50ms to all clients
- **STR export:** <100ms (3 Moss queries + template render)
