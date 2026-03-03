"""
services/productivity_score.py — Discipline / Productivity Score
=================================================================
Multi-factor score (0–100) based on:

  1. Completion Rate     (35%) — tasks completed / total due
  2. Streak Consistency  (25%) — current streak contribution
  3. Task Difficulty     (20%) — average difficulty of completed tasks
  4. Mood Stability      (20%) — variance of mood scores (lower = better)

Updates daily via cron. Also provides factor breakdown for the frontend.
"""
from bson import ObjectId
from utils.db import get_db
from utils.helpers import utc_now, get_day_range
from config import Config
from datetime import timedelta
import statistics


def compute_productivity_score(user_id: str) -> dict:
    """
    Compute and persist the productivity score for a user.
    Returns { score, factors, user }.
    """
    db = get_db()
    user = db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return {"score": 0, "factors": {}, "user": None}

    completion_pct = _completion_rate(user_id)
    streak_pct     = _streak_score(user.get("streak", 0))
    difficulty_pct = _difficulty_score(user_id)
    mood_pct       = _mood_stability_score(user_id)

    w = Config
    score = (
        w.SCORE_WEIGHT_COMPLETION * completion_pct +
        w.SCORE_WEIGHT_STREAK     * streak_pct +
        w.SCORE_WEIGHT_DIFFICULTY * difficulty_pct +
        w.SCORE_WEIGHT_MOOD       * mood_pct
    )
    score = round(min(max(score, 0), 100), 1)

    factors = {
        "completion_rate": round(completion_pct, 1),
        "streak_score":    round(streak_pct, 1),
        "difficulty_bonus": round(difficulty_pct, 1),
        "mood_stability":  round(mood_pct, 1),
    }

    # Persist
    db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"productivityScore": score, "scoreFactors": factors}}
    )

    from utils.helpers import serialize_doc
    updated_user = db.users.find_one({"_id": ObjectId(user_id)})
    updated_user.pop("password", None)

    return {
        "score": score,
        "factors": factors,
        "user": serialize_doc(updated_user),
    }


# ─────────────────────────────────────────────
# Factor calculators
# ─────────────────────────────────────────────

def _completion_rate(user_id: str, days: int = 14) -> float:
    """Percentage of non-missed tasks completed in last `days` days (scaled 0-100)."""
    db = get_db()
    cutoff = utc_now() - timedelta(days=days)
    total = db.tasks.count_documents({
        "userId": ObjectId(user_id),
        "createdAt": {"$gte": cutoff},
        "status": {"$in": ["Completed", "Missed"]}
    })
    if total == 0:
        return 50.0   # neutral default for new users
    completed = db.tasks.count_documents({
        "userId": ObjectId(user_id),
        "createdAt": {"$gte": cutoff},
        "status": "Completed"
    })
    return (completed / total) * 100


def _streak_score(streak: int) -> float:
    """
    Convert streak to 0-100.
    Logarithmic: 1d→15, 3d→40, 7d→65, 14d→80, 30d→95
    """
    if streak <= 0:
        return 0.0
    return min(100.0, round(30 * (streak ** 0.5), 1))


def _difficulty_score(user_id: str, days: int = 14) -> float:
    """
    Average difficulty_score of completed tasks (0-1 scale → 0-100).
    Completing hard tasks earns more points.
    """
    db = get_db()
    cutoff = utc_now() - timedelta(days=days)
    pipeline = [
        {"$match": {
            "userId": ObjectId(user_id),
            "status": "Completed",
            "createdAt": {"$gte": cutoff}
        }},
        {"$group": {"_id": None, "avg_diff": {"$avg": "$difficulty_score"}}}
    ]
    result = list(db.tasks.aggregate(pipeline))
    if not result or result[0]["avg_diff"] is None:
        return 50.0
    return round(result[0]["avg_diff"] * 100, 1)


def _mood_stability_score(user_id: str, days: int = 7) -> float:
    """
    Lower variance in mood scores = higher stability score.
    Returns 0-100.
    """
    from models.mood_model import get_moods_in_range
    scores = []
    for i in range(days):
        start, end = get_day_range(i)
        from models.mood_model import get_moods_in_range
        moods = get_moods_in_range(user_id, start, end)
        for m in moods:
            scores.append(m["moodScore"])

    if len(scores) < 2:
        return 50.0

    # Normalize variance: mood range is -5 to +5 (max variance ~25)
    variance = statistics.variance(scores)
    stability = max(0.0, 100.0 - (variance / 25.0) * 100.0)
    return round(stability, 1)