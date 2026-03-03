"""
utils/db.py — MongoDB connection using PyMongo
Provides a singleton db client accessible across the entire app.
"""
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import ConnectionFailure
from config import Config
import sys


_client: MongoClient = None
_db = None


def get_db():
    """Return the database instance, creating the connection if needed."""
    global _client, _db
    if _db is not None:
        return _db

    try:
        _client = MongoClient(Config.MONGO_URI, serverSelectionTimeoutMS=5000)
        # Ping to verify connection
        _client.admin.command("ping")
        _db = _client.get_default_database()
        print(f"✅ MongoDB connected: {_db.name}")
        _ensure_indexes()
        return _db
    except ConnectionFailure as e:
        print(f"❌ MongoDB connection failed: {e}", file=sys.stderr)
        raise


def _ensure_indexes():
    """Create indexes for performance."""
    db = _db
    db.users.create_index([("email", ASCENDING)], unique=True)
    db.tasks.create_index([("userId", ASCENDING), ("deadline", ASCENDING)])
    db.tasks.create_index([("userId", ASCENDING), ("status", ASCENDING)])
    db.moods.create_index([("userId", ASCENDING), ("timestamp", DESCENDING)])
    db.journals.create_index([("userId", ASCENDING), ("createdAt", DESCENDING)])
    db.xp_history.create_index([("userId", ASCENDING), ("timestamp", DESCENDING)])
    db.badges.create_index([("userId", ASCENDING), ("badge_id", ASCENDING)])
    print("✅ MongoDB indexes ensured")


def close_db():
    global _client, _db
    if _client:
        _client.close()
        _client = None
        _db = None