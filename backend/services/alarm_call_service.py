"""
services/alarm_call_service.py — Alarm Wake-Up Call System
============================================================
Fires a real Twilio voice call to the user when their alarm time arrives.

Voice profiles:
  strict    — firm, no-nonsense wake-up (like a drill sergeant)
  loving    — warm, gentle good-morning call
  dramatic  — over-the-top epic wake-up with theatrical flair

Flow:
  1. alarm_call_job() runs every 60s (registered in app.py scheduler)
  2. Finds all enabled alarms matching current HH:MM + weekday
  3. Looks up user's phone number
  4. Places a Twilio call with the right TwiML script
  5. Logs the call to prevent duplicate fires
  6. Also pushes a DB notification so the app shows it

Usage in app.py scheduler:
  from services.alarm_call_service import alarm_call_job
  scheduler.add_job(alarm_call_job, IntervalTrigger(seconds=60), id="alarm_call_job")
"""

from utils.db import get_db
from utils.helpers import utc_now
from models.alarm_model import (
    get_enabled_alarms_at, record_alarm_trigger, create_notification
)
from config import Config


# ─────────────────────────────────────────────────────────────
# Main job — called every 60 seconds by APScheduler
# ─────────────────────────────────────────────────────────────

def alarm_call_job():
    """
    Every minute: check if any enabled alarm matches the current time.
    If so, call the user on their registered phone number.
    """
    try:
        now         = utc_now()
        time_str    = now.strftime("%H:%M")        # e.g. "07:30"
        day_of_week = now.weekday()                # 0=Mon … 6=Sun

        alarms = get_enabled_alarms_at(time_str, day_of_week)
        if not alarms:
            return

        db = get_db()

        for alarm in alarms:
            alarm_id = alarm["_id"]
            user_id  = alarm["userId"]

            # ── Idempotency: only fire once per alarm per minute ──
            already_fired = db.alarm_call_log.find_one({
                "alarmId": alarm_id,
                "firedAt": {
                    "$gte": now.replace(second=0, microsecond=0)
                }
            })
            if already_fired:
                continue

            # ── Get user's phone number ──
            from bson import ObjectId
            user = db.users.find_one({"_id": ObjectId(user_id)})
            if not user:
                continue

            phone = user.get("phone", "").strip()
            name  = user.get("name", "Hero")

            # ── Record alarm trigger in DB ──
            record_alarm_trigger(alarm_id, snoozed=False)

            # ── Push in-app notification regardless of phone ──
            create_notification(
                user_id, "alarm",
                f"⏰ {alarm['label']}",
                f"Your alarm '{alarm['label']}' is ringing! Time to wake up!",
                persistent=True
            )

            # ── Make phone call if phone number is set ──
            if phone:
                result = _place_alarm_call(
                    user_id       = user_id,
                    phone         = phone,
                    name          = name,
                    alarm_label   = alarm.get("label", "Wake Up"),
                    voice_profile = alarm.get("voiceProfile", "strict"),
                )
                call_status = "called" if result.get("success") else f"call_failed: {result.get('error')}"
            else:
                call_status = "no_phone_set"

            # ── Log the fire event ──
            db.alarm_call_log.insert_one({
                "alarmId":     alarm_id,
                "userId":      user_id,
                "alarmLabel":  alarm.get("label", "Wake Up"),
                "firedAt":     now,
                "callStatus":  call_status,
                "voiceProfile": alarm.get("voiceProfile", "strict"),
            })

            print(f"  🔔 Alarm fired: '{alarm.get('label')}' for user {user_id} — {call_status}")

    except Exception as e:
        print(f"  ❌ alarm_call_job error: {e}")


# ─────────────────────────────────────────────────────────────
# Twilio call
# ─────────────────────────────────────────────────────────────

def _place_alarm_call(user_id: str, phone: str, name: str,
                      alarm_label: str, voice_profile: str) -> dict:
    """Place the actual Twilio voice call."""

    if not all([Config.TWILIO_ACCOUNT_SID,
                Config.TWILIO_AUTH_TOKEN,
                Config.TWILIO_PHONE_NUMBER]):
        return {
            "success": False,
            "error": "Twilio not configured. Add TWILIO_ACCOUNT_SID, "
                     "TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER to your .env"
        }

    try:
        from twilio.rest import Client

        # Look up productivity score for context
        db    = get_db()
        from bson import ObjectId
        user  = db.users.find_one({"_id": ObjectId(user_id)}) or {}
        score = user.get("productivityScore", 60)
        streak= user.get("streak", 0)

        twiml  = _build_alarm_twiml(name, alarm_label, voice_profile, score, streak)
        client = Client(Config.TWILIO_ACCOUNT_SID, Config.TWILIO_AUTH_TOKEN)

        call = client.calls.create(
            twiml=twiml,
            to=phone,
            from_=Config.TWILIO_PHONE_NUMBER
        )
        return {"success": True, "call_sid": call.sid}

    except ImportError:
        return {"success": False, "error": "twilio not installed. Run: pip install twilio"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────
# TwiML scripts per voice profile
# ─────────────────────────────────────────────────────────────

def _build_alarm_twiml(name: str, label: str, profile: str,
                       score: float, streak: int) -> str:
    """
    Build a TwiML response that sounds like a real wake-up call.
    Each profile has a distinct personality.
    """

    # ── STRICT — firm drill-sergeant energy ──
    if profile == "strict":
        text = (
            f"Attention {name}! "
            f"This is your Luma wake-up call. "
            f"Your alarm '{label}' is ringing right now. "
            f"It is time to get up immediately. "
            f"You have quests to complete today. "
            f"Your current productivity score is {int(score)} out of 100. "
        )
        if streak > 0:
            text += f"You have a {streak}-day streak on the line. Do not break it. "
        text += (
            f"No snoozing. No excuses. "
            f"Get up, {name}. Your day starts NOW. "
        )
        voice = "alice"
        rate  = "90%"

    # ── LOVING — warm, gentle morning call ──
    elif profile == "loving":
        text = (
            f"Good morning, {name}! "
            f"This is your gentle wake-up call from Luma. "
            f"Your alarm '{label}' is going off, and it's time to start your beautiful day. "
            f"You've been doing so well "
        )
        if streak > 0:
            text += f"— {streak} days of amazing consistency! "
        text += (
            f"Today is a fresh opportunity to accomplish great things. "
            f"Take a deep breath, smile, and rise when you're ready. "
            f"You've got this, {name}. "
            f"Your quests are waiting, and I believe in you. "
            f"Have a wonderful, productive day. Good morning! "
        )
        voice = "alice"
        rate  = "95%"

    # ── DRAMATIC — over-the-top epic theatre ──
    elif profile == "dramatic":
        text = (
            f"RISE, {name.upper()}! "
            f"The moment you have been waiting for has arrived! "
            f"Your alarm — '{label}' — sounds the call to GREATNESS! "
            f"The world trembles in anticipation of what you will achieve today! "
            f"Your productivity score stands at {int(score)}. "
        )
        if streak > 0:
            text += (
                f"A {streak}-day streak of LEGENDARY proportions hangs in the balance! "
            )
        text += (
            f"Mere mortals hit snooze. "
            f"But YOU, {name}, are no mere mortal. "
            f"You are a QUEST CHAMPION. "
            f"So arise! Arise and CONQUER this day! "
            f"Your epic adventure awaits! "
        )
        voice = "alice"
        rate  = "85%"

    else:
        # fallback to strict
        return _build_alarm_twiml(name, label, "strict", score, streak)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="{voice}" rate="{rate}">{text}</Say>
    <Pause length="1"/>
    <Say voice="{voice}" rate="{rate}">
        Press any key to dismiss this alarm, or simply hang up.
        Goodbye, {name}!
    </Say>
    <Gather numDigits="1" timeout="10"/>
</Response>"""


# ─────────────────────────────────────────────────────────────
# Manual call trigger (used by alarm_routes.py for test calls)
# ─────────────────────────────────────────────────────────────

def trigger_test_alarm_call(user_id: str) -> dict:
    """
    Lets the user trigger a test call from the settings page
    to verify their phone number before relying on it for real alarms.
    """
    db   = get_db()
    from bson import ObjectId
    user = db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return {"success": False, "error": "User not found"}

    phone = user.get("phone", "").strip()
    if not phone:
        return {"success": False, "error": "No phone number saved. Add one in Settings first."}

    return _place_alarm_call(
        user_id       = user_id,
        phone         = phone,
        name          = user.get("name", "Hero"),
        alarm_label   = "Test Alarm",
        voice_profile = "loving",   # always friendly for test
    )