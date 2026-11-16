"""Field boundaries: USDA NASS Crop Sequence Boundaries (US, with 2017-2024 CDL sequence), keyless."""
from __future__ import annotations

from ..config import http

CSB = "https://pdi.scinet.usda.gov/hosting/rest/services/Hosted/Crop_Sequence_Boundaries_2024/FeatureServer/0/query"
YEARS = list(range(2017, 2025))
FIELDS = "csbid,csbacres,cnty,cntyfips,statefips," + ",".join(f"cdl{y}" for y in YEARS)


def meta_of(feat: dict) -> dict:
    p = feat.get("properties") or {}
    st = str(p.get("statefips") or "").zfill(2)
    cf = str(p.get("cntyfips") or "").zfill(3)
    return {"statefips": st, "county_fips": st + cf if p.get("cntyfips") else None, "country_code": "us",
            "csbid": p.get("csbid"), "acres": p.get("csbacres"), "county": p.get("cnty"),
            "cdl_sequence": {y: p.get(f"cdl{y}") for y in YEARS}}


def at_point(lat: float, lon: float) -> dict | None:
    params = {"geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": 4326,
              "spatialRel": "esriSpatialRelIntersects", "outFields": FIELDS, "outSR": 4326, "f": "geojson"}
    r = http().get(CSB, params=params, timeout=60)
    r.raise_for_status()
    feats = r.json().get("features", [])
    return feats[0] if feats else None


def in_bbox(w: float, s: float, e: float, n: float, limit: int = 2000) -> list[dict]:
    params = {"geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
              "spatialRel": "esriSpatialRelIntersects", "outFields": FIELDS, "outSR": 4326, "f": "geojson",
              "resultRecordCount": limit, "geometryPrecision": 6}
    r = http().get(CSB, params=params, timeout=60)
    r.raise_for_status()
    return r.json().get("features", [])


# --------------------------------------------------------------------------- Fields of The World (global)
# FTW global field boundaries 2025 (PMTiles v3, MVT layer "fields", z0-14). CC BY 4.0.
# Kerner et al., Fields of The World; ftw/global-field-boundaries on Source Cooperative.
FTW_URL = "https://data.source.coop/ftw/global-field-boundaries/pmtiles/ftw-global-fields-2025.pmtiles"
FTW_LAYER = "fields"
FTW_ATTRIBUTION = "Field boundaries: Fields of The World (FTW) global 2025, CC BY 4.0 (source.coop/ftw)"
FTW_MIN_CONF = 69  # FTW docs: recommended confidence_mean filter
_ftw_bytes: dict[tuple[int, int], bytes] = {}


def _ftw_get_bytes(offset: int, length: int) -> bytes:
    """HTTP range read with an in-memory cache (header + directories are re-read for every tile)."""
    import requests
    key = (offset, length)
    if key in _ftw_bytes:
        return _ftw_bytes[key]
    from ..config import USER_AGENT
    r = requests.get(FTW_URL, headers={"Range": f"bytes={offset}-{offset + length - 1}", "User-Agent": USER_AGENT},
                     timeout=60)
    r.raise_for_status()
    b = r.content
    if length <= 2_000_000 and len(_ftw_bytes) < 512:
        _ftw_bytes[key] = b
    return b


def _tile_xy(lat: float, lon: float, z: int) -> tuple[int, int, float, float]:
    import math
    n = 2 ** z
    xf = (lon + 180.0) / 360.0 * n
    yf = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return int(xf), int(yf), xf, yf


def _ftw_tile(z: int, x: int, y: int) -> list[tuple]:
    """Decode one FTW tile -> [(lon/lat shapely polygon, props)]."""
    import gzip
    import math

    import mapbox_vector_tile
    import numpy as np
    from pmtiles.reader import Reader
    from shapely.geometry import shape
    from shapely.ops import transform

    raw = Reader(_ftw_get_bytes).get(z, x, y)
    if not raw:
        return []
    if raw[:2] == bytes([0x1F, 0x8B]):
        raw = gzip.decompress(raw)
    layer = mapbox_vector_tile.decode(raw, default_options={"y_coord_down": True}).get(FTW_LAYER)
    if not layer:
        return []
    ext = layer.get("extent", 4096)
    n = 2 ** z

    def to_lonlat(tx, ty, tz=None):
        gx = (x + np.asarray(tx) / ext) / n
        gy = (y + np.asarray(ty) / ext) / n
        return gx * 360.0 - 180.0, np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * gy))))

    out = []
    for f in layer["features"]:
        g = f.get("geometry") or {}
        if g.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        try:
            sg = shape(g)
            if not sg.is_valid:
                sg = sg.buffer(0)
            out.append((transform(to_lonlat, sg), f.get("properties") or {}))
        except Exception:  # noqa: BLE001
            continue
    return out


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def ftw_at(lat: float, lon: float, z: int = 14) -> dict | None:
    """The FTW field polygon containing (lat, lon), as a GeoJSON Feature in lon/lat, or None.

    Vector tiles clip polygons at tile edges, so pieces of the same field in the 8 neighbouring tiles
    (same confidence values, overlapping in the tile buffer) are merged back."""
    from shapely.geometry import Point, mapping
    from shapely.ops import unary_union

    x, y, _, _ = _tile_xy(lat, lon, z)
    pt = Point(lon, lat)
    hits = [(g, p) for g, p in _ftw_tile(z, x, y) if g.contains(pt)]
    if not hits:
        return None
    geo, props = min(hits, key=lambda h: h[0].area)
    key = (props.get("confidence_mean"), props.get("confidence_min"))
    parts = [geo]
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if dx == dy == 0:
                continue
            for g, p in _ftw_tile(z, x + dx, y + dy):
                if (p.get("confidence_mean"), p.get("confidence_min")) == key and g.intersects(unary_union(parts).buffer(1e-6)):
                    parts.append(g)
    geo = unary_union(parts)
    if geo.geom_type == "MultiPolygon":  # keep the part containing the point
        geo = next((q for q in geo.geoms if q.contains(pt)), max(geo.geoms, key=lambda q: q.area))
    geo = geo.simplify(1e-6)
    conf = _num(props.get("confidence_mean"))
    # FTW_MIN_CONF (69) is documented for the 2024 alpha file (percent scale). The 2025 file stores 0-1 values
    # (about 0.35-0.56 in our checks) with no documented threshold, so no low-confidence flag is set for it.
    low = (conf < FTW_MIN_CONF) if conf is not None and conf > 1 else None
    return {"type": "Feature", "geometry": mapping(geo),
            "properties": {"source": "ftw", "confidence_mean": conf, "confidence_min": _num(props.get("confidence_min")),
                           "confidence_median": _num(props.get("confidence_median")), "time": props.get("time"),
                           "low_confidence": low, "tiles_merged": len(parts),
                           "note": "Model-delineated field boundary (FTW). Check it against the imagery and redraw if needed.",
                           "attribution": FTW_ATTRIBUTION}}


def ftw_near(lat: float, lon: float, z: int = 14) -> list[dict]:
    """All FTW polygons in the z14 tile at a point (lon/lat), with area and confidence. For picking pilot fields."""
    x, y, _, _ = _tile_xy(lat, lon, z)
    out = []
    for g, p in _ftw_tile(z, x, y):
        c = g.representative_point()
        out.append({"lat": c.y, "lon": c.x, "bounds": g.bounds, "confidence_mean": _num(p.get("confidence_mean"))})
    return out


def ftw_in_bbox(w: float, s: float, e: float, n: float, z: int = 14, max_tiles: int = 9) -> list[dict]:
    """FTW field polygons inside a small view (for drawing pickable boundaries on the map/globe)."""
    from shapely.geometry import box, mapping
    x0, y0, _, _ = _tile_xy(n, w, z)
    x1, y1, _, _ = _tile_xy(s, e, z)
    tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    if len(tiles) > max_tiles:
        return []
    view = box(w, s, e, n)
    out, seen = [], set()
    for x, y in tiles:
        for g, p in _ftw_tile(z, x, y):
            if not g.intersects(view) or g.area < 2e-8:  # skip slivers (< ~0.02 ha)
                continue
            c = g.representative_point()
            key = (round(c.x, 4), round(c.y, 4))
            if key in seen:
                continue
            seen.add(key)
            out.append({"type": "Feature", "geometry": mapping(g.simplify(2e-6)),
                        "properties": {"source": "ftw", "confidence_mean": _num(p.get("confidence_mean")),
                                       "pick_lat": c.y, "pick_lon": c.x}})
    return out


def ftw_meta(feat: dict, country_code: str | None = None, state: str | None = None) -> dict:
    p = feat.get("properties") or {}
    return {"country_code": (country_code or "").lower() or None, "state": state, "source": "ftw",
            "ftw_confidence_mean": p.get("confidence_mean"), "attribution": FTW_ATTRIBUTION,
            "licence": "CC BY 4.0"}
