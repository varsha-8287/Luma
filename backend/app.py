"""
app.py — QuestFlow Backend Entry Point
=======================================
Flask app with:
  - JWT authentication
  - CORS
  - All route blueprints
  - APScheduler midnight cron job
  - Health check endpoint
"""
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_bcrypt import Bcrypt
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import atexit
import pytz

from config import Config
from utils.db import get_db

# ── Import blueprints ──
from routes.auth_routes import auth_bp, bcrypt as auth_bcrypt
from routes.task_routes import task_bp
from routes.mood_routes import mood_bp
from routes.analytics_routes import analytics_bp
from routes.reminder_routes import reminder_bp
from routes.journal_routes import journal_bp, gamification_bp


def create_app() -> Flask:
    app = Flask(__name__)

    # ── Config ──
    app.config["JWT_SECRET_KEY"]         = Config.JWT_SECRET_KEY
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = Config.JWT_ACCESS_TOKEN_EXPIRES

    # ── Extensions ──
    CORS(app, resources={r"/api/*": {"origins": "*"}})
    JWTManager(app)
    auth_bcrypt.init_app(app)

    # ── Blueprints ──
    app.register_blueprint(auth_bp)
    app.register_blueprint(task_bp)
    app.register_blueprint(mood_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(reminder_bp)
    app.register_blueprint(journal_bp)
    app.register_blueprint(gamification_bp)

    # ── Health check ──
    @app.route("/", methods=["GET"])
    def health():
        return jsonify({
            "status": "ok",
            "message": "🚀 QuestFlow API is running!",
            "version": "2.0.0",
            "endpoints": {
                "auth":        "/api/auth/register  /api/auth/login",
                "tasks":       "/api/tasks  /api/tasks/smart-ranked",
                "mood":        "/api/mood  /api/mood/daily-summary",
                "analytics":   "/api/analytics/productivity-score  /api/analytics/patterns  /api/analytics/prediction  /api/analytics/wrapped",
                "journal":     "/api/journal",
                "gamification":"/api/gamification/badges  /api/gamification/xp-history",
                "reminders":   "/api/reminders  /api/reminders/call"
            }
        }), 200

    # ── JWT error handlers ──
    @app.errorhandler(401)
    def unauthorized(e):
        return jsonify({"success": False, "message": "Unauthorized. Provide a valid JWT token."}), 401

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"success": False, "message": "Endpoint not found."}), 404

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"success": False, "message": "Internal server error.", "error": str(e)}), 500

    # ── Initialize DB connection ──
    with app.app_context():
        try:
            get_db()
        except Exception as e:
            print(f"⚠️  DB init warning: {e}")

    return app


# ══════════════════════════════════════════════
# MIDNIGHT CRON JOB (APScheduler)
# ══════════════════════════════════════════════

def midnight_job():
    """
    Runs every day at 00:00 UTC.
    Tasks:
      1. Auto-mark overdue Pending tasks as Missed + deduct XP
      2. Calculate and save mood daily summaries
      3. Update user streaks
      4. Recompute productivity scores
      5. Re-rank tasks via smart algorithm
    """
    print("🕐 Running midnight cron job...")
    try:
        from utils.helpers import utc_now, get_day_range
        from models.task_model import get_overdue_pending_tasks, mark_task_missed
        from models.mood_model import get_moods_in_range, save_daily_summary, count_positive_mood_streak, MOOD_SCORES
        from models.user_model import update_user_xp, find_user_by_id, update_mood_positive_streak
        from services.gamification_engine import update_daily_streak, award_xp
        from services.productivity_score import compute_productivity_score
        from services.scheduling_algorithm import rank_tasks_for_user
        from bson import ObjectId

        db = get_db()
        now = utc_now()

        # ── 1. Mark overdue tasks as Missed ──
        overdue_tasks = get_overdue_pending_tasks(before=now)
        missed_count = 0
        for task in overdue_tasks:
            mark_task_missed(task["_id"], Config.XP_MISSED)
            update_user_xp(str(task["userId"]), Config.XP_MISSED)
            missed_count += 1
        print(f"  ✅ Marked {missed_count} overdue tasks as Missed")

        # ── 2. Mood daily summaries + bonus XP ──
        users = list(db.users.find({}))
        for user in users:
            uid = str(user["_id"])
            start, end = get_day_range(0)
            moods = get_moods_in_range(uid, start, end)

            if moods:
                avg_score = sum(m["moodScore"] for m in moods) / len(moods)
                # Determine dominant mood
                mood_counts = {}
                for m in moods:
                    mood_counts[m["moodType"]] = mood_counts.get(m["moodType"], 0) + 1
                dominant_mood = max(mood_counts, key=mood_counts.get)
                save_daily_summary(uid, avg_score, dominant_mood)

                # Mood positive streak
                pos_streak = count_positive_mood_streak(uid)
                update_mood_positive_streak(uid, pos_streak)

                # Bonus XP for positive mood
                if avg_score > 3:
                    award_xp(uid, Config.XP_MOOD_BONUS, "Daily mood bonus (positive)")

            # ── 3. Update streak ──
            update_daily_streak(uid)

            # ── 4. Recompute productivity score ──
            try:
                compute_productivity_score(uid)
            except Exception as e:
                print(f"  ⚠️  Score compute failed for {uid}: {e}")

            # ── 5. Re-rank pending tasks ──
            try:
                from models.task_model import get_pending_tasks_by_user
                pending = get_pending_tasks_by_user(uid)
                if pending:
                    rank_tasks_for_user(uid, pending)
            except Exception as e:
                print(f"  ⚠️  Re-rank failed for {uid}: {e}")

        print(f"  ✅ Processed {len(users)} users in midnight job")
    except Exception as e:
        print(f"  ❌ Midnight cron error: {e}")


def start_scheduler(app: Flask):
    scheduler = BackgroundScheduler(timezone=pytz.utc)
    scheduler.add_job(
        func=midnight_job,
        trigger=CronTrigger(hour=0, minute=0, second=0, timezone=pytz.utc),
        id="midnight_job",
        name="Midnight productivity cron",
        replace_existing=True,
        misfire_grace_time=300,
    )
    scheduler.start()
    print("✅ APScheduler started — midnight job scheduled at 00:00 UTC")
    atexit.register(lambda: scheduler.shutdown())
    return scheduler


# ══════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════

if __name__ == "__main__":
    app = create_app()
    start_scheduler(app)

    print(f"""
╔══════════════════════════════════════════════╗
║   🚀  QuestFlow Backend  v2.0.0              ║
║   Running on  http://0.0.0.0:{Config.PORT:<5}           ║
║   MongoDB:    {Config.MONGO_URI[:40]}...  ║
╚══════════════════════════════════════════════╝
    """)

    app.run(
        host="0.0.0.0",
        port=Config.PORT,
        debug=Config.DEBUG,
        use_reloader=False   # Must be False when using APScheduler
    )