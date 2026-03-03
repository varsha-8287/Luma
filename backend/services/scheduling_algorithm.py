"""
services/scheduling_algorithm.py — Smart Task Scheduling Algorithm
====================================================================
Auto-ranks tasks using a weighted composite formula:

    score = w1 * priority_score
          + w2 * deadline_urgency
          + w3 * behavioral_history_score

The behavioral component uses past completion patterns per category
to adjust rank upward or downward dynamically.
"""
from datetime import datetime, timezone
from utils.db import get_db
from utils.helpers import utc_now
from config import Config
from bson import ObjectId
import math


# ─────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────

def rank_tasks_for_user(user_id: str, tasks: list) -> list:
    """
    Accept a list of serialized pending task dicts.
    Return same list with 'smart_rank' field added, sorted descending.
    """
    if not tasks:
        return tasks

    behavior_map = _get_behavioral_map(user_id)

    for task in tasks:
        task["smart_rank"] = _compute_rank(task, behavior_map)

    tasks.sort(key=lambda t: t["smart_rank"], reverse=True)

    # Persist ranks to DB
    db = get_db()
    for t in tasks:
        db.tasks.update_one(
            {"_id": ObjectId(t["_id"])},
            {"$set": {"smart_rank": t["smart_rank"]}}
        )

    return tasks


# ─────────────────────────────────────────────
# Scoring components
# ─────────────────────────────────────────────

def _compute_rank(task: dict, behavior_map: dict) -> float:
    w1 = Config.RANK_WEIGHT_PRIORITY
    w2 = Config.RANK_WEIGHT_DEADLINE
    w3 = Config.RANK_WEIGHT_BEHAVIOR

    p  = _priority_score(task.get("priority", 2))
    d  = _deadline_urgency(task.get("deadline"))
    b  = _behavioral_score(task.get("category", "work"), behavior_map)

    raw = w1 * p + w2 * d + w3 * b
    return round(min(max(raw, 0.0), 1.0), 4)


def _priority_score(priority: int) -> float:
    """Map priority 1/2/3 → 0.33 / 0.66 / 1.0"""
    return {1: 0.33, 2: 0.66, 3: 1.0}.get(int(priority), 0.66)


def _deadline_urgency(deadline_str) -> float:
    """
    Urgency rises as deadline approaches.
    > 7 days  → 0.0
    < 1 hour  → 1.0
    Logistic curve between.
    """
    if not deadline_str:
        return 0.5
    try:
        if isinstance(deadline_str, str):
            deadline = datetime.fromisoformat(deadline_str.replace("Z", "+00:00"))
        else:
            deadline = deadline_str
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)

        seconds_left = (deadline - utc_now()).total_seconds()

        if seconds_left <= 0:
            return 1.0                          # overdue → top urgency
        if seconds_left >= 7 * 86400:
            return 0.0

        # Normalise to 0-1 over 7-day window, then apply sigmoid
        t = 1.0 - (seconds_left / (7 * 86400))
        return round(1 / (1 + math.exp(-10 * (t - 0.5))), 4)
    except Exception:
        return 0.5


def _behavioral_score(category: str, behavior_map: dict) -> float:
    """
    behavior_map: { category: completion_rate (0-1) }
    High completion rate in a category → slight boost (user is good at it).
    Low rate → slight penalty to signal task needs focus.
    We INVERT this: penalize what user avoids to push it higher in rank.
    """
    rate = behavior_map.get(category, 0.5)
    # Invert: categories with low completion get pushed up (need attention)
    return round(1.0 - rate * 0.4, 4)   # range: 0.6 – 1.0


# ─────────────────────────────────────────────
# Behavioral history map
# ─────────────────────────────────────────────

def _get_behavioral_map(user_id: str) -> dict:
    """
    Returns { category: completion_rate } from last 30 days.
    Uses MongoDB aggregation.
    """
    db = get_db()
    from datetime import timedelta
    cutoff = utc_now() - timedelta(days=30)

    pipeline = [
        {"$match": {
            "userId": ObjectId(user_id),
            "createdAt": {"$gte": cutoff}
        }},
        {"$group": {
            "_id": "$category",
            "total": {"$sum": 1},
            "completed": {
                "$sum": {"$cond": [{"$eq": ["$status", "Completed"]}, 1, 0]}
            }
        }}
    ]
    rows = list(db.tasks.aggregate(pipeline))
    result = {}
    for row in rows:
        cat = row["_id"] or "work"
        if row["total"] > 0:
            result[cat] = round(row["completed"] / row["total"], 3)
    return result