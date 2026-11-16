"""Weather-driven disease risk at a field (wave U9, B2).

Port of the published UW-Madison crop disease forecasting models (MIT licence):
  * Crop Disease Forecasting Tool, https://github.com/UW-Madison-DSI/crop_disease_forecasting_tool
    commit 1071967fcaffedefcef06f9febf37f9ace86553e (2025-07-03),
    materials/model_surfaces/surfaces-plot.py (last changed in 3ff3d9e576da0e84384bae350540cc622ecbb2ff):
    tar spot LR4/LR6 intercepts and slopes, gray leaf spot, white mold dryland (first logit) and irrigated logits;
    app/functions/7_data_transformations.R: risk classes.
  * The tool's model API (README "API to our models"), https://github.com/UW-Madison-DSI/ag_forecasting_api
    commit 91c9de187e1215165c585dfb662ae9368e5fdc84 (2026-05-08):
    api/models/risk_models.py (full production models: tar spot ensemble with night RH>=90 hours, the three-logit
    dryland white mold ensemble, inactive rules and class thresholds), api/utils/math_helpers.py (logit sign
    convention), api/services/ibm_service.py + api/config/constants.py (hourly -> daily aggregation, night =
    hours outside 07-19 counted to the next date, rolling windows 30/21/14 days, 15 °C inactive threshold).
  The coefficients below are copied from those files unchanged.

Inputs: NASA POWER hourly T2M, RH2M, T2MDEW, WS2M (LST) at the field's POWER cell (≈50 km), instead of the on-farm
or Wisconet station the models were fitted on. The output is the share of days in the susceptible window whose
weather favours the disease. It is not a yield-loss number and does not say the disease is present.
"""
from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import numpy as np
import pandas as pd

from ..config import CACHE, USER_AGENT
from ..ingest import power

DISEASE_VERSION = "u9.1"
CACHE_DIR = CACHE / "disease"
HOURLY_PARAMS = "T2M,RH2M,T2MDEW,WS2M"
FETCH_START = (5, 15)   # mm, dd: 30-day windows need ~45 days of lead-in before July 1
FETCH_END = (9, 15)
# Susceptible window in calendar days. The models apply at corn V10-R3 (tar spot, gray leaf spot) and soybean R1-R3
# with rows nearly closed (white mold) (Purdue Pest&Crop 2024 on the Crop Risk Tool). Mapping those stages to
# July 1 - August 15 for the US Midwest is a FarmSmart assumption, shown to the user.
WINDOW = ((7, 1), (8, 15))
FIRST_YEAR = 2001        # POWER hourly meteorology starts 2001
N_YEARS = 15

REPO = "https://github.com/UW-Madison-DSI/crop_disease_forecasting_tool"
REPO_COMMIT = "1071967fcaffedefcef06f9febf37f9ace86553e"
API_REPO = "https://github.com/UW-Madison-DSI/ag_forecasting_api"
API_COMMIT = "91c9de187e1215165c585dfb662ae9368e5fdc84"

# Valid region: the models were fitted on US Midwest / Great Lakes fields and stations (Wisconsin-led data;
# tar spot: Webster et al. 2023 Sci Rep 13:17064). FarmSmart keeps them to these states.
VALID_STATES = {"17": "Illinois", "18": "Indiana", "19": "Iowa", "26": "Michigan", "27": "Minnesota",
                "39": "Ohio", "55": "Wisconsin"}

INACTIVE_C = 15.0  # api/config/constants.py TEMP_INACTIVE_THRESHOLD_C


def _logistic(x):
    return np.exp(x) / (1 + np.exp(x))


# ---- the models (api/models/risk_models.py @ 91c9de1; intercept - Σ coef·x per math_helpers.compute_logit) ----
def tarspot(mean_at_30d, max_rh_30d, rh90_night_14d):
    p4 = _logistic(32.06987 - (0.89471 * mean_at_30d + 0.14373 * max_rh_30d))
    p6 = _logistic(20.35950 - (0.91093 * mean_at_30d + 0.29240 * rh90_night_14d))
    return (p4 + p6) / 2


def gray_leaf_spot(min_at_21d, min_dp_30d):
    return _logistic(-2.9467 - (0.03729 * min_at_21d) + (0.6534 * min_dp_30d))


def whitemold_dryland(max_at_30d, max_rh_30d, max_ws_30d):
    return (_logistic(-0.47 * max_at_30d - 1.01 * max_ws_30d + 16.65)
            + _logistic(-0.68 * max_at_30d + 17.19)
            + _logistic(-0.56 * max_at_30d + 0.10 * max_rh_30d - 0.75 * max_ws_30d + 8.20)) / 3


def whitemold_irrigated(max_at_30d, max_rh_30d, rows_30in: bool):
    base = (0.65 * max_at_30d) + (0.38 * max_rh_30d) - 52.65
    return _logistic(base - 2.38) if rows_30in else _logistic(base)


MODELS = [
    dict(id="tar_spot", crop="corn", name_en="Tar spot (Tarspotter)", name_es="Mancha de asfalto (Tarspotter)",
         inputs=["30-day mean air temperature (°C)", "30-day mean of daily maximum relative humidity (%)",
                 "14-day mean of night hours with relative humidity ≥ 90%"],
         thresholds={"low_below": 0.20, "high_above": 0.35, "inactive_if": "30-day mean temperature < 15 °C"},
         stages="corn V10–R3", pathogen="tar_spot",
         paper="Webster et al. 2023, Sci Rep 13:17064 (doi:10.1038/s41598-023-44338-6)"),
    dict(id="gray_leaf_spot", crop="corn", name_en="Gray leaf spot", name_es="Mancha gris de la hoja",
         inputs=["21-day mean of daily minimum air temperature (°C)", "30-day mean of daily minimum dew point (°C)"],
         thresholds={"low_below": 0.20, "high_above": 0.60, "inactive_if": "21-day mean minimum temperature < 5 °C "
                                                                         "or 30-day mean temperature < 15 °C"},
         stages="corn V10–R3", pathogen="gray_leaf_spot", paper=None),
    dict(id="white_mold_dryland", crop="soybean", name_en="White mold, dryland (Sporecaster)",
         name_es="Moho blanco, secano (Sporecaster)",
         inputs=["30-day mean of daily maximum air temperature (°C)", "30-day mean of daily maximum relative humidity (%)",
                 "30-day mean of daily maximum wind speed (m/s)"],
         thresholds={"low_below": 0.20, "high_above": 0.35, "inactive_if": "30-day mean maximum temperature < 15 °C"},
         stages="soybean R1–R3 with rows nearly closed", pathogen="sclerotinia",
         paper="Willbur et al. 2018, Phytopathology (Sporecaster apothecia models)"),
    dict(id="white_mold_irrigated_30in", crop="soybean", name_en="White mold, irrigated, 30-inch rows (Sporecaster)",
         name_es="Moho blanco, con riego, surcos de 30 pulgadas (Sporecaster)",
         inputs=["30-day mean of daily maximum air temperature (°C)", "30-day mean of daily maximum relative humidity (%)"],
         thresholds={"low_below": 0.05, "high_above": 0.10, "inactive_if": "30-day mean maximum temperature < 15 °C"},
         stages="soybean R1–R3 with rows nearly closed", pathogen="sclerotinia",
         paper="Willbur et al. 2018, Phytopathology (Sporecaster apothecia models)"),
    dict(id="white_mold_irrigated_15in", crop="soybean", name_en="White mold, irrigated, 15-inch rows (Sporecaster)",
         name_es="Moho blanco, con riego, surcos de 15 pulgadas (Sporecaster)",
         inputs=["30-day mean of daily maximum air temperature (°C)", "30-day mean of daily maximum relative humidity (%)"],
         thresholds={"low_below": 0.05, "high_above": 0.10, "inactive_if": "30-day mean maximum temperature < 15 °C"},
         stages="soybean R1–R3 with rows nearly closed", pathogen="sclerotinia",
         paper="Willbur et al. 2018, Phytopathology (Sporecaster apothecia models)"),
]


# ---- weather ----------------------------------------------------------------------------------------------------
def _fetch_hourly(glat: float, glon: float, start: date, end: date) -> pd.DataFrame:
    import requests
    params = dict(parameters=HOURLY_PARAMS, community="AG", longitude=glon, latitude=glat, start=f"{start:%Y%m%d}",
                  end=f"{end:%Y%m%d}", format="JSON", **{"time-standard": "LST"})
    r = requests.get(f"{power.BASE}/hourly/point", params=params, timeout=180, headers={"User-Agent": USER_AGENT})
    r.raise_for_status()
    p = r.json()["properties"]["parameter"]
    df = pd.DataFrame(p)
    df.index = pd.to_datetime(df.index, format="%Y%m%d%H")
    return df.replace(-999.0, np.nan).astype(float)


def season_hourly(lat: float, lon: float, year: int) -> pd.DataFrame | None:
    """Hourly POWER weather May 15 - Sep 15 of `year` at the field's POWER cell. Complete past seasons are kept as
    parquet; the running season is fetched fresh (POWER hourly lags a few days)."""
    glat, glon = power._grid_key(lat, lon)
    start, end = date(year, *FETCH_START), date(year, *FETCH_END)
    latest = power._latest_end()
    if start > latest:
        return None
    complete = end <= latest - timedelta(days=5)
    pq = CACHE_DIR / f"power_hourly_{glat:.2f}_{glon:.3f}_{year}.parquet"
    if complete and pq.exists():
        return pd.read_parquet(pq)
    df = _fetch_hourly(glat, glon, start, min(end, latest))
    if complete:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        df.to_parquet(pq)
    return df


def daily_inputs(h: pd.DataFrame) -> pd.DataFrame:
    """Hourly -> daily model inputs, as ag_forecasting_api ibm_service._build_daily (night = hours outside 07-19,
    counted to the date 4 h later; rolling means need the full window)."""
    h = h.sort_index()
    d = pd.DataFrame({
        "t_mean": h["T2M"].resample("D").mean(),
        "t_min": h["T2M"].resample("D").min(),
        "t_max": h["T2M"].resample("D").max(),
        "dp_min": h["T2MDEW"].resample("D").min(),
        "rh_max": h["RH2M"].resample("D").max(),
        "ws_max": h["WS2M"].resample("D").max(),
        "rh80_hours": (h["RH2M"] >= 80).astype(float).where(h["RH2M"].notna()).resample("D").sum(min_count=1),
        "n_hours": h["T2M"].resample("D").count(),
    })
    night = h[~h.index.hour.isin(range(7, 20))]
    key = (night.index + pd.Timedelta(hours=4)).normalize()
    d["rh90_night_hours"] = (night["RH2M"] >= 90).astype(float).groupby(key).sum().reindex(d.index)
    for col, w in (("t_max", 30), ("t_mean", 30), ("dp_min", 30), ("rh_max", 30), ("ws_max", 30),
                   ("rh90_night_hours", 14), ("rh80_hours", 30), ("t_min", 21)):
        d[f"{col}_{w}ma"] = d[col].rolling(w, min_periods=w).mean()
    # a day's risk uses weather through the day before (forecasting_date = date + 1)
    d.index = d.index + pd.Timedelta(days=1)
    return d


def risk_series(d: pd.DataFrame) -> pd.DataFrame:
    """Daily probabilities per model; NaN where inactive or inputs are missing."""
    out = pd.DataFrame(index=d.index)
    active = d["t_mean_30ma"] >= INACTIVE_C
    out["tar_spot"] = tarspot(d["t_mean_30ma"], d["rh_max_30ma"], d["rh90_night_hours_14ma"]).where(active)
    gls_on = active & (d["t_min_21ma"] >= 5)
    out["gray_leaf_spot"] = gray_leaf_spot(d["t_min_21ma"], d["dp_min_30ma"]).where(gls_on)
    wm_on = d["t_max_30ma"] >= INACTIVE_C
    out["white_mold_dryland"] = whitemold_dryland(d["t_max_30ma"], d["rh_max_30ma"], d["ws_max_30ma"]).where(wm_on)
    out["white_mold_irrigated_30in"] = whitemold_irrigated(d["t_max_30ma"], d["rh_max_30ma"], True).where(wm_on)
    out["white_mold_irrigated_15in"] = whitemold_irrigated(d["t_max_30ma"], d["rh_max_30ma"], False).where(wm_on)
    return out


def _window(df: pd.DataFrame, year: int) -> pd.DataFrame:
    a, b = pd.Timestamp(date(year, *WINDOW[0])), pd.Timestamp(date(year, *WINDOW[1]))
    return df[(df.index >= a) & (df.index <= b)]


def _season_summary(r: pd.DataFrame, d: pd.DataFrame, year: int) -> dict:
    w = _window(r, year)
    di = _window(d, year)
    res = {"year": year, "days_in_window": int(len(w)),
           "days_with_weather": int((di["n_hours"] >= 20).sum()) if len(di) else 0}
    for m in MODELS:
        s = w[m["id"]]
        hi = m["thresholds"]["high_above"]
        lo = m["thresholds"]["low_below"]
        valid = s.dropna()
        res[m["id"]] = {
            "share_high": float((valid > hi).sum() / len(w)) if len(w) else None,
            "share_moderate": float(((valid >= lo) & (valid <= hi)).sum() / len(w)) if len(w) else None,
            "mean_prob": float(valid.mean()) if len(valid) else None,
            "max_prob": float(valid.max()) if len(valid) else None,
            "days_scored": int(len(valid)),
        }
    return res


_INPUT_COLS = {
    "tar_spot": {"t_mean_30d_c": "t_mean_30ma", "rh_max_30d_pct": "rh_max_30ma", "rh90_night_hours_14d": "rh90_night_hours_14ma"},
    "gray_leaf_spot": {"t_min_21d_c": "t_min_21ma", "dew_point_min_30d_c": "dp_min_30ma"},
    "white_mold_dryland": {"t_max_30d_c": "t_max_30ma", "rh_max_30d_pct": "rh_max_30ma", "wind_max_30d_ms": "ws_max_30ma"},
    "white_mold_irrigated_30in": {"t_max_30d_c": "t_max_30ma", "rh_max_30d_pct": "rh_max_30ma"},
    "white_mold_irrigated_15in": {"t_max_30d_c": "t_max_30ma", "rh_max_30d_pct": "rh_max_30ma"},
}


def _inputs_mean(dailies: dict, years: list[int], mid: str) -> dict:
    """Mean of each model input over the window, all history years (so the panel can show what drove the score)."""
    frames = [_window(dailies[y][0], y) for y in years if y in dailies]
    if not frames:
        return {}
    d = pd.concat(frames)
    return {k: round(float(d[c].mean()), 2) for k, c in _INPUT_COLS[mid].items() if d[c].notna().any()}


def _class(p: float | None, m: dict) -> str | None:
    if p is None or (isinstance(p, float) and math.isnan(p)):
        return "inactive"
    t = m["thresholds"]
    return "high" if p > t["high_above"] else "low" if p < t["low_below"] else "moderate"


def field_disease(lat: float, lon: float, country_code: str | None, statefips: str | None,
                  today: date | None = None) -> dict:
    today = today or date.today()
    scale = "regional weather, NASA POWER grid cell (≈50 km), not an on-farm weather station"
    if (country_code or "").lower() != "us" or statefips not in VALID_STATES:
        return {"available": False,
                "reason": "These disease weather models were built and tested for the US Midwest and Great Lakes "
                          f"({', '.join(sorted(VALID_STATES.values()))}). This field is outside that area, so we "
                          "don't run them here.",
                "reason_es": "Estos modelos de clima y enfermedad se crearon y probaron para el Medio Oeste y los "
                             "Grandes Lagos de EE. UU. Este lote está fuera de esa zona, así que no los usamos aquí.",
                "scale": scale, "version": DISEASE_VERSION}
    latest = power._latest_end()
    win_start = date(today.year, *WINDOW[0])
    # history = complete seasons before this calendar year; this_season = this year's window once it has started
    years = list(range(max(FIRST_YEAR, today.year - N_YEARS), today.year))
    running = today.year if latest >= win_start else None
    want = years + ([running] if running else [])
    errors = []

    def get(y):
        try:
            return y, season_hourly(lat, lon, y)
        except Exception as e:  # noqa: BLE001 - reported, never filled in
            errors.append(f"{y}: {type(e).__name__}")
            return y, None

    with ThreadPoolExecutor(max_workers=6) as ex:
        got = dict(ex.map(get, want))
    seasons, dailies = {}, {}
    for y in want:
        h = got.get(y)
        if h is None or h.empty:
            continue
        d = daily_inputs(h)
        r = risk_series(d)
        seasons[y] = _season_summary(r, d, y)
        dailies[y] = (d, r)
    done = [y for y in years if y in seasons and seasons[y]["days_in_window"] > 0]
    if len(done) < 5:
        return {"available": False, "reason": "NASA POWER hourly weather could not be read for enough seasons "
                                              f"({len(done)} of {len(years)}). Try again later.",
                "reason_es": "No se pudo leer el clima horario de NASA POWER para suficientes temporadas.",
                "errors": errors, "scale": scale, "version": DISEASE_VERSION}
    glat, glon = power._grid_key(lat, lon)
    models = []
    missing_share = 1 - np.mean([seasons[y]["days_with_weather"] / max(1, seasons[y]["days_in_window"]) for y in done])
    for m in MODELS:
        shares = [seasons[y][m["id"]]["share_high"] for y in done]
        arr = np.array([s for s in shares if s is not None], float)
        this = None
        if running in seasons:
            d, r = dailies[running]
            s = _window(r, running)[m["id"]]
            end_w = date(running, *WINDOW[1])
            through = min(latest + timedelta(days=1), end_w)
            last = r[m["id"]][r.index <= pd.Timestamp(through)].dropna()
            this = {"year": running, "through": str(through), "complete": through >= end_w,
                    "share_high_risk_days": (round(float((s.dropna() > m["thresholds"]["high_above"]).sum() / len(s)), 3)
                                             if len(s) else None),
                    "days_so_far": int(len(s)),
                    "latest": ({"date": str(last.index[-1].date()), "prob": round(float(last.iloc[-1]), 3),
                                "class": _class(float(last.iloc[-1]), m)} if len(last) else None)}
        models.append({
            "id": m["id"], "crop": m["crop"], "name_en": m["name_en"], "name_es": m["name_es"],
            "pathogen": m["pathogen"],
            # irrigated variants only apply to irrigated soybean; the panel shows them on request
            "primary": not m["id"].startswith("white_mold_irrigated"),
            "source": "UW-Madison Crop Disease Forecasting Tool (MIT licence), models as implemented in the tool's API",
            "url": REPO, "code": {"repo": REPO, "commit": REPO_COMMIT, "file": "materials/model_surfaces/surfaces-plot.py",
                                  "api_repo": API_REPO, "api_commit": API_COMMIT, "api_file": "api/models/risk_models.py"},
            "paper": m["paper"],
            "valid_region": "US Midwest / Great Lakes (" + ", ".join(sorted(VALID_STATES.values())) + ")",
            "stages": m["stages"],
            "window": {"from": f"{WINDOW[0][0]:02d}-{WINDOW[0][1]:02d}", "to": f"{WINDOW[1][0]:02d}-{WINDOW[1][1]:02d}",
                       "note": f"Model applies at {m['stages']}; mapping that to these dates is a FarmSmart "
                               "assumption for the Midwest. Your own crop stage may differ."},
            "inputs": m["inputs"], "thresholds": m["thresholds"],
            "years": done,
            "share_high_risk_days": [None if seasons[y][m["id"]]["share_high"] is None
                                     else round(seasons[y][m["id"]]["share_high"], 3) for y in done],
            "share_moderate_days": [None if seasons[y][m["id"]]["share_moderate"] is None
                                    else round(seasons[y][m["id"]]["share_moderate"], 3) for y in done],
            "mean_prob": [None if seasons[y][m["id"]]["mean_prob"] is None
                          else round(seasons[y][m["id"]]["mean_prob"], 3) for y in done],
            "typical": round(float(np.median(arr)), 3) if len(arr) else None,
            "p90_year": round(float(np.percentile(arr, 90)), 3) if len(arr) else None,
            "last_year": (round(seasons[done[-1]][m["id"]]["share_high"], 3)
                          if seasons[done[-1]][m["id"]]["share_high"] is not None else None),
            "last_year_label": done[-1],
            "this_season": this,
            "is_nasa": True,
            "inputs_window_mean": _inputs_mean(dailies, done, m["id"]),
        })
        if len(arr) >= 5 and float(np.percentile(arr, 10)) >= 0.95:
            models[-1]["note"] = ("With this weather the model puts almost every day in its high class in every year, "
                                  "so it does not separate one summer from another here. Compare years by the model's average score instead.")
            models[-1]["note_es"] = ("Con este clima el modelo pone casi todos los días en su clase alta todos los años, "
                                     "así que no distingue un verano de otro aquí. Compare los años por la puntuación media del modelo.")
    reasons = ["Weather comes from NASA POWER, a regional grid (≈50 km), not an on-farm station like the ones the "
               "models were fitted on; humidity and wind at your field can differ.",
               "These models score weather only. Disease also needs the pathogen in the field and a susceptible "
               "hybrid or variety; they say nothing about either.",
               "The July 1 – August 15 window stands in for the crop stages the models need; your crop may reach them "
               "earlier or later."]
    score = 1.0 - 0.25 - 0.1 - 0.1
    if missing_share > 0.05:
        score -= 0.15
        reasons.append(f"{missing_share:.0%} of window days have incomplete hourly weather.")
    if len(done) < 10:
        score -= 0.1
        reasons.append(f"Only {len(done)} seasons of hourly weather.")
    level = "high" if score >= 0.8 else "medium" if score >= 0.5 else "low"
    return {
        "available": True, "version": DISEASE_VERSION,
        "models": models,
        "years": done,
        "weather": {"source": "NASA POWER", "product": "hourly T2M, RH2M, T2MDEW, WS2M (MERRA-2 based), local solar time",
                    "url": "https://power.larc.nasa.gov/", "is_nasa": True,
                    "cell": {"lat": glat, "lon": glon}, "footprint": power.footprint(lat, lon),
                    "missing_share": round(float(missing_share), 3)},
        "note": "Share of days from July 1 to August 15 whose weather favours the disease (the model's high-risk "
                "class). It does not mean the disease is present, and it is not a yield-loss number. Scout the field "
                "and check your hybrid or variety rating.",
        "note_es": "Proporción de días del 1 de julio al 15 de agosto con clima que favorece la enfermedad (clase de "
                   "riesgo alto del modelo). No significa que la enfermedad esté presente ni es una pérdida de "
                   "rendimiento. Revise el lote y la tolerancia de su híbrido o variedad.",
        "scale": scale,
        "si": {"confidence": level, "score": round(score, 2), "reasons": reasons,
               "method": "published logistic models (UW-Madison), re-run on NASA POWER hourly weather"},
        "errors": errors or None,
    }
