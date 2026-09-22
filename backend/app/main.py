"""
ComplianceMind — FastAPI Application
AI-Native Compliance Workspace (YC F26 RFS #12)
Real-time multiplayer: compliance officers + AI agents share one workspace.
"""
import json
import asyncio
import uuid
from typing import Optional
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.core.config import settings
from app.core.moss_service import moss_service
from app.agents.orchestrator import orchestrator

app = FastAPI(
    title="ComplianceMind API",
    description="AI-Native Compliance Workspace powered by Moss sub-10ms retrieval",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import traceback as _tb
from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = _tb.format_exc()
    print("[500 ERROR]", tb)
    return JSONResponse(status_code=500, content={"error": str(exc), "traceback": tb})


# ─── Workspace / Presence State ──────────────────────────────────────────────

class WorkspaceState:
    """
    In-memory workspace state.
    Tracks who is online, active tasks, and WebSocket connections.
    (Persisted context lives in Moss indexes — keyed by workspace_id)
    """
    def __init__(self):
        # workspace_id → {user_id: {name, ws, joined_at}}
        self._presence: dict[str, dict[str, dict]] = {}
        # workspace_id → [task_ids]
        self._tasks: dict[str, list[dict]] = {}

    def join(self, workspace_id: str, user_id: str, name: str, ws: WebSocket):
        self._presence.setdefault(workspace_id, {})[user_id] = {
            "name": name, "ws": ws, "joined_at": datetime.now(timezone.utc).isoformat()
        }

    def leave(self, workspace_id: str, user_id: str):
        self._presence.get(workspace_id, {}).pop(user_id, None)

    def get_presence(self, workspace_id: str) -> list[dict]:
        return [
            {"user_id": uid, "name": info["name"], "joined_at": info["joined_at"]}
            for uid, info in self._presence.get(workspace_id, {}).items()
        ]

    def add_task(self, workspace_id: str, task: dict):
        self._tasks.setdefault(workspace_id, []).append(task)

    def get_tasks(self, workspace_id: str) -> list[dict]:
        return self._tasks.get(workspace_id, [])

    def update_task(self, workspace_id: str, task_id: str, status: str):
        for task in self._tasks.get(workspace_id, []):
            if task["id"] == task_id:
                task["status"] = status
                task["updated_at"] = datetime.now(timezone.utc).isoformat()

    async def broadcast(self, workspace_id: str, message: dict, exclude_user: str = ""):
        dead = []
        for uid, info in self._presence.get(workspace_id, {}).items():
            if uid == exclude_user:
                continue
            try:
                await info["ws"].send_json(message)
            except Exception:
                dead.append(uid)
        for uid in dead:
            self.leave(workspace_id, uid)


workspace_state = WorkspaceState()


# ─── REST Models ─────────────────────────────────────────────────────────────

class FlagRequest(BaseModel):
    description: str
    workspace_id: str = "default"
    task_id: Optional[str] = None
    run_full_pipeline: bool = True
    target_agent: Optional[str] = None  # scanner, analyst, drafter, escalation


class DocumentUpload(BaseModel):
    text: str
    index: str = "regulations"
    workspace_id: str = "default"
    metadata: Optional[dict] = None


class QueryRequest(BaseModel):
    query: str
    index: str = "regulations"
    workspace_id: str = "default"
    top_k: int = 5


class FeedbackRequest(BaseModel):
    task_id: str
    content: str
    correction: str
    correction_type: str = "exception"  # "exception" | "false_positive" | "guideline"
    officer_name: str = "Officer"
    workspace_id: str = "default"


# ─── Startup / Seed Data ─────────────────────────────────────────────────────

SEED_REGULATIONS = [
    ("SEBI Insider Trading Regulations 2015 — Regulation 4: No insider shall trade in securities when in possession of UPSI. Penalty: Up to ₹25 crore or 3x profit.", {"type": "regulation", "authority": "SEBI", "severity": "critical"}),
    ("SEBI Insider Trading Regulations 2015 — Regulation 9: Minimum standards for code of conduct. Trading window must be closed 7 days prior to earnings announcements.", {"type": "regulation", "authority": "SEBI", "severity": "high"}),
    ("SEBI LODR 2015 — Regulation 30: Listed entities must disclose material events or information to the stock exchanges within 24 hours.", {"type": "regulation", "authority": "SEBI", "severity": "high"}),
    ("RBI Master Direction on KYC 2016 — Section 16: Banks must conduct enhanced due diligence for PEPs (Politically Exposed Persons) and update records every 2 years.", {"type": "regulation", "authority": "RBI", "severity": "high"}),
    ("RBI Master Direction on KYC 2016 — Section 37: Wire transfers above ₹50,000 must include complete originator and beneficiary information.", {"type": "regulation", "authority": "RBI", "severity": "medium"}),
    ("GDPR Article 17 — Right to Erasure: Data subjects have the right to request deletion of personal data. Organizations must comply within 30 days.", {"type": "regulation", "authority": "EU", "severity": "high"}),
    ("GDPR Article 33 — Data Breach Notification: Controllers must notify the supervisory authority within 72 hours of becoming aware of a personal data breach.", {"type": "regulation", "authority": "EU", "severity": "critical"}),
    ("FEMA Regulation 2000 — Section 6: Foreign exchange transactions above $25,000 require prior RBI approval and must be reported within 30 days.", {"type": "regulation", "authority": "RBI", "severity": "high"}),
    ("PMLA 2002 — Section 12: Reporting entities must file Suspicious Transaction Reports (STR) within 7 days of detecting suspicious activity.", {"type": "regulation", "authority": "FIU-IND", "severity": "critical"}),
    ("PMLA 2002 — Section 12A: Access to information. Director can call for records from any reporting entity, to be provided within 5 days.", {"type": "regulation", "authority": "FIU-IND", "severity": "high"}),
    ("Companies Act 2013 — Section 177: Audit committee must review related party transactions. All RPTs above ₹1 crore require board approval.", {"type": "regulation", "authority": "MCA", "severity": "medium"}),
    ("Companies Act 2013 — Section 188: Restriction on related party transactions without board consent. Contracts over ₹50 crore require prior shareholder approval.", {"type": "regulation", "authority": "MCA", "severity": "high"}),
    ("Income Tax Act 1961 — Section 269ST: No person shall receive an amount of ₹2 lakh or more in cash for a single transaction or from a single person in a day.", {"type": "regulation", "authority": "IT Dept", "severity": "high"}),
    ("Anti-Bribery Policy 2021: Gifts to government officials exceeding ₹5,000 require prior compliance approval. All hospitality must be recorded in the register.", {"type": "policy", "authority": "Internal", "severity": "medium"}),
    ("Data Masking Standard 2023: All PII and financial PAN data must be masked in non-production environments and encrypted at rest.", {"type": "policy", "authority": "Internal", "severity": "high"}),
]

SEED_TRANSACTIONS = [
    ("Transaction TXN-2024-0891: ₹4.2 crore wire transfer from HDFC account A-2291 to offshore account in Cayman Islands on 2024-09-15. No prior RBI approval documented.", {"type": "transaction", "id": "TXN-2024-0891", "amount": "4.2cr", "risk": "high"}),
    ("Transaction TXN-2024-0892: NIFTY options purchase of ₹1.8 crore by Director Ramesh K on 2024-09-14 — 3 days before Q2 earnings announcement.", {"type": "transaction", "id": "TXN-2024-0892", "amount": "1.8cr", "risk": "critical"}),
    ("Transaction TXN-2024-0893: Related party loan of ₹12 crore to subsidiary Acme Pvt Ltd — no board approval minutes found in records.", {"type": "transaction", "id": "TXN-2024-0893", "amount": "12cr", "risk": "high"}),
    ("Customer KYC-USER-441: KYC last updated 2019. Customer classified as PEP since 2022. Enhanced due diligence not conducted. 3 transactions above ₹10L in last 30 days.", {"type": "kyc_alert", "id": "KYC-441", "risk": "high"}),
    ("Transaction TXN-2024-0910: Cash deposit of ₹2.5 lakh by a single entity on 2024-10-01. Exceeds Section 269ST limit.", {"type": "transaction", "id": "TXN-2024-0910", "amount": "2.5L", "risk": "medium"}),
    ("Audit Log A-102: Unmasked database dump exported to staging server by DBA user 'admin' on 2024-10-02.", {"type": "audit_log", "id": "A-102", "risk": "high"}),
    ("Expense REP-332: ₹15,000 dinner expense for municipal official hosted by Sales VP on 2024-10-03. Missing compliance pre-approval.", {"type": "expense", "id": "REP-332", "amount": "15k", "risk": "medium"}),
]


@app.on_event("startup")
async def startup():
    await moss_service.initialize()

    # Seed regulations
    for text, meta in SEED_REGULATIONS:
        await moss_service.add_document(
            settings.regulations_index, text, meta, workspace_id="default"
        )

    # Seed transactions
    for text, meta in SEED_TRANSACTIONS:
        await moss_service.add_document(
            settings.transactions_index, text, meta, workspace_id="default"
        )

    print("[READY] ComplianceMind backend ready")
    print(f"[SEED] Seeded {len(SEED_REGULATIONS)} regulations + {len(SEED_TRANSACTIONS)} transactions")


# ─── REST Endpoints ───────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "ComplianceMind", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/workspace/{workspace_id}")
async def get_workspace(workspace_id: str):
    stats = await moss_service.get_index_stats(workspace_id)
    return {
        "workspace_id": workspace_id,
        "presence": workspace_state.get_presence(workspace_id),
        "tasks": workspace_state.get_tasks(workspace_id),
        "index_stats": stats,
    }


@app.get("/api/benchmark")
async def run_benchmark():
    """Prove Moss <10ms — used in demo."""
    result = await moss_service.benchmark(n=10)
    return result


@app.get("/api/leaderboard-proof")
async def leaderboard_proof():
    """
    Single endpoint for hackathon judges.
    Returns:
    - Moss retrieval benchmark (sub-10ms proof)
    - Live pipeline wall-clock timings (parallel agent proof)
    - Architecture summary
    """
    import time as _t

    # 1. Moss benchmark — 10 queries
    bench = await moss_service.benchmark(n=10)

    # 2. Full pipeline timing on a sample event
    sample_event = "Director purchased ₹1.8Cr options 3 days before earnings announcement"
    t0 = _t.perf_counter()
    pipeline_results = await orchestrator.run_full_pipeline(
        sample_event, "leaderboard-demo", "proof"
    )
    total_pipeline_ms = round((_t.perf_counter() - t0) * 1000, 1)

    return {
        "project": "ComplianceMind — AI-Native Compliance Workspace",
        "hackathon": "YC Fall 2026 x Moss Zero Latency Builder Sprint",
        "track": "Track 2: Multiplayer AI and Collaborative Agents",
        "moss_retrieval": {
            "avg_ms": bench["avg_ms"],
            "min_ms": bench["min_ms"],
            "max_ms": bench["max_ms"],
            "all_under_10ms": bench["all_under_10ms"],
            "mode": bench["mode"],
            "n_queries": bench["n"],
        },
        "parallel_pipeline": {
            "agents_run": len(pipeline_results),
            "architecture": "Phase1(RegScanner ∥ RiskAnalyst) → Phase2(AuditDrafter ∥ Escalation)",
            "total_wall_clock_ms": total_pipeline_ms,
            "moss_indexes_queried": ["regulations", "transactions", "violations", "session-history"],
            "parallel_queries_per_agent": 3,
        },
        "key_claims": [
            f"Moss retrieval avg: {bench['avg_ms']}ms",
            f"All 10 benchmark queries under 10ms: {bench['all_under_10ms']}",
            f"4-agent parallel pipeline wall-clock: {total_pipeline_ms}ms",
            "True asyncio.gather parallelism — agents run concurrently, not sequentially",
            "WebSocket multiplayer — multiple officers share one workspace in real-time",
        ],
        "agents": [r.agent_name for r in pipeline_results],
    }


@app.post("/api/flag")
async def flag_event(req: FlagRequest):
    """Flag a compliance event — triggers agent analysis pipeline."""
    import traceback as _tb
    task_id = req.task_id or str(uuid.uuid4())[:8]

    # Log event to session history
    await moss_service.add_document(
        settings.session_history_index,
        f"[Compliance Flag] {req.description}",
        metadata={"type": "flag", "task_id": task_id},
        workspace_id=req.workspace_id,
    )

    try:
        if req.run_full_pipeline:
            results = await orchestrator.run_full_pipeline(
                req.description, req.workspace_id, task_id
            )
        elif req.target_agent:
            results = await orchestrator.run_single_agent(
                req.target_agent, req.description, req.workspace_id, task_id
            )
        else:
            results = await orchestrator.run_full_pipeline(
                req.description, req.workspace_id, task_id
            )
    except Exception as e:
        tb = _tb.format_exc()
        print("[FLAG ERROR]", tb)
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": str(e), "traceback": tb})

    return {
        "task_id": task_id,
        "workspace_id": req.workspace_id,
        "responses": [
            {
                "agent": r.agent_name,
                "role": r.role,
                "content": r.content,
                "retrieval_latency_ms": r.latency_ms,
                "context_used": r.context_used,
                "timestamp": r.timestamp,
            }
            for r in results
        ],
    }


@app.post("/api/query")
async def query_moss(req: QueryRequest):
    result = await moss_service.query(req.index, req.query, req.top_k, req.workspace_id)
    return {
        "results": [
            {"id": r.id, "text": r.text, "score": r.score, "metadata": r.metadata}
            for r in result.results
        ],
        "latency_ms": result.latency_ms,
        "index": result.index_name,
    }


@app.post("/api/feedback")
async def submit_feedback(req: FeedbackRequest):
    """Ingests human officer correction/feedback into Moss learned-rules index."""
    try:
        doc_text = f"[Officer Precedent: {req.correction_type.upper()}] {req.correction} (Applied to event: {req.content})"
        doc_id = await moss_service.add_document(
            settings.learned_rules_index,
            doc_text,
            metadata={
                "type": "learned_rule",
                "correction_type": req.correction_type,
                "task_id": req.task_id,
                "officer": req.officer_name,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            workspace_id=req.workspace_id,
        )
        # Broadcast to workspace officers
        await workspace_state.broadcast(req.workspace_id, {
            "type": "rule_learned",
            "rule_id": doc_id,
            "rule": req.correction,
            "correction_type": req.correction_type,
            "task_id": req.task_id,
            "officer": req.officer_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return {
            "status": "learned",
            "rule_id": doc_id,
            "correction": req.correction,
            "index": settings.learned_rules_index,
        }
    except Exception as e:
        print(f"[FEEDBACK ERROR] {e}")
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/learned-rules/{workspace_id}")
async def get_learned_rules(workspace_id: str):
    """Retrieve learned rules and precedents for this workspace."""
    try:
        query_res = await moss_service.query(
            settings.learned_rules_index,
            "compliance officer precedent exception guideline",
            top_k=10,
            workspace_id=workspace_id,
        )
        return {
            "workspace_id": workspace_id,
            "count": len(query_res.results),
            "rules": [
                {"id": r.id, "text": r.text, "metadata": r.metadata, "score": r.score}
                for r in query_res.results
            ],
            "latency_ms": query_res.latency_ms,
        }
    except Exception as e:
        return {"workspace_id": workspace_id, "count": 0, "rules": [], "error": str(e)}


# ─── WebSocket — Real-Time Multiplayer Workspace ───────────────────────────

@app.websocket("/ws/{workspace_id}")
async def workspace_ws(websocket: WebSocket, workspace_id: str):
    """
    Real-time WebSocket per workspace.
    Multiple compliance officers + agents share the same room.
    Clients must send a join message with their name first.
    """
    await websocket.accept()
    user_id = str(uuid.uuid4())[:8]
    user_name = "Officer"

    try:
        # Wait for join message
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
        join_data = json.loads(raw)
        user_name = join_data.get("name", "Officer")
    except Exception:
        pass

    workspace_state.join(workspace_id, user_id, user_name, websocket)

    # Announce join
    await workspace_state.broadcast(workspace_id, {
        "type": "presence",
        "event": "joined",
        "user_id": user_id,
        "name": user_name,
        "presence": workspace_state.get_presence(workspace_id),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    # Send current state to new joiner
    await websocket.send_json({
        "type": "workspace_state",
        "workspace_id": workspace_id,
        "presence": workspace_state.get_presence(workspace_id),
        "tasks": workspace_state.get_tasks(workspace_id),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            msg_type = msg.get("type", "flag")

            if msg_type == "flag":
                content = msg.get("content", "")
                target_agent = msg.get("target_agent")
                task_id = str(uuid.uuid4())[:8]

                # Create task in workspace
                task = {
                    "id": task_id,
                    "description": content,
                    "status": "analyzing",
                    "created_by": user_name,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                workspace_state.add_task(workspace_id, task)

                # Broadcast task creation
                await workspace_state.broadcast(workspace_id, {
                    "type": "task_created",
                    "task": task,
                    "user": user_name,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

                # Log to Moss session history
                await moss_service.add_document(
                    settings.session_history_index,
                    f"[{user_name}] {content}",
                    metadata={"user": user_name, "task_id": task_id},
                    workspace_id=workspace_id,
                )

                # Run agents — broadcast each result as it arrives
                if target_agent:
                    results = await orchestrator.run_single_agent(
                        target_agent, content, workspace_id, task_id
                    )
                else:
                    results = await orchestrator.run_full_pipeline(
                        content, workspace_id, task_id
                    )

                for result in results:
                    await workspace_state.broadcast(workspace_id, {
                        "type": "agent_response",
                        "agent": result.agent_name,
                        "role": result.role,
                        "content": result.content,
                        "retrieval_latency_ms": result.latency_ms,
                        "context_used": result.context_used,
                        "task_id": task_id,
                        "timestamp": result.timestamp,
                    })

                # Update task status
                workspace_state.update_task(workspace_id, task_id, "awaiting_review")
                await workspace_state.broadcast(workspace_id, {
                    "type": "task_updated",
                    "task_id": task_id,
                    "status": "awaiting_review",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            elif msg_type == "approve":
                task_id = msg.get("task_id", "")
                workspace_state.update_task(workspace_id, task_id, "approved")
                await workspace_state.broadcast(workspace_id, {
                    "type": "task_updated",
                    "task_id": task_id,
                    "status": "approved",
                    "approved_by": user_name,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            elif msg_type == "feedback":
                task_id = msg.get("task_id", "")
                content = msg.get("content", "")
                correction = msg.get("correction", "")
                correction_type = msg.get("correction_type", "exception")
                doc_text = f"[Officer Precedent: {correction_type.upper()}] {correction} (Applied to: {content})"
                doc_id = await moss_service.add_document(
                    settings.learned_rules_index,
                    doc_text,
                    metadata={
                        "type": "learned_rule",
                        "correction_type": correction_type,
                        "task_id": task_id,
                        "officer": user_name,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                    workspace_id=workspace_id,
                )
                await workspace_state.broadcast(workspace_id, {
                    "type": "rule_learned",
                    "rule_id": doc_id,
                    "rule": correction,
                    "correction_type": correction_type,
                    "task_id": task_id,
                    "officer": user_name,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            elif msg_type == "chat":
                await workspace_state.broadcast(workspace_id, {
                    "type": "chat",
                    "user": user_name,
                    "user_id": user_id,
                    "content": msg.get("content", ""),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }, exclude_user=user_id)

    except WebSocketDisconnect:
        workspace_state.leave(workspace_id, user_id)
        await workspace_state.broadcast(workspace_id, {
            "type": "presence",
            "event": "left",
            "user_id": user_id,
            "name": user_name,
            "presence": workspace_state.get_presence(workspace_id),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
