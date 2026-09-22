"""SQLite storage layer. Uses only the standard library so the project runs anywhere."""
import json
import os
import sqlite3
import threading
import time

DB_PATH = os.environ.get(
    "SURAKSHA_DB", os.path.join(os.path.dirname(os.path.dirname(__file__)), "suraksha.db")
)

_lock = threading.RLock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row
_conn.execute("PRAGMA journal_mode=WAL")
_conn.execute("PRAGMA foreign_keys=ON")

SCHEMA = """
CREATE TABLE IF NOT EXISTS tourists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    nationality TEXT,
    home_state TEXT,
    id_doc TEXT,
    blood_group TEXT,
    medical_notes TEXT,
    emergency_name TEXT,
    emergency_phone TEXT,
    language TEXT DEFAULT 'en',
    band_id TEXT UNIQUE,
    digital_id TEXT,
    trip_start TEXT,
    trip_end TEXT,
    itinerary TEXT,
    last_lat REAL,
    last_lon REAL,
    last_seen REAL,
    battery INTEGER,
    status TEXT DEFAULT 'safe',
    created_at REAL
);
CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tourist_id TEXT REFERENCES tourists(id) ON DELETE CASCADE,
    lat REAL, lon REAL, source TEXT, ts REAL
);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    msg_id TEXT UNIQUE,
    tourist_id TEXT REFERENCES tourists(id) ON DELETE SET NULL,
    band_id TEXT,
    type TEXT NOT NULL,
    lat REAL, lon REAL,
    source TEXT,
    gateway_id TEXT,
    hops TEXT,
    hop_count INTEGER DEFAULT 0,
    battery INTEGER,
    message TEXT,
    status TEXT DEFAULT 'open',
    assigned_to TEXT,
    notes TEXT,
    created_at REAL,
    ack_at REAL,
    resolved_at REAL
);
CREATE TABLE IF NOT EXISTS geofences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    risk TEXT DEFAULT 'high',
    lat REAL, lon REAL, radius_m REAL,
    description TEXT,
    created_at REAL
);
CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, kind TEXT, lat REAL, lon REAL, phone TEXT
);
CREATE TABLE IF NOT EXISTS gateways (
    id TEXT PRIMARY KEY,
    name TEXT, lat REAL, lon REAL,
    last_seen REAL, packets INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS advisories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT, level TEXT, created_at REAL
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_locations_tourist ON locations(tourist_id, ts);
"""

JSON_FIELDS = {"hops", "itinerary"}


def init():
    with _lock:
        _conn.executescript(SCHEMA)
        cols = {r["name"] for r in _conn.execute("PRAGMA table_info(tourists)").fetchall()}
        if "home_state" not in cols:  # databases created before this column existed
            _conn.execute("ALTER TABLE tourists ADD COLUMN home_state TEXT")
        _conn.commit()


def _row(r):
    if r is None:
        return None
    d = dict(r)
    for k in JSON_FIELDS:
        if k in d and isinstance(d[k], str):
            try:
                d[k] = json.loads(d[k])
            except ValueError:
                pass
    return d


def query(sql, params=()):
    with _lock:
        return [_row(r) for r in _conn.execute(sql, params).fetchall()]


def one(sql, params=()):
    with _lock:
        return _row(_conn.execute(sql, params).fetchone())


def execute(sql, params=()):
    with _lock:
        cur = _conn.execute(sql, params)
        _conn.commit()
        return cur.lastrowid


def insert(table, data):
    data = {k: (json.dumps(v) if k in JSON_FIELDS and not isinstance(v, str) else v) for k, v in data.items()}
    cols = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    return execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(data.values()))


def update(table, key, key_value, data):
    if not data:
        return
    data = {k: (json.dumps(v) if k in JSON_FIELDS and not isinstance(v, str) else v) for k, v in data.items()}
    sets = ", ".join(f"{k} = ?" for k in data)
    execute(f"UPDATE {table} SET {sets} WHERE {key} = ?", (*data.values(), key_value))


def now():
    return time.time()
