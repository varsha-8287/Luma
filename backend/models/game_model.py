"""
models/game_model.py — Brain Games document model
==================================================
Collections:
  game_scores  — individual game session results
  game_stats   — per-user aggregated stats (best scores, total plays)

Fields (game_scores):
  userId, gameId, score, duration, metadata, createdAt

Fields (game_stats):
  userId, gameId, bestScore, totalPlays, totalScore,
  bestTime, lastPlayedAt
"""
from bson import ObjectId
from utils.db import get_db
from utils.helpers import serialize_doc, serialize_list, utc_now


VALID_GAMES = {"memory", "sudoku", "wordsearch", "numberzen"}

GAME_XP_REWARDS = {
    "memory":     30,
    "sudoku":     50,
    "wordsearch": 40,
    "numberzen":  60,
}


def save_game_score(user_id: str, game_id: str, score: int,
                    duration: int, metadata: dict = None, won: bool = False) -> dict:
    """
    Save a completed game session.
    duration = seconds played
    metadata = game-specific extras (e.g. errors, words_found, max_tile)
    """
    if game_id not in VALID_GAMES:
        raise ValueError(f"Invalid game. Valid: {list(VALID_GAMES)}")

    db = get_db()
    doc = {
        "userId":    ObjectId(user_id),
        "gameId":    game_id,
        "score":     score,
        "duration":  duration,
        "won":       won,
        "metadata":  metadata or {},
        "xpEarned":  GAME_XP_REWARDS[game_id] if won else max(5, score // 20),
        "createdAt": utc_now(),
    }
    result = db.game_scores.insert_one(doc)
    doc["_id"] = result.inserted_id

    # Update aggregated stats
    _update_game_stats(user_id, game_id, score, duration, won, doc["xpEarned"])

    return serialize_doc(doc)


def _update_game_stats(user_id: str, game_id: str, score: int,
                       duration: int, won: bool, xp: int):
    """Upsert the per-user per-game stats document."""
    db = get_db()
    existing = db.game_stats.find_one({
        "userId": ObjectId(user_id),
        "gameId": game_id
    })

    if not existing:
        db.game_stats.insert_one({
            "userId":       ObjectId(user_id),
            "gameId":       game_id,
            "bestScore":    score,
            "bestDuration": duration,
            "totalPlays":   1,
            "totalWins":    1 if won else 0,
            "totalScore":   score,
            "totalXP":      xp,
            "lastPlayedAt": utc_now(),
            "createdAt":    utc_now(),
        })
    else:
        db.game_stats.update_one(
            {"userId": ObjectId(user_id), "gameId": game_id},
            {"$set":  {"lastPlayedAt": utc_now()},
             "$max":  {"bestScore": score},
             "$min":  {"bestDuration": duration if duration > 0 else existing.get("bestDuration", 9999)},
             "$inc":  {"totalPlays": 1, "totalWins": 1 if won else 0,
                       "totalScore": score, "totalXP": xp}}
        )


def get_user_game_stats(user_id: str) -> list:
    """All game stats for a user (one doc per game played)."""
    db = get_db()
    stats = list(db.game_stats.find({"userId": ObjectId(user_id)}))
    return serialize_list(stats)


def get_game_history(user_id: str, game_id: str = None, limit: int = 20) -> list:
    """Recent game sessions for a user, optionally filtered by game."""
    db = get_db()
    query = {"userId": ObjectId(user_id)}
    if game_id and game_id in VALID_GAMES:
        query["gameId"] = game_id
    sessions = list(db.game_scores.find(
        query,
        sort=[("createdAt", -1)],
        limit=limit
    ))
    return serialize_list(sessions)


def get_leaderboard(game_id: str, limit: int = 10) -> list:
    """Top scores across all users for a specific game."""
    if game_id not in VALID_GAMES:
        raise ValueError("Invalid game")
    db = get_db()
    pipeline = [
        {"$match": {"gameId": game_id}},
        {"$sort":  {"bestScore": -1}},
        {"$limit": limit},
        {"$lookup": {
            "from":         "users",
            "localField":   "userId",
            "foreignField": "_id",
            "as":           "user"
        }},
        {"$unwind": {"path": "$user", "preserveNullAndEmptyArrays": True}},
        {"$project": {
            "gameId":    1, "bestScore": 1, "totalPlays": 1,
            "totalWins": 1, "lastPlayedAt": 1,
            "userName":  "$user.name",
        }}
    ]
    return serialize_list(list(db.game_stats.aggregate(pipeline)))


def get_total_game_xp(user_id: str) -> int:
    """Sum of all XP earned from games."""
    db = get_db()
    pipeline = [
        {"$match": {"userId": ObjectId(user_id)}},
        {"$group": {"_id": None, "total": {"$sum": "$xpEarned"}}}
    ]
    result = list(db.game_scores.aggregate(pipeline))
    return result[0]["total"] if result else 0