"""
app.py — Luma Backend Entry Point  v3.2.0
==========================================
Fixes in v3.2.0:
  - _REMINDER_WINDOWS overdue tuple: min_left was None which caused a
    TypeError when doing `min_left <= minutes_left`.  Now uses a
    sentinel value of -999 so the is_overdue branch is always taken
    exclusively via the `triggered` boolean path.
  - Added "about to end" window: 2-min warning (last chance alert).
  - task_reminder_job: deadline timezone guard (pytz import was
    inside the loop — moved to function scope to avoid repeated
    import overhead).
  - midnight_job: overdue_tasks loop used task["userId"] as ObjectId
    but update_user_xp expects a str — now wraps with str().
"""
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_bcrypt import Bcrypt
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
import atexit
import pytz

from config import Config
from utils.db import get_db

# ── Import blueprints ──────────────────────────────────────────
from routes.auth_routes      import auth_bp, bcrypt as auth_bcrypt
from routes.task_routes      import task_bp
from routes.mood_routes      import mood_bp
from routes.analytics_routes import analytics_bp
from routes.reminder_routes  import reminder_bp
from routes.journal_routes   import journal_bp, gamification_bp
from routes.game_routes      import game_bp
from routes.alarm_routes     import alarm_bp, notif_bp
from services.alarm_call_service import alarm_call_job


def create_app() -> Flask:
    app = Flask(__name__)

    # ── Config ────────────────────────────────────────────────
    app.config["JWT_SECRET_KEY"]           = Config.JWT_SECRET_KEY
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = Config.JWT_ACCESS_TOKEN_EXPIRES

    # ── Extensions ────────────────────────────────────────────
    CORS(app, resources={r"/api/*": {"origins": "*"}})
    JWTManager(app)
    auth_bcrypt.init_app(app)

    # ── Blueprints ────────────────────────────────────────────
    app.register_blueprint(auth_bp)
    app.register_blueprint(task_bp)
    app.register_blueprint(mood_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(reminder_bp)
    app.register_blueprint(journal_bp)
    app.register_blueprint(gamification_bp)
    app.register_blueprint(game_bp)
    app.register_blueprint(alarm_bp)
    app.register_blueprint(notif_bp)

    # ── Health check ──────────────────────────────────────────
    @app.route("/", methods=["GET"])
    def health():
        return jsonify({
            "status":  "ok",
            "message": "🚀 Luma API is running!",
            "version": "3.2.0",
            "endpoints": {
                "auth":          "/api/auth/register  /api/auth/login",
                "tasks":         "/api/tasks  /api/tasks/smart-ranked",
                "mood":          "/api/mood  /api/mood/daily-summary",
                "analytics":     "/api/analytics/productivity-score  /api/analytics/patterns  /api/analytics/prediction  /api/analytics/wrapped",
                "journal":       "/api/journal",
                "gamification":  "/api/gamification/badges  /api/gamification/xp-history",
                "reminders":     "/api/reminders  /api/reminders/call",
                "games":         "/api/games/score  /api/games/stats  /api/games/history  /api/games/leaderboard/<game>  /api/games/xp",
                "alarms":        "/api/alarms  /api/alarms/<id>/toggle  /api/alarms/<id>/trigger",
                "notifications": "/api/notifications  /api/notifications/unread-count  /api/notifications/read-all",
            }
        }), 200

    # ── Error handlers ────────────────────────────────────────
    @app.errorhandler(401)
    def unauthorized(e):
        return jsonify({"success": False, "message": "Unauthorized. Provide a valid JWT token."}), 401

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"success": False, "message": "Endpoint not found."}), 404

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"success": False, "message": "Internal server error.", "error": str(e)}), 500

    # ── DB init + indexes ─────────────────────────────────────
    with app.app_context():
        try:
            _create_indexes()
        except Exception as e:
            print(f"⚠️  DB init warning: {e}")

    return app


# ══════════════════════════════════════════════════════════════
# MONGODB INDEX CREATION
# ══════════════════════════════════════════════════════════════

def _create_indexes():
    from pymongo import ASCENDING, DESCENDING
    db = get_db()

    db.users.create_index([(  "email", ASCENDING)], unique=True, name="users_email_unique")

    db.tasks.create_index([(  "userId", ASCENDING), ("status",   ASCENDING)], name="tasks_user_status")
    db.tasks.create_index([(  "userId", ASCENDING), ("deadline", ASCENDING)], name="tasks_user_deadline")

    db.moods.create_index([(  "userId", ASCENDING), ("timestamp", DESCENDING)], name="moods_user_time")
    db.moods.create_index([(  "userId", ASCENDING), ("isDailySummary", ASCENDING)], name="moods_summary")

    db.journals.create_index([(  "userId", ASCENDING), ("createdAt", DESCENDING)], name="journals_user_date")

    db.badges.create_index([(  "userId", ASCENDING), ("badge_id", ASCENDING)], unique=True, name="badges_user_badge")

    db.xp_history.create_index([(  "userId", ASCENDING), ("timestamp", DESCENDING)], name="xp_user_time")

    db.game_scores.create_index([(  "userId", ASCENDING), ("gameId", ASCENDING)],     name="game_scores_user_game")
    db.game_scores.create_index([(  "userId", ASCENDING), ("createdAt", DESCENDING)], name="game_scores_user_date")
    db.game_scores.create_index([(  "gameId", ASCENDING), ("score", DESCENDING)],     name="game_scores_leaderboard")

    db.game_stats.create_index(
        [("userId", ASCENDING), ("gameId", ASCENDING)],
        unique=True,
        name="game_stats_user_game_unique"
    )
    db.game_stats.create_index([("gameId", ASCENDING), ("bestScore", DESCENDING)], name="game_stats_leaderboard")

    db.alarms.create_index([(  "userId", ASCENDING), ("createdAt", DESCENDING)], name="alarms_user_date")
    db.alarms.create_index([(  "time",   ASCENDING), ("enabled",   ASCENDING)],  name="alarms_time_enabled")

    db.notifications.create_index([(  "userId", ASCENDING), ("createdAt", DESCENDING)], name="notifs_user_date")
    db.notifications.create_index([(  "userId", ASCENDING), ("read",      ASCENDING)],  name="notifs_user_read")
    db.notifications.create_index(
        [("createdAt", ASCENDING)],
        expireAfterSeconds=30 * 24 * 3600,
        partialFilterExpression={"persistent": False},
        name="notifs_ttl_30d"
    )

    db.task_reminder_log.create_index(
        [("taskId", ASCENDING), ("window", ASCENDING)],
        unique=True,
        name="reminder_log_task_window_unique"
    )
    db.task_reminder_log.create_index(
        [("createdAt", ASCENDING)],
        expireAfterSeconds=2 * 24 * 3600,
        name="reminder_log_ttl_2d"
    )

    db.alarm_call_log.create_index(
        [("alarmId", ASCENDING), ("firedAt", ASCENDING)],
        name="alarm_call_log_dedup"
    )

    db.alarm_call_log.create_index(
        [("firedAt", ASCENDING)],
        expireAfterSeconds=7 * 24 * 3600,
        name="alarm_call_log_ttl_7d"
    )

    print("✅ MongoDB indexes created/verified")


# ══════════════════════════════════════════════════════════════
# TASK REMINDER JOB  (runs every 60 seconds)
# ══════════════════════════════════════════════════════════════

# Reminder windows:
#   label, min_minutes_left, max_minutes_left, window_key, is_overdue
#
# BUG FIX: original had None for overdue min_left which caused:
#   TypeError: '<=' not supported between instances of 'NoneType' and 'float'
# Fix: use -999 sentinel; overdue detection is handled by `is_overdue` flag only.
#
# NEW: "2min" (about-to-end) window added.
_REMINDER_WINDOWS = [
    ("30min",  28,   32,   "30min",   False),  # 28–32 min left
    ("10min",   8,   12,   "10min",   False),  #  8–12 min left
    ("5min",    3,    7,   "5min",    False),  #  3–7  min left
    ("2min",    0,    2,   "2min",    False),  #  0–2  min left  ← NEW "about to end"
    ("overdue",-999,  0,   "overdue", True),   # just passed deadline (0 to -2 min)
]


def task_reminder_job():
    """
    Runs every 60 seconds.
    Pushes DB notifications for: 30min / 10min / 5min / 2min / overdue windows.
    """
    try:
        from utils.helpers import utc_now
        from models.alarm_model import create_notification
        from bson import ObjectId
        from datetime import timedelta

        db  = get_db()
        now = utc_now()

        # Fetch all pending tasks due within the next 35 minutes
        # OR that passed their deadline up to 2 minutes ago
        window_start = now - timedelta(minutes=2)
        window_end   = now + timedelta(minutes=35)

        pending_tasks = list(db.tasks.find({
            "status":   "Pending",
            "deadline": {"$gte": window_start, "$lte": window_end}
        }))

        if not pending_tasks:
            return

        for task in pending_tasks:
            task_id  = str(task["_id"])
            user_id  = str(task["userId"])
            deadline = task["deadline"]

            # Ensure timezone-aware
            if deadline.tzinfo is None:
                deadline = pytz.utc.localize(deadline)

            minutes_left = (deadline - now).total_seconds() / 60.0

            for label, min_left, max_left, window_key, is_overdue in _REMINDER_WINDOWS:

                if is_overdue:
                    # Fire only in the 2-minute window immediately after deadline
                    triggered = (-2 <= minutes_left < 0)
                else:
                    triggered = (min_left <= minutes_left <= max_left)

                if not triggered:
                    continue

                # Idempotency — skip if already notified for this window
                already_sent = db.task_reminder_log.find_one({
                    "taskId": task_id,
                    "window": window_key
                })
                if already_sent:
                    continue

                # Build notification
                name = task.get("name", "A quest")

                if is_overdue:
                    notif_title   = "⚠️ Quest Overdue!"
                    notif_message = (
                        f'"{name}" has just passed its deadline. '
                        f'Complete it immediately or it will be marked Missed! '
                        f'[VOICE: Your quest {name} is now overdue! Complete it right now!]'
                    )
                    notif_type = "task"

                elif window_key == "2min":
                    notif_title   = "🔴 Quest Ending in 2 Minutes!"
                    notif_message = (
                        f'"{name}" is about to expire — this is your last chance! '
                        f'[VOICE: Last chance! Your quest {name} expires in under 2 minutes. Complete it NOW!]'
                    )
                    notif_type = "task"

                elif window_key == "5min":
                    notif_title   = "🚨 Quest Expiring in 5 Minutes!"
                    notif_message = (
                        f'"{name}" expires in 5 minutes — stop everything and complete it NOW! '
                        f'[VOICE: Critical alert! Your quest {name} expires in just 5 minutes. Complete it immediately!]'
                    )
                    notif_type = "task"

                elif window_key == "10min":
                    notif_title   = "⚡ Quest Due in 10 Minutes"
                    notif_message = (
                        f'"{name}" is due very soon. Wrap up and complete it! '
                        f'[VOICE: Heads up! {name} is due in 10 minutes.]'
                    )
                    notif_type = "reminder"

                else:  # 30min
                    notif_title   = "🔔 Quest Due in 30 Minutes"
                    notif_message = (
                        f'"{name}" is due in about 30 minutes. '
                        f'Start now to complete it on time!'
                    )
                    notif_type = "reminder"

                # Push to DB
                create_notification(user_id, notif_type, notif_title, notif_message, persistent=False)

                # Log to prevent re-fire
                db.task_reminder_log.insert_one({
                    "taskId":    task_id,
                    "userId":    user_id,
                    "window":    window_key,
                    "taskName":  name,
                    "createdAt": now
                })

    except Exception as e:
        print(f"  ❌ task_reminder_job error: {e}")


# ══════════════════════════════════════════════════════════════
# MIDNIGHT CRON JOB
# ══════════════════════════════════════════════════════════════

def midnight_job():
    """
    Runs every day at 00:00 UTC.
    1. Auto-mark overdue tasks as Missed + deduct XP
    2. Calculate mood daily summaries
    3. Update user streaks
    4. Recompute productivity scores
    5. Re-rank pending tasks
    6. Fire any alarms that match midnight time
    7. Push streak-danger notifications if needed
    """
    print("🕐 Running midnight cron job...")
    try:
        from utils.helpers import utc_now, get_day_range
        from models.task_model  import get_overdue_pending_tasks, mark_task_missed, get_pending_tasks_by_user
        from models.mood_model  import get_moods_in_range, save_daily_summary, count_positive_mood_streak
        from models.user_model  import update_user_xp, update_mood_positive_streak, find_user_by_id
        from models.alarm_model import get_enabled_alarms_at, record_alarm_trigger, create_notification
        from services.gamification_engine import update_daily_streak, award_xp
        from services.productivity_score  import compute_productivity_score
        from services.scheduling_algorithm import rank_tasks_for_user
        from bson import ObjectId

        db  = get_db()
        now = utc_now()

        # ── 1. Mark overdue tasks ──────────────────────────────
        overdue_tasks = get_overdue_pending_tasks(before=now)
        missed_count  = 0
        for task in overdue_tasks:
            mark_task_missed(task["_id"], Config.XP_MISSED)
            # BUG FIX: task["userId"] is an ObjectId — update_user_xp needs str
            update_user_xp(str(task["userId"]), Config.XP_MISSED)
            create_notification(
                str(task["userId"]), "task",
                "⏰ Quest Missed!",
                f'"{task["name"]}" expired and was marked missed. -{abs(Config.XP_MISSED)} XP.',
                persistent=False
            )
            missed_count += 1
        print(f"  ✅ Marked {missed_count} overdue tasks as Missed")

        # ── 2–5. Per-user processing ───────────────────────────
        users = list(db.users.find({}))
        for user in users:
            uid = str(user["_id"])

            # Mood summary
            start, end = get_day_range(0)
            moods = get_moods_in_range(uid, start, end)
            if moods:
                avg_score = sum(m["moodScore"] for m in moods) / len(moods)
                mood_counts = {}
                for m in moods:
                    mood_counts[m["moodType"]] = mood_counts.get(m["moodType"], 0) + 1
                dominant_mood = max(mood_counts, key=mood_counts.get)
                save_daily_summary(uid, avg_score, dominant_mood)
                pos_streak = count_positive_mood_streak(uid)
                update_mood_positive_streak(uid, pos_streak)
                if avg_score > 3:
                    award_xp(uid, Config.XP_MOOD_BONUS, "Daily mood bonus (positive)")

            # Streak
            update_daily_streak(uid)

            # Productivity score
            try:
                compute_productivity_score(uid)
            except Exception as e:
                print(f"  ⚠️  Score compute failed for {uid}: {e}")

            # Re-rank tasks
            try:
                pending = get_pending_tasks_by_user(uid)
                if pending:
                    rank_tasks_for_user(uid, pending)
            except Exception as e:
                print(f"  ⚠️  Re-rank failed for {uid}: {e}")

            # ── 7. Streak danger notification ──────────────────
            fresh_user = find_user_by_id(uid)
            if fresh_user and fresh_user.get("streak", 0) > 0:
                completed_today = db.tasks.count_documents({
                    "userId":      ObjectId(uid),
                    "status":      "Completed",
                    "completedAt": {"$gte": start, "$lte": end}
                })
                if completed_today == 0:
                    create_notification(
                        uid, "streak",
                        "🔥 Streak Broken!",
                        f"Your {fresh_user['streak']}-day streak ended. Start fresh tomorrow!",
                        persistent=False
                    )

        # ── 6. Fire midnight alarms ────────────────────────────
        midnight_alarms = get_enabled_alarms_at("00:00", now.weekday())
        for alarm in midnight_alarms:
            record_alarm_trigger(alarm["_id"])
            create_notification(
                str(alarm["userId"]), "alarm",
                f"⏰ {alarm['label']}",
                "Your midnight alarm is ringing!",
                persistent=True
            )

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

    scheduler.add_job(
        func=task_reminder_job,
        trigger=IntervalTrigger(seconds=60),
        id="task_reminder_job",
        name="Task deadline reminder (every 60s)",
        replace_existing=True,
        misfire_grace_time=30,
    )

    scheduler.add_job(
        func=alarm_call_job,
        trigger=IntervalTrigger(seconds=60),
        id="alarm_call_job",
        name="Alarm wake-up call checker (every 60s)",
        replace_existing=True,
        misfire_grace_time=30,
    )

    scheduler.start()
    print("✅ APScheduler started — midnight job at 00:00 UTC, task reminders every 60s")
    atexit.register(lambda: scheduler.shutdown())
    return scheduler


# ══════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    app = create_app()
    start_scheduler(app)

    print(f"""
╔══════════════════════════════════════════════════╗
║   🌟  Luma Backend  v3.2.0                       ║
║   Running on  http://0.0.0.0:{Config.PORT:<5}             ║
║   MongoDB:    {Config.MONGO_URI[:38]}...  ║
║                                                  ║
║   Schedulers:                                    ║
║     • Midnight cron     00:00 UTC daily           ║
║     • Task reminders    every 60 seconds          ║
╚══════════════════════════════════════════════════╝
    """)

    app.run(
        host="0.0.0.0",
        port=Config.PORT,
        debug=Config.DEBUG,
        use_reloader=False
    )