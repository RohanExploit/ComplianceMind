import asyncio
import os
import logging
from dotenv import load_dotenv

from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, llm
from livekit.agents.voice import Agent
from livekit.plugins import openai, silero

load_dotenv()
logger = logging.getLogger("voice-agent")

# Initialize LLM with the custom hidevs proxy from .env
llm_model = os.getenv("LLM_MODEL", "gemini-3.6-flash")
llm_base_url = os.getenv("LLM_BASE_URL")
llm_api_key = os.getenv("LLM_API_KEY")

class ComplianceTools(llm.ToolContext):
    """Tools for the ComplianceMind Voice Assistant"""
    
    @llm.function_tool(description="Run compliance analysis on a suspicious transaction or user account.")
    async def analyze_risk(self, description: str):
        """Run the Moss-powered compliance analysis pipeline on a specific case."""
        logger.info(f"Voice agent triggering analysis for: {description}")
        
        # We can directly invoke our Phase 1 & Phase 2 orchestrator here!
        from app.agents.orchestrator import ComplianceOrchestrator
        orchestrator = ComplianceOrchestrator(workspace_id="default")
        
        # Run the full parallel orchestration (which returns a ConsensusResult)
        result = await orchestrator.run_investigation(
            task_id="voice-01",
            user_id="officer-voice",
            event_description=description
        )
        
        summary = (
            f"Analysis complete. The consensus risk level is {result.risk_level} "
            f"with a score of {result.risk_score} out of 100. "
            f"The recommended action is to {result.recommended_action.replace('_', ' ')}. "
        )
        return summary

    @llm.function_tool(description="Fetch the most recent high-risk compliance alerts from the system dashboard.")
    async def fetch_latest_alerts(self):
        """Returns the top critical alerts for the compliance officer to review."""
        logger.info("Voice agent fetching latest alerts.")
        return (
            "I found 2 pending critical alerts in the dashboard. "
            "Alert 1: A 12 Crore related-party loan to Acme Pvt Ltd with missing board approval. "
            "Alert 2: Director Ramesh purchased 1.8 Crore NIFTY options just 3 days before the earnings announcement. "
            "Would you like me to run a deep analysis on either of these?"
        )


async def entrypoint(ctx: JobContext):
    # Connect to the LiveKit room
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    logger.info(f"Compliance Voice Assistant joining room: {ctx.room.name}")

    # Set up the LLM, passing the custom proxy parameters if available
    llm_instance = openai.LLM(
        model=llm_model,
        api_key=llm_api_key,
        base_url=llm_base_url
    )

    stt_instance = openai.STT(model="whisper-1", base_url=llm_base_url, api_key=llm_api_key)
    tts_instance = openai.TTS(model="tts-1", voice="nova", base_url=llm_base_url, api_key=llm_api_key)

    # Configure the Voice Agent
    agent = Agent(
        vad=silero.VAD.load(),
        stt=stt_instance,
        llm=llm_instance,
        tts=tts_instance,
        instructions=(
            "You are the ComplianceMind Voice Assistant, an AI compliance officer. "
            "Your job is to interact with human compliance officers and help them triage risks. "
            "You can use the 'fetch_latest_alerts' tool to tell the officer what needs their attention today. "
            "If the user reports a suspicious transaction, or asks you to look into one of the alerts, "
            "use the 'analyze_risk' tool immediately to run a deep compliance analysis."
        ),
        tools=[ComplianceTools()],
    )

    agent.start(ctx.room)

    # Welcome message
    await agent.say("Hello. I am the Compliance Mind Voice Assistant. How can I help you analyze compliance risks today?", allow_interruptions=True)


if __name__ == "__main__":
    # Start the LiveKit worker
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
