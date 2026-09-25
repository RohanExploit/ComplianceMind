"""
ComplianceMind — Analytics & Metrics API
Advanced endpoints for hackathon demo: risk trends, leaderboard, STR export, audit export.
"""
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import Response
from fpdf import FPDF

from app.core.moss_service import moss_service
from app.core.config import settings
from app.agents.orchestrator import orchestrator

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/risk-summary")
async def risk_summary(workspace_id: str = "default"):
    """
    Aggregated risk metrics across all active investigations.
    Used by the Risk Dashboard widget.
    """
    violations_res = await moss_service.query(
        settings.violations_index,
        "compliance violation risk critical high",
        top_k=20,
        workspace_id=workspace_id,
    )

    critical = sum(1 for r in violations_res.results if "CRITICAL" in r.text.upper() or "92 / 100" in r.text)
    high = sum(1 for r in violations_res.results if "HIGH" in r.text.upper() and "CRITICAL" not in r.text.upper())
    medium = sum(1 for r in violations_res.results if "MEDIUM" in r.text.upper())
    low = max(0, len(violations_res.results) - critical - high - medium)

    # Jurisdiction breakdown
    reg_res = await moss_service.query(
        settings.regulations_index,
        "SEBI RBI GDPR PMLA FEMA compliance",
        top_k=15,
    )
    jurisdictions = {}
    for r in reg_res.results:
        for auth in ["SEBI", "RBI", "GDPR", "PMLA", "FEMA", "MCA", "FIU-IND"]:
            if auth in r.text:
                jurisdictions[auth] = jurisdictions.get(auth, 0) + 1

    return {
        "workspace_id": workspace_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "risk_distribution": {
            "critical": critical,
            "high": high,
            "medium": medium,
            "low": low,
            "total": len(violations_res.results),
        },
        "jurisdiction_exposure": jurisdictions,
        "retrieval_latency_ms": violations_res.latency_ms,
        "moss_mode": "live" if moss_service._indexes_loaded else "mock",
    }


@router.get("/str-export/{task_id}")
async def export_str(task_id: str, workspace_id: str = "default"):
    """
    Generate a Suspicious Transaction Report (STR) in FIU-IND format.
    One-click regulatory filing simulation.
    """
    # Pull relevant findings from violations index
    findings_res = await moss_service.query(
        settings.violations_index,
        f"task {task_id}",
        top_k=5,
        workspace_id=workspace_id,
    )

    report_id = f"STR-{datetime.now().strftime('%Y%m%d')}-{task_id.upper()}"

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=16, style="B")
    pdf.cell(200, 10, "SUSPICIOUS TRANSACTION REPORT (STR)", ln=True, align="C")
    pdf.ln(5)

    pdf.set_font("Helvetica", size=10, style="B")
    pdf.cell(50, 8, "Report ID:", border=0)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(150, 8, report_id, ln=True)

    pdf.set_font("Helvetica", size=10, style="B")
    pdf.cell(50, 8, "Filing Entity:", border=0)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(150, 8, "ComplianceMind Automated Compliance System", ln=True)

    pdf.set_font("Helvetica", size=10, style="B")
    pdf.cell(50, 8, "Filing Date:", border=0)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(150, 8, datetime.now(timezone.utc).strftime('%d %B %Y, %H:%M UTC'), ln=True)

    pdf.set_font("Helvetica", size=10, style="B")
    pdf.cell(50, 8, "Statutory Basis:", border=0)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(150, 8, "PMLA 2002 - Section 12 (7-day STR Filing Obligation)", ln=True)

    pdf.set_font("Helvetica", size=10, style="B")
    pdf.cell(50, 8, "Submitted To:", border=0)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(150, 8, "Financial Intelligence Unit - India (FIU-IND)", ln=True)

    pdf.line(10, pdf.get_y()+5, 200, pdf.get_y()+5)
    pdf.ln(10)

    pdf.set_font("Helvetica", size=12, style="B")
    pdf.cell(200, 8, "Section A: Transaction Details", ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(200, 6, f"- Reference Task ID: {task_id}", ln=True)
    pdf.cell(200, 6, f"- Investigation Initiated: {datetime.now(timezone.utc).isoformat()}", ln=True)
    pdf.cell(200, 6, f"- Workspace: {workspace_id}", ln=True)
    pdf.ln(5)

    pdf.set_font("Helvetica", size=12, style="B")
    pdf.cell(200, 8, "Section B: Agent Analysis Summary", ln=True)
    pdf.set_font("Helvetica", size=10)
    for r in findings_res.results[:3]:
        # Encode to latin-1 or replace chars that fpdf helvetica doesn't support
        clean_text = r.text[:200].encode('latin-1', 'replace').decode('latin-1')
        pdf.multi_cell(0, 6, f"- {clean_text}")
    pdf.ln(5)

    pdf.set_font("Helvetica", size=12, style="B")
    pdf.cell(200, 8, "Section C: Risk Assessment", ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(200, 6, "- Automated Risk Scoring: ComplianceMind Multi-Agent Pipeline", ln=True)
    pdf.cell(200, 6, f"- Moss Retrieval Latency: {findings_res.latency_ms}ms (sub-10ms target)", ln=True)
    pdf.cell(200, 6, "- Regulatory Frameworks Applied: SEBI IT Reg 2015, RBI KYC, PMLA 2002", ln=True)
    pdf.ln(5)

    pdf.set_font("Helvetica", size=12, style="B")
    pdf.cell(200, 8, "Section D: Recommended Action", ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(200, 6, "- Immediate account freeze pending verification", ln=True)
    pdf.cell(200, 6, "- Escalate to FIU-IND within statutory 7-day window", ln=True)
    pdf.cell(200, 6, "- Preserve all transaction logs and communication records", ln=True)

    pdf.line(10, pdf.get_y()+5, 200, pdf.get_y()+5)
    pdf.ln(10)
    pdf.set_font("Helvetica", size=8, style="I")
    pdf.cell(200, 4, "Generated automatically by ComplianceMind AI Compliance Workspace", ln=True, align="C")
    pdf.cell(200, 4, "Powered by Moss Sub-10ms Semantic Retrieval Engine", ln=True, align="C")

    pdf_bytes = pdf.output()

    return Response(
        content=bytes(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{report_id}.pdf"'}
    )


@router.get("/leaderboard")
async def leaderboard_proof():
    """
    Comprehensive hackathon proof-of-work endpoint.
    Demonstrates Moss sub-10ms + parallel pipeline in one call.
    """
    t0 = time.perf_counter()
    bench = await moss_service.benchmark(n=10)
    bench_ms = round((time.perf_counter() - t0) * 1000, 1)

    sample = "Director purchased ₹1.8Cr options 3 days before earnings announcement — potential insider trading"
    pipeline_t0 = time.perf_counter()
    results = await orchestrator.run_full_pipeline(sample, "leaderboard", "proof-run")
    pipeline_ms = round((time.perf_counter() - pipeline_t0) * 1000, 1)

    return {
        "project": "ComplianceMind — AI-Native Compliance Workspace",
        "hackathon": "YC Fall 2026 x Moss: Zero Latency Builder Sprint",
        "track": "Track 2: Multiplayer AI and Collaborative Agents | RFS #12",
        "selected": "TOP 10 — MOSS HACKATHON",
        "moss_performance": {
            "avg_ms": bench["avg_ms"],
            "min_ms": bench["min_ms"],
            "max_ms": bench["max_ms"],
            "p95_under_10ms": bench["all_under_10ms"],
            "n_queries": bench["n"],
            "mode": bench["mode"],
            "benchmark_wall_ms": bench_ms,
        },
        "pipeline_performance": {
            "total_wall_clock_ms": pipeline_ms,
            "agents_executed": len(results),
            "architecture": "Phase1(RegScanner ∥ RiskAnalyst) → Phase2(AuditDrafter ∥ Escalation)",
            "agent_names": [r.agent_name for r in results],
            "indexes_queried": ["regulations", "transactions", "violations", "session-history", "learned-rules"],
            "parallelism": "True asyncio.gather — agents do NOT block each other",
        },
        "key_differentiators": [
            f"✅ Moss retrieval avg: {bench['avg_ms']}ms (target: <10ms)",
            f"✅ All 10 queries under 10ms: {bench['all_under_10ms']}",
            f"✅ 4-agent parallel pipeline: {pipeline_ms}ms wall-clock",
            "✅ True multiplayer — multiple officers share one WebSocket room",
            "✅ Human-in-the-loop: Officers teach agents new precedents via Moss memory",
            "✅ One-click STR export — PMLA-compliant FIU-IND report generation",
            "✅ Persistent workspaces — rooms survive server restarts via Moss indexing",
            "✅ 15+ seeded regulations: SEBI, RBI, GDPR, PMLA, FEMA, MCA, IT Act",
        ],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/audit-trail/{workspace_id}")
async def audit_trail(workspace_id: str, limit: int = 20):
    """
    Pull complete audit trail for a workspace from Moss session history.
    """
    history = await moss_service.query(
        settings.session_history_index,
        "compliance flag investigation audit",
        top_k=limit,
        workspace_id=workspace_id,
    )
    violations = await moss_service.query(
        settings.violations_index,
        "agent finding audit",
        top_k=limit,
        workspace_id=workspace_id,
    )
    learned = await moss_service.query(
        settings.learned_rules_index,
        "officer precedent correction rule",
        top_k=10,
        workspace_id=workspace_id,
    )

    return {
        "workspace_id": workspace_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "flags_and_queries": [
            {"text": r.text, "score": r.score, "metadata": r.metadata}
            for r in history.results
        ],
        "agent_findings": [
            {"text": r.text, "score": r.score, "metadata": r.metadata}
            for r in violations.results
        ],
        "learned_precedents": [
            {"text": r.text, "score": r.score, "metadata": r.metadata}
            for r in learned.results
        ],
        "latency_ms": {
            "history": history.latency_ms,
            "violations": violations.latency_ms,
            "learned": learned.latency_ms,
        },
    }
