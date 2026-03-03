"""
services/reminder_engine.py — Adaptive Call Reminder System
============================================================
Two modes:
  1. In-app reminders — returned via API for the frontend to display
  2. Voice calls (Twilio) — tone adapts based on user performance

Tone logic:
  - productivityScore >= 70 → Motivational
  - productivityScore 40-69 → Balanced
  - productivityScore < 40  → Strict / Urgent
"""
from bson import ObjectId
from utils.db import get_db
from utils.helpers import utc_now, serialize_doc, serialize_list
from config import Config
from datetime import timedelta


# ─────────────────────────────────────────────
# In-app Reminder Generation
# ─────────────────────────────────────────────

def get_pending_reminders(user_id: str) -> list:
    """
    Return reminders for tasks due within 24 hours.
    Tone adapts to user's performance.
    """
    db = get_db()
    now = utc_now()
    in_24h = now + timedelta(hours=24)

    tasks = list(db.tasks.find({
        "userId": ObjectId(user_id),
        "status": "Pending",
        "deadline": {"$gte": now, "$lte": in_24h}
    }, sort=[("deadline", 1)]))

    if not tasks:
        return []

    user = db.users.find_one({"_id": ObjectId(user_id)})
    score = user.get("productivityScore", 60) if user else 60
    tone  = _get_tone(score)

    reminders = []
    for t in tasks:
        deadline = t["deadline"]
        time_left_h = round((deadline - now).total_seconds() / 3600, 1)
        message = _build_message(t["name"], time_left_h, tone)
        reminders.append({
            "task_id":   str(t["_id"]),
            "task_name": t["name"],
            "deadline":  deadline.isoformat(),
            "time_left_hours": time_left_h,
            "message":   message,
            "tone":      tone,
        })

    return reminders


def acknowledge_reminder(user_id: str, task_id: str) -> bool:
    db = get_db()
    result = db.tasks.update_one(
        {"_id": ObjectId(task_id), "userId": ObjectId(user_id)},
        {"$set": {"reminderScheduled": True}}
    )
    return result.modified_count > 0


# ─────────────────────────────────────────────
# Twilio Voice Call (optional)
# ─────────────────────────────────────────────

def trigger_voice_call(user_id: str, phone_number: str) -> dict:
    """
    Place a TwiML voice call via Twilio.
    TwiML script adapts based on productivity score.
    """
    if not all([Config.TWILIO_ACCOUNT_SID, Config.TWILIO_AUTH_TOKEN, Config.TWILIO_PHONE_NUMBER]):
        return {"success": False, "error": "Twilio not configured. Add TWILIO_ vars to .env"}

    try:
        from twilio.rest import Client
        db = get_db()
        user = db.users.find_one({"_id": ObjectId(user_id)})
        score = user.get("productivityScore", 60) if user else 60
        tone  = _get_tone(score)
        name  = user.get("name", "Hero") if user else "Hero"

        twiml = _build_twiml(name, score, tone)

        client = Client(Config.TWILIO_ACCOUNT_SID, Config.TWILIO_AUTH_TOKEN)
        call = client.calls.create(
            twiml=twiml,
            to=phone_number,
            from_=Config.TWILIO_PHONE_NUMBER
        )
        return {"success": True, "call_sid": call.sid, "tone": tone}
    except ImportError:
        return {"success": False, "error": "twilio package not installed. Run: pip install twilio"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _get_tone(score: float) -> str:
    if score >= 70:  return "motivational"
    if score >= 40:  return "balanced"
    return "strict"


def _build_message(task_name: str, hours_left: float, tone: str) -> str:
    hrs = f"{hours_left:.0f}h" if hours_left >= 1 else f"{hours_left*60:.0f}min"

    messages = {
        "motivational": f"🌟 You're crushing it! Don't forget: '{task_name}' is due in {hrs}. You've got this!",
        "balanced":     f"⏰ Reminder: '{task_name}' is due in {hrs}. Stay on track — you can do it!",
        "strict":       f"🚨 URGENT: '{task_name}' must be completed in {hrs}. Your XP is at risk. Act NOW!",
    }
    return messages.get(tone, messages["balanced"])


def _build_twiml(name: str, score: float, tone: str) -> str:
    if tone == "motivational":
        text = (
            f"Hello {name}! This is , your productivity companion. "
            f"You've been amazing lately with a score of {int(score)} out of 100! "
            f"Just a friendly reminder that you have tasks due soon. "
            f"Keep up the incredible work! You're a true hero."
        )
    elif tone == "balanced":
        text = (
            f"Hi {name}, QuestFlow calling with a task reminder. "
            f"Your productivity score is {int(score)}. You have quests due soon. "
            f"Stay focused, complete your tasks, and keep your streak alive!"
        )
    else:  # strict
        text = (
            f"Attention {name}. This is an urgent QuestFlow reminder. "
            f"Your productivity score has dropped to {int(score)}. "
            f"You have overdue tasks. Complete them immediately to stop losing XP. "
            f"Your streak is at risk. Do not delay!"
        )

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice" rate="95%">{text}</Say>
    <Pause length="1"/>
    <Say voice="alice">Good luck on your quests! Goodbye.</Say>
</Response>"""