"""Demo data around Shillong, Meghalaya. Coordinates and phone numbers are approximate
sample values for the demo only. Replace them with verified data before real use."""
import random

from . import db, identity

GEOFENCES = [
    ("Elephant Falls", "high", 25.5405, 91.8235, 450, "The rocks are slippery. Stay behind the railings."),
    ("Umiam Lake", "medium", 25.6560, 91.8850, 1200, "Deep water. Take a boat only with a life jacket."),
    ("Shillong Peak", "medium", 25.5465, 91.8725, 500, "Air Force area. Entry only with a permit."),
    ("Forest belt south of Mawlai", "high", 25.5150, 91.9100, 1500, "No mobile network here. Go only with a registered guide."),
    ("Laitlum Canyon", "high", 25.4630, 91.9060, 800, "Unfenced cliff edge. Keep to the marked path."),
]

PLACES = [
    ("Sadar Police Station", "police", 25.5752, 91.8830, "0364-2224400"),
    ("Laitumkhrah Police Station", "police", 25.5690, 91.8985, "0364-2224401"),
    ("Mawlai Police Outpost", "police", 25.5970, 91.8840, "0364-2224402"),
    ("Tourist Police Booth, Police Bazar", "police", 25.5770, 91.8855, "0364-2224403"),
    ("Civil Hospital Shillong", "hospital", 25.5735, 91.8810, "0364-2224100"),
    ("NEIGRIHMS", "hospital", 25.6040, 91.9455, "0364-2538013"),
    ("Nazareth Hospital", "hospital", 25.5645, 91.8990, "0364-2224101"),
]

# name, phone, home state, id doc, blood, medical, contact name, contact phone, language, band
TOURISTS = [
    ("Aarav Sharma", "+91 98110 24567", "Delhi", "AADHAAR-4821-7730-1290", "B+", "", "Neha Sharma (sister)", "+91 98110 88213", "hi", "BAND-1001"),
    ("Priya Nair", "+91 94470 31822", "Kerala", "AADHAAR-2290-5518-3346", "O+", "Asthma, carries an inhaler", "Rahul Nair (husband)", "+91 94470 55190", "en", "BAND-1002"),
    ("Rohan Das", "+91 90380 11745", "West Bengal", "AADHAAR-6634-9021-5572", "A-", "", "Mita Das (mother)", "+91 90380 60024", "en", "BAND-1003"),
    ("Kabir Singh", "+91 98150 67310", "Punjab", "AADHAAR-7710-3384-4334", "AB+", "Diabetic, takes insulin", "Harpreet Kaur (wife)", "+91 98150 22671", "hi", "BAND-1004"),
    ("Ananya Iyer", "+91 94440 72918", "Tamil Nadu", "AADHAAR-3158-6602-8817", "O-", "Allergic to penicillin", "Lakshmi Iyer (mother)", "+91 94440 13356", "en", "BAND-1005"),
    ("Meera Joshi", "+91 98220 45093", "Maharashtra", "AADHAAR-9043-1176-2250", "B-", "", "Vikram Joshi (brother)", "+91 98220 70418", "hi", "BAND-1006"),
]

GATEWAYS = [
    ("GW-POLICEBAZAR", "Police Bazar gateway", 25.5770, 91.8855),
    ("GW-LAITUMKHRAH", "Laitumkhrah gateway", 25.5690, 91.8985),
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
    for i, (name, phone, state, doc, bg, med, en, ep, lang, band) in enumerate(TOURISTS):
        lat = 25.5788 + rnd.uniform(-0.02, 0.02)
        lon = 91.8933 + rnd.uniform(-0.02, 0.02)
        rec = dict(
            id=identity.new_tourist_id(), name=name, phone=phone, nationality="Indian", home_state=state,
            id_doc=identity.mask_doc(doc), blood_group=bg, medical_notes=med,
            emergency_name=en, emergency_phone=ep, language=lang, band_id=band,
            trip_start="2026-09-20", trip_end="2026-09-28",
            itinerary=["Police Bazar", "Elephant Falls", "Umiam Lake", "Sohra (Cherrapunji)"],
            last_lat=lat, last_lon=lon, last_seen=t, battery=rnd.randint(55, 98),
            status="safe", created_at=t + i * 0.001,
        )
        rec["digital_id"] = identity.issue(rec)
        db.insert("tourists", rec)
        db.insert("locations", dict(tourist_id=rec["id"], lat=lat, lon=lon, source="seed", ts=t))
