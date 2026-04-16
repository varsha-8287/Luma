"""
routes/alarm_routes.py — Alarm & Notification endpoints  v3.3.0
================================================================
NEW in v3.3.0:
  - POST /api/alarms/phone          — save phone number for wake-up calls
  - GET  /api/alarms/phone          — get current saved phone
  - POST /api/alarms/test-call      — trigger a test alarm call immediately
  - All other endpoints unchanged from v3.2.0

Alarms:
  POST   /api/alarms                  — create alarm
  GET    /api/alarms                  — list user alarms
  PUT    /api/alarms/<id>/toggle      — enable/disable
  PUT    /api/alarms/<id>/trigger     — record a trigger (fired/snoozed)
  DELETE /api/alarms/<id>             — delete alarm
  POST   /api/alarms/phone            — save phone number (NEW)
  GET    /api/alarms/phone            — get phone number (NEW)
  POST   /api/alarms/test-call        — test the wake-up call (NEW)

Notifications:
  GET    /api/notifications                  — list (optional ?unread=true)
  GET    /api/notifications/unread-count     — badge count
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
    delete_notification, clear_all_notifications, get_unread_count,
    VALID_ALARM_MODES
)
from models.user_model import update_user_phone, find_user_by_id, get_public_user
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
    alarm_mode    = (data.get("alarmMode") or data.get("alarm_mode") or "normal").strip()

    if alarm_mode not in VALID_ALARM_MODES:
        alarm_mode = "normal"

    if not time or len(time) != 5 or time[2] != ":":
        return jsonify(error_response("Invalid time format. Use HH:MM", 400)[0]), 400
    if not isinstance(repeat, list):
        repeat = []

    alarm = create_alarm(user_id, label, time, voice_profile, repeat, alarm_mode)

    mode_label = "📞 Wake-Up Call" if alarm_mode == "wake_call" else "🔔 In-App"
    create_notification(
        user_id, "alarm",
        "⏰ Alarm Set!",
        f'"{label}" alarm set for {time} · {mode_label} mode.'
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
    user_id = get_jwt_identity()
    alarm   = get_alarm_by_id(alarm_id, user_id)
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
# PHONE NUMBER FOR ALARM CALLS  (NEW)
# ══════════════════════════════════════════════

@alarm_bp.route("/phone", methods=["POST"])
@jwt_required()
def save_phone():
    """
    Save the user's phone number for wake-up calls.
    Body: { "phone": "+919876543210", "alarmCallEnabled": true }
    Phone must be in E.164 format: +[country code][number]
    """
    user_id = get_jwt_identity()
    data    = request.get_json(silent=True) or {}
    phone   = (data.get("phone") or "").strip()
    enabled = bool(data.get("alarmCallEnabled", True))

    if not phone:
        return jsonify(error_response("Phone number is required.", 400)[0]), 400

    # Basic E.164 validation
    if not phone.startswith("+") or not phone[1:].isdigit() or len(phone) < 8:
        return jsonify(error_response(
            "Phone must be in E.164 format, e.g. +919876543210", 400)[0]
        ), 400

    updated_user = update_user_phone(user_id, phone, enabled)
    if not updated_user:
        return jsonify(error_response("User not found.", 404)[0]), 404

    return jsonify({
        "success": True,
        "message": "Phone number saved! You'll receive a call when your alarm goes off.",
        "user":    updated_user,
    }), 200


@alarm_bp.route("/phone", methods=["GET"])
@jwt_required()
def get_phone():
    """Return the user's saved phone number and call preference."""
    user_id = get_jwt_identity()
    user    = find_user_by_id(user_id)
    if not user:
        return jsonify(error_response("User not found.", 404)[0]), 404

    return jsonify({
        "success":          True,
        "phone":            user.get("phone", ""),
        "alarmCallEnabled": user.get("alarmCallEnabled", True),
    }), 200


# ══════════════════════════════════════════════
# TEST CALL  (NEW)
# ══════════════════════════════════════════════

@alarm_bp.route("/test-call", methods=["POST"])
@jwt_required()
def test_call():
    """
    Immediately trigger a test wake-up call to the user's saved phone.
    Use this so users can hear how their voice profile sounds before relying on it.
    """
    user_id = get_jwt_identity()

    from services.alarm_call_service import trigger_test_alarm_call
    result = trigger_test_alarm_call(user_id)

    status = 200 if result.get("success") else 400
    return jsonify(result), status


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
        pass