"""
routes/reminder_routes.py — Reminder endpoints
GET /api/reminders
PUT /api/reminders/:id/ack
POST /api/reminders/call
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services.reminder_engine import (
    get_pending_reminders, acknowledge_reminder, trigger_voice_call
)
from utils.helpers import error_response

reminder_bp = Blueprint("reminders", __name__, url_prefix="/api/reminders")


@reminder_bp.route("", methods=["GET"])
@jwt_required()
def list_reminders():
    user_id   = get_jwt_identity()
    reminders = get_pending_reminders(user_id)
    return jsonify({"success": True, "reminders": reminders}), 200


@reminder_bp.route("/<task_id>/ack", methods=["PUT"])
@jwt_required()
def ack_reminder(task_id: str):
    user_id = get_jwt_identity()
    ok = acknowledge_reminder(user_id, task_id)
    if not ok:
        return jsonify(error_response("Task not found.", 404)[0]), 404
    return jsonify({"success": True, "message": "Reminder acknowledged."}), 200


@reminder_bp.route("/call", methods=["POST"])
@jwt_required()
def make_call():
    """
    Trigger an adaptive Twilio voice call.
    Body: { "phone": "+1XXXXXXXXXX" }
    """
    user_id = get_jwt_identity()
    data    = request.get_json(silent=True) or {}
    phone   = (data.get("phone") or "").strip()

    if not phone:
        return jsonify(error_response("Phone number required.", 400)[0]), 400

    result = trigger_voice_call(user_id, phone)
    status = 200 if result.get("success") else 400
    return jsonify(result), status