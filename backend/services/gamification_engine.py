"""
services/gamification_engine.py — Full Gamification Engine
===========================================================
Handles:
  - XP award with multipliers (streak × mood)
  - Badge unlock logic (18 badges)
  - XP history logging
  - Weekly "Spotify Wrapped" analytics
  - Streak update logic
"""
from bson import ObjectId
from utils.db import get_db
from utils.helpers import utc_now, serialize_doc, serialize_list, get_day_range
from config import Config
from datetime import timedelta
from models.user_model import find_user_by_id, update_user_xp, increment_completed_count
import math


# ─────────────────────────────────────────────
# XP Award
# ─────────────────────────────────────────────

def award_xp(user_id: str, base_xp: int, reason: str, task_id: str = None) -> dict:
    """
    Award XP with multiplier applied.
    Multiplier = 1 + (streak_bonus) + (mood_bonus)
    Returns { xp_earned, multiplier, new_total, leveled_up }
    """
    user = find_user_by_id(user_id)
    if not user:
        return {}

    multiplier = _compute_multiplier(user)
    xp_earned = round(base_xp * multiplier) if base_xp > 0 else base_xp
    xp_earned = max(xp_earned, base_xp)   # never award less than base for positives

    updated_user, leveled_up = update_user_xp(user_id, xp_earned)

    # Log XP history
    _log_xp(user_id, xp_earned, reason, task_id)

    # Check badge unlocks
    badges_unlocked = check_and_unlock_badges(user_id, updated_user)

    return {
        "xp_earned":      xp_earned,
        "base_xp":        base_xp,
        "multiplier":     round(multiplier, 2),
        "new_total_xp":   updated_user["totalXP"],
        "new_level":      updated_user["level"],
        "leveled_up":     leveled_up,
        "badges_unlocked": badges_unlocked,
        "user":           updated_user,
    }


def _compute_multiplier(user: dict) -> float:
    streak = user.get("streak", 0)
    mood_streak = user.get("moodPositiveStreak", 0)

    streak_bonus = min(0.5, streak * 0.05)          # +5% per day, capped at +50%
    mood_bonus   = min(0.25, mood_streak * 0.05)    # +5% per mood-positive day, capped +25%

    return round(1.0 + streak_bonus + mood_bonus, 2)


def _log_xp(user_id: str, xp: int, reason: str, task_id: str = None):
    db = get_db()
    doc = {
        "userId": ObjectId(user_id),
        "xp": xp,
        "reason": reason,
        "taskId": ObjectId(task_id) if task_id else None,
        "timestamp": utc_now(),
    }
    db.xp_history.insert_one(doc)


def get_xp_history(user_id: str, limit: int = 50) -> list:
    db = get_db()
    history = list(db.xp_history.find(
        {"userId": ObjectId(user_id)},
        sort=[("timestamp", -1)],
        limit=limit
    ))
    return serialize_list(history)


# ─────────────────────────────────────────────
# Streak Management
# ─────────────────────────────────────────────

def update_daily_streak(user_id: str):
    """
    Called at midnight. Checks if user completed any task yesterday.
    Increments or resets streak accordingly.
    """
    db = get_db()
    start, end = get_day_range(1)   # yesterday
    completed_yesterday = db.tasks.count_documents({
        "userId": ObjectId(user_id),
        "status": "Completed",
        "completedAt": {"$gte": start, "$lte": end}
    })
    user = db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return

    if completed_yesterday > 0:
        new_streak = user.get("streak", 0) + 1
    else:
        new_streak = 0

    db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"streak": new_streak}}
    )

    # Award streak bonus XP
    if new_streak > 0 and new_streak % 7 == 0:
        award_xp(user_id, 50, f"7-day streak milestone! ({new_streak} days)")
    elif new_streak > 0 and new_streak % 3 == 0:
        award_xp(user_id, 15, f"3-day streak bonus")


# ─────────────────────────────────────────────
# Badge System (18 badges)
# ─────────────────────────────────────────────

BADGE_DEFINITIONS = [
    # id, name, emoji, description, check_fn_name
    ("first_quest",    "First Blood",         "⚔️",  "Complete your first quest"),
    ("tasks_10",       "Quest Adept",          "📋",  "Complete 10 quests"),
    ("tasks_50",       "Quest Master",         "🗡️",  "Complete 50 quests"),
    ("tasks_100",      "Quest Champion",       "👑",  "Complete 100 quests"),
    ("streak_3",       "On Fire",              "🔥",  "3-day streak"),
    ("streak_7",       "Unstoppable",          "🌊",  "7-day streak"),
    ("streak_30",      "Legendary Streak",     "🌟",  "30-day streak"),
    ("xp_100",         "XP Hunter",            "💫",  "Earn 100 XP"),
    ("xp_500",         "XP Warrior",           "⭐",  "Earn 500 XP"),
    ("xp_1000",        "XP Legend",            "🏆",  "Earn 1000 XP"),
    ("level_5",        "Apprentice Hero",      "🎯",  "Reach Level 5"),
    ("level_10",       "True Hero",            "🦸",  "Reach Level 10"),
    ("level_25",       "Productivity Sage",    "🧙",  "Reach Level 25"),
    ("early_bird",     "Early Bird",           "🐦",  "Complete 5 tasks before deadline"),
    ("happy_streak",   "Mood Warrior",         "😊",  "3 consecutive days of Happy mood"),
    ("perfect_day",    "Perfect Day",          "💎",  "Complete all tasks due in a single day"),
    ("journal_10",     "Chronicler",           "📖",  "Write 10 journal entries"),
    ("night_owl",      "Night Owl",            "🦉",  "Complete a task after midnight"),
]


def check_and_unlock_badges(user_id: str, user: dict) -> list:
    """Check all badge conditions and unlock newly earned badges."""
    db = get_db()
    already_earned = {
        b["badge_id"] for b in db.badges.find({"userId": ObjectId(user_id)})
    }

    newly_unlocked = []
    for badge_id, name, emoji, desc in BADGE_DEFINITIONS:
        if badge_id in already_earned:
            continue
        if _check_badge(badge_id, user_id, user):
            db.badges.insert_one({
                "userId": ObjectId(user_id),
                "badge_id": badge_id,
                "name": name,
                "emoji": emoji,
                "description": desc,
                "earnedAt": utc_now(),
            })
            newly_unlocked.append({"id": badge_id, "name": name, "emoji": emoji})

    return newly_unlocked


def _check_badge(badge_id: str, user_id: str, user: dict) -> bool:
    db = get_db()
    completed = user.get("completedTasksCount", 0)
    streak    = user.get("streak", 0)
    xp        = user.get("totalXP", 0)
    level     = user.get("level", 0)
    early     = user.get("earlyCompletionCount", 0)

    checks = {
        "first_quest":  completed >= 1,
        "tasks_10":     completed >= 10,
        "tasks_50":     completed >= 50,
        "tasks_100":    completed >= 100,
        "streak_3":     streak >= 3,
        "streak_7":     streak >= 7,
        "streak_30":    streak >= 30,
        "xp_100":       xp >= 100,
        "xp_500":       xp >= 500,
        "xp_1000":      xp >= 1000,
        "level_5":      level >= 5,
        "level_10":     level >= 10,
        "level_25":     level >= 25,
        "early_bird":   early >= 5,
        "happy_streak": _check_happy_streak(user_id),
        "perfect_day":  _check_perfect_day(user_id),
        "journal_10":   db.journals.count_documents({"userId": ObjectId(user_id)}) >= 10,
        "night_owl":    _check_night_owl(user_id),
    }
    return checks.get(badge_id, False)


def _check_happy_streak(user_id: str) -> bool:
    from models.mood_model import get_moods_in_range
    for i in range(1, 4):
        start, end = get_day_range(i)
        moods = get_moods_in_range(user_id, start, end)
        if not moods:
            return False
        if any(m["moodType"] != "Happy" for m in moods):
            return False
    return True


def _check_perfect_day(user_id: str) -> bool:
    db = get_db()
    start, end = get_day_range(1)  # yesterday
    due = db.tasks.count_documents({
        "userId": ObjectId(user_id),
        "deadline": {"$gte": start, "$lte": end}
    })
    completed = db.tasks.count_documents({
        "userId": ObjectId(user_id),
        "deadline": {"$gte": start, "$lte": end},
        "status": "Completed"
    })
    return due > 0 and due == completed


def _check_night_owl(user_id: str) -> bool:
    db = get_db()
    cutoff = utc_now() - timedelta(days=30)
    task = db.tasks.find_one({
        "userId": ObjectId(user_id),
        "status": "Completed",
        "completedAt": {"$gte": cutoff},
        "$expr": {"$gte": [{"$hour": "$completedAt"}, 23]}
    })
    return task is not None


def get_badges_for_user(user_id: str) -> list:
    db = get_db()
    badges = list(db.badges.find({"userId": ObjectId(user_id)}, sort=[("earnedAt", -1)]))
    return serialize_list(badges)


# ─────────────────────────────────────────────
# Weekly Wrapped Analytics
# ─────────────────────────────────────────────

def get_weekly_wrapped(user_id: str) -> dict:
    db = get_db()
    cutoff = utc_now() - timedelta(days=7)
    prev_cutoff = utc_now() - timedelta(days=14)

    tasks_this_week = list(db.tasks.find({
        "userId": ObjectId(user_id),
        "createdAt": {"$gte": cutoff}
    }))
    tasks_last_week = list(db.tasks.find({
        "userId": ObjectId(user_id),
        "createdAt": {"$gte": prev_cutoff, "$lt": cutoff}
    }))

    completed_this = [t for t in tasks_this_week if t["status"] == "Completed"]
    completed_last = [t for t in tasks_last_week if t["status"] == "Completed"]

    xp_this = sum(t.get("points", 0) for t in completed_this)
    xp_last = sum(t.get("points", 0) for t in completed_last)
    growth  = _pct_change(len(completed_last), len(completed_this))

    # Most active category
    from collections import Counter
    cat_counts = Counter(t.get("category", "work") for t in completed_this)
    top_category = cat_counts.most_common(1)[0][0] if cat_counts else "—"

    # Most skipped category
    missed_this = [t for t in tasks_this_week if t["status"] == "Missed"]
    skipped_cats = Counter(t.get("category", "work") for t in missed_this)
    most_skipped = skipped_cats.most_common(1)[0][0] if skipped_cats else "—"

    # Completion rate
    due = len([t for t in tasks_this_week if t["status"] in ("Completed", "Missed")])
    comp_rate = len(completed_this) / due if due > 0 else 0

    user = db.users.find_one({"_id": ObjectId(user_id)})

    return {
        "tasks_completed":   len(completed_this),
        "xp_earned":         xp_this,
        "best_streak":       user.get("streak", 0) if user else 0,
        "top_category":      top_category.capitalize(),
        "most_skipped":      most_skipped.capitalize(),
        "completion_rate":   round(comp_rate, 3),
        "growth_pct":        growth,
        "growth_percentage": growth,
    }


def get_weekly_stats(user_id: str) -> dict:
    """Return day-by-day data for charts."""
    days_data = []
    xp_per_day = []
    mood_scores_per_day = []
    completion_rates = []
    heatmap = {}
    cat_breakdown = {}

    from models.mood_model import get_moods_in_range
    db = get_db()

    for i in range(6, -1, -1):
        start, end = get_day_range(i)
        day_str = start.strftime("%Y-%m-%d")
        days_data.append(day_str)

        # XP
        xp_hist = list(db.xp_history.find({
            "userId": ObjectId(user_id),
            "timestamp": {"$gte": start, "$lte": end},
            "xp": {"$gt": 0}
        }))
        day_xp = sum(x["xp"] for x in xp_hist)
        xp_per_day.append(day_xp)
        heatmap[day_str] = len([x for x in xp_hist])

        # Mood
        moods = get_moods_in_range(user_id, start, end)
        avg_mood = sum(m["moodScore"] for m in moods) / len(moods) if moods else 0
        mood_scores_per_day.append(round(avg_mood, 2))

        # Completion rate
        total = db.tasks.count_documents({
            "userId": ObjectId(user_id),
            "deadline": {"$gte": start, "$lte": end},
            "status": {"$in": ["Completed", "Missed"]}
        })
        done = db.tasks.count_documents({
            "userId": ObjectId(user_id),
            "status": "Completed",
            "completedAt": {"$gte": start, "$lte": end}
        })
        completion_rates.append(round(done / total * 10, 2) if total > 0 else 0)

    # Category breakdown (last 30 days, percentage)
    cutoff30 = utc_now() - timedelta(days=30)
    pipeline = [
        {"$match": {"userId": ObjectId(user_id), "status": "Completed", "createdAt": {"$gte": cutoff30}}},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}}
    ]
    rows = list(db.tasks.aggregate(pipeline))
    total_cat = sum(r["count"] for r in rows) or 1
    for r in rows:
        cat_breakdown[r["_id"] or "work"] = round(r["count"] / total_cat * 100)

    return {
        "days":             days_data,
        "dates":            days_data,
        "xp_per_day":       xp_per_day,
        "mood_scores":      mood_scores_per_day,
        "completion_rates": completion_rates,
        "completion_heatmap": heatmap,
        "category_breakdown": cat_breakdown,
    }


def _pct_change(old: int, new: int) -> float:
    if old == 0:
        return 100.0 if new > 0 else 0.0
    return round((new - old) / old * 100, 1)