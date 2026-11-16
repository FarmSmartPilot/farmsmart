"""Field-scale NASA observations: HLS 30 m NDVI per scene inside the field, and ECOSTRESS 70 m daytime ET.

Precomputed pilot JSON first (data/precomputed/{hls,ecostress}_{fid}.json), then data/cache/fieldsat/, else a
live read with a 60 s budget. Any failure returns available:false with a plain reason; values are never invented.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from fastapi import APIRouter, HTTPException

from .. import config
from ..ingest import ecostress as eco
from ..ingest import hls_ndvi as hls

router = APIRouter()

BUDGET_S = 60
_SCENE = re.compile(r"^HLS\.(L30|S30)\.T[0-9A-Z]{5}\.\d{7}T\d{6}\.v2\.0$")
_FID = re.compile(r"^[0-9a-f]{6,40}$")


def _ctx(fid: str) -> dict:
    if not _FID.match(fid):
        raise HTTPException(404, "unknown field")
    from .main import _ctx as main_ctx  # lazy: main imports this module at start-up
    return main_ctx(fid)


def _read(p) -> Optional[dict]:
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    except (OSError, ValueError):
        return None


def _centre(ctx: dict) -> tuple[float, float]:
    """Field centre (lon, lat): the polygon centroid, or a point inside the polygon if the centroid falls outside."""
    from shapely.geometry import Point, shape
    shp = shape(ctx["geometry"])
    c = ctx.get("centroid")
    pt = Point(c) if c else shp.centroid
    if not shp.contains(pt):
        pt = shp.representative_point()
    return float(pt.x), float(pt.y)


def _lat(ctx: dict) -> float:
    c = ctx.get("centroid")
    if c:
        return float(c[1])
    from shapely.geometry import shape
    return float(shape(ctx["geometry"]).centroid.y)


def _fail(fid: str, reason: str, **extra: Any) -> dict:
    return {"available": False, "reason": reason, "field_id": fid, **extra}


def _year_ok(doc: dict, year: Optional[int]) -> bool:
    return year is None or str(doc.get("period", {}).get("start", ""))[:4] == str(year)


# --------------------------------------------------------------------------- HLS

@router.get("/api/fields/{fid}/hls")
def field_hls(fid: str, year: Optional[int] = None):
    """HLS v2.0 L30/S30 NDVI scene summaries inside the field (30 m). `year` = season start year (default: latest complete)."""
    pre = _read(config.PRECOMP / f"hls_{fid}.json")
    if pre and _year_ok(pre, year):
        pre.pop("grid", None)
        return {**pre, "served_from": "precomputed"}
    ctx = _ctx(fid)
    try:
        start, _end, _ = hls.season_period(_lat(ctx), year=year)
        cp = hls.cache_path(fid, start.isoformat())
        doc = _read(cp)
        if doc and doc.get("complete"):
            return {**doc, "served_from": "cache"}
        doc, _grids = hls.field_hls(ctx["geometry"], _lat(ctx), key=fid, year=year, budget_s=BUDGET_S)
        if doc.get("available"):
            cp.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        return {**doc, "served_from": "live"}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        return _fail(fid, f"HLS not retrieved: {type(e).__name__}: {str(e)[:200]}", scenes=[], grid_scene_id=None)


@router.get("/api/fields/{fid}/hls/{scene_id}/grid")
def field_hls_grid(fid: str, scene_id: str):
    """30 m NDVI pixel grid of one HLS scene over the field window (null = masked; `inside` = pixel centre in field)."""
    if not _SCENE.match(scene_id):
        return _fail(fid, "Not an HLS v2.0 scene id.")
    pre = _read(config.PRECOMP / f"hls_{fid}.json")
    if pre and (pre.get("grid") or {}).get("scene_id") == scene_id:
        return {"available": True, "reason": None, **pre["grid"], "served_from": "precomputed"}
    g = hls.cached_grid(fid, scene_id)
    if g:
        return {"available": True, "reason": None, **g, "served_from": "cache"}
    ctx = _ctx(fid)
    try:
        g = hls.read_grid_live(ctx["geometry"], scene_id)
    except Exception as e:  # noqa: BLE001
        return _fail(fid, f"HLS scene {scene_id} not read: {type(e).__name__}: {str(e)[:200]}")
    return {"available": True, "reason": None, **g, "served_from": "live"}


# --------------------------------------------------------------------------- ECOSTRESS

@router.get("/api/fields/{fid}/ecostress")
def field_ecostress(fid: str, year: Optional[int] = None):
    """ECOSTRESS L3T JET v003 daytime ET (mm/day) at the 70 m pixel at the field centre, for the latest complete season."""
    pre = _read(config.PRECOMP / f"ecostress_{fid}.json")
    if pre and _year_ok(pre, year):
        return {**pre, "served_from": "precomputed"}
    ctx = _ctx(fid)
    try:
        lon, lat = _centre(ctx)
        start, end, _ = hls.season_period(lat, year=year)
        cp = hls.FS_CACHE / f"ecostress_series_{fid}_{start}.json"
        doc = _read(cp)
        if doc and doc.get("complete"):
            return {**doc, "served_from": "cache"}
        doc = eco.field_ecostress(lon, lat, start, end, key=fid, budget_s=BUDGET_S)
        if doc.get("available"):
            cp.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        return {**doc, "served_from": "live"}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        return _fail(fid, f"ECOSTRESS not retrieved: {type(e).__name__}: {str(e)[:200]}", observations=[])
