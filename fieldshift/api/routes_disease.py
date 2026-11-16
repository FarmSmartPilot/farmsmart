"""GET /api/fields/{fid}/disease: weather that favours tar spot, gray leaf spot and white mold at the field.

Published UW-Madison logistic models (fieldshift/engine/disease.py) re-run on NASA POWER hourly weather (≈50 km).
Past seasons are cached as parquet (data/cache/disease); the per-field answer is kept in memory for 12 h so the
running season refreshes about twice a day. Also returns the pathogen host groups (engine/rules/pathogens.yaml) for
the crops this field grew, so the panel can say which diseases the rotation itself carries over."""
from __future__ import annotations

import re
import threading
import time

from fastapi import APIRouter, HTTPException

from ..engine import disease as dz, kb

router = APIRouter()

_FID = re.compile(r"^[0-9a-f]{6,40}$")
_mem: dict[str, tuple[float, dict]] = {}
_locks: dict[str, threading.Lock] = {}
TTL = 12 * 3600


def _hosts_block(ctx: dict) -> dict:
    """Pathogen groups hosted by the crops in this field's recent CDL history (data from pathogens.yaml)."""
    P, C = kb.pathogens(), kb.crops()
    hist = []
    for y in ((ctx.get("crop_history") or {}).get("years") or [])[-6:]:
        top = max((c for c in y.get("classes") or [] if c.get("crop_id") in C), key=lambda c: c.get("share") or 0,
                  default=None)
        if top and (top.get("share") or 0) >= 0.5:
            hist.append({"year": y["year"], "crop": top["crop_id"]})
    groups = []
    for pid, p in P.items():
        crops_here = sorted({h["crop"] for h in hist if h["crop"] in (p.get("hosts") or []) + (p.get("inoculum_sources") or [])})
        if crops_here:
            groups.append({"id": pid, "name_en": p["name_en"], "name_es": p["name_es"], "kind": p["kind"],
                           "hosts": p.get("hosts"), "inoculum_sources": p.get("inoculum_sources"),
                           "in_recent_crops": crops_here, "break_years": p.get("break_years"),
                           "survival_years": p.get("survival_years"), "advice_en": p.get("advice_en"),
                           "advice_es": p.get("advice_es"), "sources": p.get("sources")})
    return {"recent_crops": hist, "groups": groups,
            "source": "USDA NASS Cropland Data Layer (30 m) for the crops; host lists from extension sources",
            "is_nasa": False}


@router.get("/api/fields/{fid}/disease")
def field_disease(fid: str):
    if not _FID.match(fid):
        raise HTTPException(404, "unknown field")
    hit = _mem.get(fid)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    lock = _locks.setdefault(fid, threading.Lock())
    with lock:
        hit = _mem.get(fid)
        if hit and time.time() - hit[0] < TTL:
            return hit[1]
        from .main import _ctx  # lazy: main imports this module at start-up
        ctx = _ctx(fid)
        lon, lat = ctx["centroid"][0], ctx["centroid"][1]
        out = {"field_id": fid,
               **dz.field_disease(lat, lon, (ctx.get("place") or {}).get("country_code"), ctx.get("statefips"))}
        out["rotation_hosts"] = _hosts_block(ctx)
        if out.get("available") and not out.get("errors"):
            if len(_mem) > 500:
                _mem.clear()
            _mem[fid] = (time.time(), out)
        return out
