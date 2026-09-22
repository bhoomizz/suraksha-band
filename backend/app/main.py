"""Suraksha Band backend: REST API, WebSocket live feed, and static hosting for the web apps.

Run from the backend folder:
    .venv\\Scripts\\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import asyncio
import contextlib
import os
import re
import secrets
import time
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, geo, identity, seed

WEB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "web"))
INACTIVITY_MIN = float(os.environ.get("INACTIVITY_MIN", "15"))
ACTIVE_WINDOW_S = 30 * 60
ALERT_TYPES = {"SOS", "FALL", "HEALTH", "GEOFENCE", "INACTIVITY"}


# ---------------------------------------------------------------- live feed
class Hub:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)

    def drop(self, ws: WebSocket):
        self.clients.discard(ws)

    async def emit(self, event: str, data):
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json({"event": event, "data": data, "ts": time.time()})
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.drop(ws)


hub = Hub()


# ---------------------------------------------------------------- schemas
class TouristIn(BaseModel):
    name: str = Field(min_length=1)
    phone: Optional[str] = None
    nationality: Optional[str] = None
    id_doc: Optional[str] = None
    blood_group: Optional[str] = None
    medical_notes: Optional[str] = None
    emergency_name: Optional[str] = None
    emergency_phone: Optional[str] = None
    language: str = "en"
    band_id: Optional[str] = None
    trip_start: Optional[str] = None
    trip_end: Optional[str] = None
    itinerary: List[str] = []


class LocationIn(BaseModel):
    lat: float
    lon: float
    battery: Optional[int] = None
    source: str = "app"


class PacketIn(BaseModel):
    """One message from a band, as relayed over the mesh or sent directly by the app."""
    msg_id: Optional[str] = None
    band_id: Optional[str] = None
    tourist_id: Optional[str] = None
    type: str = "SOS"
    lat: Optional[float] = None
    lon: Optional[float] = None
    battery: Optional[int] = None
    heart_rate: Optional[int] = None
    message: Optional[str] = None
    hops: List[str] = []
    ts: Optional[float] = None


class IngestIn(BaseModel):
    gateway_id: str
    gateway_lat: Optional[float] = None
    gateway_lon: Optional[float] = None
    packets: List[PacketIn]


class ActionIn(BaseModel):
    responder: Optional[str] = None
    notes: Optional[str] = None


class GeofenceIn(BaseModel):
    name: str
    risk: str = "high"
    lat: float
    lon: float
    radius_m: float = Field(gt=0)
    description: Optional[str] = None


class AdvisoryIn(BaseModel):
    message: str = Field(min_length=1)
    level: str = "warning"


# ---------------------------------------------------------------- helpers
def get_tourist(tourist_id=None, band_id=None):
    if tourist_id:
        return db.one("SELECT * FROM tourists WHERE id = ?", (tourist_id,))
    if band_id:
        return db.one("SELECT * FROM tourists WHERE band_id = ?", (band_id,))
    return None


def alert_view(a):
    if not a:
        return a
    a["tourist"] = get_tourist(a["tourist_id"]) if a.get("tourist_id") else None
    if a.get("lat") is not None:
        places = db.query("SELECT * FROM places")
        a["nearest_police"] = geo.nearest(a["lat"], a["lon"], places, "police", 2)
        a["nearest_hospital"] = geo.nearest(a["lat"], a["lon"], places, "hospital", 2)
    return a


async def refresh_tourist_status(tid):
    n = db.one(
        "SELECT COUNT(*) AS n FROM alerts WHERE tourist_id = ? AND status != 'resolved'", (tid,)
    )["n"]
    db.update("tourists", "id", tid, {"status": "alert" if n else "safe"})
    await hub.emit("tourist_update", get_tourist(tid))


async def create_alert(tourist, *, type, lat, lon, source, msg_id=None, band_id=None,
                       gateway_id=None, hops=None, battery=None, message=None):
    msg_id = msg_id or f"{source.upper()}-{secrets.token_hex(5)}"
    existing = db.one("SELECT * FROM alerts WHERE msg_id = ?", (msg_id,))
    if existing:  # same SOS arriving over a second mesh path or a retry
        return alert_view(existing), False
    hops = hops or []
    aid = db.insert("alerts", dict(
        msg_id=msg_id, tourist_id=tourist["id"] if tourist else None,
        band_id=band_id or (tourist or {}).get("band_id"), type=type, lat=lat, lon=lon,
        source=source, gateway_id=gateway_id, hops=hops,
        hop_count=max(0, len(hops) - 1),  # hops lists every node from origin band to gateway
        battery=battery, message=message, status="open", created_at=db.now(),
    ))
    alert = alert_view(db.one("SELECT * FROM alerts WHERE id = ?", (aid,)))
    await hub.emit("alert_new", alert)
    if tourist:
        await refresh_tourist_status(tourist["id"])
    return alert, True


async def record_location(tourist, lat, lon, source, battery=None):
    """Store a position, then check geofences. Returns the zones the tourist is inside."""
    tid = tourist["id"]
    upd = {"last_lat": lat, "last_lon": lon, "last_seen": db.now()}
    if battery is not None:
        upd["battery"] = battery
    db.update("tourists", "id", tid, upd)
    db.insert("locations", dict(tourist_id=tid, lat=lat, lon=lon, source=source, ts=db.now()))

    inside = geo.fences_containing(lat, lon, db.query("SELECT * FROM geofences"))
    for f in inside:
        if f["risk"] != "high":
            continue
        open_gf = db.one(
            "SELECT id FROM alerts WHERE tourist_id = ? AND type = 'GEOFENCE' AND status != 'resolved' AND message = ?",
            (tid, f"Entered: {f['name']}"),
        )
        if not open_gf:
            await create_alert(tourist, type="GEOFENCE", lat=lat, lon=lon, source=source,
                               message=f"Entered: {f['name']}")
    await hub.emit("tourist_update", get_tourist(tid))
    return inside


async def process_packet(p: PacketIn, source: str, gateway_id=None):
    tourist = get_tourist(p.tourist_id, p.band_id)
    ptype = p.type.upper()
    result = {"msg_id": p.msg_id, "type": ptype, "tourist_id": tourist["id"] if tourist else None}

    if tourist and p.lat is not None and p.lon is not None:
        result["zones"] = [f["name"] for f in await record_location(tourist, p.lat, p.lon, source, p.battery)]
    elif tourist and p.battery is not None:
        db.update("tourists", "id", tourist["id"], {"battery": p.battery, "last_seen": db.now()})

    if ptype == "CANCEL" and tourist:
        opened = db.query(
            "SELECT id FROM alerts WHERE tourist_id = ? AND status != 'resolved' AND type IN ('SOS','FALL','HEALTH')",
            (tourist["id"],),
        )
        for a in opened:
            db.update("alerts", "id", a["id"], {"status": "resolved", "resolved_at": db.now(),
                                                "notes": "Cancelled by tourist (false alarm)"})
            await hub.emit("alert_update", alert_view(db.one("SELECT * FROM alerts WHERE id = ?", (a["id"],))))
        await refresh_tourist_status(tourist["id"])
        result["cancelled"] = len(opened)
    elif ptype in ALERT_TYPES:
        lat, lon = p.lat, p.lon
        if lat is None and tourist:  # no GPS fix: fall back to last known position
            lat, lon = tourist["last_lat"], tourist["last_lon"]
        msg = p.message
        if ptype == "HEALTH" and p.heart_rate:
            msg = msg or f"Abnormal heart rate: {p.heart_rate} bpm"
        alert, created = await create_alert(
            tourist, type=ptype, lat=lat, lon=lon, source=source, msg_id=p.msg_id,
            band_id=p.band_id, gateway_id=gateway_id, hops=p.hops, battery=p.battery, message=msg,
        )
        result.update(alert_id=alert["id"], duplicate=not created)
    return result


async def inactivity_watch():
    """Raise an INACTIVITY alert when a tourist inside a risk zone goes silent."""
    while True:
        await asyncio.sleep(20)
        cutoff = db.now() - INACTIVITY_MIN * 60
        fences = db.query("SELECT * FROM geofences")
        for t in db.query("SELECT * FROM tourists WHERE status = 'safe' AND last_seen < ?", (cutoff,)):
            if t["last_lat"] is None:
                continue
            zones = geo.fences_containing(t["last_lat"], t["last_lon"], fences)
            if not zones:
                continue
            already = db.one("SELECT id FROM alerts WHERE tourist_id = ? AND type = 'INACTIVITY' AND created_at > ?",
                             (t["id"], t["last_seen"]))
            if already:  # one alert per silent period, even after it is resolved
                continue
            mins = int((db.now() - t["last_seen"]) / 60)
            await create_alert(t, type="INACTIVITY", lat=t["last_lat"], lon=t["last_lon"], source="system",
                               message=f"No signal for {mins} min inside {zones[0]['name']}")


# ---------------------------------------------------------------- app
@contextlib.asynccontextmanager
async def lifespan(app):
    db.init()
    seed.seed_if_empty()
    task = asyncio.create_task(inactivity_watch())
    yield
    task.cancel()


app = FastAPI(title="Suraksha Band API", version="1.0", lifespan=lifespan,
              description="Tourist safety backend: SOS alerts, LoRa mesh gateway ingest, geofencing, digital ID.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    return {"ok": True, "time": time.time()}


# Tourists
@app.post("/api/tourists", status_code=201)
async def register_tourist(body: TouristIn):
    if body.band_id and get_tourist(band_id=body.band_id):
        raise HTTPException(409, f"Band {body.band_id} is already linked to another tourist")
    rec = body.model_dump()
    rec.update(id=identity.new_tourist_id(), id_doc=identity.mask_doc(body.id_doc),
               status="safe", created_at=db.now(), last_seen=db.now())
    rec["digital_id"] = identity.issue(rec)
    db.insert("tourists", rec)
    t = get_tourist(rec["id"])
    await hub.emit("tourist_update", t)
    return t


@app.get("/api/tourists")
def list_tourists():
    return db.query("SELECT * FROM tourists ORDER BY created_at DESC")


@app.get("/api/tourists/{tid}")
def tourist_detail(tid: str):
    t = get_tourist(tid)
    if not t:
        raise HTTPException(404, "Tourist not found")
    return t


@app.post("/api/tourists/{tid}/band")
async def link_band(tid: str, body: dict):
    t = get_tourist(tid)
    if not t:
        raise HTTPException(404, "Tourist not found")
    band = (body.get("band_id") or "").strip().upper() or None
    other = get_tourist(band_id=band) if band else None
    if other and other["id"] != tid:
        raise HTTPException(409, f"Band {band} is already linked to another tourist")
    db.update("tourists", "id", tid, {"band_id": band})
    t = get_tourist(tid)
    await hub.emit("tourist_update", t)
    return t


@app.get("/api/tourists/{tid}/track")
def tourist_track(tid: str, limit: int = 200):
    rows = db.query("SELECT lat, lon, source, ts FROM locations WHERE tourist_id = ? ORDER BY ts DESC LIMIT ?",
                    (tid, limit))
    return list(reversed(rows))


@app.post("/api/tourists/{tid}/location")
async def update_location(tid: str, body: LocationIn):
    t = get_tourist(tid)
    if not t:
        raise HTTPException(404, "Tourist not found")
    zones = await record_location(t, body.lat, body.lon, body.source, body.battery)
    return {"ok": True, "zones": zones}


# SOS and mesh
@app.post("/api/sos")
async def sos(body: PacketIn):
    """Direct SOS from the tourist app over the internet."""
    if not get_tourist(body.tourist_id, body.band_id):
        raise HTTPException(404, "Unknown tourist or band")
    return await process_packet(body, source="app")


@app.post("/api/gateway/ingest")
async def gateway_ingest(body: IngestIn):
    """Called by a LoRa gateway (real ESP32 or the simulator) with packets heard on the mesh."""
    gw = db.one("SELECT * FROM gateways WHERE id = ?", (body.gateway_id,))
    if gw:
        db.execute("UPDATE gateways SET last_seen = ?, packets = packets + ? WHERE id = ?",
                   (db.now(), len(body.packets), body.gateway_id))
    else:
        db.insert("gateways", dict(id=body.gateway_id, name=body.gateway_id, lat=body.gateway_lat,
                                   lon=body.gateway_lon, last_seen=db.now(), packets=len(body.packets)))
    results = [await process_packet(p, source="mesh", gateway_id=body.gateway_id) for p in body.packets]
    await hub.emit("gateway_update", db.one("SELECT * FROM gateways WHERE id = ?", (body.gateway_id,)))
    return {"ok": True, "results": results}


SMS_RE = re.compile(r"(SOS|FALL|HEALTH|CANCEL)\s+(BAND-\w+)(?:\s+(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+))?(?:\s+B(\d+))?", re.I)


@app.post("/api/sms/inbound")
async def sms_inbound(request: Request):
    """SMS fallback. Point an SMS provider webhook or a GSM gateway here.
    Body format: 'SOS BAND-1001 25.5788,91.8933 B80'"""
    if request.headers.get("content-type", "").startswith("application/json"):
        data = await request.json()
    else:
        data = dict(await request.form())
    text = data.get("body") or data.get("Body") or data.get("message") or ""
    m = SMS_RE.search(text)
    if not m:
        raise HTTPException(400, "Could not parse SMS. Expected: SOS BAND-1001 25.57,91.89")
    kind, band, lat, lon, batt = m.groups()
    pkt = PacketIn(msg_id=f"SMS-{band}-{int(time.time() // 60)}", band_id=band.upper(), type=kind.upper(),
                   lat=float(lat) if lat else None, lon=float(lon) if lon else None,
                   battery=int(batt) if batt else None, hops=["SMS"])
    return await process_packet(pkt, source="sms")


# Alerts
@app.get("/api/alerts")
def list_alerts(status: Optional[str] = None, limit: int = 200):
    if status == "active":
        rows = db.query("SELECT * FROM alerts WHERE status != 'resolved' ORDER BY created_at DESC LIMIT ?", (limit,))
    elif status:
        rows = db.query("SELECT * FROM alerts WHERE status = ? ORDER BY created_at DESC LIMIT ?", (status, limit))
    else:
        rows = db.query("SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?", (limit,))
    return [alert_view(a) for a in rows]


@app.get("/api/alerts/{aid}")
def alert_detail(aid: int):
    a = db.one("SELECT * FROM alerts WHERE id = ?", (aid,))
    if not a:
        raise HTTPException(404, "Alert not found")
    return alert_view(a)


async def _set_alert(aid, changes):
    a = db.one("SELECT * FROM alerts WHERE id = ?", (aid,))
    if not a:
        raise HTTPException(404, "Alert not found")
    db.update("alerts", "id", aid, changes)
    a = alert_view(db.one("SELECT * FROM alerts WHERE id = ?", (aid,)))
    await hub.emit("alert_update", a)
    if a["tourist_id"]:
        await refresh_tourist_status(a["tourist_id"])
    return a


@app.post("/api/alerts/{aid}/ack")
async def ack_alert(aid: int, body: ActionIn):
    return await _set_alert(aid, {"status": "acknowledged", "ack_at": db.now(),
                                  "assigned_to": body.responder or "Control Room", "notes": body.notes})


@app.post("/api/alerts/{aid}/resolve")
async def resolve_alert(aid: int, body: ActionIn):
    a = db.one("SELECT ack_at FROM alerts WHERE id = ?", (aid,))
    changes = {"status": "resolved", "resolved_at": db.now(), "notes": body.notes}
    if a and not a["ack_at"]:
        changes["ack_at"] = db.now()
    if body.responder:
        changes["assigned_to"] = body.responder
    return await _set_alert(aid, changes)


# Geofences, places, gateways, advisories
@app.get("/api/geofences")
def list_geofences():
    return db.query("SELECT * FROM geofences")


@app.post("/api/geofences", status_code=201)
async def add_geofence(body: GeofenceIn):
    gid = db.insert("geofences", {**body.model_dump(), "created_at": db.now()})
    await hub.emit("geofences_changed", db.query("SELECT * FROM geofences"))
    return db.one("SELECT * FROM geofences WHERE id = ?", (gid,))


@app.delete("/api/geofences/{gid}")
async def delete_geofence(gid: int):
    db.execute("DELETE FROM geofences WHERE id = ?", (gid,))
    await hub.emit("geofences_changed", db.query("SELECT * FROM geofences"))
    return {"ok": True}


@app.get("/api/places")
def list_places(lat: Optional[float] = None, lon: Optional[float] = None):
    places = db.query("SELECT * FROM places")
    if lat is not None and lon is not None:
        return geo.nearest(lat, lon, places, limit=len(places))
    return places


@app.get("/api/gateways")
def list_gateways():
    return db.query("SELECT * FROM gateways")


@app.get("/api/advisories")
def list_advisories(limit: int = 10):
    return db.query("SELECT * FROM advisories ORDER BY created_at DESC LIMIT ?", (limit,))


@app.post("/api/advisories", status_code=201)
async def add_advisory(body: AdvisoryIn):
    aid = db.insert("advisories", {**body.model_dump(), "created_at": db.now()})
    adv = db.one("SELECT * FROM advisories WHERE id = ?", (aid,))
    await hub.emit("advisory", adv)
    return adv


@app.get("/api/stats")
def stats():
    t = db.now()
    day_start = t - (t % 86400)
    acked = db.query("SELECT created_at, ack_at FROM alerts WHERE ack_at IS NOT NULL")
    avg_resp = (sum(a["ack_at"] - a["created_at"] for a in acked) / len(acked)) if acked else None
    by_type = {r["type"]: r["n"] for r in db.query("SELECT type, COUNT(*) AS n FROM alerts GROUP BY type")}
    return {
        "tourists": db.one("SELECT COUNT(*) AS n FROM tourists")["n"],
        "active_tourists": db.one("SELECT COUNT(*) AS n FROM tourists WHERE last_seen > ?", (t - ACTIVE_WINDOW_S,))["n"],
        "open_alerts": db.one("SELECT COUNT(*) AS n FROM alerts WHERE status = 'open'")["n"],
        "acknowledged": db.one("SELECT COUNT(*) AS n FROM alerts WHERE status = 'acknowledged'")["n"],
        "resolved_today": db.one("SELECT COUNT(*) AS n FROM alerts WHERE status = 'resolved' AND resolved_at > ?", (day_start,))["n"],
        "gateways_online": db.one("SELECT COUNT(*) AS n FROM gateways WHERE last_seen > ?", (t - 600,))["n"],
        "avg_response_s": round(avg_resp) if avg_resp is not None else None,
        "alerts_by_type": by_type,
    }


@app.get("/api/ledger/verify")
def verify_ledger():
    return identity.verify_chain()


@app.post("/api/demo/reset")
async def demo_reset():
    """Clear alerts and put everyone back to safe, handy between demo runs."""
    db.execute("DELETE FROM alerts")
    db.execute("UPDATE tourists SET status = 'safe', last_seen = ?", (db.now(),))
    await hub.emit("reset", {})
    return {"ok": True}


@app.websocket("/ws")
async def ws_feed(ws: WebSocket):
    await hub.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive pings from clients
    except WebSocketDisconnect:
        pass
    finally:
        hub.drop(ws)


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
