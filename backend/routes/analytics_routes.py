"""
routes/analytics_routes.py — Analytics endpoints
GET /api/analytics/productivity-score
GET /api/analytics/weekly-stats
GET /api/analytics/patterns
GET /api/analytics/prediction
GET /api/analytics/wrapped
"""
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services.productivity_score import compute_productivity_score
from services.behavioral_analysis import analyze_patterns
from services.predictive_model import predict_completion
from services.gamification_engine import get_weekly_wrapped, get_weekly_stats

analytics_bp = Blueprint("analytics", __name__, url_prefix="/api/analytics")


@analytics_bp.route("/productivity-score", methods=["GET"])
@jwt_required()
def productivity_score():
    user_id = get_jwt_identity()
    data    = compute_productivity_score(user_id)
    return jsonify({"success": True, **data}), 200


@analytics_bp.route("/weekly-stats", methods=["GET"])
@jwt_required()
def weekly_stats():
    user_id = get_jwt_identity()
    data    = get_weekly_stats(user_id)
    return jsonify({"success": True, **data}), 200


@analytics_bp.route("/patterns", methods=["GET"])
@jwt_required()
def patterns():
    user_id = get_jwt_identity()
    data    = analyze_patterns(user_id)
    return jsonify({"success": True, **data}), 200


@analytics_bp.route("/prediction", methods=["GET"])
@jwt_required()
def prediction():
    user_id = get_jwt_identity()
    data    = predict_completion(user_id)
    return jsonify({"success": True, **data}), 200


@analytics_bp.route("/wrapped", methods=["GET"])
@jwt_required()
def wrapped():
    user_id = get_jwt_identity()
    data    = get_weekly_wrapped(user_id)
    return jsonify({"success": True, **data}), 200