"""M7 Climate futures & Climate Twins.

1. future_deltas(): NEX-GDDP-CMIP6 daily tasmax/tasmin/pr at the field's 0.25° cell for a set of CMIP6 models,
   historical 1995-2014 vs 2041-2060 (SSP2-4.5, SSP5-8.5), sampled years, fetched via NCCS THREDDS NCSS (CSV).
   Per model: monthly deltas (ΔTmax, ΔTmin in °C; precip ratio) plus raw-model annual indicators.
2. future_climate(): delta method on the field's NASA POWER 1991-2020 daily record -> 2041-2060 climate per model.
3. Analog search: z-scored Euclidean distance over 6 indicators against present-day cropland cells
   (data/reference/analog_candidates.parquet, built by scripts/build_analog_candidates.py), per model and for the
   ensemble median; model agreement; "novel climate" flag calibrated on present-day nearest-neighbour distances.
4. What is grown at the analog: FAOSTAT harvested area, country scale (data/reference/faostat_top_crops.json).
5. climate_twins(): JSON for the UI with evidence and confidence.

Every number comes from the downloaded data; missing pieces become None with a reason.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeout
from datetime import date
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd

from .. import evidence
from ..config import CACHE, DATA, PRECOMP, http
from ..ingest import power
from . import climate

MODEL_ID, MODEL_VERSION = "M7", "0.1.0"
THREDDS = "https://ds.nccs.nasa.gov/thredds"
NEX = "AMES/NEX/GDDP-CMIP6"

# Six CMIP6 models spanning the ensemble's equilibrium climate sensitivity (ECS, IPCC AR6 WG1 Table 7.SM.5):
# GFDL-ESM4 2.6, MIROC6 2.6, MPI-ESM1-2-HR 3.0, MRI-ESM2-0 3.2, ACCESS-CM2 4.7, UKESM1-0-LL 5.3.
DEFAULT_MODELS = ["ACCESS-CM2", "GFDL-ESM4", "MIROC6", "MPI-ESM1-2-HR", "MRI-ESM2-0", "UKESM1-0-LL"]
SCENARIOS = ["ssp245", "ssp585"]
HIST_PERIOD, FUT_PERIOD = (1995, 2014), (2041, 2060)
# Year samples. NCSS costs ≈6.5-10 s per model-year-variable file and the server sustains ≈1 file/s in parallel.
# "fast" (a new point) uses daily mean tas + pr and applies ΔT to both Tmax and Tmin: 6 models x 2 vars x 6 years
# = 72 files under a time budget. "full" (pilot precompute) uses tasmax/tasmin/pr and 5+5 years: 270 files.
SAMPLES = {
    "fast": {"hist": [2000, 2010], "fut": [2045, 2055], "vars": ["tas", "pr"], "budget_s": 80},
    "full": {"hist": [1995, 2000, 2005, 2010, 2014], "fut": [2041, 2045, 2050, 2055, 2060],
             "vars": ["tasmax", "tasmin", "pr"], "budget_s": 900},
}
WORKERS = 12
CAL360 = {"UKESM1-0-LL", "HadGEM3-GC31-LL", "HadGEM3-GC31-MM", "KACE-1-0-G"}
BASELINE = (1991, 2020)            # POWER baseline the deltas are applied to
PR_OFFSET_MM_DAY = 1 / 30          # 1 mm/month offset in the precip ratio, so dry months don't explode
PR_RATIO_CLAMP = (1 / 3, 3.0)
AGREE_KM = 500.0
NOVEL_EXCLUDE_KM = 300.0           # calibrating NN distances ignore candidates closer than this (same region)
NOVEL_PCTL = 95
DISTINCT_KM = 400.0                # analogs reported for one scenario are at least this far apart
MONTH_DAYS = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
# Analog features use monthly mean T2M and precipitation only: the POWER climatology T2M_MAX/T2M_MIN monthly
# values are period extremes, not means of daily max/min, so they are not comparable with a daily-derived field value.
FEATURES = ["tmean_ann", "t_warm", "t_cold", "log_precip_ann", "gdd10_m", "warm_pr_frac"]
FEATURE_LABELS = {
    "tmean_ann": "Mean annual temperature (°C)", "t_warm": "Mean temperature of the warmest month (°C)",
    "t_cold": "Mean temperature of the coldest month (°C)", "log_precip_ann": "Annual precipitation (log mm)",
    "gdd10_m": "Growing degree days base 10 °C from monthly means", "warm_pr_frac": "Share of precipitation in the 6 warmest months",
}
REF = DATA / "reference"
TW_CACHE = CACHE / "twins"
TW_CACHE.mkdir(parents=True, exist_ok=True)


# ----------------------------------------------------------------------------------------------- NEX-GDDP fetch
def _snap025(lat: float, lon: float) -> tuple[float, float]:
    """NEX-GDDP 0.25° cell centre (…125, …375, …625, …875)."""
    f = lambda v: math.floor(v * 4) / 4 + 0.125  # noqa: E731
    return round(f(lat), 3), round(f(lon), 3)


def _catalog(path: str) -> str:
    r = http().get(f"{THREDDS}/catalog/{NEX}/{path}/catalog.xml", timeout=60)
    r.raise_for_status()
    return r.text


@lru_cache(maxsize=256)
def _member(model: str, scenario: str) -> str | None:
    t = re.findall(r'catalogRef[^>]*title="([^"]+)"', _catalog(f"{model}/{scenario}"))
    return sorted(t)[0] if t else None


@lru_cache(maxsize=512)
def _files(model: str, scenario: str, member: str, var: str) -> dict[int, str]:
    """year -> file name, preferring the highest version suffix when several exist."""
    names = re.findall(r'name="([^"]+\.nc)"', _catalog(f"{model}/{scenario}/{member}/{var}"))
    best: dict[int, tuple[float, str]] = {}
    for n in names:
        m = re.search(r"_(\d{4})(?:_v(\d+)\.(\d+))?\.nc$", n)
        if not m:
            continue
        y = int(m.group(1))
        ver = float(f"{m.group(2)}.{m.group(3)}") if m.group(2) else 0.0
        if y not in best or ver > best[y][0]:
            best[y] = (ver, n)
    return {y: n for y, (v, n) in best.items()}


def _fetch_year(model: str, scenario: str, member: str, var: str, fname: str, year: int,
                lat: float, lon: float) -> dict[str, Any]:
    end_day = "30" if model in CAL360 else "31"     # 360-day calendars have no 31 December (HTTP 400)
    url = (f"{THREDDS}/ncss/grid/{NEX}/{model}/{scenario}/{member}/{var}/{fname}?var={var}"
           f"&latitude={lat}&longitude={lon}&time_start={year}-01-01T00:00:00Z&time_end={year}-12-{end_day}T23:59:59Z&accept=csv")
    last = None
    for attempt in range(3):
        try:
            r = http().get(url, timeout=180)
            if r.status_code == 200:
                break
            last = f"HTTP {r.status_code}"
            if r.status_code == 400 and end_day == "31":
                end_day = "30"
                url = url.replace(f"time_end={year}-12-31", f"time_end={year}-12-30")
                continue
        except Exception as e:  # network hiccup: retry politely
            last = repr(e)[:120]
        time.sleep(2 + 3 * attempt)
    else:
        return {"error": last, "url": url}
    rows = list(csv.reader(io.StringIO(r.text)))
    vals, months, cell = [], [], None
    for row in rows[1:]:
        if len(row) < 5 or not row[4]:
            continue
        months.append(int(row[0][5:7]))          # parse text: 360-day / noleap calendars break datetime parsing
        vals.append(float(row[4]))
        cell = (float(row[2]), float(row[3]))
    v = np.array(vals)
    if var == "pr":
        v = v * 86400.0                          # kg m-2 s-1 -> mm/day
    else:
        v = v - 273.15                           # K -> °C
    return {"values": v, "months": np.array(months), "cell": cell, "file": fname, "n": len(v)}


def _year_stats(var: str, d: dict) -> dict:
    """Per-year summaries from one model-year-variable daily series."""
    v, mo = d["values"], d["months"]
    monthly = [float(v[mo == m].mean()) if (mo == m).any() else None for m in range(1, 13)]
    out = {"monthly": monthly, "n_days": int(len(v))}
    scale = 365.25 / len(v) if len(v) else None
    if var == "tasmax":
        out["hot_days"] = float((v >= climate.HEAT_C).sum() * scale)
    if var in ("tasmin",):
        out["frost_days"] = float((v <= climate.FROST_C).sum() * scale)
    return out


def future_deltas(lat: float, lon: float, models: list[str] | None = None, scenarios: list[str] | None = None,
                  mode: str = "fast") -> dict:
    """Per-model monthly deltas (2041-2060 minus 1995-2014) at the field's NEX-GDDP 0.25° cell. Cached per point."""
    models = models or DEFAULT_MODELS
    scenarios = scenarios or SCENARIOS
    samp = SAMPLES[mode]
    glat, glon = _snap025(lat, lon)
    VARS = samp["vars"]
    key = f"{glat:.3f}_{glon:.3f}_{'-'.join(models)}_{'-'.join(scenarios)}_{mode}_{samp}"
    cp = TW_CACHE / f"deltas_{hashlib.sha1(key.encode()).hexdigest()[:10]}_{glat:.3f}_{glon:.3f}_{mode}.json"
    if cp.exists():
        js = json.loads(cp.read_text(encoding="utf-8"))
        if js.get("key") == key:
            js["from_cache"] = True
            return js
    t0 = time.time()
    problems: list[str] = []
    jobs = []

    def resolve(args):  # members and file names (catalog requests are cached on disk)
        m, s, v = args
        try:
            mem = _member(m, s)
            return args, mem, (_files(m, s, mem, v) if mem else {})
        except Exception as e:
            return args, None, repr(e)[:120]
    combos = [(m, s, v) for m in models for s in ["historical", *scenarios] for v in VARS]
    with ThreadPoolExecutor(WORKERS) as ex:
        resolved = list(ex.map(resolve, combos))
    for (m, s, v), mem, files in resolved:          # jobs ordered model by model so whole models finish first
        if not isinstance(files, dict) or not mem:
            problems.append(f"{m} {s} {v}: catalog not resolved ({files})")
            continue
        for y in (samp["hist"] if s == "historical" else samp["fut"]):
            if y in files:
                jobs.append((m, s, mem, v, files[y], y))
            else:
                problems.append(f"{m} {s} {v} {y}: no file in catalog")
    deadline = t0 + samp["budget_s"]
    res, skipped = [], 0
    ex = ThreadPoolExecutor(WORKERS)
    futs = {ex.submit(_fetch_year, *j, glat, glon): j for j in jobs}
    try:
        for fu in as_completed(futs, timeout=max(1.0, deadline - time.time())):
            try:
                res.append((futs[fu], fu.result()))
            except Exception as e:  # parse errors etc.
                res.append((futs[fu], {"error": repr(e)[:120]}))
    except FuturesTimeout:
        for fu in futs:
            if not fu.done():
                fu.cancel()
                skipped += 1
        problems.append(f"time budget {samp['budget_s']} s reached: {skipped} of {len(jobs)} files not fetched")
    ex.shutdown(wait=False, cancel_futures=True)

    data: dict = {}
    cell = None
    files_used = []
    for (m, s, mem, v, fname, y), d in res:
        if "error" in d:
            problems.append(f"{m} {s} {v} {y}: {d['error']}")
            continue
        cell = cell or d["cell"]
        files_used.append(fname)
        data.setdefault(m, {}).setdefault(s, {}).setdefault(v, {})[y] = _year_stats(v, d)

    def mean_monthly(block):
        return np.nanmean(np.array([yr["monthly"] for yr in block.values()], dtype=float), axis=0)

    def tx_tn(mm):  # tas-only sampling: the same ΔT for Tmax and Tmin
        return (mm["tasmax"], mm["tasmin"]) if "tasmax" in mm else (mm["tas"], mm["tas"])

    per_model = {}
    for m in models:
        md = data.get(m, {})
        hist = md.get("historical", {})
        if not all(len(hist.get(v, {})) == len(samp["hist"]) for v in VARS):
            problems.append(f"{m}: historical sample incomplete; model dropped")
            continue
        h = {v: mean_monthly(hist[v]) for v in VARS}
        entry = {"member": _member(m, "historical"), "historical": _raw_indicators(h, hist), "scenarios": {}}
        for s in scenarios:
            fut = md.get(s, {})
            if not all(len(fut.get(v, {})) == len(samp["fut"]) for v in VARS):
                problems.append(f"{m} {s}: future sample incomplete; scenario skipped for this model")
                continue
            f = {v: mean_monthly(fut[v]) for v in VARS}
            ratio = np.clip((f["pr"] + PR_OFFSET_MM_DAY) / (h["pr"] + PR_OFFSET_MM_DAY), *PR_RATIO_CLAMP)
            (fx, fn), (hx, hn) = tx_tn(f), tx_tn(h)
            entry["scenarios"][s] = {
                "d_tmax_c": np.round(fx - hx, 3).tolist(), "d_tmin_c": np.round(fn - hn, 3).tolist(),
                "pr_ratio": np.round(ratio, 4).tolist(), "raw_future": _raw_indicators(f, fut),
                "years": sorted(fut["pr"].keys()),
            }
        per_model[m] = entry
    out = {
        "key": key, "lat": lat, "lon": lon, "nex_cell": cell, "requested_cell": [glat, glon], "mode": mode,
        "variables": VARS, "historical_period": list(HIST_PERIOD), "future_period": list(FUT_PERIOD),
        "sample_years": {"hist": samp["hist"], "fut": samp["fut"]}, "scenarios": scenarios, "models": per_model,
        "n_files": len(files_used), "n_files_planned": len(jobs), "problems": problems,
        "fetch_seconds": round(time.time() - t0, 1), "retrieved": date.today().isoformat(), "from_cache": False,
    }
    if per_model and not skipped:     # a budget-cut result is not cached; the HTTP cache keeps the files fetched
        cp.write_text(json.dumps(out), encoding="utf-8")
    return out


def _raw_indicators(monthly: dict[str, np.ndarray], block: dict) -> dict:
    """Annual indicators from raw (bias-corrected, downscaled) model output: diagnostics only."""
    pr = monthly["pr"]
    if "tasmax" in monthly:
        tx, tn = monthly["tasmax"], monthly["tasmin"]
        tm = (tx + tn) / 2
        hot = round(float(np.mean([yr["hot_days"] for yr in block["tasmax"].values()])), 1)
        frost = round(float(np.mean([yr["frost_days"] for yr in block["tasmin"].values()])), 1)
        txw, tnc = round(float(tx.max()), 2), round(float(tn.min()), 2)
    else:
        tm, hot, frost, txw, tnc = monthly["tas"], None, None, None, None   # not sampled in fast mode
    return {"tmean_c": round(float(tm.mean()), 2), "t_warm_c": round(float(tm.max()), 2),
            "t_cold_c": round(float(tm.min()), 2), "tmax_warm_c": txw, "tmin_cold_c": tnc,
            "precip_mm": round(float((pr * MONTH_DAYS).sum()), 0), "hot_days_ge35": hot, "frost_days": frost}


# --------------------------------------------------------------------------------------- delta method on POWER
def _baseline_df(lat: float, lon: float) -> pd.DataFrame:
    df = power.daily(lat, lon)
    yrs = [y for y in climate.full_years(df) if BASELINE[0] <= y <= BASELINE[1]]
    return df[df.index.year.isin(yrs)][["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR"]].copy()


def apply_deltas(base: pd.DataFrame, d_tmax: list, d_tmin: list, pr_ratio: list) -> pd.DataFrame:
    mi = base.index.month.values - 1
    dx, dn, rr = np.array(d_tmax)[mi], np.array(d_tmin)[mi], np.array(pr_ratio)[mi]
    out = base.copy()
    out["T2M_MAX"] = base["T2M_MAX"] + dx
    out["T2M_MIN"] = base["T2M_MIN"] + dn
    out["T2M"] = base["T2M"] + (dx + dn) / 2
    out["PRECTOTCORR"] = base["PRECTOTCORR"] * rr
    return out


def daily_indicators(df: pd.DataFrame) -> dict:
    """Display indicators from a daily POWER-like frame (observed or delta-shifted)."""
    yrs = sorted(set(df.index.year))
    mon = df.groupby(df.index.month)
    tmax_m, tmin_m = mon["T2M_MAX"].mean(), mon["T2M_MIN"].mean()
    g = climate.gdd(df)
    fr = climate.frost_dates(df, yrs)
    return {
        "tmean_c": round(float(df["T2M"].groupby(df.index.year).mean().mean()), 2),
        "tmax_warm_c": round(float(tmax_m.max()), 2),
        "tmin_cold_c": round(float(tmin_m.min()), 2),
        "precip_mm": round(float(df["PRECTOTCORR"].groupby(df.index.year).sum().mean()), 0),
        "gdd10": round(float(g.groupby(df.index.year).sum().mean()), 0),
        "hot_days_ge35": round(float((df["T2M_MAX"] >= climate.HEAT_C).groupby(df.index.year).sum().mean()), 1),
        "frost_free_days": fr["frost_free_days_median"],
        "frost_free_years": fr["frost_free_years"],
    }


def monthly_normals(df: pd.DataFrame) -> dict[str, np.ndarray]:
    mon = df.groupby(df.index.month)
    return {"t": mon["T2M"].mean().values, "tmax": mon["T2M_MAX"].mean().values,
            "tmin": mon["T2M_MIN"].mean().values, "pr": mon["PRECTOTCORR"].mean().values}


def analog_vector(t, pr) -> np.ndarray:
    """The 6 analog features from monthly mean T2M (°C) and precipitation (mm/day) normals.
    Same function for the field and for every candidate."""
    t, pr = np.asarray(t, float), np.asarray(pr, float)
    p_mon = pr * MONTH_DAYS
    p_ann = p_mon.sum()
    warm6 = np.argsort(t)[-6:]
    return np.array([t.mean(), t.max(), t.min(), math.log(max(p_ann, 1.0)),
                     float((np.clip(t - 10, 0, None) * MONTH_DAYS).sum()), float(p_mon[warm6].sum() / max(p_ann, 1e-6))])


# ------------------------------------------------------------------------------------------------- analog set
def _hav_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(np.asarray(lon2) - lon1) / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


@lru_cache(maxsize=1)
def candidates() -> dict:
    df = pd.read_parquet(REF / "analog_candidates.parquet")
    meta = json.loads((REF / "analog_candidates.meta.json").read_text(encoding="utf-8"))
    cols = lambda p: [f"{p}{m:02d}" for m in range(1, 13)]  # noqa: E731
    X = np.array([analog_vector(r[cols("t")], r[cols("pr")])
                  for _, r in df.iterrows()])
    mu, sd = X.mean(0), X.std(0)
    Z = (X - mu) / sd
    thr, nn = _novel_threshold(Z, df.lat.values, df.lon.values)
    return {"df": df.reset_index(drop=True), "X": X, "Z": Z, "mu": mu, "sd": sd, "meta": meta,
            "novel_threshold": thr, "nn_stats": nn}


def _dist(Z: np.ndarray, z: np.ndarray) -> np.ndarray:
    """RMS z-score difference per feature (z-scored Euclidean / sqrt(n))."""
    return np.sqrt(((Z - z) ** 2).mean(1))


def _novel_threshold(Z, lat, lon) -> tuple[float, dict]:
    cp = TW_CACHE / f"novel_thr_{'-'.join(FEATURES)}_{len(Z)}_{NOVEL_EXCLUDE_KM:.0f}_{NOVEL_PCTL}.json"
    if cp.exists():
        js = json.loads(cp.read_text(encoding="utf-8"))
        return js["threshold"], js
    nn = np.empty(len(Z))
    for i in range(len(Z)):
        d = _dist(Z, Z[i])
        far = _hav_km(lat[i], lon[i], lat, lon) > NOVEL_EXCLUDE_KM
        nn[i] = d[far].min() if far.any() else np.nan
    js = {"threshold": float(np.nanpercentile(nn, NOVEL_PCTL)), "p50": float(np.nanmedian(nn)),
          "p90": float(np.nanpercentile(nn, 90)), "n": int(np.isfinite(nn).sum()),
          "definition": f"for every present-day cropland cell, the climate distance to its nearest cell more than "
                        f"{NOVEL_EXCLUDE_KM:.0f} km away; threshold = P{NOVEL_PCTL}"}
    cp.write_text(json.dumps(js), encoding="utf-8")
    return js["threshold"], js


def _place(row) -> dict:
    return {"lat": float(row.lat), "lon": float(row.lon), "country": row.country, "iso3": row.iso3,
            "admin1": row.admin1, "near_town": row.near_town, "near_town_km": float(row.near_town_km),
            "cropland_share_pct": round(float(row.crop_share_pct), 1)}


def nearest(z: np.ndarray, k: int = 5, distinct_km: float | None = None, from_latlon=None) -> list[dict]:
    C = candidates()
    d = _dist(C["Z"], z)
    order = np.argsort(d)
    out = []
    for i in order:
        r = C["df"].iloc[i]
        if distinct_km and any(_hav_km(o["lat"], o["lon"], r.lat, r.lon) < distinct_km for o in out):
            continue
        rec = _place(r) | {"distance": round(float(d[i]), 3), "idx": int(i)}
        if from_latlon:
            rec["km_from_field"] = round(float(_hav_km(from_latlon[0], from_latlon[1], r.lat, r.lon)), 0)
        out.append(rec)
        if len(out) >= k:
            break
    return out


def _zscore(vec: np.ndarray) -> np.ndarray:
    C = candidates()
    return (vec - C["mu"]) / C["sd"]


@lru_cache(maxsize=1)
def _crops() -> dict:
    return json.loads((REF / "faostat_top_crops.json").read_text(encoding="utf-8"))


def crops_at(place: dict, n: int = 5) -> dict:
    fs = _crops()
    C = candidates()
    iso_n3 = str(C["df"].iloc[place["idx"]].iso_n3).lstrip("0") if "idx" in place else None
    rec = fs["countries"].get(iso_n3 or "")
    if not rec:
        return {"scale": "country", "country": place.get("country"), "top": None,
                "reason": f"no FAOSTAT harvested-area record matched country code {iso_n3!r}"}
    return {"scale": "country", "label": "country value (FAOSTAT, national harvested area)", "country": rec["name"],
            "years": fs["years"], "total_harvested_ha": rec["total_harvested_ha"], "top": rec["top"][:n]}


# ----------------------------------------------------------------------------------------------- main output
def _summ(vals: list) -> dict:
    v = [x for x in vals if x is not None]
    if not v:
        return {"median": None, "min": None, "max": None, "n": 0}
    return {"median": round(float(np.median(v)), 2), "min": round(float(min(v)), 2),
            "max": round(float(max(v)), 2), "n": len(v)}


def _agreement(points: dict[str, dict]) -> dict:
    """How many models' top analog fall within AGREE_KM of a common cluster centre (one of the top analogs)."""
    names = list(points)
    best = (0, None, [])
    for a in names:
        members = [b for b in names if _hav_km(points[a]["lat"], points[a]["lon"], points[b]["lat"], points[b]["lon"]) <= AGREE_KM]
        if len(members) > best[0]:
            best = (len(members), a, members)
    n, centre, members = best
    return {"n_agree": n, "n_models": len(names), "radius_km": AGREE_KM,
            "cluster_centre": ({k: points[centre][k] for k in ("lat", "lon", "country", "admin1", "near_town")}
                               if centre else None), "models_in_cluster": members}


def climate_twins(lat: float, lon: float, models: list[str] | None = None, mode: str = "fast") -> dict:
    t0 = time.time()
    bag = evidence.EvidenceBag()
    reasons: list[str] = []
    base = _baseline_df(lat, lon)
    ev_power = bag.add(evidence.make("power", power.footprint(lat, lon),
                                     obs=(date(BASELINE[0], 1, 1), date(BASELINE[1], 12, 31)), units="°C, mm",
                                     transformation="1991-2020 daily baseline; delta method adds NEX-GDDP monthly change"))
    deltas = future_deltas(lat, lon, models=models, mode=mode)
    ev_nex = bag.add(evidence.make(
        "nex_gddp", f"NEX-GDDP 0.25° cell centred {deltas['nex_cell']}", obs=(date(HIST_PERIOD[0], 1, 1), date(FUT_PERIOD[1], 12, 31)),
        units="K, kg m-2 s-1", qa=deltas["problems"][:10],
        transformation=f"monthly ΔTmax/ΔTmin and precip ratio, {FUT_PERIOD[0]}-{FUT_PERIOD[1]} vs {HIST_PERIOD[0]}-{HIST_PERIOD[1]}; "
                       f"sampled years {deltas['sample_years']}; models {list(deltas['models'])}"))
    C = candidates()
    ev_cand = bag.add(evidence.make("power_clim", "present-day cropland cells worldwide (1°)",
                                    obs=tuple(date(int(x[:4]), 1, 1) if x else None for x in C["meta"]["climate_period"]),
                                    transformation="monthly normals -> 6 analog indicators, z-scored"))
    ev_gaez = bag.add(evidence.make("gaez_lc", "global, aggregated to 1°",
                                    transformation=f"cells with ≥{C['meta']['min_crop_share_pct']}% cropland kept as analog candidates"))
    ev_fao = bag.add(evidence.make("faostat", "country", obs=(date(_crops()["years"][0], 1, 1), date(_crops()["years"][1], 12, 31)),
                                   units="ha harvested", transformation="mean of years; top items by area; FAOSTAT aggregates removed"))

    # baseline (observed) indicators and the field's present-day analog self-check
    baseline = daily_indicators(base)
    pdf = power.daily(lat, lon)
    p_yrs = [y for y in climate.full_years(pdf) if int(C["meta"]["climate_period"][0][:4]) <= y <= int(C["meta"]["climate_period"][1][:4])]
    present = pdf[pdf.index.year.isin(p_yrs)]
    mn = monthly_normals(present)
    z_present = _zscore(analog_vector(mn["t"], mn["pr"]))
    self_match = nearest(z_present, k=1, from_latlon=(lat, lon))[0]
    self_match.pop("idx", None)

    scen_out = {}
    nmod = len(deltas["models"])
    if nmod == 0:
        reasons.append("No NEX-GDDP model series could be fetched; no future climate.")
    for s in deltas["scenarios"]:
        per_model, zs, tops = {}, {}, {}
        for m, e in deltas["models"].items():
            sc = e["scenarios"].get(s)
            if not sc:
                continue
            fut = apply_deltas(base, sc["d_tmax_c"], sc["d_tmin_c"], sc["pr_ratio"])
            mnf = monthly_normals(fut)
            z = _zscore(analog_vector(mnf["t"], mnf["pr"]))
            zs[m] = z
            top = nearest(z, k=5, distinct_km=DISTINCT_KM, from_latlon=(lat, lon))
            tops[m] = top
            per_model[m] = {"indicators": daily_indicators(fut),
                            "annual_d_tmax_c": round(float(np.mean(sc["d_tmax_c"])), 2),
                            "annual_d_tmin_c": round(float(np.mean(sc["d_tmin_c"])), 2),
                            "annual_pr_ratio": round(float(np.average(sc["pr_ratio"], weights=mn["pr"] * MONTH_DAYS)), 3),
                            "top_analog": {k: v for k, v in top[0].items() if k != "idx"},
                            "novel": bool(top[0]["distance"] > C["novel_threshold"])}
        if not per_model:
            scen_out[s] = {"available": False, "reason": "no model had a complete future sample"}
            continue
        keys = list(per_model[next(iter(per_model))]["indicators"])
        ind = {k: _summ([pm["indicators"][k] for pm in per_model.values()]) for k in keys}
        # ensemble-median climate -> consensus analogs
        z_med = np.median(np.array(list(zs.values())), axis=0)
        cons = nearest(z_med, k=3, distinct_km=DISTINCT_KM, from_latlon=(lat, lon))
        for a in cons:
            a["models_with_analog_within_km"] = sorted(
                m for m, tl in tops.items() if any(_hav_km(a["lat"], a["lon"], t["lat"], t["lon"]) <= AGREE_KM for t in tl))
            a["n_models_agree"] = len(a["models_with_analog_within_km"])
            a["crops"] = crops_at(a)
            a["novel"] = bool(a["distance"] > C["novel_threshold"])
            a.pop("idx", None)
        agree = _agreement({m: pm["top_analog"] for m, pm in per_model.items()})
        n_novel = sum(pm["novel"] for pm in per_model.values())
        scen_out[s] = {
            "available": True, "n_models": len(per_model), "indicators": ind,
            "deltas": {"annual_d_tmax_c": _summ([pm["annual_d_tmax_c"] for pm in per_model.values()]),
                       "annual_d_tmin_c": _summ([pm["annual_d_tmin_c"] for pm in per_model.values()]),
                       "annual_pr_ratio": _summ([pm["annual_pr_ratio"] for pm in per_model.values()])},
            "analogs": cons, "agreement": agree,
            "novel_climate": {"flag": bool(cons[0]["distance"] > C["novel_threshold"]),
                              "best_distance": cons[0]["distance"], "threshold": round(C["novel_threshold"], 3),
                              "models_novel": n_novel},
            "per_model": per_model,
        }

    # confidence
    years_n = len(SAMPLES[mode]["hist"])
    if mode == "fast":
        reasons.append("Fast sampling uses daily mean temperature (tas) only, so the same monthly warming is added to Tmax and Tmin.")
    level = "medium"
    for s, so in scen_out.items():
        if not so.get("available"):
            continue
        a = so["agreement"]
        reasons.append(f"{s.upper()}: {a['n_agree']} of {a['n_models']} models put their closest analog within "
                       f"{AGREE_KM:.0f} km of a common place ({(a['cluster_centre'] or {}).get('admin1')}, "
                       f"{(a['cluster_centre'] or {}).get('country')}).")
        if so["novel_climate"]["flag"]:
            reasons.append(f"{s.upper()}: novel climate — best analog distance {so['novel_climate']['best_distance']} exceeds "
                           f"the present-day P{NOVEL_PCTL} threshold {so['novel_climate']['threshold']}.")
    avail = [so for so in scen_out.values() if so.get("available")]
    fracs = [so["agreement"]["n_agree"] / so["agreement"]["n_models"] for so in avail]
    novel_any = any(so["novel_climate"]["flag"] for so in avail)
    if not avail or nmod < 3 or novel_any or min(fracs) < 0.5:
        level = "low"
    elif min(fracs) >= 2 / 3 and nmod >= 5 and years_n >= 4:
        level = "high"
    reasons.append(f"{nmod} CMIP6 models; {years_n} sampled years per period per model "
                   f"({'fast sampling for a new point' if mode == 'fast' else 'full sampling'}); "
                   "few sampled years let year-to-year weather leak into the monthly deltas.")
    reasons.append("Baseline is the NASA POWER regional value (≈50 km); future = baseline + model change (delta method).")
    reasons.append(f"Present-day self-check: the field's own 2001-2025 climate matches a cropland cell "
                   f"{self_match.get('km_from_field'):.0f} km away (distance {self_match['distance']}).")
    reasons.append("Crops at the analog are national FAOSTAT harvested areas (country scale), not what grows at that exact spot.")
    if deltas["problems"]:
        reasons.append(f"{len(deltas['problems'])} data problems (e.g. {deltas['problems'][0]}).")

    return {
        "model_id": MODEL_ID, "model_version": MODEL_VERSION, "kind": "process",
        "field": {"lat": lat, "lon": lon},
        "periods": {"baseline": list(BASELINE), "model_historical": list(HIST_PERIOD), "future": list(FUT_PERIOD),
                    "analog_present_day": C["meta"]["climate_period"]},
        "baseline": {"indicators": baseline, "scale_label": "regional value (≈50 km, NASA POWER)", "evidence_id": ev_power},
        "present_day_self_match": self_match,
        "scenarios": scen_out,
        "indicator_units": {"tmean_c": "°C", "tmax_warm_c": "°C", "tmin_cold_c": "°C", "precip_mm": "mm/yr",
                            "gdd10": "°C·day/yr (base 10, cap 30)", "hot_days_ge35": "days/yr (Tmax ≥ 35 °C)",
                            "frost_free_days": "days (median last spring to first fall frost)"},
        "analog_method": {"features": [FEATURE_LABELS[f] for f in FEATURES],
                          "distance": "RMS of z-scored feature differences (z by the global cropland candidate spread)",
                          "candidates": len(C["df"]), "novel_threshold": C["nn_stats"],
                          "agreement_radius_km": AGREE_KM, "distinct_analog_km": DISTINCT_KM},
        "sampling": {"mode": mode, "years": deltas["sample_years"], "variables": deltas["variables"],
                     "n_files": deltas["n_files"], "n_files_planned": deltas["n_files_planned"],
                     "fetch_seconds": deltas["fetch_seconds"], "from_cache": deltas["from_cache"],
                     "nex_cell": deltas["nex_cell"], "problems": deltas["problems"]},
        "evidence_ids": {"power": ev_power, "nex_gddp": ev_nex, "candidates": ev_cand, "cropland_mask": ev_gaez,
                         "crops": ev_fao},
        "evidence": bag.dump(),
        "confidence": {"level": level, "reasons": reasons},
        "runtime_s": round(time.time() - t0, 1),
    }


def precompute(name: str, lat: float, lon: float, mode: str = "full") -> dict:
    out = climate_twins(lat, lon, mode=mode)
    (PRECOMP / f"twins_{name}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    return out
