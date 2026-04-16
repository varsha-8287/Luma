"""
services/alarm_call_service.py — Alarm Wake-Up Call System  v3.0
=================================================================
FIXED: Now properly handles BOTH alarm modes:
  - normal    → in-app ring + TTS (handled by frontend, but backend logs it)
  - wake_call → Twilio phone call with escalation tiers
"""

from utils.db import get_db
from utils.helpers import utc_now
from models.alarm_model import (
    get_enabled_alarms_at, record_alarm_trigger, create_notification
)
from config import Config
import pytz

ESCALATION_DELAY_SECONDS = 120   # 2 minutes before next escalation tier


# ═══════════════════════════════════════════════════════════════
# MAIN ALARM JOB — runs every 60 seconds
# ═══════════════════════════════════════════════════════════════

def alarm_call_job():
    """
    Runs every minute. For EVERY alarm (both normal and wake_call):
      1. Records that the alarm fired (snoozeCount reset, lastTriggeredAt set)
      2. Creates an in-app notification
      3. For wake_call mode: ALSO places a Twilio phone call
    
    FIX: Previously this only handled wake_call mode. Now it handles both.
    """
    try:
        now         = utc_now()
        time_str    = now.strftime("%H:%M")
        day_of_week = now.weekday()

        # Get ALL alarms that should fire at this time (both normal and wake_call)
        alarms = get_enabled_alarms_at(time_str, day_of_week)
        
        if not alarms:
            return

        db = get_db()
        print(f"[alarm_call_job] Found {len(alarms)} alarm(s) to trigger at {time_str}")

        for alarm in alarms:
            alarm_id   = alarm["_id"]
            user_id    = str(alarm["userId"])
            alarm_mode = alarm.get("alarmMode", "normal")
            label      = alarm.get("label", "Alarm")

            print(f"[alarm_call_job] Processing alarm: {label} (mode={alarm_mode}) for user {user_id}")

            # ── ALWAYS record the trigger (resets snoozeCount) ──
            record_alarm_trigger(alarm_id, snoozed=False)

            # ── ALWAYS create an in-app notification ──
            mode_emoji = "📞" if alarm_mode == "wake_call" else "🔔"
            create_notification(
                user_id, "alarm",
                f"{mode_emoji} {label}",
                f"Your alarm '{label}' is ringing! Time to wake up!",
                persistent=True
            )

            # ── ONLY for wake_call mode: place phone call ──
            if alarm_mode == "wake_call":
                # Check if we already placed a call for this exact minute (idempotency)
                minute_window = now.replace(second=0, microsecond=0)
                already_fired = db.alarm_call_log.find_one({
                    "alarmId":      alarm_id,
                    "minuteWindow": minute_window,
                    "tier":         0,
                })
                if already_fired:
                    print(f"[alarm_call_job] Already placed call for {label} at {minute_window}, skipping")
                    continue

                # Get user's phone number
                from bson import ObjectId
                user = db.users.find_one({"_id": ObjectId(user_id)})
                if not user:
                    print(f"[alarm_call_job] User {user_id} not found")
                    continue

                phone = user.get("phone", "").strip()
                name  = user.get("name", "Hero")

                if not phone:
                    print(f"[alarm_call_job] ⚠️ Wake-call SKIPPED: user {user_id} has no phone number saved.")
                    _log_call(db, alarm_id, user_id, alarm, minute_window,
                              tier=0, status="no_phone_set")
                    continue

                print(f"[alarm_call_job] 📞 Placing wake-call to {phone} for '{label}' voice={alarm.get('voiceProfile','strict')}")

                result = _place_alarm_call(
                    user_id=user_id, phone=phone, name=name,
                    alarm_label=label,
                    voice_profile=alarm.get("voiceProfile", "strict"),
                    tier=0,
                )
                status = "called_t0" if result.get("success") else f"failed:{result.get('error','unknown')}"
                _log_call(db, alarm_id, user_id, alarm, minute_window,
                          tier=0, status=status, call_sid=result.get("call_sid"))

                if result.get("success"):
                    print(f"[alarm_call_job] ✅ Wake-call placed: SID={result.get('call_sid')}")
                else:
                    print(f"[alarm_call_job] ❌ Wake-call FAILED: {result.get('error')}")
            else:
                # For normal mode, just log that we processed it
                print(f"[alarm_call_job] 🔔 Normal alarm '{label}' triggered (in-app only)")

            # Disable one-time alarms (no repeat days)
            if not alarm.get("repeat"):
                db.alarms.update_one(
                    {"_id": alarm_id},
                    {"$set": {"enabled": False}}
                )
                print(f"[alarm_call_job] Disabled one-time alarm '{label}'")

    except Exception as e:
        print(f"[alarm_call_job] ❌ Error: {e}")
        import traceback
        traceback.print_exc()


# ═══════════════════════════════════════════════════════════════
# ESCALATION CHECK JOB — runs every 120 seconds
# ═══════════════════════════════════════════════════════════════

def escalation_check_job():
    """
    Find unanswered tier-0 calls and fire the next escalation tier.
    This only applies to wake_call mode alarms.
    """
    try:
        from datetime import timedelta
        db  = get_db()
        now = utc_now()
        cutoff = now - timedelta(seconds=ESCALATION_DELAY_SECONDS)

        tier0_logs = list(db.alarm_call_log.find({
            "tier":       0,
            "firedAt":    {"$lte": cutoff},
            "escalated":  {"$ne": True},
            "callStatus": {"$regex": "^called"},
        }))

        for log in tier0_logs:
            alarm_id = log["alarmId"]
            user_id  = str(log["userId"])

            # Mark as escalated to prevent duplicate escalations
            db.alarm_call_log.update_one(
                {"_id": log["_id"]},
                {"$set": {"escalated": True}}
            )

            from bson import ObjectId
            alarm_doc = db.alarms.find_one({"_id": ObjectId(str(alarm_id))})
            if not alarm_doc or not alarm_doc.get("enabled"):
                continue

            # Only escalate if still in wake_call mode
            if alarm_doc.get("alarmMode") != "wake_call":
                continue

            user = db.users.find_one({"_id": ObjectId(user_id)})
            if not user:
                continue

            phone = user.get("phone", "").strip()
            if not phone:
                continue

            # Count how many calls today to determine tier
            day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            existing = db.alarm_call_log.count_documents({
                "alarmId": alarm_id,
                "firedAt": {"$gte": day_start},
            })
            tier = min(existing, 2)  # tier 0, 1, or 2

            print(f"[escalation_check_job] 📞 Escalating call for '{alarm_doc.get('label')}' to tier {tier}")

            result = _place_alarm_call(
                user_id=user_id, phone=phone,
                name=user.get("name", "Hero"),
                alarm_label=alarm_doc.get("label", "Wake Up"),
                voice_profile=alarm_doc.get("voiceProfile", "strict"),
                tier=tier,
            )
            status = f"called_t{tier}" if result.get("success") else f"failed_t{tier}"
            _log_call(db, alarm_id, user_id, alarm_doc,
                      minute_window=now.replace(second=0, microsecond=0),
                      tier=tier, status=status, call_sid=result.get("call_sid"))

            create_notification(
                user_id, "alarm",
                "📞 Still sleeping? Calling again...",
                f"You didn't answer '{alarm_doc.get('label')}'. Calling again — louder!",
                persistent=True
            )
            print(f"[escalation_check_job] ✅ Escalation [tier {tier}] completed")

    except Exception as e:
        print(f"[escalation_check_job] ❌ Error: {e}")
        import traceback
        traceback.print_exc()


# ═══════════════════════════════════════════════════════════════
# TWILIO CALL PLACEMENT
# ═══════════════════════════════════════════════════════════════

def _place_alarm_call(user_id, phone, name, alarm_label, voice_profile, tier=0):
    """Place a Twilio call with the appropriate voice script."""
    if not all([Config.TWILIO_ACCOUNT_SID, Config.TWILIO_AUTH_TOKEN, Config.TWILIO_PHONE_NUMBER]):
        return {"success": False, "error": "Twilio not configured."}
    
    try:
        from twilio.rest import Client
        
        twiml = _build_alarm_twiml(name, alarm_label, voice_profile, tier)

        print(f"[_place_alarm_call] TwiML for {voice_profile} tier {tier}:")
        print(twiml)

        client = Client(Config.TWILIO_ACCOUNT_SID, Config.TWILIO_AUTH_TOKEN)
        call = client.calls.create(
            twiml=twiml, 
            to=phone, 
            from_=Config.TWILIO_PHONE_NUMBER,
            timeout=30,
            status_callback_event=['initiated', 'ringing', 'answered', 'completed'],
        )
        return {"success": True, "call_sid": call.sid}
    except ImportError:
        return {"success": False, "error": "twilio not installed. Run: pip install twilio"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _log_call(db, alarm_id, user_id, alarm, minute_window, tier, status, call_sid=None):
    """Log call attempt for escalation tracking."""
    db.alarm_call_log.insert_one({
        "alarmId":      alarm_id,
        "userId":       user_id,
        "alarmLabel":   alarm.get("label", "Wake Up"),
        "minuteWindow": minute_window,
        "firedAt":      utc_now(),
        "tier":         tier,
        "callStatus":   status,
        "callSid":      call_sid,
        "voiceProfile": alarm.get("voiceProfile", "strict"),
        "escalated":    False,
    })


# ═══════════════════════════════════════════════════════════════
# TWIML SCRIPT BUILDER
# ═══════════════════════════════════════════════════════════════

def _xml_escape(text: str) -> str:
    """Escape XML special characters."""
    return (text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;"))


def _build_alarm_twiml(name, label, profile, tier):
    """Build TwiML response for the alarm call."""
    tier = min(max(int(tier), 0), 2)
    
    scripts = {
        "strict": [
            f"Wake up, {name}! This is your Luma alarm '{label}'. Get out of bed immediately. No excuses!",
            f"{name}! I called you already. This is the second call. Get up right now! This is unacceptable!",
            f"That is it, {name}! Third call! Get up this instant or I am coming in there myself! You have been warned!"
        ],
        "loving": [
            f"Good morning, {name}! This is your loving wake-up call. Time to start your beautiful day. Please get up soon!",
            f"{name}, it is me again. I am getting worried. Please wake up, darling. Your quests are waiting!",
            f"{name}, this is the third time I have called. I love you, but please get out of bed right now!"
        ],
        "dramatic": [
            f"Hear ye, {name}! The alarm '{label}' doth sound! The cosmos trembles awaiting your rise! Arise!",
            f"The herald returns! Oh {name}, still you slumber! The chronicle of your quest history grows darker! Wake!",
            f"This is unprecedented! Three calls, {name}! Rise from your slumber! Become the hero this story deserves!"
        ]
    }
    
    lines = scripts.get(profile, scripts["strict"])
    text = lines[tier] if tier < len(lines) else lines[-1]
    
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice" rate="90%">{_xml_escape(text)}</Say>
    <Pause length="1"/>
    <Say voice="alice" rate="90%">Good luck on your quests today. Goodbye.</Say>
</Response>'''


# ═══════════════════════════════════════════════════════════════
# TEST CALL FUNCTION
# ═══════════════════════════════════════════════════════════════

def trigger_test_alarm_call(user_id: str) -> dict:
    """Fire a test call to verify the user's phone and voice settings."""
    from bson import ObjectId
    db = get_db()
    user = db.users.find_one({"_id": ObjectId(user_id)})
    
    if not user:
        return {"success": False, "error": "User not found"}

    phone = user.get("phone", "").strip()
    if not phone:
        return {"success": False, "error": "No phone number saved. Add one in Settings first."}

    # Get the most recent wake_call alarm for voice profile
    latest_alarm = db.alarms.find_one(
        {"userId": ObjectId(user_id), "alarmMode": "wake_call"},
        sort=[("createdAt", -1)]
    )
    voice_profile = (latest_alarm or {}).get("voiceProfile", "strict")
    alarm_label = (latest_alarm or {}).get("label", "Test Alarm")

    return _place_alarm_call(
        user_id=user_id,
        phone=phone,
        name=user.get("name", "Hero"),
        alarm_label=alarm_label,
        voice_profile=voice_profile,
        tier=0,
    )