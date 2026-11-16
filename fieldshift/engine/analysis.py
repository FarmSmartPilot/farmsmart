"""Field analysis orchestrator: context -> Area Report -> What Fits -> candidates -> simulation -> ranking -> cards.

Every number returned is computed from real data or a model run; each block carries evidence ids."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any

import numpy as np
import pandas as pd
from shapely.geometry import mapping, shape

from .. import evidence as ev
from ..config import CACHE, PRECOMP
from ..ingest import aafc, cdl, fields as fieldsrc, geocode, power, soilgrids, ssurgo, terrain
from . import climate, kb, rank as ranking, rules_engine, strategies, uncertainty
from .sim import DAYS, KY, SiteInputs, simulate, weather_stack

FIELD_CACHE = CACHE / "fields"
FIELD_CACHE.mkdir(exist_ok=True)
DRAINAGE_MAP = {"Excessively drained": "excessive", "Somewhat excessively drained": "somewhat_excessive",
                "Well drained": "well", "Moderately well drained": "moderately_well",
                "Somewhat poorly drained": "somewhat_poorly", "Poorly drained": "poorly",
                "Very poorly drained": "very_poorly"}
REGIONAL_MODE_KM2 = 50.0


def field_id(geom: dict) -> str:
    g = shape(geom).simplify(1e-5)
    return hashlib.sha1(g.wkt.encode()).hexdigest()[:12]


def _jsonable(o):
    if isinstance(o, dict):
        return {str(k): _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.ndarray):
        return _jsonable(o.tolist())
    if isinstance(o, float) and (np.isnan(o) or np.isinf(o)):
        return None
    if isinstance(o, (pd.Timestamp, date)):
        return str(o)
    return o


# --------------------------------------------------------------------------- context
def refresh_region(ctx: dict) -> dict:
    """Recompute region support on a cached context (cheap; changes as calendars are added).
    Keeps the cached region if the new lookup finds none (e.g. a context built from caller-supplied metadata)."""
    pl = ctx.get("place") or {}
    lon0, lat0 = (ctx.get("centroid") or [0.0, 0.0])[:2]
    reg = kb.region_for(pl.get("country_code"), ctx.get("statefips"), pl.get("state"), lat0, lon0)
    if reg.get("region") or not (ctx.get("region") or {}).get("region"):
        ctx["region"] = reg
    return ctx


def fix_wx_path(ctx: dict, fid: str) -> dict:
    """A cached context whose weather file path does not exist here (made on another machine, or a relative
    path from another working folder) points to the field's precomputed weather file when there is one."""
    p = ctx.get("_wx_path")
    if p and not Path(p).exists():
        alt = PRECOMP / f"wx_{fid}.parquet"
        if alt.exists():
            ctx["_wx_path"] = str(alt)
    return ctx


def build_context(geom: dict, name: str | None = None, meta: dict | None = None) -> dict:
    """Fetch all data for a field (parallel), compute area facts. Cached on disk by field id."""
    fid = field_id(geom)
    for p in (PRECOMP / f"context_{fid}.json", FIELD_CACHE / f"{fid}.json"):
        if p.exists():
            return refresh_region(fix_wx_path(json.loads(p.read_text(encoding="utf-8")), fid))
    t0 = time.time()
    g = shape(geom)
    c = g.centroid
    lat, lon = c.y, c.x
    area_ha = _area_ha(g)
    bag = ev.EvidenceBag()
    meta = meta or {}
    errors: dict[str, str] = {}

    def job(fn, *a):
        try:
            return fn(*a)
        except Exception as e:  # noqa: BLE001 - every failure is reported in coverage, never filled in
            return e

    with ThreadPoolExecutor(6) as ex:
        f_power = ex.submit(job, power.daily, lat, lon)
        f_soil = ex.submit(job, ssurgo.query, geom)
        f_cdl = ex.submit(job, cdl.history, geom, range(2008, 2026))
        f_terr = ex.submit(job, terrain.analyse, geom)
        f_rev = ex.submit(job, geocode.reverse, lat, lon)
    wx, soil, hist, terr, addr = f_power.result(), f_soil.result(), f_cdl.result(), f_terr.result(), f_rev.result()
    for k, v in (("weather", wx), ("soil", soil), ("crop_history", hist), ("terrain", terr), ("place", addr)):
        if isinstance(v, Exception):
            errors[k] = f"{type(v).__name__}: {str(v)[:160]}"
    addr = addr if isinstance(addr, dict) else {}
    cc = (addr.get("country_code") or meta.get("country_code") or "").lower()
    statefips = meta.get("statefips")
    if cc == "us" and not statefips:
        statefips = _state_fips(addr.get("state"))
    county_fips = meta.get("county_fips")
    reg = kb.region_for(cc, statefips, addr.get("state"), lat, lon)

    ctx: dict[str, Any] = {
        "id": fid, "name": name or meta.get("name") or _place_name(addr, lat, lon), "geometry": mapping(g),
        "centroid": [lon, lat], "area_ha": area_ha, "mode": "regional" if area_ha / 100 > REGIONAL_MODE_KM2 else "field",
        "place": {k: addr.get(k) for k in ("county", "state", "country", "country_code", "city", "town", "village")},
        "statefips": statefips, "county_fips": county_fips, "region": reg, "errors": errors, "evidence": {},
    }

    # --- weather & climate
    if not isinstance(wx, Exception):
        wid = bag.add(ev.make("power", power.footprint(lat, lon), obs=(wx.index.min().date(), wx.index.max().date()),
                              effective_res="regional value (≈50 km)", units="see variable",
                              qa=["fill value -999 removed"], transformation="daily point series; FAO-56 ET0; climatology"))
        clim_sum = climate.summarize(wx, lat)
        season = climate.this_season(wx, lat)
        hz = climate.weekly_hazards(wx, lat)
        r_ann = climate.r_factor(clim_sum["normals"].get("precip", np.nan)) if clim_sum["normals"] else None
        ctx["climate"] = {**clim_sum, "evidence_id": wid}
        ctx["season"] = {**season, "evidence_id": wid}
        ctx["hazards_weekly"] = {"weeks": hz.round(4).reset_index().to_dict("records"),
                                 "heavy_rain_threshold_mm": hz.attrs.get("heavy_rain_threshold_mm"),
                                 "wind_threshold_10m": climate.WIND_THRESHOLD_10M, "heat_c": climate.HEAT_C,
                                 "evidence_id": wid}
        ctx["r_factor"] = r_ann
        wx_path = CACHE / f"wx_{fid}.parquet"
        wx.to_parquet(wx_path)
        ctx["_wx_path"] = str(wx_path)
    # --- soil
    if not isinstance(soil, Exception) and soil.get("available"):
        sid = bag.add(ev.make("ssurgo", f"{len(soil['units'])} map units intersecting field", units="various",
                              transformation="area- and component-weighted surface horizon; AWS 0-100 cm"))
        p = soil["properties"]
        ctx["soil"] = {**soil, "source": "ssurgo", "evidence_id": sid,
                       "drainage_class": DRAINAGE_MAP.get(p.get("drainagecl") or "", None)}
    else:
        ssurgo_reason = errors.get("soil") or "no SSURGO coverage (outside the US?)"
        try:  # outside SSURGO: modelled global soil map at the field centroid
            sg = soilgrids.query(lat, lon)
        except Exception as e:  # noqa: BLE001
            sg = {"available": False, "reason": f"SoilGrids failed: {str(e)[:120]}"}
        if sg.get("available"):
            sid = bag.add(ev.make("soilgrids", f"point {lat:.5f}, {lon:.5f} (field centroid)", units="various",
                                  effective_res="250 m modelled grid cell", qa=[soilgrids.LABEL],
                                  transformation="0-30 cm thickness-weighted; OM = SOC x 1.724; AWC Saxton & Rawls 2006; "
                                                 "K Williams 1995 EPIC; AWS 0-100 cm summed over 5 layers"))
            ctx["soil"] = {**sg, "evidence_id": sid, "drainage_class": None, "ssurgo_reason": ssurgo_reason}
            errors.pop("soil", None)
        else:
            ctx["soil"] = {"available": False, "reason": f"{ssurgo_reason}; {sg.get('reason')}"}
    # --- terrain
    if not isinstance(terr, Exception):
        tid = bag.add(ev.make("terrain", f"{terr['n_pixels']} DEM pixels in field", effective_res=f"≈{terr['pixel_m']:.0f} m",
                              units="m, %", transformation="slope by finite differences; RUSLE LS (McCool) with 50 m slope length"))
        ctx["terrain"] = {**terr, "evidence_id": tid}
    # --- crop history
    if not isinstance(hist, Exception):
        avail = [h for h in hist if h.get("available")]
        if avail:
            hid = bag.add(ev.make("cdl", "field polygon pixel histogram", obs=(date(avail[0]["year"], 1, 1), date(avail[-1]["year"], 12, 31)),
                                  effective_res="30 m (10 m from 2024)", transformation="dominant class share per year"))
            ctx["crop_history"] = {"years": hist, "evidence_id": hid, "source": "cdl"}
    if "crop_history" not in ctx and cc == "ca":
        try:
            ah = aafc.history(geom)
            avail = [h for h in ah if h.get("available")]
            if avail:
                hid = bag.add(ev.make("aafc", "field polygon pixel histogram", obs=(date(avail[0]["year"], 1, 1), date(avail[-1]["year"], 12, 31)),
                                      effective_res="30 m (56 m in 2009-2010)", transformation="dominant class share per year"))
                ctx["crop_history"] = {"years": ah, "evidence_id": hid, "source": "aafc"}
                errors.pop("crop_history", None)
            yr = avail[-1]["year"] if avail else 2024
            rows = aafc.regional_crops(lat, lon, yr)
            rid = bag.add(ev.make("aafc", f"{aafc.REGION_KM:.0f} km box around the field", obs=(date(yr, 1, 1), date(yr, 12, 31)),
                                  effective_res=f"regional total ({aafc.REGION_KM:.0f} km box)", transformation="area by class"))
            ctx["county_crops"] = {"rows": rows[:12], "year": yr, "evidence_id": rid, "source": "aafc",
                                   "scale": f"regional ({aafc.REGION_KM:.0f} km box around the field), not a county"}
        except Exception as e:  # noqa: BLE001
            errors["crop_history"] = f"AAFC: {str(e)[:160]}"
    elif "crop_history" not in ctx and cc and cc != "us":
        errors.pop("crop_history", None)  # CDL is US-only: not an error, just no service here
    if cc == "us" and county_fips:
        try:
            cs = cdl.county_stats(county_fips, 2024)
            cid_ = bag.add(ev.make("cdl", f"county FIPS {county_fips}", obs=(date(2024, 1, 1), date(2024, 12, 31)),
                                   effective_res="county total", transformation="acreage by class"))
            ctx["county_crops"] = {"rows": cs[:12], "year": 2024, "evidence_id": cid_, "source": "cdl"}
        except Exception as e:  # noqa: BLE001
            errors["county_crops"] = str(e)[:160]
    ctx["evidence"] = bag.dump()
    ctx["coverage"] = coverage(ctx)
    ctx["elapsed_s"] = round(time.time() - t0, 1)
    out = _jsonable(ctx)
    # A failed place lookup (network) would leave the field without a country for good (no US data, no prices):
    # keep that context in memory only, so the next request tries the lookup again.
    if not ("place" in errors and not (ctx["place"].get("country_code") or meta.get("country_code"))):
        (FIELD_CACHE / f"{fid}.json").write_text(json.dumps(out), encoding="utf-8")
    return out


def _area_ha(g) -> float:
    from pyproj import Geod
    a, _ = Geod(ellps="WGS84").geometry_area_perimeter(g)
    return abs(a) / 1e4


_STATES = {"Iowa": "19", "Kansas": "20", "California": "06", "Illinois": "17", "Indiana": "18", "Minnesota": "27",
           "Missouri": "29", "Nebraska": "31", "Ohio": "39", "Wisconsin": "55", "Colorado": "08", "Oklahoma": "40",
           "Texas": "48", "New Mexico": "35", "Arizona": "04", "Nevada": "32", "North Dakota": "38",
           "South Dakota": "46", "Montana": "30", "Alaska": "02", "Hawaii": "15"}


def _state_fips(name):
    return _STATES.get(name or "")


def _place_name(addr, lat, lon):
    parts = [addr.get("county"), addr.get("state")]
    parts = [p for p in parts if p]
    return ", ".join(parts) if parts else f"{lat:.3f}, {lon:.3f}"


def coverage(ctx: dict) -> list[dict]:
    cc = (ctx["place"].get("country_code") or "").lower()
    st = ctx.get("statefips")
    out = []

    def add(layer, status, note):
        out.append({"layer": layer, "status": status, "note": note})
    add("Weather & climate (NASA POWER)", "supported" if "climate" in ctx else "not_available",
        "Daily since 1991 at ≈50 km" if "climate" in ctx else ctx["errors"].get("weather", "failed"))
    add("Imagery", "supported", "Satellite basemap; NASA GIBS science layers")
    soil = ctx["soil"]
    if soil.get("available") and soil.get("source") == "soilgrids":
        add("Soil (SoilGrids 250 m)", "partial",
            "Modelled soil map (SoilGrids 250 m), not a soil survey. Drainage class and wind erodibility not available")
    else:
        add("Soil (SSURGO)", "supported" if soil.get("available") else "not_available",
            "Mapped soil units for your field" if soil.get("available") else "Detailed US soil survey not available here")
    add("Terrain", "supported" if "terrain" in ctx else "not_available", "Elevation tiles ≈10–30 m")
    hsrc = (ctx.get("crop_history") or {}).get("source")
    if hsrc == "aafc":
        add("Crop history (AAFC)", "supported", "AAFC Annual Crop Inventory 2009–2025 (30 m)")
    else:
        add("Crop history (CDL)" if cc == "us" else "Crop history", "supported" if "crop_history" in ctx else "not_available",
            "USDA crop maps 2008–2025" if "crop_history" in ctx else
            ("No crop map here; enter your history" if cc == "us" else
             "No field crop-history map for this country; enter your rotation (a typical regional rotation is shown until you do)"))
    reg = ctx["region"]
    add("Rotation rules & calendars", "supported" if reg.get("region") and reg.get("exact") else
        ("partial" if reg.get("region") else "not_available"), reg.get("note") or f"{reg.get('label')} calendar")
    survey = soil.get("available") and soil.get("source") != "soilgrids"
    add("Outcome models (water, erosion, carbon)", "supported" if "climate" in ctx and survey else
        ("partial" if "climate" in ctx else "not_available"),
        "Process models run on your soil and weather" if survey else
        ("Run with modelled soil values (SoilGrids 250 m)" if soil.get("available") else "Run with default soil values"))
    add("Forecasts", "supported" if cc == "us" else "partial", "NOAA NWS (US) / Open-Meteo")
    add("Markets & costs", "partial" if cc == "us" else "not_available", "USDA ERS regional costs and returns" if cc == "us" else "No market data for this region yet")
    if st in ("02", "15"):
        add("Alaska / Hawaii", "partial", "CDL and calendars are limited; treat results as exploratory")
    return out


# --------------------------------------------------------------------------- area report helpers
def history_list(ctx) -> list[dict]:
    out = []
    for h in (ctx.get("crop_history") or {}).get("years", []):
        if h.get("available"):
            d = h["dominant"]
            out.append({"year": h["year"], "crop_id": d.get("crop_id"), "name": d["name"], "share": d["share"],
                        "source": "AAFC" if h.get("source") == "AAFC ACI" else "CDL", "confirmed": False})
    return out


def field_facts(ctx: dict, farm: dict, wx: pd.DataFrame | None) -> dict:
    """Facts the rules engine binds as `field`."""
    soil = (ctx.get("soil") or {}).get("properties") or {}
    clim = ctx.get("climate") or {}
    fr = clim.get("frost") or {}
    region = ctx["region"].get("region")
    facts = {
        "region": region,
        "slope_pct": (ctx.get("terrain") or {}).get("slope_mean_pct"),
        "drainage_class": (ctx.get("soil") or {}).get("drainage_class"),
        "texture_class": soil.get("texture_class"),
        "ph": soil.get("ph1to1h2o_r"),
        "frost_free_days_p50": fr.get("frost_free_days_median"),
        "frost_free_days_p20": None, "gdd_p50": None, "gdd_p20": None,
        "irrigation_mm": float(farm.get("irrigation_mm") or 0),
        "peak_erosivity_months": [], "bare_months": [], "season_etc": {}, "rain_eff_season_p20_mm": None,
    }
    if wx is not None and len(clim.get("annual", [])):
        ann = pd.DataFrame(clim["annual"])
        facts["gdd_p50"] = float(ann["gdd10"].median())
        facts["gdd_p20"] = float(ann["gdd10"].quantile(0.2))
        ffd = _ffd_by_year(wx)
        if ffd:
            facts["frost_free_days_p20"] = float(np.percentile(ffd, 20))
        # FAO/AGLW dependable effective rain (monthly): Peff = 0.8P-25 if P>75 else max(0.6P-10,0); season May-Sep
        m = wx["PRECTOTCORR"].groupby([wx.index.year, wx.index.month]).sum()
        peff = m.apply(lambda P: 0.8 * P - 25 if P > 75 else max(0.6 * P - 10, 0))
        season = peff[peff.index.get_level_values(1).isin([5, 6, 7, 8, 9])].groupby(level=0).sum()
        facts["rain_eff_season_p20_mm"] = float(season.quantile(0.2))
        hz = pd.DataFrame((ctx.get("hazards_weekly") or {}).get("weeks", []))
        if len(hz):
            hz["month"] = (hz["week"] * 7 // 30.5 + 1).clip(1, 12).astype(int)
            ms = hz.groupby("month")["erosivity_share"].sum()
            facts["peak_erosivity_months"] = [f"{m:02d}" for m in ms.sort_values(ascending=False).index[:3]]
        et0 = climate.et0_pm(wx, ctx["centroid"][1], clim.get("elevation_m") or 0)
        et0_doy = et0.groupby(et0.index.dayofyear).mean().values[:365]
        cal = kb.calendars().get(region or "", {}).get("crops", {})
        C = kb.crops()
        for cid, w in cal.items():
            c = C.get(cid)
            if not c or not c.get("kc") or not c.get("stage_days"):
                continue
            p = kb.window_mid(w.get("plant"))
            if p is None:
                continue
            sd = c["stage_days"]
            kc = np.concatenate([np.full(sd["ini"], c["kc"]["ini"]),
                                 np.linspace(c["kc"]["ini"], c["kc"]["mid"], sd["dev"]),
                                 np.full(sd["mid"], c["kc"]["mid"]),
                                 np.linspace(c["kc"]["mid"], c["kc"]["end"], sd["late"])])
            days = (p + np.arange(len(kc))) % 365
            facts["season_etc"][cid] = float((kc * et0_doy[days]).sum())
    return facts


def _ffd_by_year(wx):
    out = []
    for y, g in wx.groupby(wx.index.year):
        if len(g) < 360:
            continue
        sp = g[(g.index.month <= 7) & (g["T2M_MIN"] <= 0)]
        fa = g[(g.index.month >= 7) & (g["T2M_MIN"] <= 0)]
        if len(sp) and len(fa):
            out.append((fa.index.min() - sp.index.max()).days - 1)
    return out


def what_fits(ctx: dict, farm: dict, facts: dict) -> dict:
    """Hard constraints per crop with exclusion reasons (rules engine single-crop pass)."""
    region = ctx["region"].get("region")
    if not region:
        return {"supported": False, "reason": ctx["region"].get("note"), "feasible": [], "excluded": []}
    C = kb.crops()
    cal = kb.calendars()[region]
    feasible, excluded = [], []
    wont = set(farm.get("wont_grow") or [])
    for cid in list(cal["crops"].keys()) + list(cal["covers"].keys()):
        c = C.get(cid)
        if not c:
            continue
        reasons = []
        if cid in wont:
            reasons.append({"stage": "user", "reason": "On your 'won't grow' list"})
        if not c.get("simulable"):
            reasons.append({"stage": "hard_constraint",
                            "reason": "Missing crop water-use stages (FAO-56) in our knowledge base, so we can't simulate it honestly"})
        if c["season"] != "cover":
            seq = [{"cash": cid, "cover": None}, {"cash": cid, "cover": None}]
            r = rules_engine.run(seq, facts, farm)
            for x in r["excluded"]:
                reasons.append({"stage": "rules" if x["rule"] not in ("equipment_filter", "market_filter", "livestock_filter") else "hard_constraint",
                                "reason": x["message"], "rule": x["rule"]})
            etc = facts["season_etc"].get(cid)
            pdry = facts.get("rain_eff_season_p20_mm")
            water_note = None
            if etc and pdry is not None and facts["irrigation_mm"] == 0:
                water_note = {"season_etc_mm": round(etc), "dry_year_rain_mm": round(pdry),
                              "covered_share": round(min(1.0, pdry / etc), 2)}
        else:
            water_note = None
        item = {"crop_id": cid, "name": C[cid]["name"], "name_es": C[cid].get("name_es"), "season": c["season"],
                "roles": c.get("roles"), "water": water_note,
                "common_here": _common_share(ctx, cid)}
        if reasons:
            excluded.append({**item, "reasons": reasons})
        else:
            feasible.append(item)
    return {"supported": True, "region": region, "feasible": feasible, "excluded": excluded,
            "method": "rules", "note": "Hard constraints from the agronomy rules engine. 'Common here' is not the same as suitable."}


def _common_share(ctx, cid):
    rows = (ctx.get("county_crops") or {}).get("rows") or []
    tot = sum(r["acres"] for r in rows if r.get("crop_id")) or 0
    a = sum(r["acres"] for r in rows if r.get("crop_id") == cid)
    return round(a / tot, 3) if tot else None


# --------------------------------------------------------------------------- compare
def compare(ctx: dict, farm: dict | None = None, priorities: list[str] | None = None,
            baseline_seq: list[dict] | None = None, scenario: str = "normal",
            budgets: dict | None = None, custom: list[dict] | None = None, _capture: dict | None = None) -> dict:
    """budgets: {crop_id: {price_usd_bu, cost_usd_ac, yield_bu_ac}} (any subset) replaces ERS/M2 in profit only.
    custom: up to MAX_CUSTOM farmer-built options [{name, sequence}], screened like generated candidates and
    always shown when feasible. Without these (and without price= in the scenario) the output is unchanged.
    _capture: optional dict filled with the internal per-option simulation results (money calculator); the
    returned comparison is the same with or without it."""
    t0 = time.time()
    farm_arg = farm
    farm = {**{"equipment": ["row_crop_planter", "grain_drill", "combine"], "markets": [], "livestock": False,
               "hay_buyer": False, "irrigation_mm": 0, "wont_grow": [], "water": "rainfed"},
            **(ctx.get("default_farm") or {}), **(farm or {})}
    if "equipment" not in (farm_in := (farm_arg or {})):
        # assumption (shown to the user): the farm has (or hires) the equipment for crops this field already grew
        grown = {h["crop_id"] for h in history_list(ctx) if h.get("crop_id")}
        inferred = {e for cid in grown if cid in kb.crops() for e in (kb.crops()[cid].get("equipment") or [])}
        farm["equipment"] = sorted(set(farm["equipment"]) | inferred)
        farm["equipment_inferred_from"] = sorted(grown)
    if not (farm or {}).get("markets_confirmed"):
        # assumption (shown to the user): crops with ≥0.5 % of county cropland (USDA CDL) have a local market
        rows = (ctx.get("county_crops") or {}).get("rows") or []
        tot = sum(r["acres"] for r in rows if r.get("crop_id")) or 0
        # only crops in the knowledge base can be sold (CDL land covers such as pasture are not a market)
        local = [r["crop_id"] for r in rows if r.get("crop_id") in kb.crops() and r["crop_id"] != "fallow"
                 and tot and r["acres"] / tot >= 0.005]
        farm["markets"] = sorted(set(farm.get("markets") or []) | set(local))
        msrc = (ctx.get("county_crops") or {}).get("source")
        farm["markets_assumed_from"] = (("AAFC crop inventory, area around the field" if msrc == "aafc" else
                                         "USDA CDL county acreage") if local else None)
    priorities = priorities or ["soil_cover", "erosion", "water", "profit", "soil_health", "pests", "workload"]
    region = ctx["region"].get("region")
    if not region:
        return {"supported": False, "reason": ctx["region"].get("note")}
    wx = pd.read_parquet(ctx["_wx_path"]) if ctx.get("_wx_path") else None
    if wx is None:
        return {"supported": False, "reason": "No weather data for this field"}
    wx = _scenario(wx, scenario)
    hist = history_list(ctx)
    if baseline_seq:
        base = {"sequence": baseline_seq, "label": "entered by you", "method": "user"}
    elif ctx.get("default_baseline") and not hist:
        # no crop-history map here: a documented typical regional rotation stands in until the user enters theirs
        db = ctx["default_baseline"]
        base = {"sequence": db["sequence"], "label": db.get("label"), "method": "typical_regional",
                "source": db.get("source"), "note": db.get("note")}
    else:
        base = strategies.detect_baseline(hist)
    baseline = base.get("sequence")
    if baseline and base.get("method") in ("user", "typical_regional"):
        b_ids = sorted({x for st in baseline for x in (st["cash"], st.get("double")) if x and x != "fallow"})
        if "equipment" not in (farm_arg or {}):
            # assumption (shown): the farm has the equipment for the crops of its current rotation
            farm["equipment"] = sorted(set(farm["equipment"]) | {e for cid in b_ids for e in (kb.crops()[cid].get("equipment") or [])})
            farm["equipment_inferred_from"] = sorted(set(farm.get("equipment_inferred_from") or []) | set(b_ids))
        if not farm.get("markets_confirmed") and not farm.get("markets_assumed_from"):
            # no regional crop statistics connected: assume the crops already grown have a buyer (shown)
            farm["markets"] = sorted(set(farm.get("markets") or []) | set(b_ids))
            farm["markets_assumed_from"] = "your current rotation (no regional market data connected here)"
    facts = field_facts(ctx, farm, wx)
    # the farmer's own soil test replaces the mapped pH (rules: pH fit, lime) and organic matter (soil-carbon start).
    # Only when sent: without it nothing here changes (pilot outputs stay byte-identical).
    soil_test, soil_test_ignored = (_clean_soil_test(farm_arg.get("soil_test"))
                                    if isinstance(farm_arg, dict) and "soil_test" in farm_arg else (None, None))
    soil_mapped = (ctx.get("soil") or {}).get("properties") or {}
    if soil_test:
        if "ph" in soil_test:
            facts["ph"] = soil_test["ph"]
        facts["soil_test"] = {**soil_test, "label": _soil_test_label(soil_test),
                              "label_es": _soil_test_label(soil_test, "es")}
    fits = what_fits(ctx, farm, facts)
    feasible_ids = {f["crop_id"] for f in fits["feasible"]} | {"fallow"}
    if not base.get("sequence"):
        return {"supported": False, "reason": "Need your current rotation: " + base.get("reason", ""), "what_fits": fits}
    baseline = base["sequence"]
    C_ = kb.crops()
    unsim = sorted({x for st in baseline for x in (st["cash"], st.get("double"), st.get("cover"))
                    if x and (x not in C_ or not C_[x].get("simulable"))})
    if unsim:
        names = ", ".join(C_[x]["name"] if x in C_ else x for x in unsim)
        return {"supported": False, "what_fits": fits,
                "baseline_detection": {k: v for k, v in base.items() if k != "sequence"}, "baseline_sequence": baseline,
                "reason": f"Your current rotation includes {names}. Our knowledge base has no FAO-56 crop water-use "
                          "stages for it, so we can't simulate it honestly yet. The Area Report still works."}
    county = [r["crop_id"] for r in (ctx.get("county_crops") or {}).get("rows", []) if r.get("crop_id")]
    raw = strategies.generate(baseline, region, county, farm)
    cands = [{"id": "baseline", "family": "baseline", "sequence": baseline, "note": "Your current rotation", "is_baseline": True}]
    for i, c in enumerate(raw):
        cands.append({**c, "id": f"c{i + 1}", "is_baseline": False})
    custom_rejected: list[dict] = []
    if custom is not None:
        ok_custom, custom_rejected = _parse_custom(custom)
        for i, u in enumerate(ok_custom):
            cands.append({"id": f"u{i + 1}", "family": "custom", "sequence": u["sequence"], "note": None,
                          "is_baseline": False, "is_custom": True, "custom_name": u["name"]})

    clim = strategies.clim_from(wx)
    soil = (ctx.get("soil") or {}).get("properties") or {}
    years = climate.full_years(wx)
    et0 = climate.et0_pm(wx, ctx["centroid"][1], (ctx.get("climate") or {}).get("elevation_m") or 0)
    om = soil.get("om_r")
    if soil_test and "om_pct" in soil_test:
        om = soil_test["om_pct"]
    soc = om * 0.58 * 1.3 * 30 / 10 if om else None  # t C/ha in 0-30 cm: OM% x 0.58 x bulk density 1.3 g/cm3 x 30 cm
    k_si = soil.get("kwfact") * 0.1317 if soil.get("kwfact") else None  # US -> SI (AH-703 conversion)
    ls = (ctx.get("terrain") or {}).get("ls_mean") or 0.3
    taw = (soil.get("aws100_cm") or 15) * 10
    excluded_cands = []
    results = []
    stacks: dict[int, tuple] = {}
    for c in cands:
        seq = c["sequence"]
        if c.get("is_custom"):
            # farmer-built option: the same screens as generated candidates, but every reason is collected
            reasons = [_not_fit_reason(x, fits) for x in sorted({x for s in seq for x in (s["cash"], s.get("cover"), s.get("double"))
                                                                  if x and x not in feasible_ids})]
            seq_r, owner = expand_doubles(seq)
            rr = rules_engine.run(seq_r, facts, farm, [h["crop_id"] for h in hist])
            not_fit = list(reasons)
            reasons += [x["message"] for x in rr["excluded"] if not any(x["message"] in t for t in not_fit)]
            try:
                tl, issues = strategies.timeline(seq, region, clim)
            except Exception as e:  # noqa: BLE001 - reported to the farmer, never filled in
                tl, issues = None, [f"Could not build a planting calendar for this sequence ({type(e).__name__})"]
            if tl is None and not any("planting calendar" in t for t in not_fit):
                reasons += issues or ["Could not build a planting calendar for this sequence"]
            elif tl is None:
                reasons += [t for t in issues if not t.startswith("No planting/harvest dates")]
            if reasons:
                custom_rejected.append({"name": c["custom_name"], "sequence": seq,
                                        "rotation_label": strategies.name_of(seq), "reasons": list(dict.fromkeys(reasons))})
                continue
            n = tl.days // DAYS
            if n not in stacks:
                stacks[n] = weather_stack(wx, et0, n, years)
            W, starts = stacks[n]
            site = SiteInputs(W, starts, taw, k_si, ls, ctx.get("r_factor") or 0, soil.get("wei"), soc,
                              float(farm.get("irrigation_mm") or 0), auto_irrigate=farm.get("water") == "irrigated")
            mult = _rotation_mult(tl, seq, seq_r, owner, rr)
            sim = simulate(tl, site, kb.crops(), {cid: 1.0 for cid in kb.crops()}, mult)
            results.append({"cand": c, "rules": rr, "sim": sim, "tl": tl, "issues": issues, "site": site, "mult": mult})
            continue
        bad = [s["cash"] for s in seq if s["cash"] not in feasible_ids] + [s["cover"] for s in seq if s.get("cover") and s["cover"] not in feasible_ids] + \
              [s["double"] for s in seq if s.get("double") and s["double"] not in feasible_ids]
        if bad and not c["is_baseline"]:
            excluded_cands.append({**_cand_head(c), "reason": f"Uses a crop that doesn't fit here: {', '.join(sorted(set(bad)))}"})
            continue
        seq_r, owner = expand_doubles(seq)
        rr = rules_engine.run(seq_r, facts, farm, [h["crop_id"] for h in hist])
        if rr["excluded"] and not c["is_baseline"]:
            excluded_cands.append({**_cand_head(c), "reason": rr["excluded"][0]["message"], "rule": rr["excluded"][0]["rule"]})
            continue
        tl, issues = strategies.timeline(seq, region, clim)
        if tl is None:
            if c["is_baseline"]:
                return {"supported": False, "reason": "; ".join(issues)}
            excluded_cands.append({**_cand_head(c), "reason": "; ".join(issues)})
            continue
        n = tl.days // DAYS
        if n not in stacks:
            stacks[n] = weather_stack(wx, et0, n, years)
        W, starts = stacks[n]
        site = SiteInputs(W, starts, taw, k_si, ls, ctx.get("r_factor") or 0, soil.get("wei"), soc,
                          float(farm.get("irrigation_mm") or 0), auto_irrigate=farm.get("water") == "irrigated")
        # rotation yield multipliers per event (map transitions -> events)
        L = len(seq)
        mult = {}
        for k_ev, e in enumerate(tl.events):
            if e.kind in ("cash", "forage"):
                k_year = round((e.end // DAYS)) % L
                if len(seq_r) != L:  # double crops: map the event to its expanded position (year of planting, crop)
                    k_year = next((j for j, (i, cid) in enumerate(owner) if i == (e.start // DAYS) % L and cid == e.crop_id), None)
                if k_year in rr["yield_mult_combined"]:
                    mult[k_ev] = rr["yield_mult_combined"][k_year]
        sim = simulate(tl, site, kb.crops(), {cid: 1.0 for cid in kb.crops()}, mult)
        results.append({"cand": c, "rules": rr, "sim": sim, "tl": tl, "issues": issues, "site": site, "mult": mult})

    # indicators
    crops_used = {e["crop_id"] for r in results for e in r["sim"]["events"] if e["kind"] in ("cash", "forage")}
    m2 = _yield_county(ctx, wx, crops_used, "irrigated" if farm.get("water") == "irrigated" else "nonirrigated")
    ref_results = [r for r in results if not r["cand"].get("is_custom")]
    econ = _econ_for(ctx, results, m2, ref_results)
    econ_ers = econ
    budgets_clean, budget_ignored = _clean_budgets(budgets)
    price_pct = _scenario_price(scenario)
    if budgets_clean or price_pct:
        econ = _apply_budgets(econ, budgets_clean, results, ref_results, price_pct)
    for r in results:
        r["ind"], r["samples"] = _indicators(r, wx, econ, m2)
    rank_in = [{"id": r["cand"]["id"], "family": r["cand"]["family"], "is_baseline": r["cand"]["is_baseline"],
                "ind": {k: v["p50"] for k, v in r["ind"].items() if v.get("p50") is not None},
                "ind_samples": r["samples"]} for r in results]
    rk = ranking.rank(rank_in, priorities)
    custom_ids = [r["cand"]["id"] for r in results if r["cand"].get("is_custom")]
    if custom_ids:
        # farmer-built options are ranked with the rest but shown on top of (not instead of) baseline + 2 alternatives
        std_in = [x for x in rank_in if x["id"] not in custom_ids]
        rk_std = {**rk, "rank": {k: v for k, v in rk["rank"].items() if k not in custom_ids},
                  "pareto": {k: v for k, v in rk["pareto"].items() if k not in custom_ids}}
        show = ranking.select_cards(std_in, rk_std, n_alt=2) + custom_ids
    else:
        show = ranking.select_cards(rank_in, rk, n_alt=2)
    hz = pd.DataFrame(ctx["hazards_weekly"]["weeks"])
    windy_weeks, rain_weeks = _risk_weeks(hz)
    base_r = next(r for r in results if r["cand"]["is_baseline"])
    base_r["base_meta"] = {k: v for k, v in base.items() if k != "sequence"}
    cards = []
    for r in results:
        cards.append(_card(r, base_r, rk, ctx, facts, windy_weeks, rain_weeks, r["cand"]["id"] in show))
        if econ.get("budget_detail") is not None:
            cards[-1]["economics"] = _card_economics(r, econ)
    shown = [c for c in cards if c["shown"]]
    shown.sort(key=lambda c: (not c["is_baseline"], rk["rank"][c["id"]]))
    binding = None
    shown_std = [c for c in shown if not c.get("is_custom")]
    alt_families = {c["family"] for c in shown_std if not c["is_baseline"]}
    if len(shown_std) < 3 or len(alt_families) < 2:
        binding = _binding_constraint(fits, excluded_cands)
        if binding is not None and len(shown_std) >= 3 and len(alt_families) < 2:
            binding["note"] = ("Only one strategy family produced options that pass the rules here, so both "
                               "alternatives come from it.")
    out = {
        "supported": True, "field_id": ctx["id"], "region": ctx["region"], "scenario": scenario,
        "priorities": priorities, "weights": rk["weights"], "baseline_detection": {k: v for k, v in base.items() if k != "sequence"},
        "what_fits": fits, "facts": facts,
        "economics": {k: econ.get(k) for k in ("available", "reason", "region", "missing", "yield_anchor")},
        "farm_used": {k: farm.get(k) for k in ("equipment", "equipment_inferred_from", "markets", "markets_assumed_from",
                                               "livestock", "hay_buyer", "water", "irrigation_mm", "wont_grow", "n_rate_kg_ha")},
        "candidates_considered": len(cands), "candidates_simulated": len(results), "excluded_candidates": excluded_cands,
        "cards": shown, "all_cards": cards, "ranking": {k: v for k, v in rk.items() if k != "contributions"},
        "risk_weeks": {"windy": windy_weeks, "heavy_rain": rain_weeks,
                       "definition": "Windy weeks: the quarter of weeks with the most days ≥ 8 m/s at 10 m (NASA POWER 1991–present). "
                                     "Heavy-rain weeks: the quarter of weeks with the most rain erosivity."},
        "binding_constraint": binding,
        "weather_years": {"n": len(years), "first": years[0], "last": years[-1]},
        "assumptions": ASSUMPTIONS,
        "reminder": "FarmSmart shows patterns and trade-offs. It does not replace your judgment or local agronomy advice.",
        "elapsed_s": round(time.time() - t0, 2),
    }
    if econ.get("budget_detail") is not None:
        out["economics"].update({k: econ.get(k) for k in ("budget_source", "budget_detail", "budgets_used",
                                                          "budget_incomplete", "price_scale", "price_note")})
    if budgets is not None:
        out["economics"]["budget_ignored"] = budget_ignored
    if soil_test_ignored is not None:  # farm.soil_test was sent
        mapped_src = ("modelled soil map (SoilGrids 250 m)" if (ctx.get("soil") or {}).get("source") == "soilgrids"
                      else "USDA soil survey (SSURGO)" if (ctx.get("soil") or {}).get("available") else None)
        out["soil_test"] = {
            "used": soil_test, "ignored": soil_test_ignored,
            "label": _soil_test_label(soil_test) if soil_test else None,
            "label_es": _soil_test_label(soil_test, "es") if soil_test else None,
            "replaces": {"ph": soil_mapped.get("ph1to1h2o_r") if soil_test and "ph" in soil_test else None,
                         "om_pct": soil_mapped.get("om_r") if soil_test and "om_pct" in soil_test else None,
                         "source": mapped_src},
            "applies_to": ["pH fit and lime rules", "soil-carbon start (organic matter)"] if soil_test else [],
            "note": ("Your soil test replaces the mapped pH and organic matter for the rules and the soil-carbon "
                     "start. Texture, water-holding and drainage still come from the soil map." if soil_test else
                     "Your soil test was not used: " + "; ".join(soil_test_ignored) + "."),
        }
    if custom is not None:
        out["custom_considered"] = len(custom) if isinstance(custom, list) else 0
        out["custom_rejected"] = [{k: v for k, v in x.items() if k != "stage"} for x in custom_rejected]
        # an indicator missing only on a farmer-built option drops out of the ranking for everyone: say so
        lost = [k for k in rk.get("dropped_indicators") or []
                if all(x["ind"].get(k) is not None for x in rank_in if x["id"] not in custom_ids)]
        if custom_ids and lost:
            who = [r["cand"]["custom_name"] for r in results if r["cand"].get("is_custom")
                   and any(next(x for x in rank_in if x["id"] == r["cand"]["id"])["ind"].get(k) is None for k in lost)]
            labels = ", ".join(ranking.INDICATORS[k][1].lower() for k in lost)
            out["custom_note"] = (f"{', '.join(who)} has no value for {labels} (no cost and price data for one of its "
                                  f"crops), so {labels} was left out of the ranking for every option. Values are never "
                                  "filled in. Add your own prices and costs for that crop to include it.")
    if _capture is not None:
        _capture.update(results=results, ref_results=ref_results, econ=econ, econ_ers=econ_ers, m2=m2, wx=wx,
                        farm=farm, region=region, years=years)
    return _jsonable(out)


MAX_CUSTOM = 4
MAX_CUSTOM_YEARS = 6


def _rotation_mult(tl, seq, seq_r, owner, rr) -> dict:
    """Rotation yield multipliers per timeline event (same mapping as the main candidate loop)."""
    L = len(seq)
    mult = {}
    for k_ev, e in enumerate(tl.events):
        if e.kind in ("cash", "forage"):
            k_year = round((e.end // DAYS)) % L
            if len(seq_r) != L:
                k_year = next((j for j, (i, cid) in enumerate(owner) if i == (e.start // DAYS) % L and cid == e.crop_id), None)
            if k_year in rr["yield_mult_combined"]:
                mult[k_ev] = rr["yield_mult_combined"][k_year]
    return mult


def _parse_custom(custom) -> tuple[list[dict], list[dict]]:
    """Validate farmer-built options: shape, known crop ids, cover/cash roles. Returns (ok, rejected)."""
    C = kb.crops()
    ok, rej = [], []
    if not isinstance(custom, list):
        return [], [{"name": "Your options", "reasons": ["Options must be a list"], "stage": "input"}]

    def nm(cid):
        return C[cid]["name"] if cid in C else str(cid)
    for i, u in enumerate(custom):
        name = (str(u.get("name") or "").strip()[:80] if isinstance(u, dict) else "") or f"My option {i + 1}"
        if i >= MAX_CUSTOM:
            rej.append({"name": name, "reasons": [f"Up to {MAX_CUSTOM} options of your own can be tested at once"], "stage": "input"})
            continue
        steps = u.get("sequence") if isinstance(u, dict) else None
        if not isinstance(steps, list) or not steps:
            rej.append({"name": name, "reasons": ["The option has no years"], "stage": "input"})
            continue
        reasons = []
        if len(steps) > MAX_CUSTOM_YEARS:
            reasons.append(f"Up to {MAX_CUSTOM_YEARS} years per option")
        seq = []
        for y, st in enumerate(steps[:MAX_CUSTOM_YEARS], start=1):
            st = st if isinstance(st, dict) else {}
            cash, cover, dbl = st.get("cash"), st.get("cover") or None, st.get("double") or None
            if not isinstance(cash, str) or cash not in C:
                reasons.append(f"Year {y}: unknown crop '{str(cash)[:40]}'" if cash else f"Year {y}: no crop chosen")
                continue
            if C[cash]["season"] == "cover":
                reasons.append(f"Year {y}: {nm(cash)} is a cover crop; choose it as the cover after a crop")
            if cover is not None and (not isinstance(cover, str) or cover not in C or C[cover]["season"] != "cover"):
                reasons.append(f"Year {y}: {nm(cover) if isinstance(cover, str) else 'that'} is not a cover crop")
            if dbl is not None and (not isinstance(dbl, str) or dbl not in C or C[dbl]["season"] in ("cover", "perennial", "fallow")):
                reasons.append(f"Year {y}: {nm(dbl) if isinstance(dbl, str) else 'that'} can't be a second crop in the same year")
            step = {"cash": cash, "cover": cover}
            if dbl:
                step["double"] = dbl
            seq.append(step)
        if reasons:
            rej.append({"name": name, "sequence": seq, "reasons": list(dict.fromkeys(reasons)), "stage": "input"})
        else:
            ok.append({"name": name, "sequence": seq})
    return ok, rej


def _not_fit_reason(cid: str, fits: dict) -> str:
    C = kb.crops()
    nm = C[cid]["name"] if cid in C else cid
    ex = next((e for e in fits.get("excluded", []) if e["crop_id"] == cid), None)
    if ex:
        return f"{nm} doesn't fit here: " + "; ".join(dict.fromkeys(r["reason"] for r in ex["reasons"]))
    return f"{nm} is not in the planting calendar for this region"


BUDGET_KEYS = {"price_usd_bu": (0.0, 1e4, False), "cost_usd_ac": (0.0, 2e4, True), "yield_bu_ac": (0.0, 1e5, False)}


def _clean_budgets(budgets) -> tuple[dict, list[str]]:
    """{crop_id: {price_usd_bu, cost_usd_ac, yield_bu_ac}} -> validated floats; bad entries listed, never guessed."""
    out, ignored = {}, []
    if not isinstance(budgets, dict):
        return out, (["budgets must be an object keyed by crop id"] if budgets is not None else [])
    C = kb.crops()
    for cid, b in budgets.items():
        if cid not in C or not isinstance(b, dict):
            ignored.append(f"{str(cid)[:40]}: unknown crop")
            continue
        e = {}
        for k, (lo, hi, zero_ok) in BUDGET_KEYS.items():
            v = b.get(k)
            if v is None or v == "":
                continue
            try:
                v = float(v)
            except (TypeError, ValueError):
                ignored.append(f"{cid}.{k}: not a number")
                continue
            if not np.isfinite(v) or v < lo or v > hi or (v == 0 and not zero_ok):
                ignored.append(f"{cid}.{k}: out of range")
                continue
            e[k] = v
        if e:
            out[cid] = e
    return out, ignored


SOIL_TEST_RANGES = {"ph": (3.0, 10.5), "om_pct": (0.1, 60.0)}


def _clean_soil_test(st) -> tuple[dict | None, list[str]]:
    """farm.soil_test = {ph, om_pct, year} (the farmer's own lab test) -> validated values; bad entries listed,
    never guessed. Returns (None, reasons) when neither pH nor organic matter is usable."""
    if not isinstance(st, dict):
        return None, ["soil_test must be an object {ph, om_pct, year}"]
    out, ignored = {}, []
    for k, (lo, hi) in SOIL_TEST_RANGES.items():
        v = st.get(k)
        if v is None or v == "":
            continue
        try:
            v = float(v)
        except (TypeError, ValueError):
            ignored.append(f"{k}: not a number")
            continue
        if not np.isfinite(v) or v < lo or v > hi:
            ignored.append(f"{k}: out of range ({lo:g}–{hi:g})")
            continue
        out[k] = round(v, 2)
    y = st.get("year")
    if y not in (None, ""):
        try:
            y = int(y)
            if not 1950 <= y <= date.today().year:
                raise ValueError
            out["year"] = y
        except (TypeError, ValueError):
            ignored.append(f"year: not a year between 1950 and {date.today().year}")
    if "ph" not in out and "om_pct" not in out:
        return None, ignored or ["soil_test has no pH or organic matter value"]
    return out, ignored


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _soil_test_label(st: dict, lang: str = "en") -> str:
    y = f" ({st['year']})" if st.get("year") else ""
    return (f"your soil test{y}" if lang == "en" else f"su análisis de suelo{y}")


def _scenario_price(scenario: str) -> float:
    """price=<percent> from the custom scenario form (profit only); 0 when absent."""
    if not scenario.startswith("custom:"):
        return 0.0
    kv = dict(x.split("=", 1) for x in scenario[7:].split(",") if "=" in x)
    try:
        return max(-80.0, min(100.0, float(kv.get("price", 0))))
    except ValueError:
        return 0.0


def _apply_budgets(econ: dict, budgets: dict, results: list, ref_results: list, price_pct: float) -> dict:
    """Farmer's own price / cost / yield replace ERS (price, cost) and the M2/ERS yield anchor in profit only.
    A crop ERS doesn't cover (or a non-US field) gets profit only when price, cost and yield are all given."""
    econ = {**econ, "crops": {k: dict(v) for k, v in (econ.get("crops") or {}).items()},
            "missing": list(econ.get("missing") or [])}
    if not econ.get("available"):
        econ.update({"crops": {}, "price_years": []})
    crops_used = {e["crop_id"] for r in results for e in r["sim"]["events"] if e["kind"] in ("cash", "forage")}
    detail, incomplete = {}, []
    for cid in sorted(crops_used):
        b = budgets.get(cid) or {}
        ce = econ["crops"].get(cid)
        if ce is None:
            if not all(k in b for k in BUDGET_KEYS):
                if b:
                    incomplete.append(cid)
                continue
            # no ERS data here: profit from the farmer's own three numbers only
            pool = [r for r in ref_results if any(e["crop_id"] == cid for e in r["sim"]["events"])] or results
            idx = np.concatenate([e["yield"] for r in pool for e in r["sim"]["events"]
                                  if e["crop_id"] == cid and e["kind"] in ("cash", "forage")])
            med = float(np.nanmedian(idx)) if idx.size else np.nan
            ce = {"ym": b["yield_bu_ac"] / med if med and med > 0 else None, "yield_p50": None, "yield_source": None,
                  "yield_unit": "your unit per acre", "price_years": [], "prices": [], "op_cost": None, "region": None,
                  "evidence": None}
            econ["crops"][cid] = ce
            econ["missing"] = [x for x in econ["missing"] if x != cid]
        # default sources: USDA ERS, except sunflower (NDSU budgets, NASS prices and yields; ingest/ground_econ.py)
        sun = cid == "sunflower"
        src = {"price": "NASS" if sun else "ERS", "cost": "NDSU" if sun else "ERS",
               "yield": "M2" if "M2" in (ce.get("yield_source") or "") else ("NASS" if sun else "ERS")}
        if "price_usd_bu" in b:
            ce["price_fixed"], src["price"] = b["price_usd_bu"], "yours"
        if "cost_usd_ac" in b:
            ce["op_cost"], src["cost"] = b["cost_usd_ac"], "yours"
        if "yield_bu_ac" in b:
            if ce.get("yield_p50"):  # rescale: ym = anchor / simulated median, so the median is anchor / ym
                med = ce["yield_p50"] / ce["ym"] if ce.get("ym") else None
                ce["ym"] = b["yield_bu_ac"] / med if med and med > 0 else None
            ce["yield_p50"], ce["yield_source"], src["yield"] = b["yield_bu_ac"], "your yield", "yours"
        if ce.get("ym") is None:
            econ["crops"].pop(cid, None)
            continue
        detail[cid] = src
    if econ["crops"] and not econ.get("available"):
        econ["available"] = True
        econ["reason"] = "Profit from your own prices, costs and yields (no regional cost data connected here)"
    econ["price_years"] = sorted({y for c in econ["crops"].values() for y in c["price_years"]})
    econ["budget_detail"] = detail
    econ["budget_source"] = {k: ("yours" if "yours" in v.values() else ("NDSU/NASS" if k == "sunflower" else "ERS"))
                             for k, v in detail.items()}
    econ["budgets_used"] = {k: {**budgets[k], "unit": (econ["crops"].get(k) or {}).get("yield_unit")}
                            for k in budgets if k in detail}
    econ["budget_incomplete"] = [{"crop_id": c, "reason": "No regional cost and price data for this crop here, so profit needs your "
                                                          "price, cost and yield (all three)"} for c in incomplete]
    econ["price_scale"] = 1 + price_pct / 100 if price_pct else 1.0
    econ["price_note"] = (f"Prices scaled by {price_pct:+.0f}% (hypothetical; profit only)" if price_pct else None)
    return econ


def _card_economics(r, econ) -> dict:
    cash = list(dict.fromkeys(e["crop_id"] for e in r["sim"]["events"] if e["kind"] in ("cash", "forage")))
    det = econ.get("budget_detail") or {}
    return {"budget_source": {c: econ["budget_source"][c] for c in cash if c in det},
            "budget_detail": {c: det[c] for c in cash if c in det},
            "price_scale": econ.get("price_scale", 1.0),
            "profit_available": bool(econ.get("available")) and all(c in (econ.get("crops") or {}) for c in cash)}


ASSUMPTIONS = [
    "Cover crop growth follows a temperature curve to full cover at about 700 °C-days (base 0 °C); real stands vary with seeding date and rate.",
    "Residue cover after harvest comes from ISU PM 1901a; how fast it breaks down is an assumption by residue type.",
    "The yield index is % of a water-unlimited potential at this site (FAO-33 Ky method). For US counties with USDA NASS "
    "yield records, the county yield range in bu/ac comes from M2 and sets the yield scale for profit; it describes the "
    "county average, not your field.",
    "Erosion uses RUSLE with a 50 m slope length and no conservation practice factor (P = 1).",
    "Weather is NASA POWER at ≈50 km: it describes the region around the field, not the field itself.",
]


def expand_doubles(seq: list[dict]) -> tuple[list[dict], list[tuple[int, str]]]:
    """[{cash, cover, double}] -> one item per harvested crop, in field order (rice, wheat, rice, ...).
    The cover moves to after the second crop. owner[j] = (sequence index, crop id). Identity without doubles."""
    if not any(s.get("double") for s in seq):
        return seq, [(i, s["cash"]) for i, s in enumerate(seq)]
    out, owner = [], []
    for i, s in enumerate(seq):
        if s.get("double"):
            out.append({"cash": s["cash"], "cover": None})
            out.append({"cash": s["double"], "cover": s.get("cover")})
            owner += [(i, s["cash"]), (i, s["double"])]
        else:
            out.append({"cash": s["cash"], "cover": s.get("cover")})
            owner.append((i, s["cash"]))
    return out, owner


def _scenario(wx: pd.DataFrame, scenario: str) -> pd.DataFrame:
    """Scenario transforms (clearly hypothetical): dry = -25% rain; hot = +2 °C; wet = +20% rain."""
    if scenario == "normal":
        return wx
    w = wx.copy()
    if scenario.startswith("custom:"):
        # scenario slider: "custom:rain=-20,temp=1.5" -> rain x (1 + pct/100), temperatures + delta °C (hypothetical)
        kv = dict(x.split("=") for x in scenario[7:].split(",") if "=" in x)
        rain = max(-60.0, min(60.0, float(kv.get("rain", 0))))
        temp = max(-3.0, min(5.0, float(kv.get("temp", 0))))
        w["PRECTOTCORR"] *= 1 + rain / 100
        for k in ("T2M", "T2M_MAX", "T2M_MIN"):
            w[k] += temp
        w.attrs = wx.attrs
        return w
    if scenario == "dry":
        w["PRECTOTCORR"] *= 0.75
    elif scenario == "wet":
        w["PRECTOTCORR"] *= 1.2
    elif scenario == "hot":
        for k in ("T2M", "T2M_MAX", "T2M_MIN"):
            w[k] += 2.0
    w.attrs = wx.attrs
    return w


def _cand_head(c):
    return {"id": c["id"], "family": c["family"], "name": strategies.name_of(c["sequence"]), "note": c.get("note")}


COVER_COST_USD_AC = (35.0, 37.0)  # Plastina et al. 2018, CARD Ag Policy Review: avg cost of planting covers, IA/IL/MN
COVER_COST_SRC = "Plastina, Liu, Miguez & Carlson 2018, 'Do cover crops pay?', ISU CARD Agricultural Policy Review (avg planting cost $35-37/acre)"


YIELD_COUNTY_SCALE = "county statistics, not your field"


def _yield_county(ctx, wx, crops, practice: str | None = None) -> dict:
    """M2 county yield P10/P50/P90 (typical year) per crop, for US fields with a known county. {} otherwise.
    `practice` ('irrigated' / 'nonirrigated', from the farm's water setting) selects the NASS practice-specific
    county series when the county has one; otherwise all practices, with a note."""
    if (ctx["place"].get("country_code") or "").lower() != "us" or not ctx.get("county_fips") or wx is None:
        return {}
    try:
        from ..models import m02_yield as M2
    except Exception:  # noqa: BLE001 - model unavailable: ERS route stays
        return {}
    lat = ctx["centroid"][1]
    elev = (ctx.get("climate") or {}).get("elevation_m") or 0
    out = {}
    for cid in sorted(crops):
        if cid not in M2.CROPS:
            continue
        try:
            o = M2.county_outlook(cid, ctx["county_fips"], wx, lat, float(elev), practice=practice)
        except Exception as e:  # noqa: BLE001 - reported, never filled in
            o = {"available": False, "reason": f"M2 could not run: {type(e).__name__}: {str(e)[:120]}"}
        out[cid] = _m2_block(o) if o.get("available") else {"available": False, "reason": o.get("reason")}
    return out


def _m2_block(o: dict) -> dict:
    v = o.get("validation") or {}
    cov, loso = v.get("temporal_coverage80"), v.get("loso_coverage80")
    flags = []
    if cov is not None and cov < 0.75:
        flags.append(f"its 80% range held the county yield in only {cov:.0%} of held-out years")
    if (o.get("out_of_range_share") or 0) > 0.05:
        flags.append("some weather years here fall outside the weather the model was trained on")
    conf = uncertainty.assess(interval=(o["p10"], o["p50"], o["p90"]), data_flags=flags,
                              coarse_inputs=["weather ≈50 km", "county statistics"], method="si", calibrated=True)
    if cov is not None:
        ty = v.get("test_years") or [2018, 2024]
        conf["reasons"].append(f"on held-out {ty[0]}–{ty[1]} county yields the 80% range held the truth {cov:.0%} of the "
                               "time" + (f" ({loso:.0%} for whole states left out of training)" if loso is not None else ""))
    pre = {k: o[k] for k in ("unit", "p10", "p50", "p90", "trend_yield", "trend_year", "trend_slope_per_year", "county_years",
                             "county_n_years", "weather_years", "n_weather_years", "worst_weather_year",
                             "harvested_share_of_planted", "per_year_p50", "practice")}
    pr = o.get("practice") or {}
    prac_txt = {"irrigated": "irrigated fields", "nonirrigated": "non-irrigated (dryland) fields"}.get(pr.get("series"),
                                                                                                      "all practices")
    return {"available": True, **pre, "scale": YIELD_COUNTY_SCALE,
            "label": f"county yield in a typical year ({o['unit']}, {prac_txt}): USDA NASS county trend for "
                     f"{o['trend_year']} with the season weather of every year on record",
            "note": ((pr.get("note") + " ") if pr.get("note") else "") +
                    "NASS county yields are per harvested acre; ERS costs are per planted acre, so acres that were "
                    "abandoned or grazed out are not counted.",
            "si": {"model_id": "M2", "name": "County yield and yield risk (LightGBM quantile regression, conformalized)",
                   "drivers": [d["label"] for d in o.get("drivers") or []], "driver_effects": o.get("drivers"),
                   "confidence": conf,
                   "information_cutoff": f"{o['cutoff']} season (USDA NASS county yields 2000–{o['cutoff']})",
                   "card": "models/model_cards/m02_yield.md", "validation": v},
            "evidence": [{"source": "USDA NASS Quick Stats", "is_nasa": False, "product": "county yield estimates (survey)",
                          "years": o["county_years"], "footprint": f"county FIPS {o['county_fips']}",
                          "scale": "county average (per harvested acre)", "url": "https://quickstats.nass.usda.gov",
                          "licence": "Public domain (USDA)"},
                         {"source": "NASA POWER", "is_nasa": True, "product": "daily meteorology and root-zone wetness (AG)",
                          "years": o["weather_years"], "scale": "regional value (≈50 km)",
                          "url": "https://power.larc.nasa.gov"}]}


def _econ_for(ctx, results, m2: dict | None = None, ref_results: list | None = None) -> dict:
    """Per-crop economics (USDA ERS regional costs & returns) + yield scale calibration. US only.
    Yield scale: M2 county P50 (USDA NASS county trend) when available, else the ERS regional 5-year median."""
    if (ctx["place"].get("country_code") or "").lower() != "us" or not ctx.get("statefips"):
        return {"available": False, "reason": "Costs and prices are connected for US fields only so far"}
    try:
        from ..ingest import econ as E
        region = (E.region_for_county(ctx["county_fips"]) if ctx.get("county_fips") else None) or E.region_for(ctx["statefips"])
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"economics data unavailable: {e}"}
    crops_used = {e["crop_id"] for r in results for e in r["sim"]["events"] if e["kind"] in ("cash", "forage")}
    out = {"available": True, "region": region, "crops": {}, "missing": []}
    for cid in crops_used:
        ec = E.crop_economics(cid, region, fips=ctx.get("county_fips") or ctx.get("statefips"))
        if not ec or not ec.get("last10") or not ec["last10"].get("yield"):
            out["missing"].append(cid)
            continue
        # yield-scale median from the standard candidates, so farmer-built options never shift other cards' profit
        pool = [r for r in (ref_results if ref_results is not None else results)
                if any(e["crop_id"] == cid for e in r["sim"]["events"])] or results
        idx = np.concatenate([e["yield"] for r in pool for e in r["sim"]["events"] if e["crop_id"] == cid and e["kind"] in ("cash", "forage")])
        med = float(np.nanmedian(idx)) if idx.size else np.nan
        y5 = ec["last5"]["yield"]["p50"]
        yc = (m2 or {}).get(cid) or {}
        if yc.get("available"):
            ser = (yc.get("practice") or {}).get("series") or "all"
            y_anchor = yc["p50"]
            ysrc = ("M2 county yield (USDA NASS county trend + season weather; "
                    + {"irrigated": "irrigated series", "nonirrigated": "non-irrigated series"}.get(ser, "all practices") + ")")
        else:
            y_anchor, ysrc = y5, ec.get("yield_source") or "USDA ERS regional 5-year median"
        out.setdefault("yield_anchor", {})[cid] = {"source": ysrc, "yield_p50": y_anchor, "ers_yield_p50": y5}
        out["crops"][cid] = {
            "ym": y_anchor / med if med and med > 0 else None, "yield_p50": y_anchor, "yield_source": ysrc,
            "yield_unit": ec["units"]["yield"],
            "price_years": ec["last10"]["price"]["years"], "prices": ec["last10"]["price"]["values"],
            "op_cost": ec["last5"]["operating_cost"]["p50"], "region": ec.get("region"),
            "evidence": ec.get("evidence"),
        }
    yrs = sorted({y for c in out["crops"].values() for y in c["price_years"]})
    out["price_years"] = yrs
    return out


def _indicators(r, wx, econ=None, m2=None) -> tuple[dict, dict]:
    sim = r["sim"]
    S = sim["S"]
    cash = [e for e in sim["events"] if e["kind"] in ("cash", "forage")]
    rel = np.nanmean(np.array([e["rel_yield"] for e in cash]), axis=0) if cash else np.full(S, np.nan)
    # rotation multiplier applied: yield index = rel * mult (sim used ym=1)
    yidx = np.nanmean(np.array([e["yield"] for e in cash]), axis=0) * 100 if cash else np.full(S, np.nan)
    # dry-year regret: mean yield loss in the driest 20% of simulated sequences
    P = sim["water_use_mm"]  # placeholder for ordering not used
    starts = sim["start_years"]
    gs = wx["PRECTOTCORR"][wx.index.month.isin([5, 6, 7, 8])].groupby(wx.index.year[wx.index.month.isin([5, 6, 7, 8])]).sum()
    seq_rain = np.array([gs.reindex(range(y, y + sim["years_n"])).mean() for y in starts])
    dry = seq_rain <= np.nanpercentile(seq_rain, 20)
    regret = np.full(S, np.nan)
    # dry-year regret = % yield shortfall in the driest 20 % of sequences vs this rotation's own typical year (≥ 0)
    typical = np.nanmedian(yidx)
    regret[dry] = np.clip(100 * (1 - yidx[dry] / typical), 0, None) if typical and typical > 0 else np.nan
    cover_days = 365 - sim["bare_days"]
    C = kb.crops()
    n_years = len(r["cand"]["sequence"])
    seq, _ = expand_doubles(r["cand"]["sequence"])
    n = len(seq)
    pb = sum(1 for i in range(n) if not set(C[seq[i]["cash"]].get("pest_host_groups") or []) & set(C[seq[i - 1]["cash"]].get("pest_host_groups") or [])
             and C[seq[i]["cash"]]["family"] != C[seq[i - 1]["cash"]]["family"]) / n
    ops = sum((2 if C[s["cash"]]["season"] != "perennial" else 4) + (2 if s.get("cover") and s["cover"] not in strategies.WINTERKILL else 1 if s.get("cover") else 0) for s in seq) / n_years
    div = len({s["cash"] for s in seq}) + 0.5 * len({s["cover"] for s in seq if s.get("cover")})
    ncred = []
    for s in seq:
        c = C[s["cash"]]
        if c.get("n_fixing") and c.get("n_credit_next_kg_ha"):
            ncred.append(sum(c["n_credit_next_kg_ha"]) / 2)
        if s.get("cover") and C[s["cover"]].get("n_fixing") and C[s["cover"]].get("n_credit_next_kg_ha"):
            ncred.append(sum(C[s["cover"]]["n_credit_next_kg_ha"]) / 2)
    nbal = sum(ncred) / n_years
    samples = {
        "soil_cover": np.full(S, cover_days), "erosion_water": sim["erosion_water_t_ha"], "wind_exposure": sim["wind_index"],
        "water_use": sim["water_use_mm"], "dry_year_regret": regret[dry] if dry.any() else np.array([np.nan]),
        "soc_trend": sim["soc_change_t_ha_yr"], "n_balance": np.full(S, nbal), "pest_break": np.full(S, pb),
        "workload": np.full(S, ops), "diversity": np.full(S, div),
        "yield_index": yidx,
    }
    # ---- profit (M8): net return over operating costs, $/acre/yr, paired price years across crops
    if econ and econ.get("available") and all(e["crop_id"] in econ["crops"] for e in cash):
        rng = np.random.default_rng(11)
        yrs = econ["price_years"]
        draw = rng.integers(len(yrs), size=S) if yrs else np.zeros(S, int)
        tot = np.zeros(S)
        pscale = econ.get("price_scale", 1.0)
        for e in cash:
            ce = econ["crops"][e["crop_id"]]
            if ce.get("price_fixed") is not None:  # the farmer's own price
                price = np.full(S, float(ce["price_fixed"]))
            else:
                pmap = dict(zip(ce["price_years"], ce["prices"]))
                price = np.array([pmap.get(yrs[i], np.nanmedian(ce["prices"])) for i in draw])
            if pscale != 1.0:
                price = price * pscale
            tot += np.nan_to_num(e["yield"]) * ce["ym"] * price - ce["op_cost"]
        covers = [s for s in seq if s.get("cover")]
        n_cyc = max(len(cash), 1) / max(n, 1)
        tot -= len(covers) * np.mean(COVER_COST_USD_AC) * n_cyc
        years_in = max(len(cash), 1) * (sim["years_n"] / max(len(cash), 1)) if cash else 1
        profit = tot / sim["years_n"]
        samples["profit_p50"] = profit
        samples["profit_p10"] = profit
    ind = {k: uncertainty.quantiles(v) for k, v in samples.items() if k != "yield_index"}
    if "profit_p10" in ind:
        ind["profit_p10"] = {**ind["profit_p10"], "p50": ind["profit_p10"]["p10"]}  # ranked on the bad-year value
    ind["yield_index"] = uncertainty.quantiles(yidx)
    ind["bare_windy_days"] = uncertainty.quantiles(sim["bare_windy_days"])
    ind["bare_heavy_rain_days"] = uncertainty.quantiles(sim["bare_heavy_rain_days"])
    ind["deep_drainage"] = uncertainty.quantiles(sim["deep_drainage_mm"])
    if np.nanmax(sim["irrigation_mm"]) > 0:
        ind["irrigation"] = uncertainty.quantiles(sim["irrigation_mm"])
        samples["water_use"] = sim["irrigation_mm"]  # for irrigated fields, rank on pumped water (groundwater)
        ind["water_use"] = uncertainty.quantiles(sim["irrigation_mm"])
    yc = {cid: m2[cid] for cid in dict.fromkeys(e["crop_id"] for e in cash) if cid in (m2 or {})}
    if yc:
        ind["yield_county"] = yc  # M2 county yield per cash crop (county statistics, not your field)
    clean = {k: v[~np.isnan(v)] if isinstance(v, np.ndarray) else v for k, v in samples.items()}
    return ind, clean


def _risk_weeks(hz: pd.DataFrame) -> tuple[list[int], list[int]]:
    if not len(hz):
        return [], []
    wq = hz["windy_days"].quantile(0.75)
    eq = hz["erosivity_share"].quantile(0.75)
    return [int(w) for w in hz.loc[hz["windy_days"] >= wq, "week"]], [int(w) for w in hz.loc[hz["erosivity_share"] >= eq, "week"]]


def _weekly_cover(tl, years_n) -> list[list[float]]:
    """Mean soil cover per week for each rotation year (from the simulated timeline)."""
    out = []
    from .sim import residue_cover
    res = residue_cover(tl, kb.crops())
    cover = np.clip(tl.canopy + (1 - tl.canopy) * res, 0, 1)
    for y in range(years_n):
        seg = cover[y * DAYS:(y + 1) * DAYS]
        out.append([round(float(seg[w * 7:min(w * 7 + 7, 365)].mean()), 3) for w in range(52)])
    return out


def _weekly_crops(tl, y0: int, n: int) -> list[dict]:
    """Calendar bars (start/end in weeks relative to the first shown year) for events overlapping the window."""
    C = kb.crops()
    bars = []
    lo, hi = y0 * DAYS, (y0 + n) * DAYS
    for e in tl.events:
        if e.end <= lo or e.start >= hi:
            continue
        bars.append({"crop_id": e.crop_id, "name": C[e.crop_id]["name"].split(" (")[0], "kind": e.kind,
                     "start_week": round((max(e.start, lo) - lo) / 7, 1), "end_week": round((min(e.end, hi) - lo) / 7, 1)})
    return bars


def _card(r, base_r, rk, ctx, facts, windy_weeks, rain_weeks, shown) -> dict:
    c = r["cand"]
    cid = c["id"]
    fam = kb.families().get(c["family"]) if c["family"] != "baseline" else None
    ind = r["ind"]
    bind = base_r["ind"]
    L = len(c["sequence"])
    show_years = min(2, L) if L >= 2 else 1
    y0 = L if r["tl"].days // DAYS >= 2 * L else 0  # show a cycle not cut at the window edge
    weekly = _weekly_cover(r["tl"], r["tl"].days // DAYS)
    wk_show = (weekly[y0:y0 + 2] if len(weekly) >= y0 + 2 else weekly[:2])
    bare_w = [w for yr in wk_show for w in range(52) if yr[w] < 0.30]
    overlap_windy = sum(1 for yr in wk_show for w in windy_weeks if yr[w] < 0.30) / max(len(wk_show), 1)
    overlap_rain = sum(1 for yr in wk_show for w in rain_weeks if yr[w] < 0.30) / max(len(wk_show), 1)

    # confidence per key indicator
    soil_ok = ctx["soil"].get("available") and ctx["soil"].get("source") != "soilgrids"
    flags = []
    if not soil_ok:
        flags.append("modelled soil map (SoilGrids 250 m), not a soil survey" if ctx["soil"].get("available")
                     else "no field soil survey; default soil assumed")
    st = facts.get("soil_test")  # the farmer's soil test (only when sent)
    conf = {}
    for k in ("erosion_water", "wind_exposure", "water_use", "yield_index", "soc_trend"):
        # soil carbon starts from organic matter: with the farmer's test it no longer rests on the mapped soil
        fl = [] if (st and "om_pct" in st and k == "soc_trend") else flags
        conf[k] = uncertainty.assess(samples=r["samples"].get(k) if k in r["samples"] else None,
                                     data_flags=fl, coarse_inputs=["weather ≈50 km"],
                                     applicability_ok=ctx["region"].get("exact", False) or k != "yield_index",
                                     applicability_note="planting calendar borrowed from another region", method="process")
    lvl_order = {"low": 0, "medium": 1, "high": 2}
    overall = min(conf.values(), key=lambda x: lvl_order[x["level"]])
    if r["rules"]["confidence_delta"] < 0 and overall["level"] != "low":
        overall = {**overall, "level": "medium" if overall["level"] == "high" else "low",
                   "reasons": overall["reasons"] + ["a rule flagged extra uncertainty"]}

    # benefits / trade-offs vs baseline (computed)
    def d(k):
        a, b = ind.get(k, {}).get("p50"), bind.get(k, {}).get("p50")
        return None if a is None or b is None else a - b
    deltas = {k: d(k) for k in ("soil_cover", "erosion_water", "wind_exposure", "water_use", "yield_index",
                                "soc_trend", "n_balance", "pest_break", "workload", "dry_year_regret", "bare_windy_days")}
    benefits, tradeoffs = [], []
    if not c["is_baseline"]:
        _delta_text(deltas, bind, benefits, tradeoffs)
    rules_fired = [{"message": x["message"], "message_es": x.get("message_es"), "rule": x["rule"], "sources": x["sources"]} for x in r["rules"]["fired"]]
    flags_out = [{"message": x["message"], "message_es": x.get("message_es"), "flag": x["flag"], "sources": x["sources"]} for x in r["rules"]["flags"]]
    texts = kb.rules().get("check_locally_texts", {}) or {}
    check = []
    for x in r["rules"]["check_locally"]:
        t = texts.get(x["item"])
        check.append({"id": x["item"], "text": (t.get("en") if isinstance(t, dict) else t) or x["message"],
                      "text_es": t.get("es") if isinstance(t, dict) else None})
    if fam:
        # family-level checks only when they concern a crop in this option (no pea/lentil test on corn-soybean)
        in_seq = {x for st in (r.get("cand") or {}).get("sequence") or [] for x in (st.get("cash"), st.get("cover"), st.get("double")) if x}
        for cl in fam.get("check_locally") or []:
            t = texts.get(cl)
            needs = t.get("crops") if isinstance(t, dict) else None
            if needs and not (set(needs) & in_seq):
                continue
            if t and cl not in {x["id"] for x in check}:
                check.append({"id": cl, "text": t.get("en") if isinstance(t, dict) else t,
                              "text_es": t.get("es") if isinstance(t, dict) else None})
    gaps = []
    if not soil_ok:
        gaps.append("No detailed soil survey for this field" + (": soil values come from a modelled soil map (SoilGrids 250 m)"
                                                                if ctx["soil"].get("available") else "") +
                    (f"; pH and organic matter come from {st['label']}" if st else ""))
    if (ctx.get("soil") or {}).get("source") == "soilgrids":
        gaps.append("Drainage class and wind erodibility are not available from SoilGrids; rules that need them did not run")
    yc = ind.get("yield_county") or {}
    if yc and all(v.get("available") for v in yc.values()):
        gaps.append("Yields in bu/ac are county statistics (USDA NASS, M2), not your field: your own yield records would be better")
    elif yc:
        miss = [kb.crops()[k]["name"] if k in kb.crops() else k for k, v in yc.items() if not v.get("available")]
        why_not = next((v.get("reason") for v in yc.values() if not v.get("available") and v.get("reason")), None)
        gaps.append("No county yield range for " + ", ".join(miss) + (f" ({why_not})" if why_not else "") +
                    ": shown as % of site potential, and profit uses the USDA ERS regional yield")
    else:
        gaps.append("Yield shown as % of site potential: " + ("no county yield model for these crops" if
                    (ctx["place"].get("country_code") or "").lower() == "us" else "no yield or price records connected for this country"))
    if any(s.get("cover") for s in c["sequence"]):
        gaps.append("Cover crop growth is modelled from temperature, not measured biomass")
    if any("rice" in (s["cash"], s.get("double")) for s in c["sequence"]):
        gaps.append("Flooded rice: water held in the paddy and lost to percolation is not modelled, so rice water use is underestimated")
    if not ctx["region"].get("exact"):
        gaps.append(ctx["region"].get("note") or "Calendar borrowed from another region")
    gaps.append("Weather is regional (≈50 km); your field can differ")
    why = []
    if c["is_baseline"]:
        bsrc = base_r.get("base_meta") or {}
        if bsrc.get("method") == "typical_regional":
            why.append(f"This is the {bsrc.get('label')}: the usual system here ({bsrc.get('source')}). "
                       "No crop map covers this field, so enter your own rotation to compare against it.")
        elif bsrc.get("method") == "user":
            why.append("This is the rotation you entered. It is always shown so you can compare.")
        else:
            src = "AAFC crop maps" if (ctx.get("crop_history") or {}).get("source") == "aafc" else "USDA crop maps"
            why.append(f"This is what you grow now, detected from {src}. It is always shown so you can compare.")
    elif c.get("is_custom"):
        why.append("This is an option you built. It is always shown so you can compare it with the others.")
        top = [x for x in rk["contributions"][cid][:2] if x["weight"] > 0.05]
        if top:
            why.append("It scores well on " + " and ".join(x["label"].lower() for x in top) + ", which you ranked high.")
    else:
        why.append((fam or {}).get("definition_en", ""))
        if c.get("note"):
            why.append(c["note"] + ".")
        top = [x for x in rk["contributions"][cid][:2] if x["weight"] > 0.05]
        if top:
            why.append("It scores well on " + " and ".join(x["label"].lower() for x in top) + ", which you ranked high.")
    evidence = []
    if fam:
        for b in fam.get("benefits") or []:
            evidence.append({"text": b.get("en"), "text_es": b.get("es"), "sources": b.get("sources", []), "kind": "study"})
    for x in rules_fired:
        evidence.append({"text": x["message"], "sources": x["sources"], "kind": "rule"})
    if st:
        sp = (ctx.get("soil") or {}).get("properties") or {}
        got_en, got_es, was_en, was_es = [], [], [], []
        if "ph" in st:
            got_en.append(f"soil pH {st['ph']:g}")
            got_es.append(f"pH del suelo {st['ph']:g}")
            if sp.get("ph1to1h2o_r") is not None:
                was_en.append(f"pH {sp['ph1to1h2o_r']:.1f}")
                was_es.append(f"pH {sp['ph1to1h2o_r']:.1f}")
        if "om_pct" in st:
            got_en.append(f"organic matter {st['om_pct']:g} %")
            got_es.append(f"materia orgánica {st['om_pct']:g} %")
            if sp.get("om_r") is not None:
                was_en.append(f"organic matter {sp['om_r']:.1f} %")
                was_es.append(f"materia orgánica {sp['om_r']:.1f} %")
        evidence.append({
            "text": (_cap(" and ".join(got_en)) + f" from {st['label']}, used for the pH and lime rules and the "
                     "soil-carbon start" + (f" instead of the mapped values ({', '.join(was_en)})" if was_en else "") + "."),
            "text_es": (_cap(" y ".join(got_es)) + f" de {st['label_es']}, usados en las reglas de pH y cal y en "
                        "el carbono inicial del suelo" + (f" en lugar de los valores del mapa ({', '.join(was_es)})"
                                                          if was_es else "") + "."),
            "sources": [], "kind": "farmer"})
    risks = list(tradeoffs) + [x["message"] for x in flags_out]
    if fam:
        risks += [x.get("en") for x in fam.get("risks") or []]
    risks = list(dict.fromkeys(r for r in risks if r))
    tis = (fam or {}).get("try_it_small") or {}
    srcs = kb.sources()
    used_src = {s for e in evidence for s in e["sources"]} | {s for x in flags_out for s in x["sources"]}
    out = {
        "id": cid, "name": "Your current rotation" if c["is_baseline"] else strategies.name_of(c["sequence"]),
        "rotation_label": strategies.name_of(c["sequence"]),
        "family": c["family"], "family_name": (fam or {}).get("name_en", "Current"), "family_name_es": (fam or {}).get("name_es", "Actual"),
        "is_baseline": c["is_baseline"], "sequence": c["sequence"], "shown": shown,
        "rank": rk["rank"][cid], "score": rk["scores"][cid], "match": round(rk["scores"][cid] * 100),
        "pareto": rk["pareto"][cid], "win_share": rk["win_share"][cid], "best_for_you": rk["top"] == cid,
        "indicators": ind, "deltas": deltas,
        "confidence": overall, "confidence_by_indicator": conf,
        "why": [w for w in why if w], "evidence": evidence, "benefits": benefits, "tradeoffs_risks": risks,
        "information_gaps": gaps, "check_locally": check,
        "try_it_small": {"example": tis.get("example_en"), "example_es": tis.get("example_es"), "design": tis.get("design"),
                         "measure": tis.get("measure"), "duration": tis.get("duration")} if tis else
                        {"example": "Keep this as your check strip when you test an alternative."},
        "flags": flags_out, "issues": r["issues"],
        "timeline": {"weekly_cover": wk_show, "bars": _weekly_crops(r["tl"], y0, 2),
                     "bare_weeks": len(bare_w) / max(len(wk_show), 1),
                     "bare_windy_overlap_weeks": overlap_windy, "bare_heavy_rain_overlap_weeks": overlap_rain},
        "sources": {k: srcs[k] for k in used_src if k in srcs},
        "model": {"id": "M6+M9", "name": "FarmSmart process simulator + rotation ranker", "kind": "process",
                  "weather_years": r["sim"]["S"]},
    }
    if c.get("is_custom"):
        out.update({"is_custom": True, "custom_name": c["custom_name"], "name": c["custom_name"],
                    "family_name": "Your own option", "family_name_es": "Tu propia opción",
                    "try_it_small": {"example": "Try it on one strip or one field first, next to your current rotation, "
                                                "and compare the two at harvest.",
                                     "example_es": "Pruébela primero en una franja o en un campo, junto a su rotación "
                                                   "actual, y compare las dos en la cosecha."}})
    return out


def _delta_text(dl, base, benefits, tradeoffs):
    def fmt(v, digits=1):
        return f"{abs(v):.{digits}f}"
    spec = [
        ("soil_cover", +1, "{v} more days a year with the soil covered", "{v} fewer days a year with the soil covered", 0),
        ("erosion_water", -1, "{v} t/ha less soil lost to water each year (RUSLE)", "{v} t/ha more soil lost to water each year (RUSLE)", 2),
        ("bare_windy_days", -1, "{v} fewer windy days on bare soil per year", "{v} more windy days on bare soil per year", 1),
        ("water_use", -1, "Uses {v} mm less water a year", "Uses {v} mm more water a year", 0),
        ("yield_index", +1, "Yield index {v} points higher", "Yield index {v} points lower", 1),
        ("soc_trend", +1, "Soil carbon trend {v} t C/ha/yr better", "Soil carbon trend {v} t C/ha/yr worse", 2),
        ("n_balance", +1, "About {v} kg N/ha/yr supplied by legumes", "{v} kg N/ha/yr less legume N", 0),
        ("dry_year_regret", -1, "{v} points less yield loss in dry years", "{v} points more yield loss in dry years", 1),
        ("workload", -1, "{v} fewer field passes a year", "{v} more field passes a year", 1),
    ]
    for k, sign, good, bad, digits in spec:
        v = dl.get(k)
        if v is None or abs(v) < (0.05 if digits else 0.5):
            continue
        txt = (good if v * sign > 0 else bad).format(v=fmt(v, digits))
        (benefits if v * sign > 0 else tradeoffs).append(txt)


def _binding_constraint(fits, excluded):
    reasons = {}
    for e in fits.get("excluded", []):
        for r in e["reasons"]:
            reasons[r["reason"]] = reasons.get(r["reason"], 0) + 1
    for e in excluded:
        reasons[e["reason"]] = reasons.get(e["reason"], 0) + 1
    if not reasons:
        return None
    top = max(reasons, key=reasons.get)
    return {"constraint": top, "count": reasons[top],
            "adjustments": ["Add equipment you could hire (custom hire)", "Add a local market or hay buyer",
                            "Allow a crop from your 'won't grow' list"]}
