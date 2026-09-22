"""Tamper-evident digital tourist ID.

Each new ID is a SHA-256 hash of the tourist's core details plus the previous
tourist's ID, which forms a simple hash chain (a blockchain-style ledger).
Changing any old record breaks every hash after it, and verify_chain() detects that.
"""
import hashlib
import json
import secrets

from . import db

CORE_FIELDS = ("id", "name", "nationality", "id_doc", "trip_start", "trip_end", "created_at")


def new_tourist_id():
    return "TID-" + secrets.token_hex(3).upper()


def _digest(record, prev_hash):
    core = {k: record.get(k) for k in CORE_FIELDS}
    payload = json.dumps(core, sort_keys=True) + (prev_hash or "GENESIS")
    return hashlib.sha256(payload.encode()).hexdigest()


def issue(record):
    prev = db.one("SELECT digital_id FROM tourists ORDER BY created_at DESC, rowid DESC LIMIT 1")
    return _digest(record, prev["digital_id"] if prev else None)


def verify_chain():
    rows = db.query("SELECT * FROM tourists ORDER BY created_at ASC, rowid ASC")
    prev = None
    for r in rows:
        if _digest(r, prev) != r["digital_id"]:
            return {"valid": False, "broken_at": r["id"], "checked": len(rows)}
        prev = r["digital_id"]
    return {"valid": True, "checked": len(rows)}


def mask_doc(doc):
    if not doc:
        return doc
    digits = "".join(ch for ch in str(doc) if ch.isalnum())
    return "XXXX XXXX " + digits[-4:]
