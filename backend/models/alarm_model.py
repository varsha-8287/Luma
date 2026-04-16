"""
models/alarm_model.py — Alarm & Notification document models
=============================================================
Collections:
  alarms        — user-created wake-up alarms
  notifications — system + app notifications per user
"""
from bson import ObjectId
from utils.db import get_db
from utils.helpers import serialize_doc, serialize_list, utc_now


VALID_VOICE_PROFILES = {"strict", "loving", "dramatic"}
VALID_ALARM_MODES    = {"normal", "wake_call"}      # normal = in-app only; wake_call = Twilio phone call
VALID_NOTIF_TYPES    = {"alarm", "task", "streak", "badge", "reminder", "mood", "game"}

NOTIF_ICONS = {
    "alarm":    "⏰",
    "task":     "📋",
    "streak":   "🔥",
    "badge":    "🏆",
    "reminder": "🔔",
    "mood":     "😊",
    "game":     "🎮",
}


# ══════════════════════════════════════════════
# ALARMS
# ══════════════════════════════════════════════

def create_alarm(user_id: str, label: str, time: str,
                 voice_profile: str = "strict", repeat: list = None,
                 alarm_mode: str = "normal") -> dict:
    """
    Create a new alarm.
    time       = "HH:MM" string
    repeat     = list of weekday ints [0-6]. Empty = one-time alarm.
    alarm_mode = "normal"    → in-app ring + TTS only
                 "wake_call" → Twilio phone call at alarm time
    """
    if voice_profile not in VALID_VOICE_PROFILES:
        voice_profile = "strict"
    if alarm_mode not in VALID_ALARM_MODES:
        alarm_mode = "normal"

    db = get_db()
    doc = {
        "userId":          ObjectId(user_id),
        "label":           (label or "Wake Up").strip(),
        "time":            time,
        "voiceProfile":    voice_profile,
        "alarmMode":       alarm_mode,
        "repeat":          repeat or [],
        "enabled":         True,
        "snoozeCount":     0,
        "lastTriggeredAt": None,
        "createdAt":       utc_now(),
    }
    result = db.alarms.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


def get_alarms_for_user(user_id: str) -> list:
    db = get_db()
    alarms = list(db.alarms.find(
        {"userId": ObjectId(user_id)},
        sort=[("createdAt", -1)]
    ))
    return serialize_list(alarms)


def get_alarm_by_id(alarm_id: str, user_id: str):
    db = get_db()
    try:
        doc = db.alarms.find_one({
            "_id":    ObjectId(alarm_id),
            "userId": ObjectId(user_id)
        })
        return serialize_doc(doc) if doc else None
    except Exception:
        return None


def toggle_alarm(alarm_id: str, user_id: str):
    db = get_db()
    alarm = db.alarms.find_one({"_id": ObjectId(alarm_id), "userId": ObjectId(user_id)})
    if not alarm:
        return None
    new_state = not alarm.get("enabled", True)
    result = db.alarms.find_one_and_update(
        {"_id": ObjectId(alarm_id), "userId": ObjectId(user_id)},
        {"$set": {"enabled": new_state}},
        return_document=True
    )
    return serialize_doc(result)


def delete_alarm(alarm_id: str, user_id: str) -> bool:
    db = get_db()
    result = db.alarms.delete_one({
        "_id":    ObjectId(alarm_id),
        "userId": ObjectId(user_id)
    })
    return result.deleted_count > 0


def record_alarm_trigger(alarm_id: str, snoozed: bool = False):
    """Called when an alarm fires or is snoozed."""
    db = get_db()
    update = {"$set": {"lastTriggeredAt": utc_now()}}
    if snoozed:
        update["$inc"] = {"snoozeCount": 1}
    else:
        update["$set"]["snoozeCount"] = 0
        alarm = db.alarms.find_one({"_id": ObjectId(alarm_id)})
        if alarm and not alarm.get("repeat"):
            update["$set"]["enabled"] = False

    result = db.alarms.find_one_and_update(
        {"_id": ObjectId(alarm_id)},
        update,
        return_document=True
    )
    return serialize_doc(result) if result else None


def get_enabled_alarms_at(time_str: str, day_of_week: int) -> list:
    """Find all alarms that should fire at this time on this weekday."""
    db = get_db()
    alarms = list(db.alarms.find({
        "time":    time_str,
        "enabled": True,
        "$or": [
            {"repeat": []},
            {"repeat": day_of_week},
        ]
    }))
    return serialize_list(alarms)


# ══════════════════════════════════════════════
# NOTIFICATIONS
# ══════════════════════════════════════════════

def create_notification(user_id: str, notif_type: str, title: str,
                        message: str, persistent: bool = False) -> dict:
    if notif_type not in VALID_NOTIF_TYPES:
        notif_type = "reminder"

    db = get_db()
    doc = {
        "userId":     ObjectId(user_id),
        "type":       notif_type,
        "title":      title,
        "message":    message,
        "icon":       NOTIF_ICONS.get(notif_type, "🔔"),
        "read":       False,
        "persistent": persistent,
        "createdAt":  utc_now(),
    }
    result = db.notifications.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


def get_notifications_for_user(user_id: str, limit: int = 50,
                               unread_only: bool = False) -> list:
    db = get_db()
    query = {"userId": ObjectId(user_id)}
    if unread_only:
        query["read"] = False
    notifs = list(db.notifications.find(
        query,
        sort=[("createdAt", -1)],
        limit=limit
    ))
    return serialize_list(notifs)


def mark_all_read(user_id: str) -> int:
    db = get_db()
    result = db.notifications.update_many(
        {"userId": ObjectId(user_id), "read": False},
        {"$set": {"read": True}}
    )
    return result.modified_count


def mark_notification_read(notif_id: str, user_id: str) -> bool:
    db = get_db()
    result = db.notifications.update_one(
        {"_id": ObjectId(notif_id), "userId": ObjectId(user_id)},
        {"$set": {"read": True}}
    )
    return result.modified_count > 0


def delete_notification(notif_id: str, user_id: str) -> bool:
    db = get_db()
    result = db.notifications.delete_one({
        "_id":    ObjectId(notif_id),
        "userId": ObjectId(user_id)
    })
    return result.deleted_count > 0


def clear_all_notifications(user_id: str) -> int:
    db = get_db()
    result = db.notifications.delete_many({"userId": ObjectId(user_id)})
    return result.deleted_count


def get_unread_count(user_id: str) -> int:
    db = get_db()
    return db.notifications.count_documents({
        "userId": ObjectId(user_id),
        "read":   False
    })