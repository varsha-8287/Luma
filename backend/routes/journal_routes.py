"""
routes/journal_routes.py — Journal endpoints
POST   /api/journal
GET    /api/journal
DELETE /api/journal/:id
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models.journal_model import create_entry, get_entries_by_user, delete_entry
from utils.helpers import error_response

journal_bp = Blueprint("journal", __name__, url_prefix="/api/journal")


@journal_bp.route("", methods=["POST"])
@jwt_required()
def add_entry():
    user_id = get_jwt_identity()
    data    = request.get_json(silent=True) or {}
    title   = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    if not title or not content:
        return jsonify(error_response("Title and content are required.", 400)[0]), 400
    entry = create_entry(user_id, title, content)
    return jsonify({"success": True, "entry": entry}), 201


@journal_bp.route("", methods=["GET"])
@jwt_required()
def list_entries():
    user_id = get_jwt_identity()
    entries = get_entries_by_user(user_id)
    return jsonify(entries), 200


@journal_bp.route("/<entry_id>", methods=["DELETE"])
@jwt_required()
def remove_entry(entry_id: str):
    user_id = get_jwt_identity()
    deleted = delete_entry(entry_id, user_id)
    if not deleted:
        return jsonify(error_response("Entry not found.", 404)[0]), 404
    return jsonify({"success": True, "message": "Entry deleted."}), 200


# ────────────────────────────────────────────────────────────
# Gamification routes (badges, XP history)
# ────────────────────────────────────────────────────────────
from flask import Blueprint as _BP
from services.gamification_engine import get_badges_for_user, get_xp_history

gamification_bp = _BP("gamification", __name__, url_prefix="/api/gamification")


@gamification_bp.route("/badges", methods=["GET"])
@jwt_required()
def badges():
    user_id = get_jwt_identity()
    return jsonify(get_badges_for_user(user_id)), 200


@gamification_bp.route("/xp-history", methods=["GET"])
@jwt_required()
def xp_history():
    user_id = get_jwt_identity()
    limit   = min(int(request.args.get("limit", 50)), 200)
    return jsonify(get_xp_history(user_id, limit=limit)), 200