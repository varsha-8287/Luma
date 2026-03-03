"""
models/journal_model.py — Journal entry document model
Fields: userId, title, content, createdAt
"""
from bson import ObjectId
from utils.db import get_db
from utils.helpers import serialize_doc, serialize_list, utc_now


def create_entry(user_id: str, title: str, content: str) -> dict:
    db = get_db()
    doc = {
        "userId": ObjectId(user_id),
        "title": title.strip(),
        "content": content.strip(),
        "createdAt": utc_now(),
    }
    result = db.journals.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


def get_entries_by_user(user_id: str) -> list:
    db = get_db()
    entries = list(db.journals.find(
        {"userId": ObjectId(user_id)},
        sort=[("createdAt", -1)]
    ))
    return serialize_list(entries)


def get_entry_by_id(entry_id: str, user_id: str) -> dict | None:
    db = get_db()
    try:
        doc = db.journals.find_one({
            "_id": ObjectId(entry_id),
            "userId": ObjectId(user_id)
        })
        return serialize_doc(doc) if doc else None
    except Exception:
        return None


def delete_entry(entry_id: str, user_id: str) -> bool:
    db = get_db()
    result = db.journals.delete_one({
        "_id": ObjectId(entry_id),
        "userId": ObjectId(user_id)
    })
    return result.deleted_count > 0


def count_entries(user_id: str) -> int:
    db = get_db()
    return db.journals.count_documents({"userId": ObjectId(user_id)})