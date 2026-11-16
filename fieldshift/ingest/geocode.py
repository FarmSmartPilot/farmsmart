"""Smart search: decimal lat/lon, DMS, or place text (Nominatim, rate-limited, attributed)."""
from __future__ import annotations

import re
import threading
import time

from ..config import http

_lock = threading.Lock()
_last = [0.0]

DEC = re.compile(r"^\s*([-+]?\d{1,2}(?:\.\d+)?)\s*[, ]\s*([-+]?\d{1,3}(?:\.\d+)?)\s*$")
DMS = re.compile(r"""(\d{1,3})[°\s]+(\d{1,2})['′\s]+(\d{1,2}(?:\.\d+)?)?["″\s]*([NSEW])""", re.I)


def parse_coords(q: str) -> tuple[float, float] | None:
    m = DEC.match(q)
    if m:
        lat, lon = float(m.group(1)), float(m.group(2))
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            return lat, lon
    parts = DMS.findall(q)
    if len(parts) == 2:
        vals = {}
        for d, mi, s, h in parts:
            v = float(d) + float(mi) / 60 + (float(s) if s else 0) / 3600
            if h.upper() in "SW":
                v = -v
            vals["lat" if h.upper() in "NS" else "lon"] = v
        if "lat" in vals and "lon" in vals:
            return vals["lat"], vals["lon"]
    return None


def search(q: str, limit: int = 6) -> list[dict]:
    c = parse_coords(q)
    if c:
        return [{"label": f"{c[0]:.5f}, {c[1]:.5f}", "lat": c[0], "lon": c[1], "kind": "coordinates", "bbox": None}]
    with _lock:  # Nominatim policy: max 1 request/second
        wait = 1.05 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
    r = http().get("https://nominatim.openstreetmap.org/search",
                   params={"q": q, "format": "jsonv2", "limit": limit, "addressdetails": 1, "polygon_geojson": 1,
                           "polygon_threshold": 0.002}, timeout=30)
    r.raise_for_status()
    out = []
    for it in r.json():
        bb = it.get("boundingbox")
        out.append({
            "label": it.get("display_name"), "lat": float(it["lat"]), "lon": float(it["lon"]),
            "kind": it.get("addresstype") or it.get("type"),
            "bbox": [float(bb[2]), float(bb[0]), float(bb[3]), float(bb[1])] if bb else None,
            "geojson": it.get("geojson") if it.get("geojson", {}).get("type") in ("Polygon", "MultiPolygon") else None,
            "address": it.get("address", {}),
        })
    return out


def reverse(lat: float, lon: float) -> dict:
    """Address of a point (OpenStreetMap Nominatim). One retry on a dropped connection or server error."""
    try:
        return _reverse_once(lat, lon)
    except Exception:  # noqa: BLE001 - second try; a second failure is raised to the caller
        time.sleep(2)
        return _reverse_once(lat, lon)


def _reverse_once(lat: float, lon: float) -> dict:
    with _lock:
        wait = 1.05 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
    r = http().get("https://nominatim.openstreetmap.org/reverse",
                   params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 10, "addressdetails": 1}, timeout=30)
    r.raise_for_status()
    return r.json().get("address", {})
