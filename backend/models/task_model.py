"""
models/task_model.py — Task document model
Fields: userId, name, description, priority, category, createdAt,
        deadline, completedAt, status, points, reminderScheduled,
        smart_rank, difficulty_score
"""
from datetime import datetime, timezone
from bson import ObjectId
from utils.db import get_db
from utils.helpers import serialize_doc, serialize_list, utc_now
from typing import Optional


VALID_STATUSES  = {"Pending", "Completed", "Missed"}
VALID_PRIORITIES = {1, 2, 3}   # 1=Low, 2=Normal, 3=Critical
VALID_CATEGORIES = {"work", "health", "personal", "learning", "social"}


def create_task(user_id: str, name: str, description: str,
                deadline: datetime, priority: int = 2,
                category: str = "work") -> dict:
    db = get_db()
    doc = {
        "userId": ObjectId(user_id),
        "name": name.strip(),
        "description": description.strip() if description else "",
        "priority": priority if priority in VALID_PRIORITIES else 2,
        "category": category if category in VALID_CATEGORIES else "work",
        "createdAt": utc_now(),
        "deadline": deadline,
        "completedAt": None,
        "status": "Pending",
        "points": 0,
        "reminderScheduled": False,
        "smart_rank": 0.0,
        "difficulty_score": _calc_difficulty(priority, deadline),
    }
    result = db.tasks.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


def _calc_difficulty(priority: int, deadline: datetime) -> float:
    """
    Simple difficulty score: high priority + tight deadline = harder.
    Range 0.0 – 1.0
    """
    from datetime import timedelta
    time_left = (deadline - utc_now()).total_seconds()
    deadline_factor = max(0.0, min(1.0, 1.0 - time_left / (7 * 86400)))
    priority_factor = (priority - 1) / 2.0   # 0.0, 0.5, 1.0
    return round(0.5 * deadline_factor + 0.5 * priority_factor, 3)


def get_tasks_by_user(user_id: str) -> list:
    db = get_db()
    tasks = list(db.tasks.find(
        {"userId": ObjectId(user_id)},
        sort=[("deadline", 1)]
    ))
    return serialize_list(tasks)


def get_pending_tasks_by_user(user_id: str) -> list:
    db = get_db()
    tasks = list(db.tasks.find(
        {"userId": ObjectId(user_id), "status": "Pending"},
        sort=[("deadline", 1)]
    ))
    return serialize_list(tasks)


def get_task_by_id(task_id: str, user_id: str) -> Optional[dict]:
    db = get_db()
    try:
        doc = db.tasks.find_one({
            "_id": ObjectId(task_id),
            "userId": ObjectId(user_id)
        })
        return serialize_doc(doc) if doc else None
    except Exception:
        return None


def complete_task(task_id: str, user_id: str, xp_earned: int) -> Optional[dict]:
    db = get_db()
    now = utc_now()
    result = db.tasks.find_one_and_update(
        {"_id": ObjectId(task_id), "userId": ObjectId(user_id), "status": "Pending"},
        {"$set": {
            "status": "Completed",
            "completedAt": now,
            "points": xp_earned,
        }},
        return_document=True
    )
    return serialize_doc(result) if result else None


def mark_task_missed(task_id: str, xp_lost: int = -10) -> Optional[dict]:
    db = get_db()
    result = db.tasks.find_one_and_update(
        {"_id": ObjectId(task_id), "status": "Pending"},
        {"$set": {"status": "Missed", "points": xp_lost}},
        return_document=True
    )
    return serialize_doc(result) if result else None


def delete_task(task_id: str, user_id: str) -> bool:
    db = get_db()
    result = db.tasks.delete_one({
        "_id": ObjectId(task_id),
        "userId": ObjectId(user_id)
    })
    return result.deleted_count > 0


def update_task_smart_rank(task_id: str, rank: float):
    db = get_db()
    db.tasks.update_one(
        {"_id": ObjectId(task_id)},
        {"$set": {"smart_rank": rank}}
    )


def get_overdue_pending_tasks(before: datetime = None) -> list:
    """Return all Pending tasks whose deadline has passed."""
    db = get_db()
    cutoff = before or utc_now()
    tasks = list(db.tasks.find({"status": "Pending", "deadline": {"$lt": cutoff}}))
    return serialize_list(tasks)


def get_tasks_completed_on_date(user_id: str, start: datetime, end: datetime) -> list:
    db = get_db()
    tasks = list(db.tasks.find({
        "userId": ObjectId(user_id),
        "status": "Completed",
        "completedAt": {"$gte": start, "$lte": end}
    }))
    return serialize_list(tasks)


def count_tasks_by_status(user_id: str) -> dict:
    db = get_db()
    pipeline = [
        {"$match": {"userId": ObjectId(user_id)}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}}
    ]
    result = {r["_id"]: r["count"] for r in db.tasks.aggregate(pipeline)}
    return {
        "Pending":   result.get("Pending", 0),
        "Completed": result.get("Completed", 0),
        "Missed":    result.get("Missed", 0),
    }


def get_recent_tasks(user_id: str, days: int = 7) -> list:
    from datetime import timedelta
    cutoff = utc_now() - timedelta(days=days)
    db = get_db()
    tasks = list(db.tasks.find({
        "userId": ObjectId(user_id),
        "createdAt": {"$gte": cutoff}
    }, sort=[("createdAt", -1)]))
    return serialize_list(tasks)