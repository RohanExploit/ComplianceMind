"""
ComplianceMind — Moss Retrieval Service
4 domain-specific indexes for AI-native compliance monitoring.
All queries target sub-10ms via Moss in-process semantic search.
"""
import time
import uuid
from typing import Optional
from dataclasses import dataclass, field

from app.core.config import settings

try:
    from moss import MossClient, QueryOptions, DocumentInfo
    MOSS_AVAILABLE = True
except ImportError:
    MOSS_AVAILABLE = False
    DocumentInfo = None


@dataclass
class RetrievalResult:
    id: str
    text: str
    score: float
    metadata: dict = field(default_factory=dict)


@dataclass
class RetrievalResponse:
    results: list[RetrievalResult]
    latency_ms: float
    index_name: str
    query: str


class MossRetrievalService:
    """
    Manages 4 compliance-domain Moss indexes:
    1. regulations   — Regulatory text, policies, laws (SEBI, GDPR, RBI, etc.)
    2. transactions  — Company events, logs, financial transactions
    3. violations    — Flagged issues, agent decisions, audit trail
    4. session-history — Human + agent conversation turns (per workspace)
    """

    def __init__(self):
        self._client = None
        self._initialized = False
        self._indexes_loaded: set[str] = set()
        self._mock_store: dict[str, list[dict]] = {}
        self._latency_samples: list[float] = []  # Track real latencies

    @property
    def all_indexes(self):
        return [
            settings.regulations_index,
            settings.transactions_index,
            settings.violations_index,
            settings.session_history_index,
            settings.learned_rules_index,
        ]

    async def initialize(self):
        if self._initialized:
            return

        for idx in self.all_indexes:
            self._mock_store[idx] = []

        if MOSS_AVAILABLE and settings.moss_project_id and settings.moss_project_key:
            try:
                self._client = MossClient(
                    settings.moss_project_id,
                    settings.moss_project_key
                )
                for index_name in self.all_indexes:
                    try:
                        await self._client.create_index(index_name, [])
                    except Exception:
                        pass
                    try:
                        await self._client.load_index(index_name)
                        self._indexes_loaded.add(index_name)
                    except Exception:
                        pass
                self._initialized = True
                print("[OK] Moss initialized - live indexes: " + str(self._indexes_loaded))
                return
            except Exception as e:
                print(f"[WARN] Moss init failed: {e}, falling back to mock")

        self._initialized = True
        print("[MOCK] Running in mock mode - set MOSS_PROJECT_ID/KEY in .env for live Moss")

    async def add_document(
        self,
        index_name: str,
        text: str,
        metadata: Optional[dict] = None,
        doc_id: Optional[str] = None,
        workspace_id: str = "default",
    ) -> str:
        """Add a document to a Moss index, tagged with workspace_id."""
        doc_id = doc_id or str(uuid.uuid4())
        meta = metadata or {}
        meta["workspace_id"] = workspace_id
        doc_obj = {"id": doc_id, "text": text, "metadata": meta}

        if self._client and index_name in self._indexes_loaded:
            try:
                # Correct Moss SDK method: add_docs with DocumentInfo objects
                await self._client.add_docs(
                    index_name,
                    [DocumentInfo(id=doc_id, text=text)]
                )
                self._mock_store.setdefault(index_name, []).append(doc_obj)
                return doc_id
            except Exception as e:
                print(f"Moss add_docs error: {e}")

        self._mock_store.setdefault(index_name, []).append(doc_obj)
        return doc_id

    async def query(
        self,
        index_name: str,
        query_text: str,
        top_k: int = 5,
        workspace_id: Optional[str] = None,
    ) -> RetrievalResponse:
        """Query Moss. Target: <10ms."""
        start = time.perf_counter()

        if self._client and index_name in self._indexes_loaded:
            try:
                raw = await self._client.query(
                    index_name, query_text, QueryOptions(top_k=top_k)
                )
                elapsed_ms = (time.perf_counter() - start) * 1000
                self._latency_samples.append(elapsed_ms)
                # SearchResult has: .docs, .time_taken_ms, .index_name, .query
                result_list = getattr(raw, 'docs', []) or []
                results = [
                    RetrievalResult(
                        id=str(getattr(r, 'id', '')),
                        text=str(getattr(r, 'text', '')),
                        score=float(getattr(r, 'score', 0.0)),
                        metadata=getattr(r, 'metadata', {}),
                    )
                    for r in result_list
                ]
                # Use Moss's own reported latency if available
                moss_latency = getattr(raw, 'time_taken_ms', None)
                elapsed_ms = moss_latency if moss_latency is not None else (time.perf_counter() - start) * 1000
                return RetrievalResponse(
                    results=results, latency_ms=round(elapsed_ms, 2),
                    index_name=index_name, query=query_text,
                )
            except Exception as e:
                print(f"Moss query error: {e}")

        # Mock: keyword overlap scoring
        store = self._mock_store.get(index_name, [])
        # Filter by workspace if specified
        if workspace_id:
            store = [d for d in store if d.get("metadata", {}).get("workspace_id") == workspace_id]

        query_words = set(query_text.lower().split())
        scored = []
        for doc in store:
            doc_words = set(doc.get("text", "").lower().split())
            score = len(query_words & doc_words) / max(len(query_words), 1)
            scored.append((doc, score))
        scored.sort(key=lambda x: x[1], reverse=True)

        elapsed_ms = (time.perf_counter() - start) * 1000
        self._latency_samples.append(elapsed_ms)

        return RetrievalResponse(
            results=[
                RetrievalResult(id=d["id"], text=d["text"], score=s, metadata=d.get("metadata", {}))
                for d, s in scored[:top_k]
            ],
            latency_ms=round(elapsed_ms, 2),
            index_name=index_name,
            query=query_text,
        )

    async def benchmark(self, n: int = 10) -> dict:
        """Run N queries and return latency stats — for demo proof."""
        import asyncio
        test_queries = [
            "GDPR data retention violation",
            "suspicious transaction pattern",
            "RBI circular compliance check",
            "insider trading policy",
            "audit trail missing",
        ]
        latencies = []
        for i in range(n):
            q = test_queries[i % len(test_queries)]
            r = await self.query(settings.regulations_index, q, top_k=3)
            latencies.append(r.latency_ms)

        return {
            "n": n,
            "avg_ms": round(sum(latencies) / len(latencies), 2),
            "min_ms": round(min(latencies), 2),
            "max_ms": round(max(latencies), 2),
            "all_under_10ms": all(l < 10 for l in latencies),
            "samples": latencies,
            "mode": "live_moss" if self._indexes_loaded else "mock",
        }

    async def get_index_stats(self, workspace_id: Optional[str] = None) -> dict:
        stats = {}
        for idx in self.all_indexes:
            store = self._mock_store.get(idx, [])
            if workspace_id:
                store = [d for d in store if d.get("metadata", {}).get("workspace_id") == workspace_id]
            samples = self._latency_samples[-20:] if self._latency_samples else []
            avg_latency = round(sum(samples) / len(samples), 2) if samples else 0
            stats[idx] = {
                "count": len(store),
                "live": idx in self._indexes_loaded,
                "avg_latency_ms": avg_latency,
            }
        return stats


moss_service = MossRetrievalService()
