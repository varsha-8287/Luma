"""
routes/alarm_routes.py — Alarm & Notification endpoints  v3.2.0
================================================================
Fixes:
  - /trigger endpoint: was not verifying user ownership before
    recording a trigger. Now fetches the alarm first and returns 404
    if it doesn't belong to the requesting user.
  - Notification unread-count route: moved above the <notif_id>
    wildcard routes so Flask resolves it correctly (it was being
    swallowed by /<notif_id>/read in some environments).

Alarms:
  POST   /api/alarms                  — create alarm
  GET    /api/alarms                  — list user alarms
  PUT    /api/alarms/<id>/toggle      — enable/disable
  PUT    /api/alarms/<id>/trigger     — record a trigger (fired/snoozed)
  DELETE /api/alarms/<id>             — delete alarm

Notifications:
  GET    /api/notifications                  — list (optional ?unread=true)
  GET    /api/notifications/unread-count     — badge count  ← MOVED ABOVE wildcard
  PUT    /api/notifications/read-all         — mark all read
  PUT    /api/notifications/<id>/read        — mark one read
  DELETE /api/notifications/<id>             — delete one
  DELETE /api/notifications                  — clear all
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models.alarm_model import (
    create_alarm, get_alarms_for_user, get_alarm_by_id,
    toggle_alarm, delete_alarm, record_alarm_trigger,
    create_notification, get_notifications_for_user,
    mark_all_read, mark_notification_read,
    delete_notification, clear_all_notifications, get_unread_count
)
from utils.helpers import error_response

alarm_bp = Blueprint("alarms", __name__, url_prefix="/api/alarms")
notif_bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")


# ══════════════════════════════════════════════
# ALARMS
# ══════════════════════════════════════════════

@alarm_bp.route("", methods=["POST"])
@jwt_required()
def add_alarm():
    user_id = get_jwt_identity()
    data    = request.get_json(silent=True) or {}

    label         = (data.get("label") or "Wake Up Alarm").strip()
    time          = (data.get("time") or "").strip()
    voice_profile = (data.get("voiceProfile") or data.get("voice_profile") or "strict").strip()
    repeat        = data.get("repeat", [])

    if not time or len(time) != 5 or time[2] != ":":
        return jsonify(error_response("Invalid time format. Use HH:MM", 400)[0]), 400
    if not isinstance(repeat, list):
        repeat = []

    alarm = create_alarm(user_id, label, time, voice_profile, repeat)

    create_notification(
        user_id, "alarm",
        "⏰ Alarm Set!",
        f'"{label}" alarm set for {time}.'
    )

    return jsonify({"success": True, "alarm": alarm}), 201


@alarm_bp.route("", methods=["GET"])
@jwt_required()
def list_alarms():
    user_id = get_jwt_identity()
    alarms  = get_alarms_for_user(user_id)
    return jsonify({"success": True, "alarms": alarms}), 200


@alarm_bp.route("/<alarm_id>/toggle", methods=["PUT"])
@jwt_required()
def toggle(alarm_id: str):
    user_id = get_jwt_identity()
    alarm   = toggle_alarm(alarm_id, user_id)
    if not alarm:
        return jsonify(error_response("Alarm not found", 404)[0]), 404
    return jsonify({"success": True, "alarm": alarm}), 200


@alarm_bp.route("/<alarm_id>/trigger", methods=["PUT"])
@jwt_required()
def trigger(alarm_id: str):
    """
    Called by the frontend when an alarm fires or is snoozed.
    Body: { snoozed: bool }
    BUG FIX: now verifies ownership before recording trigger.
    """
    user_id = get_jwt_identity()

    # Verify the alarm belongs to this user before touching it
    alarm = get_alarm_by_id(alarm_id, user_id)
    if not alarm:
        return jsonify(error_response("Alarm not found", 404)[0]), 404

    data    = request.get_json(silent=True) or {}
    snoozed = bool(data.get("snoozed", False))
    updated = record_alarm_trigger(alarm_id, snoozed)
    if not updated:
        return jsonify(error_response("Alarm not found", 404)[0]), 404
    return jsonify({"success": True, "alarm": updated}), 200


@alarm_bp.route("/<alarm_id>", methods=["DELETE"])
@jwt_required()
def remove_alarm(alarm_id: str):
    user_id = get_jwt_identity()
    deleted = delete_alarm(alarm_id, user_id)
    if not deleted:
        return jsonify(error_response("Alarm not found", 404)[0]), 404
    return jsonify({"success": True, "message": "Alarm deleted."}), 200


# ══════════════════════════════════════════════
# NOTIFICATIONS
# ══════════════════════════════════════════════

@notif_bp.route("", methods=["GET"])
@jwt_required()
def list_notifications():
    user_id     = get_jwt_identity()
    unread_only = request.args.get("unread", "").lower() == "true"
    limit       = min(int(request.args.get("limit", 50)), 200)
    notifs      = get_notifications_for_user(user_id, limit, unread_only)
    return jsonify({"success": True, "notifications": notifs}), 200


# ── IMPORTANT: static routes MUST be registered before wildcard routes ──
# Otherwise Flask matches "unread-count" as a <notif_id> parameter.

@notif_bp.route("/unread-count", methods=["GET"])
@jwt_required()
def unread_count():
    user_id = get_jwt_identity()
    count   = get_unread_count(user_id)
    return jsonify({"success": True, "unreadCount": count}), 200


@notif_bp.route("/read-all", methods=["PUT"])
@jwt_required()
def read_all():
    user_id  = get_jwt_identity()
    modified = mark_all_read(user_id)
    return jsonify({"success": True, "markedRead": modified}), 200


@notif_bp.route("/<notif_id>/read", methods=["PUT"])
@jwt_required()
def read_one(notif_id: str):
    user_id = get_jwt_identity()
    ok      = mark_notification_read(notif_id, user_id)
    if not ok:
        return jsonify(error_response("Notification not found", 404)[0]), 404
    return jsonify({"success": True}), 200


@notif_bp.route("/<notif_id>", methods=["DELETE"])
@jwt_required()
def delete_one(notif_id: str):
    user_id = get_jwt_identity()
    deleted = delete_notification(notif_id, user_id)
    if not deleted:
        return jsonify(error_response("Notification not found", 404)[0]), 404
    return jsonify({"success": True, "message": "Notification deleted."}), 200


@notif_bp.route("", methods=["DELETE"])
@jwt_required()
def clear_all():
    user_id = get_jwt_identity()
    count   = clear_all_notifications(user_id)
    return jsonify({"success": True, "deletedCount": count}), 200


# ── Internal helper ────────────────────────────────────────────
def push_system_notification(user_id: str, notif_type: str,
                              title: str, message: str, persistent: bool = False):
    """Called by other modules (gamification, tasks, etc.) to log notifications."""
    try:
        create_notification(user_id, notif_type, title, message, persistent)
    except Exception:
        pass   # never crash the caller