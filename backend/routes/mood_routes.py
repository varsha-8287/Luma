"""
routes/mood_routes.py — Mood endpoints
POST /api/mood
GET  /api/mood
GET  /api/mood/daily-summary
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models.mood_model import (
    log_mood, get_moods_for_user, get_daily_summary,
    get_moods_in_range, MOOD_SCORES
)
from utils.helpers import error_response, get_day_range, start_of_day, end_of_day

mood_bp = Blueprint("mood", __name__, url_prefix="/api/mood")


@mood_bp.route("", methods=["POST"])
@jwt_required()
def add_mood():
    user_id  = get_jwt_identity()
    data     = request.get_json(silent=True) or {}
    mood_type = (data.get("moodType") or data.get("mood_type") or "").strip()

    if mood_type not in MOOD_SCORES:
        return jsonify(error_response(
            f"Invalid moodType. Valid: {list(MOOD_SCORES.keys())}", 400)[0]
        ), 400

    mood = log_mood(user_id, mood_type)
    return jsonify({"success": True, "mood": mood}), 201


@mood_bp.route("", methods=["GET"])
@jwt_required()
def list_moods():
    user_id = get_jwt_identity()
    limit   = min(int(request.args.get("limit", 30)), 100)
    moods   = get_moods_for_user(user_id, limit=limit)
    return jsonify(moods), 200


@mood_bp.route("/daily-summary", methods=["GET"])
@jwt_required()
def daily_summary():
    user_id = get_jwt_identity()
    start, end = get_day_range(0)

    moods   = get_moods_in_range(user_id, start, end)
    summary = get_daily_summary(user_id, start, end)

    avg_score = (
        sum(m["moodScore"] for m in moods) / len(moods)
        if moods else 0
    )

    return jsonify({
        "success": True,
        "moods": moods,
        "summary": summary,
        "averageScore": round(avg_score, 2),
        "average_score": round(avg_score, 2),
        "totalEntries": len(moods),
        "total_entries": len(moods),
    }), 200