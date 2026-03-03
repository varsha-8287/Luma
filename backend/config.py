"""
config.py — Application configuration
Loads all environment variables and exposes them as a Config class.
"""
import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()


class Config:
    # ── MongoDB ──
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/gamified_app")

    # ── JWT ──
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-change-me")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        days=int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES_DAYS", 7))
    )

    # ── Flask ──
    DEBUG = os.getenv("FLASK_DEBUG", "0") == "1"
    PORT = int(os.getenv("PORT", 5000))
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

    # ── Twilio ──
    TWILIO_ACCOUNT_SID  = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN   = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")

    # ── Gamification constants ──
    XP_COMPLETE_EARLY = 20
    XP_COMPLETE_ONTIME = 10
    XP_MISSED = -10
    XP_MOOD_BONUS = 5        # bonus per day of positive mood streak
    XP_PER_LEVEL = 100

    # ── Scoring weights ──
    SCORE_WEIGHT_COMPLETION = 0.35
    SCORE_WEIGHT_STREAK     = 0.25
    SCORE_WEIGHT_DIFFICULTY = 0.20
    SCORE_WEIGHT_MOOD       = 0.20

    # ── Smart ranking weights ──
    RANK_WEIGHT_PRIORITY  = 0.40
    RANK_WEIGHT_DEADLINE  = 0.35
    RANK_WEIGHT_BEHAVIOR  = 0.25