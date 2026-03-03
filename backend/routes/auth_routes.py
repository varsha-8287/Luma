"""
routes/auth_routes.py — Authentication endpoints
POST /api/auth/register
POST /api/auth/login
"""
from flask import Blueprint, request, jsonify
from flask_bcrypt import Bcrypt
from flask_jwt_extended import create_access_token
from models.user_model import create_user, find_user_by_email, get_public_user
from utils.helpers import error_response, success_response

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")
bcrypt  = Bcrypt()


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    name     = (data.get("name") or "").strip()
    email    = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "")

    if not name or not email or not password:
        return jsonify(error_response("Name, email and password are required.", 400)[0]), 400
    if len(password) < 6:
        return jsonify(error_response("Password must be at least 6 characters.", 400)[0]), 400
    if find_user_by_email(email):
        return jsonify(error_response("Email already registered.", 409)[0]), 409

    hashed = bcrypt.generate_password_hash(password).decode("utf-8")

    try:
        user = create_user(name, email, hashed)
        token = create_access_token(identity=user["_id"])
        return jsonify({
            "success": True,
            "message": "Account created!",
            "token": token,
            "user": user
        }), 201
    except Exception as e:
        return jsonify(error_response(f"Registration failed: {str(e)}", 500)[0]), 500


@auth_bp.route("/login", methods=["POST"])
def login():
    data     = request.get_json(silent=True) or {}
    email    = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "")

    if not email or not password:
        return jsonify(error_response("Email and password required.", 400)[0]), 400

    user = find_user_by_email(email)
    if not user or not bcrypt.check_password_hash(user["password"], password):
        return jsonify(error_response("Invalid email or password.", 401)[0]), 401

    token = create_access_token(identity=str(user["_id"]))
    return jsonify({
        "success": True,
        "message": "Login successful!",
        "token": token,
        "user": get_public_user(user)
    }), 200