"""Warm the MODIS NDVI cache for pilot fields (Drought Replay ghost) for the replay years offered in the UI."""
import json, sys
from fieldshift.config import PRECOMP
from fieldshift.ingest import modis
pil = json.load(open(PRECOMP / "pilots.json", encoding="utf-8"))["pilots"]
for p in pil:
    ctx = json.load(open(PRECOMP / f"context_{p['field_id']}.json", encoding="utf-8"))
    lon, lat = ctx["centroid"]
    for y in (2012, 2017, 2023):
        try:
            df = modis.ndvi(round(lat, 4), round(lon, 4), y)
            print(p["key"], y, len(df), flush=True)
        except Exception as e:
            print(p["key"], y, "FAILED", e, flush=True)
