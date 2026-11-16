"""ECOSTRESS L3T JET v003 (tiled 70 m COGs, LP DAAC): daytime daily ET at the field-centre pixel.

Route (tested 2026-11-14): CMR granule search (public) for ECO_L3T_JET v003 (C4057232489-LPCLOUD) at the point,
then one-pixel reads of the granule's own `cloud` and `water` layers and, where clear, `ETdaily` and
`ETuncertainty` (mm/day). The v003 JET granules carry the cloud and water masks from the L2 cloud and land-surface
products, so no separate L2T download is needed. COGs are opened through /vsicurl on the signed S3 redirect
(fieldshift.ingest.earthdata._signed), so the Earthdata token never reaches GDAL, a URL or a log.

Our own filter (not the product's): only overpasses between 09:00 and 16:00 local solar time are used, because
JET's daily value is scaled from one instantaneous overpass and early-morning and evening passes give unreliable
daily totals (for example 0.0 mm/day over July corn at 18:35 solar time in Story County, Iowa). ETdaily exactly 0
with ETuncertainty exactly 0 is also treated as no value (seen at 15.5-15.9 h over Mato Grosso soybean in Dec-Jan).
ECOSTRESS rides on the ISS, so it only covers about 52° N to 52° S, at irregular times of day.
"""
from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any

import numpy as np
import requests

from ..config import CACHE
from .earthdata import CMR, EarthdataUnavailable, _signed

JET_CID = "C4057232489-LPCLOUD"  # ECO_L3T_JET v003
PRODUCT = "ECOSTRESS L3T JET v003"
URL = "https://doi.org/10.5067/ECOSTRESS/ECO_L3T_JET.003"
SCALE_NOTE = "one 70 m pixel at the field centre; a daytime model estimate, not a measured field total"
LAT_LIMIT = 52.0
SOLAR_HOURS = (9.0, 16.0)
MAX_READS = 45
MAX_OBS = 30
LAYERS = ("cloud", "water", "ETdaily", "ETuncertainty")

FS_CACHE = CACHE / "fieldsat"
FS_CACHE.mkdir(parents=True, exist_ok=True)
_UR = re.compile(r"ECOv003_L3T_JET_(\d+)_(\d+)_(\w+?)_(\d{8}T\d{6})_(\d+)$")


def _granules(lon: float, lat: float, start: date, end: date) -> list[dict]:
    key = f"{lon:.5f}_{lat:.5f}_{start}_{end}"
    f = FS_CACHE / f"eco_cmr_{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    out, after = [], None
    for _ in range(10):
        params = {"collection_concept_id": JET_CID, "point": f"{lon},{lat}", "page_size": 500, "sort_key": "start_date",
                  "temporal": f"{start}T00:00:00Z,{end}T23:59:59Z"}
        hdr = {"CMR-Search-After": after} if after else {}
        r = requests.get(f"{CMR}/granules.umm_json", params=params, headers=hdr, timeout=90)
        if r.status_code != 200:
            raise EarthdataUnavailable(f"CMR granule search for ECOSTRESS: HTTP {r.status_code}")
        items = r.json().get("items", [])
        for it in items:
            u = it["umm"]
            urls = {x["URL"].rsplit("_", 1)[-1][:-4]: x["URL"] for x in u.get("RelatedUrls", [])
                    if x.get("Type") == "GET DATA" and x["URL"].startswith("https") and x["URL"].endswith(".tif")}
            out.append({"ur": u["GranuleUR"], "start": u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"],
                        "daynight": (u.get("DataGranule") or {}).get("DayNightFlag"),
                        "urls": {k: urls[k] for k in LAYERS if k in urls}})
        after = r.headers.get("CMR-Search-After")
        if not after or not items:
            break
    if end < date.today() - timedelta(days=30):
        f.write_text(json.dumps(out))
    return out


def _solar_hour(iso: str, lon: float) -> float:
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return (t.hour + t.minute / 60 + t.second / 3600 + lon / 15.0) % 24


def _select(grans: list[dict], lon: float) -> tuple[list[dict], dict]:
    n_all = len(grans)
    day = [g for g in grans if (g["daynight"] or "Day") == "Day" and all(k in g["urls"] for k in LAYERS)]
    # one granule per overpass: highest build number, then first tile
    best: dict[tuple, dict] = {}
    for g in day:
        m = _UR.match(g["ur"])
        k = (m.group(1), m.group(2)) if m else (g["start"],)
        b = int(m.group(5)) if m else 0
        if k not in best or b > best[k]["_build"]:
            best[k] = {**g, "_build": b}
    uniq = sorted(best.values(), key=lambda g: g["start"])
    timed = [g for g in uniq if SOLAR_HOURS[0] <= _solar_hour(g["start"], lon) <= SOLAR_HOURS[1]]
    sel = timed
    if len(sel) > MAX_READS:  # evenly through the season
        idx = np.unique(np.round(np.linspace(0, len(sel) - 1, MAX_READS)).astype(int))
        sel = [sel[i] for i in idx]
    info = {"n_granules": n_all, "n_overpasses": len(uniq), "n_outside_solar_hours": len(uniq) - len(timed),
            "solar_hours": list(SOLAR_HOURS), "n_read_planned": len(sel)}
    return sel, info


def _read_pixel(g: dict, lon: float, lat: float) -> dict:
    import rasterio
    from rasterio.warp import transform
    from rasterio.windows import Window
    out: dict[str, Any] = {"scene_id": g["ur"], "datetime": g["start"][:19] + "Z"}
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                      GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="1", GDAL_HTTP_TIMEOUT="30"):
        rc = None
        for layer in LAYERS:
            if layer in ("ETdaily", "ETuncertainty") and (out.get("cloud") or out.get("fill")):
                break
            with rasterio.open("/vsicurl/" + _signed(g["urls"][layer])) as ds:
                if rc is None:
                    xs, ys = transform("EPSG:4326", ds.crs, [lon], [lat])
                    r, c = ds.index(xs[0], ys[0])
                    if not (0 <= r < ds.height and 0 <= c < ds.width):
                        out["fill"] = True
                        out["note"] = "field centre outside this tile"
                        return out
                    rc = (r, c)
                    cx, cy = ds.xy(r, c)
                    plon, plat = transform(ds.crs, "EPSG:4326", [cx], [cy])
                    out["pixel_center"] = [round(plon[0], 5), round(plat[0], 5)]
                    out["tile_crs"] = ds.crs.to_string()
                v = ds.read(1, window=Window(rc[1], rc[0], 1, 1))[0, 0]
            if layer in ("cloud", "water"):
                if int(v) == 255:
                    out["fill"] = True
                    out[layer] = None
                else:
                    out[layer] = bool(int(v) == 1)
            else:
                key = "et_mm_day" if layer == "ETdaily" else "et_sd_mm_day"
                out[key] = round(float(v), 2) if np.isfinite(v) else None
    return out


def _degenerate(r: dict) -> bool:
    """ETdaily exactly 0 with ETuncertainty exactly 0: all ensemble members at zero, seen on late-afternoon
    passes over growing crops (e.g. Mato Grosso soybean, Dec-Jan). Treated as no value, and counted."""
    return r.get("et_mm_day") == 0 and r.get("et_sd_mm_day") in (0, None)


def _evidence(start: date, end: date) -> dict:
    from ..evidence import SOURCES
    s = SOURCES.get("ecostress", {})
    return {"source_id": "ecostress", "product": PRODUCT, "resolution": "70 m", "url": URL,
            "retrieved": date.today().isoformat(), "observation_period": [start.isoformat(), end.isoformat()],
            "licence": s.get("licence"), "citation": s.get("citation"), "is_nasa": True,
            "qa": ["cloud and water flags from the granule's own cloud and water layers (from the L2 cloud and land-surface products)",
                   "cloudy overpasses are not used",
                   "ETdaily exactly 0 with ETuncertainty exactly 0 is treated as no value (FarmSmart filter)",
                   f"only overpasses between {SOLAR_HOURS[0]:02.0f}:00 and {SOLAR_HOURS[1]:02.0f}:00 local solar time (FarmSmart filter)",
                   "et_sd_mm_day is the product's ETuncertainty layer (mm/day)",
                   "ISS orbit: irregular overpass times, coverage about 52° N to 52° S"]}


def field_ecostress(lon: float, lat: float, start: date, end: date, *, key: str, budget_s: float = 60,
                    workers: int = 16) -> dict:
    """Daytime ETdaily at the 70 m pixel containing (lon, lat), start..end. Per-overpass reads are cached
    under data/cache/fieldsat/eco_<key>.json so a budget-limited call can be resumed."""
    t0 = time.time()
    base = {"field_id": key, "period": {"start": start.isoformat(), "end": end.isoformat()}, "scale_note": SCALE_NOTE,
            "observations": []}
    if abs(lat) > LAT_LIMIT:
        return {**base, "available": False,
                "reason": f"Outside ECOSTRESS coverage: the ISS orbit covers about {LAT_LIMIT:g}° N to {LAT_LIMIT:g}° S."}
    try:
        grans = _granules(lon, lat, start, end)
    except (EarthdataUnavailable, requests.RequestException) as e:
        return {**base, "available": False, "reason": f"ECOSTRESS search failed: {e}"}
    if not grans:
        return {**base, "available": False, "reason": "No ECOSTRESS JET overpasses over this field in the season."}
    sel, info = _select(grans, lon)
    if not sel:
        return {**base, "available": False, "search": info,
                "reason": f"{info['n_overpasses']} ECOSTRESS overpasses, none between "
                          f"{SOLAR_HOURS[0]:02.0f}:00 and {SOLAR_HOURS[1]:02.0f}:00 local solar time."}
    cf = FS_CACHE / f"eco_{key}.json"
    done: dict[str, dict] = json.loads(cf.read_text()) if cf.exists() else {}
    todo = [g for g in sel if g["ur"] not in done]
    errors: list[str] = []
    timed_out = 0
    if todo:
        ex = ThreadPoolExecutor(workers)
        futs = {ex.submit(_read_pixel, g, lon, lat): g for g in todo}
        try:
            for fu in as_completed(futs, timeout=max(1.0, budget_s - (time.time() - t0))):
                g = futs[fu]
                try:
                    done[g["ur"]] = fu.result()
                except EarthdataUnavailable as e:
                    errors.append(f"{g['ur']}: {e}")
                except Exception as e:  # noqa: BLE001
                    errors.append(f"{g['ur']}: {type(e).__name__}: {str(e)[:120]}")
        except TimeoutError:
            timed_out = sum(1 for fu in futs if not fu.done())
        ex.shutdown(wait=False, cancel_futures=True)
        cf.write_text(json.dumps(done, separators=(",", ":")))
    reads = [done[g["ur"]] for g in sel if g["ur"] in done]
    valued = [r for r in reads if not r.get("cloud") and not r.get("fill") and r.get("et_mm_day") is not None]
    clear = [r for r in valued if not _degenerate(r)]
    if len(clear) > MAX_OBS:
        idx = np.unique(np.round(np.linspace(0, len(clear) - 1, MAX_OBS)).astype(int))
        clear = [clear[i] for i in idx]
    obs = [{"datetime": r["datetime"], "et_mm_day": r["et_mm_day"], "et_sd_mm_day": r.get("et_sd_mm_day"),
            "cloud": bool(r.get("cloud")), "water": bool(r.get("water")), "pixel_center": r.get("pixel_center"),
            "scene_id": r["scene_id"], "solar_hour": round(_solar_hour(r["datetime"], lon), 1)} for r in clear]
    info.update({"n_read": len(reads), "n_cloudy": sum(1 for r in reads if r.get("cloud")),
                 "n_no_value": sum(1 for r in reads if not r.get("cloud") and (r.get("fill") or r.get("et_mm_day") is None)),
                 "n_zero_with_zero_uncertainty": len(valued) - len(clear),
                 "n_errors": len(errors), "errors": errors[:5], "n_not_read_time_budget": timed_out,
                 "n_returned": len(obs), "seconds": round(time.time() - t0, 1)})
    if not obs:
        why = (f"{info['n_read']} ECOSTRESS overpasses read, none clear with a value at the field centre"
               if reads else ("ECOSTRESS reads failed: " + (errors[0] if errors else f"time budget of {budget_s:g} s reached")))
        return {**base, "available": False, "reason": why, "search": info}
    return {"available": True, "reason": None, **base, "observations": obs, "evidence": _evidence(start, end),
            "search": info, "complete": timed_out == 0 and not errors,
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds")}
