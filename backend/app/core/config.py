"""
SyncMind Backend - Core Configuration
"""
import os
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()


class Settings(BaseModel):
    """Application settings loaded from environment."""
    moss_project_id: str = os.getenv("MOSS_PROJECT_ID", "")
    moss_project_key: str = os.getenv("MOSS_PROJECT_KEY", "")
    # OpenAI-compatible LLM proxy (hidevs)
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://llm.hidevs.xyz")
    llm_model: str = os.getenv("LLM_MODEL", "gemini-2.0-flash")
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))

    # Moss index names — ComplianceMind domain
    regulations_index: str = "regulations"
    transactions_index: str = "transactions"
    violations_index: str = "violations"
    session_history_index: str = "session-history"
    learned_rules_index: str = "learned-rules"

    # Workspace config
    default_workspace: str = "default"


settings = Settings()
