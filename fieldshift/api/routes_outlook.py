"""GET /api/fields/{fid}/outlook: NOAA CPC official 1-month and 3-month outlooks at the field (US only).

See fieldshift/ingest/outlook.py. The CPC files are kept 12 h; the per-field answer is kept in memory for the same
time. A gray (non-NASA) source: chances for a large region, never a forecast for the field."""
from __future__ import annotations

import re
import time

from fastapi import APIRouter, HTTPException

from ..ingest import outlook as ol

router = APIRouter()

_FID = re.compile(r"^[0-9a-f]{6,40}$")
_mem: dict[str, tuple[float, dict]] = {}


@router.get("/api/fields/{fid}/outlook")
def field_outlook(fid: str):
    if not _FID.match(fid):
        raise HTTPException(404, "unknown field")
    hit = _mem.get(fid)
    if hit and time.time() - hit[0] < ol.TTL:
        return hit[1]
    from .main import _ctx  # lazy: main imports this module at start-up
    ctx = _ctx(fid)
    lon, lat = ctx["centroid"][0], ctx["centroid"][1]
    out = {"field_id": fid, **ol.outlook_at(lon, lat, (ctx.get("place") or {}).get("country_code"))}
    if out.get("available") and not out.get("stale"):
        if len(_mem) > 500:
            _mem.clear()
        _mem[fid] = (time.time(), out)
    return out
