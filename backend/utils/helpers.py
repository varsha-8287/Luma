"""
utils/helpers.py — Shared utility functions
Serialization, date helpers, response builders.
"""
from bson import ObjectId
from datetime import datetime, timezone
import json


def serialize_doc(doc: dict) -> dict:
    """Convert MongoDB document to JSON-serializable dict."""
    if doc is None:
        return None
    result = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            result[k] = str(v)
        elif isinstance(v, datetime):
            result[k] = v.isoformat()
        elif isinstance(v, dict):
            result[k] = serialize_doc(v)
        elif isinstance(v, list):
            result[k] = [serialize_doc(i) if isinstance(i, dict) else
                         str(i) if isinstance(i, ObjectId) else i for i in v]
        else:
            result[k] = v
    return result


def serialize_list(docs: list) -> list:
    return [serialize_doc(d) for d in docs]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def start_of_day(dt: datetime = None) -> datetime:
    d = dt or utc_now()
    return d.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)


def end_of_day(dt: datetime = None) -> datetime:
    d = dt or utc_now()
    return d.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=timezone.utc)


def parse_object_id(id_str: str) -> ObjectId:
    """Safely parse a string to ObjectId, raise ValueError if invalid."""
    try:
        return ObjectId(id_str)
    except Exception:
        raise ValueError(f"Invalid id: {id_str}")


def success_response(data=None, message="Success", status=200):
    body = {"success": True, "message": message}
    if data is not None:
        body["data"] = data
    return body, status


def error_response(message="An error occurred", status=400):
    return {"success": False, "message": message}, status


def get_day_range(days_back: int = 0):
    """Return (start, end) UTC datetimes for a day offset from today."""
    from datetime import timedelta
    base = utc_now() - timedelta(days=days_back)
    return start_of_day(base), end_of_day(base)