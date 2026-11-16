"""GET /api/fields/{fid}/peers: what cropland within about 5 km of the field grew, year by year.

USDA NASS Cropland Data Layer (US) or AAFC Annual Crop Inventory (Canada), 30 m pixels in a 10 km box: crop mix by
year, pooled year-to-year transitions, per-pixel rotation types over 6 years, recent changes and this field's own
type. Cached in data/precomputed/peers_{fid}.json (pilots) and data/cache/peers/{fid}.json. A data value (gray
source button, is_nasa false), never an SI output and never evidence that a switch pays.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException

from ..ingest import peers

router = APIRouter()

_FID = re.compile(r"^[0-9a-f]{6,40}$")


@router.get("/api/fields/{fid}/peers")
def field_peers(fid: str, refresh: bool = False):
    if not _FID.match(fid):
        raise HTTPException(404, "unknown field")
    if not refresh:
        hit = peers.cached(fid)
        if hit is not None:
            return hit
    from .main import _ctx  # lazy: main imports this module at start-up
    ctx = _ctx(fid)
    try:
        return peers.get(fid, ctx, refresh=refresh)
    except Exception as e:  # noqa: BLE001 - said plainly, never invented
        return {"available": False, "reason": f"Crop map service failed: {str(e)[:200]}", "field_id": fid,
                "version": peers.PEERS_VERSION, "is_nasa": False}
