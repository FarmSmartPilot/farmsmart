"""Market prices for the farmer's reference (wave U7): GET /api/markets.

State and US prices received (USDA NASS), ERS harvest-price history, the latest USDA WASDE season-average farm
price, USDA baseline projections and World Bank benchmarks for crops and fertilizer. All gray (non-NASA) sources;
each block carries `available` and, when false, the reason. See fieldshift/ingest/markets.py."""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..ingest import markets as mk

router = APIRouter()

_STATE = re.compile(r"^[A-Za-z]{2}$")
_CROP = re.compile(r"^[a-z][a-z_]{1,29}$")


@router.get("/api/markets")
def get_markets(state: Optional[str] = Query(None, description="2-letter US state code (USPS), e.g. IA"),
                crops: Optional[str] = Query(None, description="comma-separated FarmSmart crop ids"),
                country: Optional[str] = Query(None, description="ISO country code; anything but US returns "
                                                                 "World Bank benchmarks only")):
    if state is not None and state != "" and not _STATE.match(state):
        raise HTTPException(422, "state must be a 2-letter code")
    if country is not None and country != "" and not re.match(r"^[A-Za-z]{2,3}$", country):
        raise HTTPException(422, "country must be a 2- or 3-letter code")
    ids = None
    if crops:
        ids = [c.strip().lower() for c in crops.split(",") if c.strip()]
        bad = [c for c in ids if not _CROP.match(c)]
        if bad or len(ids) > 20:
            raise HTTPException(422, "crops must be up to 20 comma-separated crop ids")
    return mk.markets(state, ids, country)


@router.get("/api/markets/crops")
def market_crops():
    """Crop ids with a mapped market series, and which sources cover each."""
    return {"crops": {c: {"label": s["label"], "unit": s["unit"], "nass": bool(s["nass"]), "ers": bool(s["ers"]),
                          "wasde": bool(s["wasde"]), "projections": bool(s["baseline"]), "world_bank": bool(s["wb"])}
                      for c, s in mk.CROPS.items()},
            "default": mk.DEFAULT_CROPS}
