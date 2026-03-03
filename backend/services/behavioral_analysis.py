"""
services/behavioral_analysis.py — Behavioral Pattern Detection
===============================================================
Detects:
  1. Burnout — completion rate drops below threshold for 3+ consecutive days
  2. Procrastination — user repeatedly delays tasks of the same category
  3. Peak Productivity Hours — derived from completion timestamps
  4. Positive Momentum — strong streak / mood combo

Each pattern returns structured data for the frontend to display.
"""
from bson import ObjectId
from utils.db import get_db
from utils.helpers import utc_now, get_day_range
from datetime import timedelta
from collections import defaultdict


BURNOUT_THRESHOLD    = 0.30   # < 30% completion triggers burnout flag
BURNOUT_WINDOW       = 3      # consecutive days
PROCRASTINATION_MIN  = 3      # at least 3 missed/late tasks in same category
PROCRASTINATION_DAYS = 14


def analyze_patterns(user_id: str) -> dict:
    """
    Run all detectors and return:
    {
        patterns: [ {type, description, severity} ],
        suggestions: [ {text, icon} ]
    }
    """
    patterns   = []
    suggestions = []

    burnout = _detect_burnout(user_id)
    if burnout:
        patterns.append(burnout)
        suggestions.append({
            "text": "⚡ You may be burning out. Try breaking tasks into 15-minute micro-tasks today.",
            "icon": "fire"
        })

    procrastination = _detect_procrastination(user_id)
    if procrastination:
        patterns.append(procrastination)
        suggestions.append({
            "text": f"⏳ You often delay {procrastination['category']} tasks. Schedule one now using the 2-minute rule.",
            "icon": "clock"
        })

    peak = _detect_peak_hours(user_id)
    if peak:
        patterns.append(peak)
        suggestions.append({
            "text": f"⭐ You're most productive around {peak['peak_hour']}:00. Schedule critical tasks then!",
            "icon": "star"
        })

    momentum = _detect_positive_momentum(user_id)
    if momentum:
        patterns.append(momentum)
        suggestions.append({
            "text": "🚀 You're on a roll! Tackle your hardest quest while momentum is high.",
            "icon": "rocket"
        })

    if not suggestions:
        suggestions.append({
            "text": "💡 Complete more tasks to unlock personalized AI insights.",
            "icon": "lightbulb"
        })

    return {"patterns": patterns, "suggestions": suggestions}


# ─────────────────────────────────────────────
# Detectors
# ─────────────────────────────────────────────

def _detect_burnout(user_id: str) -> dict | None:
    """
    Check last BURNOUT_WINDOW days for consistently low completion.
    """
    db = get_db()
    low_days = 0

    for i in range(1, BURNOUT_WINDOW + 1):
        start, end = get_day_range(i)
        total = db.tasks.count_documents({
            "userId": ObjectId(user_id),
            "deadline": {"$gte": start, "$lte": end},
            "status": {"$in": ["Completed", "Missed"]}
        })
        if total == 0:
            continue
        completed = db.tasks.count_documents({
            "userId": ObjectId(user_id),
            "deadline": {"$gte": start, "$lte": end},
            "status": "Completed"
        })
        rate = completed / total
        if rate < BURNOUT_THRESHOLD:
            low_days += 1

    if low_days >= BURNOUT_WINDOW:
        return {
            "type": "burnout",
            "description": f"Your completion rate has been below {int(BURNOUT_THRESHOLD*100)}% for {low_days} consecutive days.",
            "severity": "high"
        }
    return None


def _detect_procrastination(user_id: str) -> dict | None:
    """
    Detect if user repeatedly misses tasks in the same category.
    """
    db = get_db()
    cutoff = utc_now() - timedelta(days=PROCRASTINATION_DAYS)

    pipeline = [
        {"$match": {
            "userId": ObjectId(user_id),
            "status": "Missed",
            "deadline": {"$gte": cutoff}
        }},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    rows = list(db.tasks.aggregate(pipeline))
    if rows and rows[0]["count"] >= PROCRASTINATION_MIN:
        category = rows[0]["_id"] or "general"
        return {
            "type": "procrastination",
            "description": f"You've missed {rows[0]['count']} '{category}' tasks in the last {PROCRASTINATION_DAYS} days.",
            "category": category,
            "severity": "medium"
        }
    return None


def _detect_peak_hours(user_id: str) -> dict | None:
    """
    Find the hour of day with the most task completions.
    """
    db = get_db()
    cutoff = utc_now() - timedelta(days=30)

    tasks = list(db.tasks.find({
        "userId": ObjectId(user_id),
        "status": "Completed",
        "completedAt": {"$gte": cutoff, "$ne": None}
    }))

    if len(tasks) < 5:
        return None

    hour_counts = defaultdict(int)
    for t in tasks:
        if t.get("completedAt"):
            hour_counts[t["completedAt"].hour] += 1

    if not hour_counts:
        return None

    peak_hour = max(hour_counts, key=hour_counts.get)
    return {
        "type": "peak_hours",
        "description": f"You complete most tasks around {peak_hour}:00.",
        "peak_hour": peak_hour,
        "severity": "info"
    }


def _detect_positive_momentum(user_id: str) -> dict | None:
    """Fires when streak >= 5 and last 3 days all had completions."""
    db = get_db()
    user = db.users.find_one({"_id": ObjectId(user_id)})
    if not user or user.get("streak", 0) < 5:
        return None

    for i in range(1, 4):
        start, end = get_day_range(i)
        count = db.tasks.count_documents({
            "userId": ObjectId(user_id),
            "status": "Completed",
            "completedAt": {"$gte": start, "$lte": end}
        })
        if count == 0:
            return None

    return {
        "type": "positive_streak",
        "description": f"Outstanding {user['streak']}-day streak! You've completed tasks every day this week.",
        "severity": "positive"
    }