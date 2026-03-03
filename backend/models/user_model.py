"""
models/user_model.py — User document model
Fields: name, email, password (hashed), totalXP, level, streak,
        completedTasksCount, createdAt
"""
from datetime import datetime, timezone
from bson import ObjectId
from utils.db import get_db
from utils.helpers import serialize_doc, utc_now
from config import Config


def create_user(name: str, email: str, hashed_password: str) -> dict:
    db = get_db()
    doc = {
        "name": name,
        "email": email.lower().strip(),
        "password": hashed_password,
        "totalXP": 0,
        "level": 0,
        "streak": 0,
        "completedTasksCount": 0,
        "earlyCompletionCount": 0,
        "moodPositiveStreak": 0,
        "lastActiveDate": None,
        "createdAt": utc_now(),
    }
    result = db.users.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


def find_user_by_email(email: str) -> dict | None:
    db = get_db()
    return db.users.find_one({"email": email.lower().strip()})


def find_user_by_id(user_id: str) -> dict | None:
    db = get_db()
    try:
        return db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        return None


def update_user_xp(user_id: str, xp_delta: int) -> dict:
    """Add/subtract XP and recalculate level. Returns updated user doc."""
    db = get_db()
    user = db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise ValueError("User not found")

    new_xp = max(0, user["totalXP"] + xp_delta)
    new_level = int(new_xp // Config.XP_PER_LEVEL)
    prev_level = user["level"]

    db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"totalXP": new_xp, "level": new_level}}
    )

    updated = db.users.find_one({"_id": ObjectId(user_id)})
    leveled_up = new_level > prev_level
    return serialize_doc(updated), leveled_up


def increment_completed_count(user_id: str, early: bool = False):
    db = get_db()
    inc_fields = {"completedTasksCount": 1}
    if early:
        inc_fields["earlyCompletionCount"] = 1
    db.users.update_one({"_id": ObjectId(user_id)}, {"$inc": inc_fields})


def update_streak(user_id: str, streak: int):
    db = get_db()
    db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"streak": streak, "lastActiveDate": utc_now()}}
    )


def update_mood_positive_streak(user_id: str, streak: int):
    db = get_db()
    db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"moodPositiveStreak": streak}}
    )


def get_public_user(user_doc: dict) -> dict:
    """Strip password from user doc."""
    safe = serialize_doc(user_doc)
    safe.pop("password", None)
    return safe