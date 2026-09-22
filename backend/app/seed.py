"""Demo data around Shillong, Meghalaya. Coordinates and phone numbers are approximate
sample values for the demo only. Replace them with verified data before real use."""
import random

from . import db, identity

GEOFENCES = [
    ("Elephant Falls - slippery rocks", "high", 25.5405, 91.8235, 450, "Wet rocks and steep drop. Stay behind the railings."),
    ("Umiam Lake - deep water", "medium", 25.6560, 91.8850, 1200, "Drowning risk. Boating only with life jackets."),
    ("Shillong Peak - restricted zone", "medium", 25.5465, 91.8725, 500, "Air Force area. Entry only with a permit."),
    ("Dense forest belt - no network", "high", 25.5150, 91.9100, 1500, "No mobile network. Do not enter without a guide."),
]

PLACES = [
    ("Sadar Police Station", "police", 25.5752, 91.8830, "0364-2224400"),
    ("Laitumkhrah Police Station", "police", 25.5690, 91.8985, "0364-2224401"),
    ("Mawlai Police Outpost", "police", 25.5970, 91.8840, "0364-2224402"),
    ("Tourist Police Booth - Police Bazar", "police", 25.5770, 91.8855, "0364-2224403"),
    ("Civil Hospital Shillong", "hospital", 25.5735, 91.8810, "0364-2224100"),
    ("NEIGRIHMS", "hospital", 25.6040, 91.9455, "0364-2538013"),
    ("Nazareth Hospital", "hospital", 25.5645, 91.8990, "0364-2224101"),
]

TOURISTS = [
    ("Aarav Sharma", "+91-9800000001", "Indian", "AADHAAR-1234-5678-9012", "B+", "", "Neha Sharma", "+91-9800000101", "en", "BAND-1001"),
    ("Emma Wilson", "+44-7700900001", "British", "PASSPORT-GB9876543", "O+", "Asthma, carries inhaler", "John Wilson", "+44-7700900101", "en", "BAND-1002"),
    ("Priya Nair", "+91-9800000002", "Indian", "AADHAAR-2222-3333-4444", "A-", "", "Rahul Nair", "+91-9800000102", "hi", "BAND-1003"),
    ("Kenji Tanaka", "+81-9000000001", "Japanese", "PASSPORT-JP1122334", "AB+", "Diabetic", "Yui Tanaka", "+81-9000000101", "en", "BAND-1004"),
    ("Rohan Das", "+91-9800000003", "Indian", "AADHAAR-5555-6666-7777", "O-", "", "Mita Das", "+91-9800000103", "hi", "BAND-1005"),
]

GATEWAYS = [
    ("GW-POLICEBAZAR", "Gateway - Police Bazar", 25.5770, 91.8855),
    ("GW-LAITUMKHRAH", "Gateway - Laitumkhrah", 25.5690, 91.8985),
]


def seed_if_empty():
    if db.one("SELECT COUNT(*) AS n FROM places")["n"]:
        return
    t = db.now()
    for name, risk, lat, lon, r, desc in GEOFENCES:
        db.insert("geofences", dict(name=name, risk=risk, lat=lat, lon=lon, radius_m=r, description=desc, created_at=t))
    for name, kind, lat, lon, phone in PLACES:
        db.insert("places", dict(name=name, kind=kind, lat=lat, lon=lon, phone=phone))
    for gid, name, lat, lon in GATEWAYS:
        db.insert("gateways", dict(id=gid, name=name, lat=lat, lon=lon, last_seen=t, packets=0))

    rnd = random.Random(42)
    for i, (name, phone, nat, doc, bg, med, en, ep, lang, band) in enumerate(TOURISTS):
        lat = 25.5788 + rnd.uniform(-0.02, 0.02)
        lon = 91.8933 + rnd.uniform(-0.02, 0.02)
        rec = dict(
            id=identity.new_tourist_id(), name=name, phone=phone, nationality=nat,
            id_doc=identity.mask_doc(doc), blood_group=bg, medical_notes=med,
            emergency_name=en, emergency_phone=ep, language=lang, band_id=band,
            trip_start="2026-09-20", trip_end="2026-09-28",
            itinerary=["Police Bazar", "Elephant Falls", "Umiam Lake", "Cherrapunji"],
            last_lat=lat, last_lon=lon, last_seen=t, battery=rnd.randint(55, 98),
            status="safe", created_at=t + i * 0.001,
        )
        rec["digital_id"] = identity.issue(rec)
        db.insert("tourists", rec)
        db.insert("locations", dict(tourist_id=rec["id"], lat=lat, lon=lon, source="seed", ts=t))
