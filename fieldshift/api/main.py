"""FarmSmart API (FastAPI). Run: uvicorn fieldshift.api.main:app --port 8000"""
from __future__ import annotations

import json
import threading
import uuid
from typing import Any, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from .. import config
from ..engine import analysis, kb
from ..ingest import fields as fieldsrc, geocode

app = FastAPI(title="FarmSmart API", version="1.6.0",
              description="Decision support for crop rotations from NASA Earth observations. Supports, never replaces, farmer judgment.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=2000)

JOBS: dict[str, dict] = {}


def _public(ctx: dict) -> dict:
    return {k: v for k, v in ctx.items() if not k.startswith("_")}


@app.get("/api/health")
def health():
    return {"ok": True, "keys": config.keys_status()}


@app.get("/api/search")
def search(q: str = Query(..., min_length=2)):
    try:
        return {"results": geocode.search(q)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Geocoder unavailable: {e}") from e


@app.get("/api/fields/at")
def field_at(lat: float, lon: float):
    """The field polygon containing a point: USDA Crop Sequence Boundaries (US), else Fields of The World (global)."""
    csb_err = None
    try:
        f = fieldsrc.at_point(lat, lon)
    except Exception as e:  # noqa: BLE001
        f, csb_err = None, str(e)[:160]
    if f:
        return {"found": True, "feature": f, "meta": fieldsrc.meta_of(f)}
    try:  # fallback: FTW global field boundaries 2025 (model-delineated, CC BY 4.0)
        g = fieldsrc.ftw_at(lat, lon)
    except Exception as e:  # noqa: BLE001
        if csb_err:
            raise HTTPException(502, f"Field boundary services unavailable: CSB {csb_err}; FTW {str(e)[:160]}") from e
        g = None
    if not g:
        return {"found": False, "note": "No mapped field boundary here. Draw your field or upload a boundary."}
    try:
        addr = geocode.reverse(lat, lon)
    except Exception:  # noqa: BLE001
        addr = {}
    return {"found": True, "feature": g, "meta": fieldsrc.ftw_meta(g, addr.get("country_code"), addr.get("state")),
            "attribution": fieldsrc.FTW_ATTRIBUTION,
            "note": "Field boundary from Fields of The World (model-delineated from satellite imagery). Check it and redraw if needed."}


@app.get("/api/fields/bbox")
def fields_bbox(w: float, s: float, e: float, n: float):
    """Field boundaries in view: USDA Crop Sequence Boundaries (US), else Fields of The World (global)."""
    if (e - w) * (n - s) > 0.05:
        return {"type": "FeatureCollection", "features": [], "note": "zoom in to see field boundaries"}
    try:
        feats = fieldsrc.in_bbox(w, s, e, n)
    except Exception:  # noqa: BLE001
        feats = []
    if feats:
        return {"type": "FeatureCollection", "features": feats, "source": "csb",
                "attribution": "Field boundaries: USDA NASS Crop Sequence Boundaries 2024"}
    if (e - w) * (n - s) > 0.004:  # FTW tiles are z14 (~2.4 km): keep the request to a handful of tiles
        return {"type": "FeatureCollection", "features": [], "note": "zoom in further to see field boundaries here"}
    try:
        feats = fieldsrc.ftw_in_bbox(w, s, e, n)
    except Exception as ex:  # noqa: BLE001
        return {"type": "FeatureCollection", "features": [], "note": f"field boundary service unavailable: {str(ex)[:120]}"}
    return {"type": "FeatureCollection", "features": feats, "source": "ftw", "attribution": fieldsrc.FTW_ATTRIBUTION}


class FieldIn(BaseModel):
    geometry: dict
    name: Optional[str] = None
    meta: Optional[dict] = None


def _run_context(job_id: str, body: FieldIn):
    try:
        JOBS[job_id].update(status="running", progress=0.2, step="Fetching NASA weather, soil, terrain and crop maps")
        ctx = analysis.build_context(body.geometry, body.name, body.meta)
    except Exception as e:  # noqa: BLE001
        JOBS[job_id].update(status="failed", failures=[str(e)[:300]])
        return
    # Start the default comparison (the one the page asks for first) right away, so it is ready or
    # under way when the browser asks; /compare waits for it instead of running it twice.
    key = _cmp_key(ctx["id"], CompareIn())
    ev = _inflight.setdefault(key, threading.Event())
    JOBS[job_id].update(status="done", progress=1.0, step="done", field_id=ctx["id"])
    try:
        out = analysis.compare(json.loads(json.dumps(ctx, default=str)))
        _compare_cache[key] = out
    except Exception:  # noqa: BLE001
        pass  # /compare will run it itself and report the error
    finally:
        ev.set()
        _inflight.pop(key, None)


@app.post("/api/fields")
def create_field(body: FieldIn, background: BackgroundTasks):
    fid = analysis.field_id(body.geometry)
    cached = analysis.FIELD_CACHE / f"{fid}.json"
    pre = config.PRECOMP / f"context_{fid}.json"
    if cached.exists() or pre.exists():
        return {"field_id": fid, "status": "done"}
    job = str(uuid.uuid4())[:8]
    JOBS[job] = {"id": job, "field_id": fid, "status": "queued", "progress": 0.05, "step": "queued", "failures": []}
    threading.Thread(target=_run_context, args=(job, body), daemon=True).start()
    return {"field_id": fid, "job_id": job, "status": "queued"}


@app.get("/api/jobs/{job_id}")
def job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "unknown job")
    return JOBS[job_id]


def _ctx(fid: str) -> dict:
    for p in (config.PRECOMP / f"context_{fid}.json", analysis.FIELD_CACHE / f"{fid}.json"):
        if p.exists():
            ctx = analysis.fix_wx_path(json.loads(p.read_text(encoding="utf-8")), fid)
            return analysis.refresh_region(ctx)
    raise HTTPException(404, "field not analysed yet")


@app.get("/api/fields/{fid}/report")
def report(fid: str):
    ctx = _ctx(fid)
    out = _public(ctx)
    out["history"] = analysis.history_list(ctx)
    return out


class CompareIn(BaseModel):
    farm: Optional[dict] = None
    priorities: Optional[list[str]] = None
    baseline: Optional[list[dict]] = None
    scenario: str = "normal"
    budgets: Optional[dict] = None       # {crop_id: {price_usd_bu, cost_usd_ac, yield_bu_ac}}: profit only
    custom: Optional[list[dict]] = None  # up to 4 farmer-built options [{name, sequence}]


_compare_cache: dict[str, Any] = {}
_inflight: dict[str, threading.Event] = {}


def _cmp_key(fid: str, body: "CompareIn") -> str:
    return json.dumps([fid, body.model_dump()], sort_keys=True)


@app.post("/api/fields/{fid}/compare")
def compare(fid: str, body: CompareIn):
    if body.budgets is not None and not body.budgets or body.custom is not None and not body.custom:
        # empty {} / [] mean "none": same result, cache key and precomputed file as a request without them
        body = body.model_copy(update={"budgets": body.budgets or None, "custom": body.custom or None})
    key = _cmp_key(fid, body)
    ev = _inflight.get(key)
    if ev is not None:
        ev.wait(90)
    if key in _compare_cache:
        return _compare_cache[key]
    pre = config.PRECOMP / f"compare_{fid}.json"
    if pre.exists() and body.farm is None and body.priorities is None and body.baseline is None and body.scenario == "normal" \
            and body.budgets is None and body.custom is None:
        out = json.loads(pre.read_text(encoding="utf-8"))
    else:
        ctx = _ctx(fid)
        out = analysis.compare(ctx, body.farm, body.priorities, body.baseline, body.scenario, body.budgets, body.custom)
    if len(_compare_cache) > 200:
        _compare_cache.clear()
    _compare_cache[key] = out
    return out


@app.get("/api/fields/{fid}/replay")
def replay(fid: str, year: int = 2012, alt: Optional[str] = None):
    import pandas as pd
    from ..engine import replay as rp
    pre = config.PRECOMP / f"replay_{fid}_{year}.json"
    if alt is None and pre.exists():
        out = json.loads(pre.read_text(encoding="utf-8"))
        ctx = _ctx(fid)
        lon, lat = ctx["centroid"]
        out["ndvi"] = rp.ndvi_ghost(round(lat, 4), round(lon, 4), year)  # may have been warmed since
        return out
    ctx = _ctx(fid)
    if not ctx["region"].get("region"):
        return {"available": False, "reason": ctx["region"].get("note")}
    cmp = compare(fid, CompareIn())
    if not cmp.get("supported"):
        return {"available": False, "reason": cmp.get("reason")}
    wx = pd.read_parquet(ctx["_wx_path"])
    cards = cmp["all_cards"]
    return analysis._jsonable(rp.replay(ctx, wx, cards, year, alt))


@app.get("/api/fields/{fid}/report.pdf")
def report_pdf(fid: str):
    from fastapi.responses import Response
    from . import pdf
    ctx = _ctx(fid)
    cmp = compare(fid, CompareIn())
    if not cmp.get("supported"):
        raise HTTPException(409, cmp.get("reason") or "no comparison available")
    data = pdf.build(_public(ctx), cmp)
    return Response(data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="farmsmart-{fid}.pdf"'})


class SubIn(BaseModel):
    email: str
    field_id: str
    types: list[str] = ["frost", "heat", "heavy_rain_bare", "wind_low_cover", "dry_down", "weekly_digest"]
    thresholds: Optional[dict] = None
    quiet: Optional[list[int]] = None
    lang: str = "en"
    units: str = "metric"


@app.post("/api/alerts/subscribe")
def alerts_subscribe(body: SubIn, request: "Request"):
    import re as _re
    from ..alerts import core
    if not _re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", body.email):
        raise HTTPException(422, "Please enter a valid email address")
    ctx = _ctx(body.field_id)
    cmp = compare(body.field_id, CompareIn())
    base_card = next((c for c in cmp.get("cards", []) if c.get("is_baseline")), None) if cmp.get("supported") else None
    cover = (base_card or {}).get("timeline", {}).get("weekly_cover", [[]])[0] if base_card else []
    field = {"id": ctx["id"], "name": ctx["name"], "lon": ctx["centroid"][0], "lat": ctx["centroid"][1]}
    base_url = str(request.base_url).rstrip("/")
    return core.subscribe(body.email, field, body.types, body.thresholds, tuple(body.quiet) if body.quiet else None,
                          body.lang, body.units, base_url, cover)


@app.get("/api/alerts/confirm")
def alerts_confirm(token: str):
    from fastapi.responses import HTMLResponse
    from ..alerts import core
    ok = core.confirm(token)
    return HTMLResponse(f"<p style='font-family:sans-serif'>{'Alerts confirmed. You can close this page.' if ok else 'Link not valid.'}</p>")


@app.get("/api/alerts/unsubscribe")
def alerts_unsubscribe(token: str):
    from fastapi.responses import HTMLResponse
    from ..alerts import core
    ok = core.unsubscribe(token)
    return HTMLResponse(f"<p style='font-family:sans-serif'>{'You are unsubscribed.' if ok else 'Link not valid.'}</p>")


@app.post("/api/alerts/run")
def alerts_run():
    from ..alerts import core
    return core.run_once()


@app.get("/api/alerts/history")
def alerts_history(field_id: Optional[str] = None):
    from ..alerts import core
    return {"items": core.history(field_id)}


@app.get("/api/fields/{fid}/forecast-alerts")
def forecast_alerts(fid: str):
    """Preview what alerts the current 7-day forecast would trigger for this field (no email)."""
    from ..alerts import core
    ctx = _ctx(fid)
    cmp = compare(fid, CompareIn())
    base_card = next((c for c in cmp.get("cards", []) if c.get("is_baseline")), None) if cmp.get("supported") else None
    cover = (base_card or {}).get("timeline", {}).get("weekly_cover", [[]])[0] if base_card else []
    fc = core.forecast(ctx["centroid"][1], ctx["centroid"][0])
    row = {"thresholds": json.dumps(core.DEFAULTS), "types": json.dumps(core.ALERT_TYPES), "cover_weeks": json.dumps(cover),
           "field_id": fid, "lang": "en"}
    warn = core.nws_warnings(ctx["centroid"][1], ctx["centroid"][0], (ctx.get("place") or {}).get("country_code"))
    return {"forecast": fc["daily"], "retrieved": fc["_retrieved"], "alerts": core.evaluate(row, fc),
            "source": "Open-Meteo forecast API (NOAA GFS/HRRR, ECMWF and other models)",
            "warnings": warn["warnings"], "warnings_note": warn["note"], "warnings_source": warn.get("source"),
            "warnings_retrieved": warn.get("retrieved")}


@app.on_event("startup")
def _warm_kb():
    # Parse the agronomy YAML once at start-up, not inside the first farmer's request.
    def warm():
        try:
            for fn in ("crops", "calendars", "rules", "families", "sources", "glossary"):
                if hasattr(kb, fn):
                    getattr(kb, fn)()
        except Exception:  # noqa: BLE001
            pass
    threading.Thread(target=warm, daemon=True).start()


@app.on_event("startup")
def _scheduler():
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from ..alerts import core
        s = BackgroundScheduler(daemon=True)
        s.add_job(core.run_once, "interval", hours=3, id="alerts", max_instances=1, coalesce=True)
        s.start()
    except Exception:  # noqa: BLE001
        pass


_twins: dict[str, Any] = {}
TWIN_PILOTS = {"twins_story_ia.json": (42.11, -93.47), "twins_garden_city_ks.json": (37.93, -100.69),
               "twins_regina_sk.json": (50.42, -104.95), "twins_ludhiana_pb.json": (30.79, 75.70),
               "twins_sorriso_mt.json": (-12.50, -55.96)}


@app.get("/api/fields/{fid}/twins")
def twins(fid: str):
    """Climate Twins (M7). Pilot fields are precomputed (full mode); new fields run in 'fast' mode in the background."""
    import math
    ctx = _ctx(fid)
    lon, lat = ctx["centroid"]
    for fn, (plat, plon) in TWIN_PILOTS.items():
        if math.hypot(lat - plat, (lon - plon) * math.cos(math.radians(lat))) < 0.5:
            p = config.PRECOMP / fn
            if p.exists():
                return {"status": "ready", **json.loads(p.read_text(encoding="utf-8"))}
    st = _twins.get(fid)
    if st is None:
        _twins[fid] = {"status": "loading"}

        def run():
            try:
                from ..engine import twins as tw
                _twins[fid] = {"status": "ready", **analysis._jsonable(tw.climate_twins(lat, lon, mode="fast"))}
            except Exception as e:  # noqa: BLE001
                _twins[fid] = {"status": "failed", "reason": str(e)[:300]}
        threading.Thread(target=run, daemon=True).start()
        return {"status": "loading", "note": "Fetching 6 CMIP6 climate models (NEX-GDDP-CMIP6). About 1 minute."}
    return st


@app.get("/api/fields/{fid}/nextmove")
def nextmove(fid: str):
    """M3 'usual next' (Markov on nearby real field sequences) next to the optimizer's 'smart next' (top card)."""
    from ..ingest.cdl import CDL_TO_CROP
    from ..models import m03_sequence
    ctx = _ctx(fid)
    cache = analysis.FIELD_CACHE / f"m3_{fid}.json"
    if (config.PRECOMP / f"m3_{fid}.json").exists():
        cache = config.PRECOMP / f"m3_{fid}.json"
    if cache.exists():
        m3 = json.loads(cache.read_text(encoding="utf-8"))
    else:
        codes = [h["dominant"]["code"] for h in ((ctx.get("crop_history") or {}).get("years") or []) if h.get("available")]
        lon, lat = ctx["centroid"]
        m3 = m03_sequence.run(lat, lon, codes[-8:]) if (ctx["place"].get("country_code") or "").lower() == "us" else \
            {"available": False, "reason": "Crop-sequence maps (USDA CSB) exist for the US only"}
        cache.write_text(json.dumps(m3), encoding="utf-8")
    cmp = compare(fid, CompareIn())
    smart = next((c for c in cmp.get("cards", []) if c.get("best_for_you")), None) if cmp.get("supported") else None
    return {"usual_next": m3, "smart_next": {"card_id": smart["id"], "name": smart["name"], "sequence": smart["sequence"],
                                             "confidence": smart["confidence"]} if smart else None,
            "history": analysis.history_list(ctx)}


@app.get("/api/tiles/naip")
def naip_tile(bbox: str, size: int = 512):
    """Caching proxy for USDA NAIP (USGS The National Map exportImage): avoids CORS failures and slow repeats."""
    import hashlib
    import requests
    from fastapi.responses import Response
    size = max(128, min(size, 1024))
    parts = [round(float(x), 1) for x in bbox.split(",")]
    if len(parts) != 4:
        raise HTTPException(422, "bbox must be 4 numbers (EPSG:3857)")
    key = hashlib.sha1(f"{parts}{size}".encode()).hexdigest()
    p = config.CACHE / "naip" / f"{key}.img"
    p.parent.mkdir(exist_ok=True)
    if p.exists():
        data = p.read_bytes()
    else:
        r = requests.get("https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage",
                         params={"bbox": ",".join(map(str, parts)), "bboxSR": 3857, "imageSR": 3857, "size": f"{size},{size}",
                                 "format": "jpgpng", "f": "image"}, timeout=60,
                         headers={"User-Agent": config.USER_AGENT})
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image"):
            raise HTTPException(502, "NAIP service unavailable")
        data = r.content
        p.write_bytes(data)
    ct = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg"
    return Response(data, media_type=ct, headers={"Cache-Control": "public, max-age=604800",
                                                  "Access-Control-Allow-Origin": "*"})


@app.get("/api/fields/{fid}/nasa")
def nasa_layers(fid: str):
    """NASA Earthdata subsets for the field: SMAP L4 root-zone soil moisture, GRACE-FO water storage trend,
    HLS 30 m greenness status, IMERG (when available). Precomputed for pilots."""
    p = config.PRECOMP / f"nasa_{fid}.json"
    if p.exists():
        return analysis._jsonable({"available": True, **json.loads(p.read_text(encoding="utf-8"))})  # NaN -> null
    return {"available": False, "reason": "NASA Earthdata subsets are precomputed for pilot fields; on-demand fetching for new fields is not enabled in this demo."}


@app.get("/api/validation/nasa")
def validation_nasa():
    p = config.ROOT / "qc" / "reports" / "nasa_validation.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


@app.get("/api/validation/weather")
def validation_weather():
    p = config.ROOT / "qc" / "reports" / "weather_agreement.json"
    return {"sites": json.loads(p.read_text(encoding="utf-8"))} if p.exists() else {"sites": []}


@app.get("/api/fields/{fid}/wind")
def wind_rose(fid: str, months: str = "3,4,5,10,11"):
    """Wind rose from NASA POWER hourly 10 m wind (last 5 full years), for the chosen months."""
    import numpy as np
    from ..ingest import power
    ctx = _ctx(fid)
    lon, lat = ctx["centroid"]
    from datetime import date
    y1 = date.today().year - 1
    df = power.hourly_wind(lat, lon, list(range(y1 - 4, y1 + 1)))
    ms = [int(m) for m in months.split(",") if m]
    d = df[df.index.month.isin(ms)].dropna()
    sectors = 16
    sec = ((d["WD10M"] + 360 / sectors / 2) % 360 // (360 / sectors)).astype(int)
    bins = [0, 4, 6, 8, 10, 99]
    spd = np.digitize(d["WS10M"], bins) - 1
    counts = np.zeros((sectors, len(bins) - 1))
    for s, b in zip(sec.values, spd):
        counts[s, min(b, len(bins) - 2)] += 1
    tot = counts.sum() or 1
    return {"sectors": sectors, "speed_bins_ms": bins, "freq": (counts / tot).round(5).tolist(),
            "hours": int(tot), "share_above_8ms": float((d["WS10M"] >= 8).mean()), "months": ms,
            "years": [y1 - 4, y1], "evidence": {"source": "NASA POWER", "product": "Hourly WS10M, WD10M (MERRA-2 based)",
                                                "native_res": "≈50 km", "is_nasa": True,
                                                "citation": "NASA Langley Research Center POWER Project"}}


@app.get("/api/kb/crops")
def crops():
    return {cid: {k: c.get(k) for k in ("id", "name", "name_es", "family", "roles", "season", "equipment", "references",
                                        "blurb_en", "blurb_es", "check_first_en", "check_first_es")}
            for cid, c in kb.crops().items()}


@app.get("/api/kb/glossary")
def glossary():
    return kb.glossary()


@app.get("/api/kb/sources")
def sources():
    return kb.sources()


@app.get("/api/pilots")
def pilots():
    p = config.PRECOMP / "pilots.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"pilots": []}


# Feature routers, each in its own file so several owners can work in parallel. A missing file is skipped,
# a broken one is not (it raises at start-up so it is noticed).
for _mod in ("routes_fieldsat", "routes_extras", "routes_money", "routes_markets", "routes_outlook",
             "routes_disease", "routes_peers"):
    try:
        app.include_router(__import__(f"fieldshift.api.{_mod}", fromlist=["router"]).router)
    except ModuleNotFoundError as _e:
        if _e.name != f"fieldshift.api.{_mod}":
            raise
