"""Geo helpers: distances, geofence checks, nearest emergency services."""
import math

EARTH_RADIUS_M = 6_371_000


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def fences_containing(lat, lon, fences):
    """Return geofences (circles) that contain the point."""
    return [f for f in fences if haversine_m(lat, lon, f["lat"], f["lon"]) <= f["radius_m"]]


def nearest(lat, lon, places, kind=None, limit=3):
    items = [p for p in places if kind is None or p["kind"] == kind]
    for p in items:
        p["distance_m"] = round(haversine_m(lat, lon, p["lat"], p["lon"]))
    return sorted(items, key=lambda p: p["distance_m"])[:limit]
