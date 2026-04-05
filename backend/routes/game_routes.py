"""
routes/game_routes.py — Brain Games endpoints
==============================================
POST   /api/games/score          — save a game session result
GET    /api/games/stats          — all game stats for current user
GET    /api/games/history        — recent sessions (optional ?game=memory)
GET    /api/games/leaderboard/<game_id> — top 10 for a game
GET    /api/games/xp             — total XP earned from games
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models.game_model import (
    save_game_score, get_user_game_stats,
    get_game_history, get_leaderboard, get_total_game_xp,
    VALID_GAMES, GAME_XP_REWARDS
)
from models.alarm_model import create_notification
from services.gamification_engine import award_xp
from utils.helpers import error_response

game_bp = Blueprint("games", __name__, url_prefix="/api/games")


@game_bp.route("/score", methods=["POST"])
@jwt_required()
def submit_score():
    """
    Save a completed game session and award XP.
    Body: { gameId, score, duration, won, metadata }
    """
    user_id = get_jwt_identity()
    data     = request.get_json(silent=True) or {}

    game_id  = (data.get("gameId") or data.get("game_id") or "").strip().lower()
    score    = int(data.get("score", 0))
    duration = int(data.get("duration", 0))
    won      = bool(data.get("won", False))
    metadata = data.get("metadata", {})

    if game_id not in VALID_GAMES:
        return jsonify(error_response(
            f"Invalid gameId. Valid: {list(VALID_GAMES)}", 400)[0]), 400

    try:
        session = save_game_score(user_id, game_id, score, duration, metadata, won)

        # Award XP via gamification engine (applies streak/mood multiplier)
        base_xp  = GAME_XP_REWARDS[game_id] if won else max(5, score // 20)
        reason   = f"Brain Game: {game_id.title()} {'win' if won else 'played'}"
        xp_result = award_xp(user_id, base_xp, reason)

        # Push a notification to DB
        if won:
            create_notification(
                user_id, "game",
                f"🎮 {game_id.title()} Complete!",
                f"You won {game_id.title()} and earned {xp_result.get('xp_earned', base_xp)} XP!"
            )

        return jsonify({
            "success":   True,
            "session":   session,
            "xp_earned": xp_result.get("xp_earned", base_xp),
            "multiplier":xp_result.get("multiplier", 1.0),
            "leveled_up":xp_result.get("leveled_up", False),
            "user":      xp_result.get("user"),
        }), 201

    except Exception as e:
        return jsonify(error_response(f"Failed to save score: {str(e)}", 500)[0]), 500


@game_bp.route("/stats", methods=["GET"])
@jwt_required()
def stats():
    """Return aggregated stats for every game the user has played."""
    user_id = get_jwt_identity()
    data    = get_user_game_stats(user_id)
    return jsonify({"success": True, "stats": data}), 200


@game_bp.route("/history", methods=["GET"])
@jwt_required()
def history():
    """Recent game sessions. Optional query: ?game=sudoku&limit=10"""
    user_id  = get_jwt_identity()
    game_id  = request.args.get("game", "").strip().lower() or None
    limit    = min(int(request.args.get("limit", 20)), 100)
    sessions = get_game_history(user_id, game_id, limit)
    return jsonify({"success": True, "sessions": sessions}), 200


@game_bp.route("/leaderboard/<game_id>", methods=["GET"])
@jwt_required()
def leaderboard(game_id: str):
    """Top 10 players for a specific game."""
    game_id = game_id.strip().lower()
    if game_id not in VALID_GAMES:
        return jsonify(error_response("Invalid game", 400)[0]), 400
    board = get_leaderboard(game_id, limit=10)
    return jsonify({"success": True, "leaderboard": board, "gameId": game_id}), 200


@game_bp.route("/xp", methods=["GET"])
@jwt_required()
def total_xp():
    """Total XP earned from all brain games."""
    user_id = get_jwt_identity()
    total   = get_total_game_xp(user_id)
    return jsonify({"success": True, "totalGameXP": total}), 200