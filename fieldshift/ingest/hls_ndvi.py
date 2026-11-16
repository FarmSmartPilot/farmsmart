"""HLS v2.0 (HLSL30 + HLSS30) NDVI inside one field polygon, per scene, at the native 30 m grid.

Route (tested 2026-11-14): CMR-STAC LPCLOUD search (public), then windowed COG reads of red, NIR and Fmask.
Each COG is opened through /vsicurl on the signed S3 redirect from LP DAAC (fieldshift.ingest.earthdata._signed),
so the Earthdata token is sent only to NASA hosts and never to GDAL, a URL or a log.

Fmask v2.0 bits removed: 1 cloud, 2 adjacent to cloud/shadow, 3 cloud shadow, 4 snow/ice, 5 water,
6-7 aerosol level == 11 (high). Fill (255) is also removed. Reflectance: DN * 0.0001, fill -9999.
A scene's field summary is withheld when fewer than 50 % of the field's pixels are usable.
NDVI shows greenness only. It is not yield, residue or soil carbon.
"""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import requests

from ..config import CACHE
from .earthdata import STAC_LP, EarthdataUnavailable, _signed

COLLECTIONS = {"HLSL30_2.0": ("L30", "B04", "B05"), "HLSS30_2.0": ("S30", "B04", "B8A")}
SCALE = 0.0001
REFL_FILL = -9999
FMASK_FILL = 255
FMASK_BAD_BITS = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5)  # cloud, adjacent, shadow, snow/ice, water
AEROSOL_HIGH = 0b11 << 6
MIN_USABLE_PCT = 50.0
MAX_SCENES = 24          # scenes read per season
MAX_SCENE_CLOUD = 80     # % scene-level cloud pre-filter (the field itself is checked pixel by pixel)
MAX_WINDOW = 400         # pixels per side (12 km); larger fields are read around their centre
PRODUCT = "HLS v2.0 (Landsat 8/9 + Sentinel-2)"
URL = "https://lpdaac.usgs.gov/products/hlsl30v002/"
NEVER_CLAIM = "Greenness is not yield, residue or soil carbon."
SCALE_NOTE = "field pixels (30 m)"

FS_CACHE = CACHE / "fieldsat"
FS_CACHE.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------- season

def season_period(lat: float, today: date | None = None, year: int | None = None) -> tuple[date, date, str]:
    """Most recent complete growing season: Apr-Oct (northern hemisphere), Oct-Mar (southern).
    `year` = the calendar year the season starts in."""
    today = today or date.today()
    if lat >= 0:
        y = year if year is not None else (today.year if today >= date(today.year, 11, 1) else today.year - 1)
        return date(y, 4, 1), date(y, 10, 31), "Apr–Oct"
    if year is None:
        y = today.year - 1 if today >= date(today.year, 4, 1) else today.year - 2
    else:
        y = year
    return date(y, 10, 1), date(y + 1, 3, 31), "Oct–Mar"


# --------------------------------------------------------------------------- search and selection

def search(geom: dict, start: date, end: date) -> list[dict]:
    """All HLS L30 + S30 items whose footprint touches the field, start..end. Cached when the period is past."""
    from shapely.geometry import shape
    shp = shape(geom)
    bbox = [round(b, 5) for b in shp.bounds]
    f = FS_CACHE / f"hls_stac_{'_'.join(f'{b:.5f}' for b in bbox)}_{start}_{end}.json"
    if f.exists():
        return json.loads(f.read_text())
    body: dict[str, Any] = {"collections": list(COLLECTIONS), "bbox": bbox, "limit": 250,
                            "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z"}
    items, url, pages = [], f"{STAC_LP}/search", 0
    while url and pages < 20:
        r = None
        for i in range(3):
            try:
                r = requests.post(url, json=body, timeout=90)
                if r.status_code < 500:
                    break
            except requests.RequestException:
                r = None
            time.sleep(2 * (i + 1))
        if r is None:
            raise EarthdataUnavailable("CMR-STAC LPCLOUD search: no response")
        if r.status_code != 200:
            raise EarthdataUnavailable(f"CMR-STAC LPCLOUD search: HTTP {r.status_code}")
        j = r.json()
        pages += 1
        for ft in j.get("features", []):
            coll = ft.get("collection")
            if coll not in COLLECTIONS:
                continue
            sensor, red, nir = COLLECTIONS[coll]
            a = ft.get("assets", {})
            if not all(k in a for k in (red, nir, "Fmask")):
                continue
            try:
                covers = bool(shape(ft["geometry"]).contains(shp))
            except Exception:  # noqa: BLE001
                covers = True
            items.append({"id": ft["id"], "sensor": sensor, "datetime": ft["properties"]["datetime"],
                          "cloud": ft["properties"].get("eo:cloud_cover"), "covers_field": covers,
                          "red": a[red]["href"], "nir": a[nir]["href"], "fmask": a["Fmask"]["href"]})
        nxt = [l for l in j.get("links", []) if l.get("rel") == "next"]
        url, body = (nxt[0]["href"], nxt[0].get("body", body)) if nxt else (None, body)
    if end < date.today() and pages < 20:
        f.write_text(json.dumps(items))
    return items


def select(items: list[dict], start: date, end: date, max_scenes: int = MAX_SCENES,
           max_cloud: float = MAX_SCENE_CLOUD) -> tuple[list[dict], dict]:
    """Scenes to read: footprint covers the field, scene cloud <= max_cloud, one per date (lowest cloud),
    then the clearest scene in each half-month first, then the clearest of the rest, up to max_scenes."""
    cand = [it for it in items if it["covers_field"] and (it["cloud"] is None or it["cloud"] <= max_cloud)]
    by_date: dict[str, dict] = {}
    for it in sorted(cand, key=lambda x: (x["cloud"] if x["cloud"] is not None else 101)):
        by_date.setdefault(it["datetime"][:10], it)
    pool = sorted(by_date.values(), key=lambda x: (x["cloud"] if x["cloud"] is not None else 101))
    bins: dict[tuple[int, int], dict] = {}
    for it in pool:
        d = date.fromisoformat(it["datetime"][:10])
        bins.setdefault((d.year * 12 + d.month, d.day > 15), it)
    chosen = {it["id"]: it for it in sorted(bins.values(), key=lambda x: x["cloud"] or 0)[:max_scenes]}
    for it in pool:
        if len(chosen) >= max_scenes:
            break
        chosen.setdefault(it["id"], it)
    out = sorted(chosen.values(), key=lambda x: x["datetime"])
    info = {"n_found": len(items), "n_partial_footprint": sum(1 for i in items if not i["covers_field"]),
            "n_scene_cloud_over": sum(1 for i in items if i["covers_field"] and i["cloud"] is not None and i["cloud"] > max_cloud),
            "n_candidates": len(pool), "n_selected": len(out),
            "selection": f"footprint covers the field; scene cloud ≤ {max_cloud:g} %; one scene per date; "
                         f"clearest per half-month first, then clearest overall; at most {max_scenes}"}
    return out, info


# --------------------------------------------------------------------------- one scene

def _window(ds, g_native, shp_native):
    from rasterio.windows import Window, from_bounds
    w = from_bounds(*shp_native.bounds, ds.transform)
    c0, r0 = int(np.floor(w.col_off)) - 1, int(np.floor(w.row_off)) - 1
    c1, r1 = int(np.ceil(w.col_off + w.width)) + 1, int(np.ceil(w.row_off + w.height)) + 1
    clipped = False
    if c1 - c0 > MAX_WINDOW or r1 - r0 > MAX_WINDOW:
        cx, cy = shp_native.centroid.x, shp_native.centroid.y
        rr, cc = ds.index(cx, cy)
        r0, c0 = rr - MAX_WINDOW // 2, cc - MAX_WINDOW // 2
        r1, c1 = r0 + MAX_WINDOW, c0 + MAX_WINDOW
        clipped = True
    return Window(c0, r0, c1 - c0, r1 - r0), clipped


def read_scene(item: dict, geom: dict) -> dict:
    """Read red, NIR and Fmask for the window over the field; return per-scene stats and the pixel grid."""
    import rasterio
    from rasterio.features import geometry_mask
    from rasterio.warp import transform_bounds, transform_geom
    from shapely.geometry import shape
    t0 = time.time()
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                      GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="1", GDAL_HTTP_TIMEOUT="30"):
        with rasterio.open("/vsicurl/" + _signed(item["fmask"])) as ds:
            crs = ds.crs
            g = transform_geom("EPSG:4326", crs, geom)
            shp_n = shape(g)
            win, clipped = _window(ds, g, shp_n)
            fm = ds.read(1, window=win, boundless=True, fill_value=FMASK_FILL)
            wt = ds.window_transform(win)
        inside = ~geometry_mask([g], out_shape=fm.shape, transform=wt, all_touched=False)
        if not inside.any():  # field smaller than one pixel centre: count touched pixels
            inside = ~geometry_mask([g], out_shape=fm.shape, transform=wt, all_touched=True)
        bands = {}
        for k in ("red", "nir"):
            with rasterio.open("/vsicurl/" + _signed(item[k])) as ds:
                a = ds.read(1, window=win, boundless=True, fill_value=REFL_FILL).astype("float32")
                bad = (a == REFL_FILL) | (a < 0)
                a = a * SCALE
                a[bad] = np.nan
                bands[k] = a
    fm = fm.astype("uint16")
    clear = (fm != FMASK_FILL) & ((fm & FMASK_BAD_BITS) == 0) & ((fm & AEROSOL_HIGH) != AEROSOL_HIGH)
    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = (bands["nir"] - bands["red"]) / (bands["nir"] + bands["red"])
    ok = clear & np.isfinite(ndvi) & (ndvi >= -1) & (ndvi <= 1)
    n_pix = int(inside.sum())
    v = ndvi[ok & inside]
    usable = round(100.0 * v.size / n_pix, 1) if n_pix else 0.0
    reasons = {"cloud": int((inside & (fm != FMASK_FILL) & ((fm & 0b1110) != 0)).sum()),
               "snow_ice": int((inside & (fm != FMASK_FILL) & ((fm & (1 << 4)) != 0)).sum()),
               "water": int((inside & (fm != FMASK_FILL) & ((fm & (1 << 5)) != 0)).sum()),
               "high_aerosol": int((inside & (fm != FMASK_FILL) & ((fm & AEROSOL_HIGH) == AEROSOL_HIGH)).sum()),
               "fill": int((inside & ((fm == FMASK_FILL) | ~np.isfinite(ndvi))).sum())}
    withheld = usable < MIN_USABLE_PCT
    words = {"cloud": "cloud or cloud shadow", "snow_ice": "snow or ice", "water": "water",
             "high_aerosol": "haze or smoke (high aerosol)", "fill": "no data"}
    causes = ", ".join(words[k] for k, n in sorted(reasons.items(), key=lambda kv: -kv[1]) if n) or "no data"
    sc: dict[str, Any] = {
        "id": item["id"], "date": item["datetime"][:10], "datetime": item["datetime"], "sensor": item["sensor"],
        "cloud_pct_scene": item["cloud"], "n_pixels": n_pix, "n_usable": int(v.size), "usable_pct": usable,
        "ndvi_mean": None, "ndvi_p10": None, "ndvi_p50": None, "ndvi_p90": None,
        "withheld": bool(withheld),
        "withheld_reason": (f"only {usable:g} % of the field's pixels were usable (masked: {causes}); "
                            f"at least {MIN_USABLE_PCT:g} % needed") if withheld else None,
        "masked_pixels": reasons, "window_clipped": clipped, "read_seconds": round(time.time() - t0, 1),
    }
    if not withheld and v.size:
        p10, p50, p90 = np.percentile(v, [10, 50, 90])
        sc.update({"ndvi_mean": round(float(v.mean()), 3), "ndvi_p10": round(float(p10), 3),
                   "ndvi_p50": round(float(p50), 3), "ndvi_p90": round(float(p90), 3)})
    h, w = fm.shape
    west, north = wt.c, wt.f
    east, south = west + wt.a * w, north + wt.e * h
    bb = transform_bounds(crs, "EPSG:4326", west, south, east, north, densify_pts=21)
    vals = np.where(ok, np.round(ndvi.astype("float64"), 3), np.nan)
    grid = {"scene_id": item["id"], "date": sc["date"], "sensor": item["sensor"], "width": int(w), "height": int(h),
            "bbox": [round(float(x), 6) for x in bb],
            "crs": crs.to_string(), "transform": [wt.a, wt.b, wt.c, wt.d, wt.e, wt.f],
            "values": [[None if not np.isfinite(x) else round(float(x), 3) for x in row] for row in vals],
            "inside": inside.tolist(),
            "withheld": sc["withheld"], "usable_pct": usable,
            "note": "native 30 m UTM grid window; bbox is its EPSG:4326 extent (rows north to south); null = masked "
                    "(cloud, adjacent cloud/shadow, shadow, snow/ice, water, high aerosol or fill)"}
    return {"scene": sc, "grid": grid}


# --------------------------------------------------------------------------- field series

def _evidence(start: date, end: date, n_read: int, n_withheld: int) -> dict:
    from ..evidence import SOURCES
    s = SOURCES.get("hls", {})
    return {"source_id": "hls", "product": PRODUCT, "resolution": "30 m", "url": URL,
            "retrieved": date.today().isoformat(), "collections": "HLSL30 v2.0 (Landsat 8/9) + HLSS30 v2.0 (Sentinel-2)",
            "observation_period": [start.isoformat(), end.isoformat()],
            "licence": s.get("licence"), "citation": s.get("citation"), "is_nasa": True,
            "qa": ["Fmask removed: cloud, adjacent cloud/shadow, cloud shadow, snow/ice, water, high aerosol, fill",
                   f"field summary withheld when < {MIN_USABLE_PCT:g} % of field pixels are usable ({n_withheld} of {n_read} scenes)",
                   "NDVI = (NIR − Red) / (NIR + Red); L30 B05/B04, S30 B8A/B04; reflectance = DN × 0.0001",
                   "pixels counted inside the field outline by pixel centre"]}


def pick_grid_scene(scenes: list[dict], start: date, end: date) -> str | None:
    """Clearest non-withheld scene in the middle third of the season (else the clearest of any)."""
    ok = [s for s in scenes if not s["withheld"] and s["n_usable"]]
    if not ok:
        return None
    span = (end - start).days
    m0, m1 = start.toordinal() + span / 3, start.toordinal() + 2 * span / 3
    mid = (m0 + m1) / 2
    inmid = [s for s in ok if m0 <= date.fromisoformat(s["date"]).toordinal() <= m1] or ok
    best = max(inmid, key=lambda s: (round(s["usable_pct"]), -abs(date.fromisoformat(s["date"]).toordinal() - mid)))
    return best["id"]


def field_hls(geom: dict, lat: float, *, key: str, year: int | None = None, budget_s: float = 60,
              max_scenes: int = MAX_SCENES, workers: int = 8) -> tuple[dict, dict[str, dict]]:
    """Season of HLS NDVI scene summaries for one field. Returns (contract response incl. extras, {scene_id: grid}).
    Per-scene reads are cached under data/cache/fieldsat/hls_<key>/ so a budget-limited call can be resumed."""
    t0 = time.time()
    start, end, label = season_period(lat, year=year)
    base = {"field_id": key, "period": {"start": start.isoformat(), "end": end.isoformat(), "label": label},
            "scale_note": SCALE_NOTE, "never_claim": NEVER_CLAIM}
    try:
        items = search(geom, start, end)
    except (EarthdataUnavailable, requests.RequestException) as e:
        return {**base, "available": False, "reason": f"HLS search failed: {e}", "scenes": [], "grid_scene_id": None}, {}
    chosen, info = select(items, start, end, max_scenes=max_scenes)
    if not chosen:
        why = "no HLS scenes over this field in the season" if not items else \
              f"no usable HLS scenes: {info['n_found']} found, none both covering the field and under {MAX_SCENE_CLOUD} % scene cloud"
        return {**base, "available": False, "reason": why, "scenes": [], "grid_scene_id": None, "search": info}, {}
    d = FS_CACHE / f"hls_{key}"
    d.mkdir(exist_ok=True)
    results: dict[str, dict] = {}
    todo = []
    for it in chosen:
        f = d / f"{it['id']}.json"
        if f.exists():
            results[it["id"]] = json.loads(f.read_text())
        else:
            todo.append(it)
    errors: list[str] = []
    timed_out = 0
    if todo:
        ex = ThreadPoolExecutor(workers)
        futs = {ex.submit(read_scene, it, geom): it for it in todo}
        try:
            for fu in as_completed(futs, timeout=max(1.0, budget_s - (time.time() - t0))):
                it = futs[fu]
                try:
                    r = fu.result()
                except EarthdataUnavailable as e:
                    errors.append(f"{it['id']}: {e}")
                    continue
                except Exception as e:  # noqa: BLE001  (one bad COG should not stop the season)
                    errors.append(f"{it['id']}: {type(e).__name__}: {str(e)[:120]}")
                    continue
                results[it["id"]] = r
                (d / f"{it['id']}.json").write_text(json.dumps(r, separators=(",", ":")))
        except TimeoutError:
            timed_out = sum(1 for fu in futs if not fu.done())
        ex.shutdown(wait=False, cancel_futures=True)
    scenes = sorted((r["scene"] for r in results.values()), key=lambda s: s["datetime"])
    grids = {sid: r["grid"] for sid, r in results.items()}
    n_w = sum(1 for s in scenes if s["withheld"])
    info.update({"n_read": len(scenes), "n_withheld": n_w, "n_errors": len(errors), "n_not_read_time_budget": timed_out,
                 "errors": errors[:5], "seconds": round(time.time() - t0, 1)})
    if not scenes:
        reason = ("HLS scenes found but none could be read: " + (errors[0] if errors else
                  f"time budget of {budget_s:g} s reached"))
        return {**base, "available": False, "reason": reason, "scenes": [], "grid_scene_id": None, "search": info}, {}
    out = {"available": True, "reason": None, **base, "scenes": scenes,
           "grid_scene_id": pick_grid_scene(scenes, start, end),
           "evidence": _evidence(start, end, len(scenes), n_w), "search": info,
           "complete": timed_out == 0 and not errors,
           "generated": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if all(s["withheld"] for s in scenes):
        out["note"] = "Every scene read was too cloudy over this field to summarise."
    return out, grids


def read_grid_live(geom: dict, scene_id: str, item: dict | None = None) -> dict:
    """Grid for one scene id (STAC item looked up by id if not given)."""
    if item is None:
        coll = "HLSL30_2.0" if ".L30." in scene_id else "HLSS30_2.0"
        r = requests.get(f"{STAC_LP}/collections/{coll}/items/{scene_id}", timeout=60)
        if r.status_code != 200:
            raise EarthdataUnavailable(f"HLS item {scene_id}: HTTP {r.status_code}")
        ft = r.json()
        sensor, red, nir = COLLECTIONS[coll]
        item = {"id": ft["id"], "sensor": sensor, "datetime": ft["properties"]["datetime"],
                "cloud": ft["properties"].get("eo:cloud_cover"), "red": ft["assets"][red]["href"],
                "nir": ft["assets"][nir]["href"], "fmask": ft["assets"]["Fmask"]["href"]}
    return read_scene(item, geom)["grid"]


def cached_grid(key: str, scene_id: str) -> dict | None:
    f = FS_CACHE / f"hls_{key}" / f"{scene_id}.json"
    return json.loads(f.read_text())["grid"] if f.exists() else None


def cache_path(key: str, start: str) -> Path:
    return FS_CACHE / f"hls_series_{key}_{start}.json"
