"""
ComplianceMind Telegram Bot
────────────────────────────
Bot: @ComplianceManagerialbot
Connects Telegram users to the full ComplianceMind multi-agent pipeline.

Commands:
  /start   — Welcome message
  /help    — Show commands
  /status  — Check backend health
  /flag    — Analyze a compliance event (or just send a message)
  /report  — Get session risk summary
"""

import asyncio
import os
import logging
import httpx
from datetime import datetime

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters,
)
from dotenv import load_dotenv

load_dotenv()

# ─── Config ───────────────────────────────────────────────────────────────────

TELEGRAM_TOKEN = "8880111769:AAEASyawYgi3j8YKZWy4oVQ7KtgH1Yq6mHk"
BACKEND_URL = os.getenv("TELEGRAM_BACKEND_URL", "https://overthrow-scheme-entail.ngrok-free.dev")

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("compliance-bot")

# Risk level → emoji
RISK_EMOJI = {
    "CRITICAL": "🚨",
    "HIGH": "🔴",
    "MEDIUM": "🟡",
    "LOW": "🟢",
}
ACTION_EMOJI = {
    "REPORT_TO_FIU": "📁 REPORT TO FIU",
    "BLOCK": "🚫 BLOCK",
    "FLAG": "🚩 FLAG",
    "APPROVE": "✅ APPROVE",
}

# ─── Helper ───────────────────────────────────────────────────────────────────

async def call_backend_flag(description: str, priority: str = "normal") -> dict | None:
    """Call the /api/flag endpoint on the ComplianceMind backend."""
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                f"{BACKEND_URL}/api/flag",
                json={
                    "description": description,
                    "workspace_id": "default",
                    "priority": priority,
                },
                headers={"ngrok-skip-browser-warning": "true"},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.TimeoutException:
        return {"error": "Backend timed out after 45s"}
    except Exception as e:
        logger.error(f"Backend call failed: {e}")
        return {"error": str(e)}


async def call_backend_health() -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{BACKEND_URL}/api/health",
                headers={"ngrok-skip-browser-warning": "true"},
            )
            return resp.json()
    except Exception as e:
        return {"error": str(e)}


async def call_backend_risk_summary() -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{BACKEND_URL}/api/analytics/risk-summary?workspace_id=default",
                headers={"ngrok-skip-browser-warning": "true"},
            )
            return resp.json()
    except Exception as e:
        return {"error": str(e)}


def esc(text: str) -> str:
    """Escape HTML special characters for Telegram HTML parse mode."""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def format_result(data: dict, description: str) -> tuple[str, str]:
    """Format the /api/flag response. Returns (text, parse_mode)."""
    if "error" in data:
        return f"❌ <b>Error</b>\n<code>{esc(data['error'])}</code>", "HTML"

    c = data.get("consensus", {})
    agents = data.get("responses", [])
    risk = c.get("risk_level", "?")
    score = c.get("risk_score", 0)
    conf = int(c.get("confidence", 0) * 100)
    action = c.get("recommended_action", "?")
    total_ms = c.get("total_wall_ms", 0)
    task_id = data.get("task_id", "?")

    emoji = RISK_EMOJI.get(risk, "⚠️")
    action_label = ACTION_EMOJI.get(action, action)

    # Score bar (10 blocks)
    filled = round(score / 10)
    bar = "█" * filled + "░" * (10 - filled)

    # Agent summary (top 3)
    agent_lines = ""
    for ag in agents[:3]:
        name = esc(ag.get("agent", "?"))
        ag_score = ag.get("risk_score", 0)
        content = esc(ag.get("content", "")[:100].replace("\n", " "))
        agent_lines += f"\n  <b>{name}</b> <code>{ag_score}/100</code> — {content}…"

    desc_short = esc(description[:80]) + ("…" if len(description) > 80 else "")

    msg = (
        f"{emoji} <b>ComplianceMind Verdict</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📋 <i>{desc_short}</i>\n\n"
        f"⚠️ <b>Risk Level:</b> <code>{esc(risk)}</code>\n"
        f"📊 <b>Score:</b> <code>{score}/100</code>  <code>{bar}</code>\n"
        f"🎯 <b>Confidence:</b> <code>{conf}%</code>\n"
        f"⚡ <b>Action:</b> <code>{esc(action_label)}</code>\n"
        f"⏱ <b>Pipeline:</b> <code>{total_ms}ms</code>\n"
        f"🆔 <b>Task ID:</b> <code>{esc(task_id)}</code>\n"
        f"\n👥 <b>Agent Analysis:</b>{agent_lines}\n"
        f"\n🔗 <a href='https://compliance-mind.vercel.app'>View Full Dashboard</a>"
    )
    return msg, "HTML"



# ─── Handlers ─────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user.first_name
    keyboard = [
        [
            InlineKeyboardButton("🌐 Open Dashboard", url="https://compliance-mind.vercel.app"),
            InlineKeyboardButton("📊 System Status", callback_data="status"),
        ],
        [
            InlineKeyboardButton("📋 Session Report", callback_data="report"),
            InlineKeyboardButton("❓ Help", callback_data="help"),
        ],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        f"⚖️ *Welcome, {user}!*\n\n"
        "I'm *ComplianceMind AI*, your intelligent compliance officer.\n\n"
        "Simply *send me any suspicious transaction or compliance event* and I'll run it through our "
        "4-agent parallel pipeline powered by Moss Vector Search.\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "📡 *Agents Online:*\n"
        "  🔎 RegScanner — regulations index\n"
        "  📊 RiskAnalyst — transactions + violations\n"
        "  📝 AuditDrafter — full synthesis\n"
        "  🚨 Escalation — action engine\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Try: _Director Ramesh bought ₹1.8Cr NIFTY options 3 days before earnings_",
        parse_mode="Markdown",
        reply_markup=reply_markup,
    )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📖 *ComplianceMind Bot Commands*\n\n"
        "*/start* — Welcome screen\n"
        "*/status* — Check backend health\n"
        "*/report* — Get session risk summary\n"
        "*/flag <event>* — Analyze with CRITICAL priority\n"
        "*/help* — This message\n\n"
        "💡 *Or just type any compliance event directly!*\n\n"
        "Examples:\n"
        "• `9 cash deposits of ₹1.9L each in 3 days`\n"
        "• `₹4.2Cr wire transfer to Cayman Islands`\n"
        "• `PEP customer KYC not updated for 3 years`\n"
        "• `Shell company with zero employees received ₹12Cr`",
        parse_mode="Markdown",
    )


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = await update.message.reply_text("🔍 Checking backend health…")
    health = await call_backend_health()
    if health and "error" not in health:
        idx = health.get("index_stats", {})
        regs = idx.get("regulations", {}).get("count", 0)
        txns = idx.get("transactions", {}).get("count", 0)
        mode = health.get("moss_mode", "?")
        await msg.edit_text(
            f"✅ *Backend Online*\n\n"
            f"🏷 *Version:* `{health.get('version', '?')}`\n"
            f"🗂 *Regulations indexed:* `{regs}`\n"
            f"💳 *Transactions indexed:* `{txns}`\n"
            f"🔮 *Moss Mode:* `{mode}`\n"
            f"⏰ *Server Time:* `{health.get('timestamp', '?')[:19]}`\n\n"
            f"🔗 *Backend:* `{BACKEND_URL}`",
            parse_mode="Markdown",
        )
    else:
        await msg.edit_text(
            f"❌ *Backend Offline*\n\n`{health.get('error', 'Unknown error')}`\n\n"
            "Make sure the local backend is running.",
            parse_mode="Markdown",
        )


async def cmd_report(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = await update.message.reply_text("📊 Fetching session report…")
    data = await call_backend_risk_summary()
    if not data or "error" in data:
        await msg.edit_text(f"❌ Could not fetch report: `{data.get('error', '?')}`", parse_mode="Markdown")
        return

    totals = data.get("totals", {})
    breakdown = data.get("breakdown", {})
    crit = breakdown.get("CRITICAL", 0)
    high = breakdown.get("HIGH", 0)
    med = breakdown.get("MEDIUM", 0)
    low = breakdown.get("LOW", 0)
    total = totals.get("total_events", 0)

    await msg.edit_text(
        f"📊 *Session Risk Summary*\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📦 *Total Events:* `{total}`\n\n"
        f"🚨 *CRITICAL:* `{crit}`\n"
        f"🔴 *HIGH:* `{high}`\n"
        f"🟡 *MEDIUM:* `{med}`\n"
        f"🟢 *LOW:* `{low}`\n"
        f"\n🔗 [Full Dashboard](https://compliance-mind.vercel.app)",
        parse_mode="Markdown",
    )


async def cmd_flag(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /flag <description> with CRITICAL priority."""
    description = " ".join(context.args)
    if not description:
        await update.message.reply_text(
            "⚠️ Please provide an event description.\n\n"
            "Usage: `/flag Director bought shares before earnings`",
            parse_mode="Markdown",
        )
        return
    await analyze_event(update, context, description, priority="critical")


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle plain text messages — run them through the compliance pipeline."""
    text = update.message.text.strip()
    if len(text) < 10:
        await update.message.reply_text(
            "💬 Please describe the compliance event in more detail (at least 10 characters).",
        )
        return
    await analyze_event(update, context, text, priority="normal")


async def analyze_event(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    description: str,
    priority: str = "normal",
):
    """Core analysis function — calls backend, formats and sends result."""
    # Priority keyboard for message
    keyboard = [[
        InlineKeyboardButton("🟡 Normal", callback_data=f"analyze:normal:{description[:200]}"),
        InlineKeyboardButton("🔴 High", callback_data=f"analyze:high:{description[:200]}"),
        InlineKeyboardButton("🚨 Critical", callback_data=f"analyze:critical:{description[:200]}"),
    ]]

    thinking_msg = await update.message.reply_text(
        f"⚡ *Running 4-Agent Compliance Pipeline…*\n\n"
        f"📋 _{description[:100]}{'…' if len(description) > 100 else ''}_\n\n"
        f"🔎 RegScanner → querying regulations…\n"
        f"📊 RiskAnalyst → checking transactions…\n"
        f"📝 AuditDrafter → synthesizing findings…\n"
        f"🚨 Escalation → determining action…",
        parse_mode="Markdown",
    )

    result = await call_backend_flag(description, priority)
    formatted, parse_mode = format_result(result, description)

    keyboard2 = [[
        InlineKeyboardButton("🔄 Re-analyze as CRITICAL", callback_data=f"analyze:critical:{description[:200]}"),
        InlineKeyboardButton("🌐 Dashboard", url="https://compliance-mind.vercel.app"),
    ]]

    await thinking_msg.edit_text(
        formatted,
        parse_mode=parse_mode,
        reply_markup=InlineKeyboardMarkup(keyboard2),
        disable_web_page_preview=True,
    )


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "status":
        health = await call_backend_health()
        if health and "error" not in health:
            await query.message.reply_text(f"✅ *Backend Online* — `{health.get('version', '?')}`", parse_mode="Markdown")
        else:
            await query.message.reply_text(f"❌ Backend offline: `{health.get('error','?')}`", parse_mode="Markdown")

    elif data == "report":
        await cmd_report(query, context)

    elif data == "help":
        await cmd_help(query, context)

    elif data.startswith("analyze:"):
        parts = data.split(":", 2)
        _, priority, description = parts[0], parts[1], parts[2]
        thinking_msg = await query.message.reply_text(
            f"⚡ *Re-analyzing as {priority.upper()}…*",
            parse_mode="Markdown",
        )
        result = await call_backend_flag(description, priority)
        formatted, parse_mode = format_result(result, description)
        await thinking_msg.edit_text(formatted, parse_mode=parse_mode, disable_web_page_preview=True)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    logger.info("Starting ComplianceMind Telegram Bot…")
    logger.info(f"Backend: {BACKEND_URL}")

    app = Application.builder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("report", cmd_report))
    app.add_handler(CommandHandler("flag", cmd_flag))
    app.add_handler(CallbackQueryHandler(handle_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    logger.info("Bot is polling… Send a message to @ComplianceManagerialbot")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
