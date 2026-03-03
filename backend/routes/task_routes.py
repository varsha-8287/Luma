"""
routes/task_routes.py — Task endpoints
POST   /api/tasks
GET    /api/tasks
GET    /api/tasks/smart-ranked
PUT    /api/tasks/:id/complete
DELETE /api/tasks/:id
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime, timezone
from models.task_model import (
    create_task, get_tasks_by_user, get_task_by_id,
    complete_task, delete_task, get_overdue_pending_tasks,
    mark_task_missed, get_pending_tasks_by_user
)
from models.user_model import update_user_xp
from services.scheduling_algorithm import rank_tasks_for_user
from services.gamification_engine import award_xp, check_and_unlock_badges, get_badges_for_user
from utils.helpers import error_response, success_response
from config import Config

task_bp = Blueprint("tasks", __name__, url_prefix="/api/tasks")


def _parse_deadline(raw) -> datetime:
    if not raw:
        raise ValueError("deadline is required")
    if isinstance(raw, datetime):
        return raw.replace(tzinfo=timezone.utc) if raw.tzinfo is None else raw
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        raise ValueError(f"Invalid deadline format: {raw}")


@task_bp.route("", methods=["POST"])
@jwt_required()
def add_task():
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}

    name     = (data.get("name") or "").strip()
    desc     = (data.get("description") or "").strip()
    priority = int(data.get("priority", 2))
    category = (data.get("category") or "work").lower()

    if not name:
        return jsonify(error_response("Task name is required.", 400)[0]), 400

    try:
        deadline = _parse_deadline(data.get("deadline"))
    except ValueError as e:
        return jsonify(error_response(str(e), 400)[0]), 400

    task = create_task(user_id, name, desc, deadline, priority, category)
    return jsonify({"success": True, "task": task}), 201


@task_bp.route("", methods=["GET"])
@jwt_required()
def list_tasks():
    """
    Returns all tasks for the current user.
    Auto-marks overdue pending tasks as Missed (with XP deduction).
    """
    user_id = get_jwt_identity()
    _auto_miss_overdue(user_id)
    tasks = get_tasks_by_user(user_id)
    return jsonify(tasks), 200


@task_bp.route("/smart-ranked", methods=["GET"])
@jwt_required()
def smart_ranked():
    """Return pending tasks sorted by AI smart-rank score."""
    user_id = get_jwt_identity()
    _auto_miss_overdue(user_id)
    pending = get_pending_tasks_by_user(user_id)
    ranked  = rank_tasks_for_user(user_id, pending)
    return jsonify(ranked), 200


@task_bp.route("/<task_id>/complete", methods=["PUT"])
@jwt_required()
def complete(task_id: str):
    user_id = get_jwt_identity()
    task = get_task_by_id(task_id, user_id)

    if not task:
        return jsonify(error_response("Task not found.", 404)[0]), 404
    if task["status"] != "Pending":
        return jsonify(error_response(f"Task is already {task['status']}.", 400)[0]), 400

    from utils.helpers import utc_now
    from datetime import datetime, timezone
    now = utc_now()
    deadline_raw = task["deadline"]
    if isinstance(deadline_raw, str):
        deadline = datetime.fromisoformat(deadline_raw.replace("Z", "+00:00"))
    else:
        deadline = deadline_raw
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)

    completed_early = now < deadline
    base_xp = Config.XP_COMPLETE_EARLY if completed_early else Config.XP_COMPLETE_ONTIME

    # Award XP with multiplier
    xp_result = award_xp(user_id, base_xp,
                         f"Completed task: {task['name']}",
                         task_id=task_id)

    xp_earned = xp_result.get("xp_earned", base_xp)

    updated_task = complete_task(task_id, user_id, xp_earned)

    # Increment completed count
    from models.user_model import increment_completed_count
    increment_completed_count(user_id, early=completed_early)

    return jsonify({
        "success": True,
        "task": updated_task,
        "xp_earned": xp_earned,
        "xpEarned": xp_earned,
        "base_xp": base_xp,
        "multiplier": xp_result.get("multiplier", 1.0),
        "completed_early": completed_early,
        "completedEarly": completed_early,
        "leveled_up": xp_result.get("leveled_up", False),
        "badges_unlocked": xp_result.get("badges_unlocked", []),
        "user": xp_result.get("user"),
        "updated_user": xp_result.get("user"),
    }), 200


@task_bp.route("/<task_id>", methods=["DELETE"])
@jwt_required()
def remove_task(task_id: str):
    user_id = get_jwt_identity()
    deleted = delete_task(task_id, user_id)
    if not deleted:
        return jsonify(error_response("Task not found.", 404)[0]), 404
    return jsonify({"success": True, "message": "Task deleted."}), 200


# ─────────────────────────────────────────────
# Internal: auto-mark overdue tasks as missed
# ─────────────────────────────────────────────

def _auto_miss_overdue(user_id: str):
    from bson import ObjectId
    from utils.db import get_db
    from utils.helpers import utc_now

    db = get_db()
    now = utc_now()
    overdue = list(db.tasks.find({
        "userId": ObjectId(user_id),
        "status": "Pending",
        "deadline": {"$lt": now}
    }))

    for t in overdue:
        tid = str(t["_id"])
        mark_task_missed(tid, Config.XP_MISSED)
        # Deduct XP directly (no multiplier on penalties)
        update_user_xp(user_id, Config.XP_MISSED)