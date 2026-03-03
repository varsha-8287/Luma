"""
models/mood_model.py — Mood document model
Fields: userId, moodType, moodScore, isDailySummary, timestamp
"""
from bson import ObjectId
from utils.db import get_db
from utils.helpers import serialize_doc, serialize_list, utc_now


MOOD_SCORES = {
    "Happy":   5,
    "Neutral": 0,
    "Sad":    -3,
    "Angry":  -5,
    "Tired":  -2,
}


def log_mood(user_id: str, mood_type: str) -> dict:
    if mood_type not in MOOD_SCORES:
        raise ValueError(f"Invalid mood type. Valid: {list(MOOD_SCORES.keys())}")
    db = get_db()
    doc = {
        "userId": ObjectId(user_id),
        "moodType": mood_type,
        "moodScore": MOOD_SCORES[mood_type],
        "isDailySummary": False,
        "timestamp": utc_now(),
    }
    result = db.moods.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


def save_daily_summary(user_id: str, avg_score: float, mood_type: str):
    db = get_db()
    doc = {
        "userId": ObjectId(user_id),
        "moodType": mood_type,
        "moodScore": round(avg_score, 2),
        "isDailySummary": True,
        "timestamp": utc_now(),
    }
    result = db.moods.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


def get_moods_for_user(user_id: str, limit: int = 30) -> list:
    db = get_db()
    moods = list(db.moods.find(
        {"userId": ObjectId(user_id), "isDailySummary": False},
        sort=[("timestamp", -1)],
        limit=limit
    ))
    return serialize_list(moods)


def get_moods_in_range(user_id: str, start, end) -> list:
    db = get_db()
    moods = list(db.moods.find({
        "userId": ObjectId(user_id),
        "isDailySummary": False,
        "timestamp": {"$gte": start, "$lte": end}
    }, sort=[("timestamp", -1)]))
    return serialize_list(moods)


def get_daily_summary(user_id: str, start, end) -> dict | None:
    db = get_db()
    doc = db.moods.find_one({
        "userId": ObjectId(user_id),
        "isDailySummary": True,
        "timestamp": {"$gte": start, "$lte": end}
    })
    return serialize_doc(doc)


def get_mood_avg_last_n_days(user_id: str, n: int = 7) -> list[float]:
    """Return list of daily avg mood scores for last n days (most recent last)."""
    from datetime import timedelta
    scores = []
    for i in range(n - 1, -1, -1):
        from utils.helpers import get_day_range
        start, end = get_day_range(i)
        moods = get_moods_in_range(user_id, start, end)
        if moods:
            avg = sum(m["moodScore"] for m in moods) / len(moods)
            scores.append(round(avg, 2))
        else:
            scores.append(None)
    return scores


def count_positive_mood_streak(user_id: str) -> int:
    """Count consecutive days ending today with avg mood > 0."""
    from utils.helpers import get_day_range
    streak = 0
    for i in range(0, 30):
        start, end = get_day_range(i)
        moods = get_moods_in_range(user_id, start, end)
        if not moods:
            break
        avg = sum(m["moodScore"] for m in moods) / len(moods)
        if avg > 0:
            streak += 1
        else:
            break
    return streak