"""
services/predictive_model.py — Predictive Task Completion Model
================================================================
Estimates the probability that a user will complete today's pending tasks.

Uses a rule-based weighted scoring model:
  - Historical completion rate (last 14 days)
  - Current streak
  - Today's mood score
  - Time-of-day factor (are deadlines still achievable?)
  - Pending task load (overloaded = lower probability)

Returns probability (0.0–1.0) + explanatory factors.
"""
from bson import ObjectId
from utils.db import get_db
from utils.helpers import utc_now, start_of_day, end_of_day, get_day_range
from datetime import timedelta
import math


def predict_completion(user_id: str) -> dict:
    db = get_db()
    user = db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return {"probability": 0.5, "factors": [], "pending_count": 0}

    factors = []

    # ── 1. Historical completion rate (last 14 days) ──
    hist_rate = _historical_rate(user_id, 14)
    hist_weight = 0.35
    factors.append({
        "label": f"Past completion rate: {int(hist_rate * 100)}%",
        "positive": hist_rate >= 0.6,
        "value": hist_rate
    })

    # ── 2. Streak factor ──
    streak = user.get("streak", 0)
    streak_score = min(1.0, streak / 10.0)   # caps at 10-day streak
    streak_weight = 0.20
    factors.append({
        "label": f"{streak}-day streak" + (" 🔥" if streak >= 3 else ""),
        "positive": streak >= 2,
        "value": streak_score
    })

    # ── 3. Today's mood ──
    mood_score = _todays_mood(user_id)
    mood_normalized = (mood_score + 5) / 10.0   # -5..+5 → 0..1
    mood_weight = 0.20
    factors.append({
        "label": f"Today's mood score: {mood_score:+.0f}",
        "positive": mood_score >= 0,
        "value": mood_normalized
    })

    # ── 4. Task load factor ──
    pending_count = db.tasks.count_documents({
        "userId": ObjectId(user_id), "status": "Pending"
    })
    load_score = _load_factor(pending_count)
    load_weight = 0.15
    factors.append({
        "label": f"{pending_count} pending quests",
        "positive": pending_count <= 5,
        "value": load_score
    })

    # ── 5. Time-left factor ──
    time_score = _time_factor(user_id)
    time_weight = 0.10
    factors.append({
        "label": "Tasks have time to complete" if time_score >= 0.5 else "Some deadlines very tight",
        "positive": time_score >= 0.5,
        "value": time_score
    })

    # ── Composite probability ──
    raw = (
        hist_weight  * hist_rate +
        streak_weight * streak_score +
        mood_weight  * mood_normalized +
        load_weight  * load_score +
        time_weight  * time_score
    )
    prob = round(min(max(raw, 0.05), 0.99), 3)

    return {
        "probability": prob,
        "completion_probability": prob,
        "factors": factors,
        "pending_count": pending_count
    }


# ─────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────

def _historical_rate(user_id: str, days: int) -> float:
    db = get_db()
    cutoff = utc_now() - timedelta(days=days)
    total = db.tasks.count_documents({
        "userId": ObjectId(user_id),
        "createdAt": {"$gte": cutoff},
        "status": {"$in": ["Completed", "Missed"]}
    })
    if total == 0:
        return 0.55   # default for new users
    completed = db.tasks.count_documents({
        "userId": ObjectId(user_id),
        "createdAt": {"$gte": cutoff},
        "status": "Completed"
    })
    return completed / total


def _todays_mood(user_id: str) -> float:
    from models.mood_model import get_moods_in_range
    start, end = get_day_range(0)
    moods = get_moods_in_range(user_id, start, end)
    if not moods:
        return 0.0
    return sum(m["moodScore"] for m in moods) / len(moods)


def _load_factor(pending_count: int) -> float:
    """
    Fewer tasks → higher probability of completing.
    1-3: 1.0, 4-6: 0.8, 7-10: 0.6, >10: 0.3
    """
    if pending_count <= 3:   return 1.0
    if pending_count <= 6:   return 0.8
    if pending_count <= 10:  return 0.6
    return 0.3


def _time_factor(user_id: str) -> float:
    """
    Fraction of today's pending tasks that still have >1 hour before deadline.
    """
    db = get_db()
    now = utc_now()
    today_end = end_of_day()
    tasks = list(db.tasks.find({
        "userId": ObjectId(user_id),
        "status": "Pending",
        "deadline": {"$lte": today_end}
    }))
    if not tasks:
        return 0.8   # no tasks due today — neutral
    achievable = sum(
        1 for t in tasks
        if t.get("deadline") and (t["deadline"] - now).total_seconds() > 3600
    )
    return achievable / len(tasks)