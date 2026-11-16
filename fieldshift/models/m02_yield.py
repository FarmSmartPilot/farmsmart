"""M2 county yield and yield risk: P10/P50/P90 of county yield from season weather.

Data
    Target   USDA NASS county yields (survey, all production practices), 2000 to the cutoff year.
    Weather  NASA POWER daily (AG community) at each county's Census internal point, snapped to the POWER
             0.5 x 0.625 degree grid (counties in one cell share weather).
Target       relative yield anomaly = yield / county trend - 1. The trend is a Theil-Sen line per county
             (robust to drought years), so technology gains are removed; it is added back for predictions.
Model        LightGBM quantile regression (alpha 0.1 / 0.5 / 0.9) per crop. The 80% interval is conformalized
             (CQR, Romano et al. 2019) with out-of-fold scores from year-grouped folds inside the training years.
Drivers      LightGBM pred_contrib on the P50 model (no shap package).

Run `python -m fieldshift.models.m02_yield` to fetch weather, validate (temporal and leave-one-state-out),
train the production model and write the artifact. Output is used by engine/analysis.py (yield_county block)."""
from __future__ import annotations

import gzip
import json
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from ..config import ARTIFACTS, CACHE, MODELS_DIR, USER_AGENT

MODEL_ID = "M2"
COMMITTED = MODELS_DIR / "m02_yield" / "m02_yield.json.gz"   # small, committed: the deployed API loads this
ARTIFACT = ARTIFACTS / "m02_yield.pkl"                         # git-ignored: models + hold-out predictions
WX_DIR = CACHE / "m2_power"
GAZ_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_counties_national.zip"
POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
WX_PARAMS = ["T2M_MAX", "T2M_MIN", "PRECTOTCORR", "GWETROOT", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN"]
WX_START, WX_END = date(1999, 9, 1), date(2025, 12, 31)
CLIM_YEARS = (2001, 2017)   # base period for soil-wetness anomalies (inside the temporal training window)
QUANTILES = (0.1, 0.5, 0.9)
TRAIN_END_TEMPORAL = 2017
TEST_YEARS = (2018, 2024)
CUTOFF = 2024               # production model: NASS county yields 2000-2024
MIN_YEARS = 8               # county needs this many yield years to fit a trend

CROPS = {
    "corn": {"unit": "bu/ac", "kind": "summer", "heat_window": ((7, 1), (8, 15)), "heat_label": "July 1 - Aug 15 (silking)"},
    "soybean": {"unit": "bu/ac", "kind": "summer", "heat_window": ((7, 15), (8, 31)), "heat_label": "mid-July - August (pod set)"},
    "sorghum": {"unit": "bu/ac", "kind": "summer", "heat_window": ((7, 15), (8, 31)), "heat_label": "mid-July - August (flowering)"},
    "winter_wheat": {"unit": "bu/ac", "kind": "winter", "heat_window": ((5, 15), (6, 20)), "heat_label": "May 15 - June 20 (grain fill)"},
}
LABELS = {
    "gdd": "growing degree days (May-Sep)", "gdd_spring": "growing degree days (Mar-Jun)",
    "heat35": "days ≥ 35 °C around flowering", "heat32": "days ≥ 32 °C in the critical window",
    "tmax_7": "July mean daily maximum", "tmin_7": "July night temperature", "tmin_8": "August night temperature",
    "tmax_5": "May mean daily maximum", "ffd": "frost-free days", "rain_45": "April-May rain",
    "rain_fall": "fall rain before sowing (Sep-Nov)", "rain_winter": "winter rain/snow (Dec-Feb)",
    "cold18": "winter days ≤ -18 °C", "freeze_spring": "spring freeze days ≤ -2 °C (Apr 1 - May 15)",
    "gwet_fall_anom": "fall root-zone wetness anomaly", "trend_level": "county yield level (trend)",
}
MONTHS = {5: "May", 6: "June", 7: "July", 8: "August", 9: "September", 3: "March", 4: "April", 10: "October"}
for _m, _n in MONTHS.items():
    LABELS[f"rain_{_m}"] = f"{_n} rain"
    LABELS[f"def_{_m}"] = f"{_n} water deficit (ET0 - rain)"
    LABELS[f"gwet_{_m}"] = f"{_n} root-zone wetness"
    LABELS[f"gwet_{_m}_anom"] = f"{_n} root-zone wetness anomaly"
    LABELS[f"rain_{_m}_anom"] = f"{_n} rain vs normal"
    LABELS[f"def_{_m}_anom"] = f"{_n} water deficit vs normal"

# Chosen by a small sweep on the temporal split (leaves 15/7/4): 7 leaves and >= 100 rows per leaf was best or tied.
LGB_PARAMS = dict(n_estimators=300, learning_rate=0.03, num_leaves=7, min_child_samples=100, subsample=0.8,
                  subsample_freq=1, colsample_bytree=0.6, reg_lambda=1.0, verbose=-1)


# ============================================================================ inputs
def gazetteer() -> pd.DataFrame:
    """Census 2023 county gazetteer: fips, state, name, internal point lat/lon."""
    d = CACHE / "gazetteer"
    txt = d / "2023_Gaz_counties_national.txt"
    if not txt.exists():
        d.mkdir(parents=True, exist_ok=True)
        r = requests.get(GAZ_URL, timeout=120, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        (d / "gaz.zip").write_bytes(r.content)
        with zipfile.ZipFile(d / "gaz.zip") as z:
            z.extractall(d)
    g = pd.read_csv(txt, sep="\t", dtype={"GEOID": str})
    g.columns = [c.strip() for c in g.columns]
    return pd.DataFrame({"fips": g["GEOID"], "state": g["USPS"], "name": g["NAME"],
                         "lat": g["INTPTLAT"].astype(float), "lon": g["INTPTLONG"].astype(float)})


def grid_key(lat: float, lon: float) -> tuple[float, float]:
    return round(lat * 2) / 2, round(lon / 0.625) * 0.625


def cell_weather(glat: float, glon: float, tries: int = 6) -> pd.DataFrame:
    """POWER daily for one grid cell, 1999-09 to 2025, float32, cached as parquet (elevation in attrs/column)."""
    WX_DIR.mkdir(parents=True, exist_ok=True)
    pq = WX_DIR / f"{glat:.2f}_{glon:.3f}.parquet"
    if pq.exists():
        return pd.read_parquet(pq)
    last = None
    for i in range(tries):
        try:
            r = requests.get(POWER_URL, params=dict(parameters=",".join(WX_PARAMS), community="AG", latitude=glat,
                                                    longitude=glon, start=f"{WX_START:%Y%m%d}", end=f"{WX_END:%Y%m%d}",
                                                    format="JSON"),
                             headers={"User-Agent": USER_AGENT}, timeout=300)
            if r.status_code == 200:
                js = r.json()
                df = pd.DataFrame(js["properties"]["parameter"])
                df.index = pd.to_datetime(df.index, format="%Y%m%d")
                df = df.replace(-999.0, np.nan).astype("float32")
                df["elev"] = np.float32(js["geometry"]["coordinates"][2])
                df.to_parquet(pq)
                return df
            last = f"HTTP {r.status_code}"
            if r.status_code == 429:  # rate limited: back off
                time.sleep(30 * (i + 1))
        except requests.RequestException as e:
            last = type(e).__name__
        time.sleep(5 * (i + 1))
    raise RuntimeError(f"POWER {glat},{glon}: {last}")


# ============================================================================ features
def _et0(wx: pd.DataFrame, lat: float, elev: float) -> pd.Series:
    from ..engine.climate import et0_pm
    return et0_pm(wx.astype(float), lat, elev)


def _doy_mask(idx: pd.DatetimeIndex, a: tuple[int, int], b: tuple[int, int]) -> np.ndarray:
    md = idx.month * 100 + idx.day
    return (md >= a[0] * 100 + a[1]) & (md <= b[0] * 100 + b[1])


def season_features(wx: pd.DataFrame, lat: float, elev: float, crop: str) -> pd.DataFrame:
    """One row per harvest year with the crop's stage-specific weather features. Works on any POWER daily frame
    with WX_PARAMS columns (training cells or a field's own series)."""
    cfg = CROPS[crop]
    wx = wx[[c for c in WX_PARAMS if c in wx.columns]].astype(float)
    et0 = _et0(wx, lat, elev)
    tx, tn, p, gw = wx["T2M_MAX"], wx["T2M_MIN"], wx["PRECTOTCORR"], wx["GWETROOT"]
    idx = wx.index
    winter = cfg["kind"] == "winter"
    sy = idx.year + ((idx.month >= 9).astype(int) if winter else 0)   # harvest (season) year
    ym = pd.DataFrame({"sy": sy, "m": idx.month, "p": p.values, "e": et0.values, "g": gw.values}, index=idx)
    monthly = ym.groupby(["sy", "m"]).agg(p=("p", "sum"), e=("e", "sum"), g=("g", "mean"), n=("p", "count"))
    gclim = ym[(ym.index.year >= CLIM_YEARS[0]) & (ym.index.year <= CLIM_YEARS[1])].groupby("m")["g"].mean()
    out: dict[str, pd.Series] = {}
    months = [5, 6, 7, 8, 9] if not winter else [3, 4, 5, 6]
    base = monthly[(monthly.index.get_level_values("sy") >= CLIM_YEARS[0]) &
                   (monthly.index.get_level_values("sy") <= CLIM_YEARS[1])].groupby(level="m")[["p", "e"]].mean()
    for m in months:
        mm = monthly.xs(m, level="m")
        out[f"rain_{m}"] = mm["p"]
        out[f"def_{m}"] = mm["e"] - mm["p"]
        out[f"rain_{m}_anom"] = mm["p"] - base.loc[m, "p"]
        out[f"def_{m}_anom"] = (mm["e"] - mm["p"]) - (base.loc[m, "e"] - base.loc[m, "p"])
    for m in ([6, 7, 8] if not winter else [3, 4, 5]):
        mm = monthly.xs(m, level="m")
        out[f"gwet_{m}"] = mm["g"]
        out[f"gwet_{m}_anom"] = mm["g"] - gclim.get(m, np.nan)
    hw = _doy_mask(idx, *cfg["heat_window"])
    out["heat35"] = (tx[hw] >= 35).groupby(sy[hw]).sum()
    if not winter:
        w = _doy_mask(idx, (6, 1), (8, 31))
        out["heat32"] = (tx[w] >= 32).groupby(sy[w]).sum()
        ms = _doy_mask(idx, (5, 1), (9, 30))
        g = ((tx.clip(upper=30) + tn.clip(lower=10)) / 2 - 10).clip(lower=0)
        out["gdd"] = g[ms].groupby(sy[ms]).sum()
        for m, nm in ((7, "tmax_7"),):
            s = idx.month == m
            out[nm] = tx[s].groupby(sy[s]).mean()
        for m in (7, 8):
            s = idx.month == m
            out[f"tmin_{m}"] = tn[s].groupby(sy[s]).mean()
        s = (idx.month >= 4) & (idx.month <= 5)
        out["rain_45"] = p[s].groupby(sy[s]).sum()
        out["ffd"] = _frost_free(tn)
    else:
        out["heat32"] = (tx[hw] >= 32).groupby(sy[hw]).sum()
        s = (idx.month >= 9) & (idx.month <= 11)
        out["rain_fall"] = p[s].groupby(sy[s]).sum()
        gf = ym[s]
        out["gwet_fall_anom"] = (gf["g"] - gf["m"].map(gclim)).groupby(gf["sy"]).mean()
        s = (idx.month == 12) | (idx.month <= 2)
        out["rain_winter"] = p[s].groupby(sy[s]).sum()
        out["cold18"] = (tn[s] <= -18).groupby(sy[s]).sum()
        s = _doy_mask(idx, (4, 1), (5, 15))
        out["freeze_spring"] = (tn[s] <= -2).groupby(sy[s]).sum()
        s = (idx.month >= 3) & (idx.month <= 6)
        out["gdd_spring"] = (((tx + tn) / 2).clip(lower=0))[s].groupby(sy[s]).sum()
        s = idx.month == 5
        out["tmax_5"] = tx[s].groupby(sy[s]).mean()
    f = pd.DataFrame(out)
    # keep only complete seasons: every month of the window present
    need = list(range(5, 10)) if not winter else [9, 10, 11, 12, 1, 2, 3, 4, 5, 6]
    cnt = ym.groupby(["sy", "m"])["p"].count().unstack()
    ok = cnt.reindex(columns=need).fillna(0).ge(27).all(axis=1)
    f = f[f.index.isin(ok[ok].index)]
    f.index.name = "year"
    return f


def _frost_free(tn: pd.Series) -> pd.Series:
    """Days between the last spring (before July) and first fall day with Tmin <= 0 °C, per full year."""
    yr, doy, m = tn.index.year, tn.index.day_of_year, tn.index.month
    full = pd.Series(1, index=tn.index).groupby(yr).count()
    full = full[full >= 360].index
    fr = (tn <= 0).to_numpy()
    sp = pd.Series(doy[fr & (m < 7)], index=yr[fr & (m < 7)]).groupby(level=0).max()
    fa = pd.Series(doy[fr & (m >= 7)], index=yr[fr & (m >= 7)]).groupby(level=0).min()
    sp = sp.reindex(full).fillna(1)
    fa = fa.reindex(full).fillna(366)
    return (fa - sp).astype(float)


def feature_names(crop: str) -> list[str]:
    winter = CROPS[crop]["kind"] == "winter"
    months = [5, 6, 7, 8, 9] if not winter else [3, 4, 5, 6]
    gm = [6, 7, 8] if not winter else [3, 4, 5]
    f = [f"rain_{m}" for m in months] + [f"def_{m}" for m in months]
    f += [f"rain_{m}_anom" for m in months] + [f"def_{m}_anom" for m in months]
    f += [f"gwet_{m}" for m in gm] + [f"gwet_{m}_anom" for m in gm] + ["heat35", "heat32"]
    if not winter:
        f += ["gdd", "tmax_7", "tmin_7", "tmin_8", "rain_45", "ffd"]
    else:
        f += ["rain_fall", "gwet_fall_anom", "rain_winter", "cold18", "freeze_spring", "gdd_spring", "tmax_5"]
    return f + ["trend_level"]


# ============================================================================ trend
def theil_sen(years: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """(slope, intercept at year 2000) of the Theil-Sen line."""
    t = years - 2000.0
    i, j = np.triu_indices(len(t), 1)
    dt = t[j] - t[i]
    ok = dt != 0
    slope = float(np.median((y[j] - y[i])[ok] / dt[ok])) if ok.any() else 0.0
    return slope, float(np.median(y - slope * t))


def state_slopes(yields: pd.DataFrame, upto: int) -> tuple[dict, float]:
    """Technology trend per state: median of the county Theil-Sen slopes (states with >= 5 counties), plus the
    pooled median. County slopes alone extrapolate badly (e.g. a few volatile dryland years tilt the line)."""
    rows = []
    for f, g in yields[yields["year"] <= upto].groupby("fips"):
        if len(g) >= MIN_YEARS:
            rows.append((g["state"].iloc[0], theil_sen(g["year"].to_numpy(float), g["yield"].to_numpy(float))[0]))
    df = pd.DataFrame(rows, columns=["state", "slope"])
    cnt = df.groupby("state").size()
    med = df.groupby("state")["slope"].median()
    return {k: float(v) for k, v in med.items() if cnt[k] >= 5}, float(df["slope"].median())


def county_trends(yields: pd.DataFrame, upto: int) -> pd.DataFrame:
    """County trend line = county level (median of yield - slope*t) with the state technology slope."""
    ss, pooled = state_slopes(yields, upto)
    rows = []
    for f, g in yields[yields["year"] <= upto].groupby("fips"):
        if len(g) < MIN_YEARS:
            continue
        b = ss.get(g["state"].iloc[0], pooled)
        a = float(np.median(g["yield"].to_numpy(float) - b * (g["year"].to_numpy(float) - 2000.0)))
        rows.append({"fips": f, "slope": b, "intercept": a, "n_years": len(g), "last_year": int(g["year"].max())})
    return pd.DataFrame(rows).set_index("fips")


def trend_at(tr: pd.Series | dict, year: int | np.ndarray):
    return tr["intercept"] + tr["slope"] * (np.asarray(year, float) - 2000.0)


# ============================================================================ dataset
def build_dataset(crop: str, workers: int = 4) -> pd.DataFrame:
    """County-year rows: yield + weather features (no trend columns yet)."""
    from ..ingest import nass
    y = nass.county_yields(crop)
    y = y[(y["year"] >= 2000) & y["yield"].notna() & (y["yield"] > 0)]
    gz = gazetteer().set_index("fips")
    y = y[y["fips"].isin(gz.index)]
    cnt = y.groupby("fips").size()
    y = y[y["fips"].isin(cnt[cnt >= MIN_YEARS].index)]
    c = gz.loc[y["fips"].unique()].copy()
    c["glat"], c["glon"] = zip(*[grid_key(a, b) for a, b in zip(c["lat"], c["lon"])])
    cells = sorted(set(zip(c["glat"], c["glon"])))
    def get(k):
        try:
            return cell_weather(*k)
        except Exception as e:  # noqa: BLE001 - counties in a cell without weather are dropped (reported)
            print(f"  weather missing for cell {k}: {e}", flush=True)
            return None
    with ThreadPoolExecutor(workers) as ex:
        wxs = dict(zip(cells, ex.map(get, cells)))
    feats = {}
    for k, wx in wxs.items():
        if wx is not None:
            feats[k] = season_features(wx, k[0], float(wx["elev"].iloc[0]), crop)
    rows = []
    for fips, cc in c.iterrows():
        if (cc["glat"], cc["glon"]) not in feats:
            continue
        fx = feats[(cc["glat"], cc["glon"])].copy()
        fx["fips"] = fips
        rows.append(fx.reset_index())
    F = pd.concat(rows, ignore_index=True)
    D = y.merge(F, on=["fips", "year"], how="inner")
    D["lat"] = D["fips"].map(c["lat"])
    D["lon"] = D["fips"].map(c["lon"])
    return D


def _with_trend(D: pd.DataFrame, tr: pd.DataFrame) -> pd.DataFrame:
    D = D[D["fips"].isin(tr.index)].copy()
    t = tr.loc[D["fips"]]
    D["trend"] = (t["intercept"].to_numpy(float) + t["slope"].to_numpy(float) * (D["year"].to_numpy(float) - 2000.0))
    D["yield"] = D["yield"].astype(float)
    D = D[D["trend"] > 0]
    D["trend_level"] = np.log(D["trend"])
    D["anom"] = D["yield"] / D["trend"] - 1
    return D


# ============================================================================ model
def _fit_q(X: np.ndarray, y: np.ndarray, alpha: float, params: dict | None = None):
    import lightgbm as lgb
    m = lgb.LGBMRegressor(objective="quantile", alpha=alpha, **(params or LGB_PARAMS))
    m.fit(X, y)
    return m


def _predict3(models, X) -> np.ndarray:
    P = np.column_stack([m.predict(X) for m in models])
    return np.sort(P, axis=1)  # no quantile crossing


def _cqr_q(scores: np.ndarray, level: float = 0.8) -> float:
    n = len(scores)
    k = min(int(np.ceil((n + 1) * level)), n)
    return float(np.sort(scores)[k - 1])


def fit_cqr_rolling(Draw: pd.DataFrame, feats: list[str], upto: int, horizon: int = 3,
                    origins: list[int] | None = None, params: dict | None = None) -> dict:
    """Quantile models on all seasons <= upto (trend fitted <= upto) + CQR correction from rolling-origin scores:
    for each origin o, trend and models are fitted on seasons <= o and scored on o+1..o+horizon, so the scores
    include the error of extrapolating the trend, as in use."""
    origins = [o for o in (origins or [upto - 3 * k for k in (4, 3, 2, 1)]) if o >= 2000 + MIN_YEARS - 1]
    scores = []
    for o in origins:
        Do = _with_trend(Draw[Draw["year"] <= upto], county_trends(Draw, o))
        tr, ca = Do[Do["year"] <= o], Do[(Do["year"] > o) & (Do["year"] <= min(o + horizon, upto))]
        if len(tr) < 200 or not len(ca):
            continue
        ms = [_fit_q(tr[feats].to_numpy(float), tr["anom"].to_numpy(float), a, params) for a in QUANTILES]
        P = _predict3(ms, ca[feats].to_numpy(float))
        yv = ca["anom"].to_numpy(float)
        scores.append(np.maximum(P[:, 0] - yv, yv - P[:, 2]))
    sc = np.concatenate(scores)
    Da = _with_trend(Draw[Draw["year"] <= upto], county_trends(Draw, upto))
    X, y = Da[feats].to_numpy(float), Da["anom"].to_numpy(float)
    models = [_fit_q(X, y, a, params) for a in QUANTILES]
    return {"models": models, "q_hat": _cqr_q(sc), "n_scores": int(len(sc)), "origins": origins, "data": Da}


def fit_cqr(D: pd.DataFrame, feats: list[str], n_folds: int = 5, params: dict | None = None) -> dict:
    """Quantile models on all rows + CQR correction from year-grouped out-of-fold scores."""
    X, y = D[feats].to_numpy(float), D["anom"].to_numpy(float)
    yrs = np.array(sorted(D["year"].unique()))
    groups = {yr: i % n_folds for i, yr in enumerate(yrs)}
    fold = D["year"].map(groups).to_numpy()
    oof = np.full((len(D), 3), np.nan)
    for k in range(n_folds):
        tr, te = fold != k, fold == k
        ms = [_fit_q(X[tr], y[tr], a, params) for a in QUANTILES]
        oof[te] = _predict3(ms, X[te])
    scores = np.maximum(oof[:, 0] - y, y - oof[:, 2])
    models = [_fit_q(X, y, a, params) for a in QUANTILES]
    return {"models": models, "q_hat": _cqr_q(scores), "oof_cover_raw": float(np.mean((y >= oof[:, 0]) & (y <= oof[:, 2])))}


def pinball(y, q, a) -> float:
    d = np.asarray(y) - np.asarray(q)
    return float(np.mean(np.maximum(a * d, (a - 1) * d)))


def metrics(y_bu, trend, P_anom, lo_anom, hi_anom, obs_anom) -> dict:
    Pb = P_anom * trend[:, None] + trend[:, None]
    lo, hi = trend * (1 + lo_anom), trend * (1 + hi_anom)
    pl = np.mean([pinball(y_bu, Pb[:, i], a) for i, a in enumerate(QUANTILES)])
    ss_res = np.sum((obs_anom - P_anom[:, 1]) ** 2)
    ss_tot = np.sum((obs_anom - obs_anom.mean()) ** 2)
    return {"n": int(len(y_bu)), "pinball_bu": round(float(pl), 3), "coverage80": round(float(np.mean((y_bu >= lo) & (y_bu <= hi))), 3),
            "width80_bu": round(float(np.mean(hi - lo)), 2), "r2_anom": round(float(1 - ss_res / ss_tot), 3),
            "mae_p50_bu": round(float(np.mean(np.abs(y_bu - Pb[:, 1]))), 2)}


def _baselines(Dtr: pd.DataFrame, Dte: pd.DataFrame, crop: str) -> dict:
    """B1: county 5-year mean anomaly (P50) with the county's own anomaly P10/P90 (climatology).
    B2: linear regression of the anomaly on the key-month rain and flowering heat days, residual quantiles."""
    out = {}
    last5 = Dtr[Dtr["year"] > Dtr["year"].max() - 5].groupby("fips")["anom"].mean()
    qs = Dtr.groupby("fips")["anom"].quantile([0.1, 0.9]).unstack()
    b1 = np.column_stack([Dte["fips"].map(qs[0.1]), Dte["fips"].map(last5).fillna(0.0), Dte["fips"].map(qs[0.9])])
    b1 = np.sort(np.nan_to_num(b1, nan=0.0), axis=1)
    out["B1"] = b1
    rain = "rain_7" if CROPS[crop]["kind"] == "summer" else "rain_5"
    Xtr = np.column_stack([np.ones(len(Dtr)), Dtr[rain], Dtr["heat35"]])
    beta, *_ = np.linalg.lstsq(Xtr, Dtr["anom"].to_numpy(float), rcond=None)
    res = Dtr["anom"].to_numpy(float) - Xtr @ beta
    r10, r90 = np.quantile(res, [0.1, 0.9])
    pred = np.column_stack([np.ones(len(Dte)), Dte[rain], Dte["heat35"]]) @ beta
    out["B2"] = np.column_stack([pred + r10, pred, pred + r90])
    out["B2_desc"] = f"OLS: anomaly ~ {rain} + heat35"
    return out


def _evaluate(Dte, P, q_hat) -> dict:
    tr = Dte["trend"].to_numpy(float)
    return metrics(Dte["yield"].to_numpy(float), tr, P, P[:, 0] - q_hat, P[:, 2] + q_hat, Dte["anom"].to_numpy(float))


def validate(crop: str, D: pd.DataFrame, loso: bool = True) -> tuple[dict, pd.DataFrame]:
    feats = feature_names(crop)
    res: dict = {"crop": crop}
    # ---- temporal: trend and model fitted on 2000-2017 only, test 2018-2024 (trend extrapolated)
    tr17 = county_trends(D, TRAIN_END_TEMPORAL)
    Dt = _with_trend(D, tr17)
    Dtr = Dt[Dt["year"] <= TRAIN_END_TEMPORAL]
    Dte = Dt[(Dt["year"] >= TEST_YEARS[0]) & (Dt["year"] <= TEST_YEARS[1])].copy()
    fit = fit_cqr_rolling(D, feats, TRAIN_END_TEMPORAL)
    P = _predict3(fit["models"], Dte[feats].to_numpy(float))
    m = _evaluate(Dte, P, fit["q_hat"])
    m["coverage80_raw"] = round(float(np.mean((Dte["anom"] >= P[:, 0]) & (Dte["anom"] <= P[:, 2]))), 3)
    m["q_hat"] = round(fit["q_hat"], 4)
    res["temporal"] = {"model": m}
    bl = _baselines(Dtr, Dte, crop)
    for b in ("B1", "B2"):
        res["temporal"][b] = metrics(Dte["yield"].to_numpy(float), Dte["trend"].to_numpy(float), bl[b], bl[b][:, 0], bl[b][:, 2],
                                     Dte["anom"].to_numpy(float))
    res["temporal"]["B2_desc"] = bl["B2_desc"]
    res["temporal"]["by_year"] = {}
    hold = Dte[["fips", "state", "year", "yield", "trend", "anom"]].copy()
    hold["crop"] = crop
    hold["p10"], hold["p50"], hold["p90"] = Dte["trend"].to_numpy() * (1 + P[:, 0] - fit["q_hat"]), \
        Dte["trend"].to_numpy() * (1 + P[:, 1]), Dte["trend"].to_numpy() * (1 + P[:, 2] + fit["q_hat"])
    hold["split"] = "temporal"
    for yr, g in hold.groupby("year"):
        res["temporal"]["by_year"][int(yr)] = round(float(np.mean((g["yield"] >= g["p10"]) & (g["yield"] <= g["p90"]))), 3)
    holds = [hold]
    # ---- spatial: leave one state out (all years; county trends from each county's own record)
    if loso:
        trall = county_trends(D, CUTOFF)
        Da = _with_trend(D[D["year"] <= CUTOFF], trall)
        per, Ps, parts = {}, [], []
        fast = {**LGB_PARAMS, "n_estimators": 220}
        for st in sorted(Da["state"].unique()):
            te = Da["state"] == st
            if te.sum() < 100 or Da.loc[~te, "state"].nunique() < 2:
                continue
            f = fit_cqr(Da[~te], feats, n_folds=3, params=fast)
            Pst = _predict3(f["models"], Da.loc[te, feats].to_numpy(float))
            per[st] = _evaluate(Da[te], Pst, f["q_hat"])
            h = Da.loc[te, ["fips", "state", "year", "yield", "trend", "anom"]].copy()
            h["p10"], h["p50"], h["p90"] = h["trend"] * (1 + Pst[:, 0] - f["q_hat"]), h["trend"] * (1 + Pst[:, 1]), \
                h["trend"] * (1 + Pst[:, 2] + f["q_hat"])
            parts.append(h)
            Ps.append((Da[te], Pst, f["q_hat"]))
        if Ps:
            Dl = pd.concat([x[0] for x in Ps])
            Pl = np.vstack([x[1] for x in Ps])
            ql = np.concatenate([np.full(len(x[0]), x[2]) for x in Ps])
            res["loso"] = {"pooled": metrics(Dl["yield"].to_numpy(float), Dl["trend"].to_numpy(float), Pl, Pl[:, 0] - ql,
                                             Pl[:, 2] + ql, Dl["anom"].to_numpy(float)), "by_state": per}
            hl = pd.concat(parts)
            hl["crop"], hl["split"] = crop, "loso"
            holds.append(hl)
    return res, pd.concat(holds, ignore_index=True)


def train_production(crop: str, D: pd.DataFrame) -> dict:
    feats = feature_names(crop)
    fit = fit_cqr_rolling(D, feats, CUTOFF)
    Da = fit["data"]
    ss, pooled = state_slopes(D, CUTOFF)
    imp = fit["models"][1].booster_.feature_importance("gain")
    # one genuinely new season: NASS 2025 county yields were not used for training (cutoff 2024)
    nxt = None
    D25 = _with_trend(D[D["year"] == CUTOFF + 1], county_trends(D, CUTOFF))
    if len(D25) >= 30:
        P25 = _predict3(fit["models"], D25[feats].to_numpy(float))
        nxt = {"season": CUTOFF + 1, **_evaluate(D25, P25, fit["q_hat"])}
    return {"next_season_check": nxt,"crop": crop, "unit": CROPS[crop]["unit"], "features": feats, "q_hat": fit["q_hat"],
            "cqr": {"scheme": "rolling origin, 3-season horizon", "origins": fit["origins"], "n_scores": fit["n_scores"]},
            "state_slopes": {k: round(v, 4) for k, v in ss.items()}, "pooled_slope": round(pooled, 4),
            "models": [m.booster_.model_to_string() for m in fit["models"]],
            "n_rows": int(len(Da)), "n_counties": int(Da["fips"].nunique()), "states": sorted(Da["state"].unique().tolist()),
            "years": [int(Da["year"].min()), int(Da["year"].max())],
            "importance": dict(sorted(zip(feats, (imp / imp.sum()).round(4).tolist()), key=lambda x: -x[1])),
            "feature_ranges": {f: [float(Da[f].quantile(0.01)), float(Da[f].quantile(0.99))] for f in feats}}


# ============================================================================ inference
@lru_cache(maxsize=1)
def load() -> dict | None:
    for p in (COMMITTED,):
        if p.exists():
            with gzip.open(p, "rt", encoding="utf-8") as f:
                return json.load(f)
    return None


@lru_cache(maxsize=16)
def _boosters(crop: str):
    import lightgbm as lgb
    art = load()
    return [lgb.Booster(model_str=s) for s in art["crops"][crop]["models"]]


def _qf_samples(P: np.ndarray, n: int = 200) -> np.ndarray:
    """Sample a per-year predictive distribution from its P10/P50/P90 (piecewise-linear quantile function,
    tails extended with the same slope to P0/P100)."""
    u = (np.arange(n) + 0.5) / n
    q10, q50, q90 = P[:, 0:1], P[:, 1:2], P[:, 2:3]
    lo = q50 - (q50 - q10) * (0.5 - u) / 0.4
    hi = q50 + (q90 - q50) * (u - 0.5) / 0.4
    return np.where(u < 0.5, lo, hi)


PRACTICE_MIN_PAIRED = 5
PRACTICE_LABEL = {"irrigated": "irrigated", "nonirrigated": "non-irrigated (dryland)"}


def practice_factors(crop: str, fips: str, practice: str, exclude_year: int | None = None,
                     _tables: tuple | None = None) -> dict | None:
    """How a county's practice-specific NASS yield (irrigated or non-irrigated) relates to its all-practices yield,
    from the years both were published (NASS stopped most practice series after 2018):
      level ratio r  = median(practice yield / all-practices yield)
      spread ratio s = SD of detrended log practice yield / SD of detrended log all-practices yield (clipped 1-3).
    M2's all-practices range is then mapped as yield = r * trend * (1 + s * anomaly). None if < 5 paired years."""
    from ..ingest import nass
    a, d = _tables or (nass.county_yields(crop), nass.practice_yields(crop, practice))
    a = a[a["fips"] == fips].set_index("year")["yield"].astype(float)
    d = d[d["fips"] == fips].set_index("year")["value"].astype(float)
    j = pd.concat([a.rename("all"), d.rename("prac")], axis=1, join="inner").dropna()
    j = j[(j["all"] > 0) & (j["prac"] > 0)]
    if exclude_year is not None:
        j = j[j.index != exclude_year]
    if len(j) < PRACTICE_MIN_PAIRED:
        return None
    t = j.index.to_numpy(float)

    def resid_sd(v):
        lv = np.log(v.to_numpy(float))
        b = np.polyfit(t, lv, 1)
        return float(np.std(lv - np.polyval(b, t), ddof=1))
    sa = resid_sd(j["all"])
    # never narrower than M2's own range: on held-out states, shrinking the swing for irrigated series
    # under-covered (0.67-0.75), while widening it for dryland series was needed (see validate_practice)
    sp_ = float(np.clip(resid_sd(j["prac"]) / sa, 1.0, 3.0)) if sa > 1e-6 else 1.0
    return {"level_ratio": float(np.median(j["prac"] / j["all"])), "spread_ratio": sp_, "n_paired": int(len(j)),
            "paired_years": [int(j.index.min()), int(j.index.max())]}


def validate_practice(crops: list[str] | None = None) -> dict:
    """Check the practice mapping on the leave-one-state-out hold-out ranges: for every county-year with a
    practice-specific yield, estimate r and s from that county's OTHER paired years and test whether the mapped 80%
    range holds the practice yield. Compared with using the all-practices range unchanged."""
    from ..ingest import nass
    H = pd.read_parquet(MODELS_DIR / "m02_yield" / "holdout_predictions.parquet")
    H = H[H["split"] == "loso"]
    out = {}
    for crop in crops or [c for c in CROPS]:
        Hc = H[H["crop"] == crop]
        allp = nass.county_yields(crop)
        for prac in ("irrigated", "nonirrigated"):
            d = nass.practice_yields(crop, prac)
            m = Hc.merge(d.rename(columns={"value": "prac"}), on=["fips", "year"])
            if len(m) < 50:
                continue
            rows = []
            for _, r in m.iterrows():
                f = practice_factors(crop, r["fips"], prac, exclude_year=int(r["year"]), _tables=(allp, d))
                if f is None:
                    continue
                tr = float(r["trend"])
                q = np.array([r["p10"], r["p50"], r["p90"]], float) / tr - 1
                adj = f["level_ratio"] * tr * (1 + f["spread_ratio"] * q)  # spread ratio floored at 1
                lvl = f["level_ratio"] * tr * (1 + q)
                rows.append((r["prac"], *adj, *lvl, r["p10"], r["p50"], r["p90"]))
            if len(rows) < 30:
                continue
            R = np.array(rows, float)
            y = R[:, 0]

            def ev(lo, mid, hi):
                pl = np.mean([pinball(y, x, a) for x, a in ((lo, 0.1), (mid, 0.5), (hi, 0.9))])
                return {"coverage80": round(float(np.mean((y >= lo) & (y <= hi))), 3), "pinball": round(float(pl), 2),
                        "mae_p50": round(float(np.mean(np.abs(y - mid))), 2), "width80": round(float(np.mean(hi - lo)), 1)}
            out[f"{crop}/{prac}"] = {"n": int(len(R)), "mapped": ev(R[:, 1], R[:, 2], R[:, 3]),
                                     "level_only": ev(R[:, 4], R[:, 5], R[:, 6]),
                                     "all_practices_unchanged": ev(R[:, 7], R[:, 8], R[:, 9])}
    return out


def county_outlook(crop: str, county_fips: str, wx: pd.DataFrame, lat: float, elev: float,
                   target_year: int | None = None, practice: str | None = None) -> dict:
    """Typical-year county yield P10/P50/P90 for `crop` from M2 run over every historical weather year at this
    location, around the NASS county trend. `practice` = 'irrigated' / 'nonirrigated' maps the all-practices range
    to that practice when the county has NASS practice-specific yields (see practice_factors); otherwise the
    all-practices range is returned with a note. Returns {'available': False, 'reason': ...} when it can't run."""
    art = load()
    if not art or crop not in art.get("crops", {}):
        return {"available": False, "reason": f"no M2 yield model for {crop}"}
    if not art["crops"][crop].get("deployed", True):
        return {"available": False, "reason": art["crops"][crop].get("not_deployed_reason")}
    from ..ingest import nass
    meta = art["crops"][crop]
    y = nass.county_yields(crop)
    y = y[(y["fips"] == county_fips) & (y["year"] <= art["cutoff"]) & y["yield"].notna()]
    if len(y) < MIN_YEARS:
        return {"available": False, "reason": f"USDA NASS has {len(y)} years of county {crop.replace('_', ' ')} yields here "
                                              f"(need {MIN_YEARS}); no county yield statistics to anchor M2"}
    st = y["state"].iloc[0]
    slope = float(meta["state_slopes"].get(st, meta["pooled_slope"]))
    icpt = float(np.median(y["yield"].to_numpy(float) - slope * (y["year"].to_numpy(float) - 2000.0)))
    ty = target_year or min(date.today().year + (1 if date.today().month >= 8 else 0), art["cutoff"] + 3)
    trend = icpt + slope * (ty - 2000)
    if trend <= 0:
        return {"available": False, "reason": "county yield trend is not positive"}
    F = season_features(wx, lat, elev, crop)
    F["trend_level"] = np.log(trend)
    F = F.dropna(subset=[f for f in meta["features"] if f not in ("trend_level", "lag_anom")])
    if len(F) < 10:
        return {"available": False, "reason": f"only {len(F)} complete weather seasons at this location"}
    X = F[meta["features"]].to_numpy(float)
    bs = _boosters(crop)
    P = np.sort(np.column_stack([b.predict(X) for b in bs]), axis=1)
    P[:, 0] -= meta["q_hat"]
    P[:, 2] += meta["q_hat"]
    # production practice: map the all-practices range to the irrigated / non-irrigated county series
    r_lvl, s_spr, prac_info = 1.0, 1.0, None
    if practice in PRACTICE_LABEL:
        fct = practice_factors(crop, county_fips, practice)
        if fct:
            r_lvl, s_spr = fct["level_ratio"], fct["spread_ratio"]
            prac_info = {"series": practice, **{k: (round(v, 3) if isinstance(v, float) else v) for k, v in fct.items()},
                         "note": f"Mapped to this county's USDA NASS {PRACTICE_LABEL[practice]} yields: level × "
                                 f"{r_lvl:.2f} and year-to-year swing × {s_spr:.2f}, from {fct['n_paired']} years when "
                                 f"NASS published both ({fct['paired_years'][0]}–{fct['paired_years'][1]})."}
        else:
            prac_info = {"series": "all", "requested": practice,
                         "note": f"USDA NASS has fewer than {PRACTICE_MIN_PAIRED} years of {PRACTICE_LABEL[practice]} "
                                 "county yields here, so this is the county average of all practices "
                                 "(irrigated and dryland together)."}
    trend_p = trend * r_lvl
    P = P * s_spr  # anomaly quantiles scaled by the practice's relative swing
    S = trend_p * (1 + _qf_samples(P))
    p10, p50, p90 = np.percentile(S.ravel(), [10, 50, 90])
    trend = trend_p
    contrib = bs[1].predict(X, pred_contrib=True)[:, :-1] * trend * s_spr   # bu/ac per feature per weather year
    mabs = np.abs(contrib).mean(axis=0)
    order = [i for i in np.argsort(-mabs) if meta["features"][i] not in ("trend_level", "lag_anom")][:3]
    drivers = [{"feature": meta["features"][i], "label": LABELS.get(meta["features"][i], meta["features"][i]),
                "mean_abs_effect": round(float(mabs[i]), 1), "unit": meta["unit"]} for i in order]
    worst = int(np.argmin(P[:, 1]))
    wi = [i for i in np.argsort(contrib[worst]) if meta["features"][i] not in ("trend_level", "lag_anom")][:2]
    worst_year = {"year": int(F.index[worst]), "p50": round(float(trend * (1 + P[worst, 1])), 1),
                  "drivers": [LABELS.get(meta["features"][i], meta["features"][i]) for i in wi]}
    # applicability: weather inside the training range?
    rng = meta["feature_ranges"]
    out_share = float(np.mean([[not (rng[f][0] <= v <= rng[f][1]) for f, v in zip(meta["features"], row)
                                if f not in ("trend_level", "lag_anom") and not np.isnan(v)] for row in X]))
    harvested = nass.county_yields(crop)
    harvested = harvested[(harvested["fips"] == county_fips) & harvested["harvested_ac"].notna()]
    planted = nass.county_table()
    planted = planted[(planted["fips"] == county_fips) & (planted["crop"] == crop) & (planted["stat"] == "planted_ac")]
    share = None
    if len(harvested) and len(planted):
        j = harvested.merge(planted[["year", "value"]], on="year")
        j = j[j["year"] > art["cutoff"] - 10]
        if len(j) >= 3 and (j["value"] > 0).all():
            share = float(np.clip(np.median(j["harvested_ac"] / j["value"]), 0, 1))
    return {"available": True, "crop": crop, "unit": meta["unit"], "p10": round(float(p10), 1), "p50": round(float(p50), 1),
            "p90": round(float(p90), 1), "trend_yield": round(float(trend), 1), "trend_year": int(ty),
            "trend_slope_per_year": round(float(slope), 2), "county_years": [int(y["year"].min()), int(y["year"].max())],
            "county_n_years": int(len(y)), "weather_years": [int(F.index.min()), int(F.index.max())], "n_weather_years": int(len(F)),
            "drivers": drivers, "worst_weather_year": worst_year, "out_of_range_share": round(out_share, 3),
            "harvested_share_of_planted": None if share is None else round(share, 3),
            "per_year_p50": {int(k): round(float(trend * (1 + v)), 1) for k, v in zip(F.index, P[:, 1])},
            "practice": prac_info,
            "county_fips": county_fips, "cutoff": art["cutoff"], "validation": meta.get("validation_summary")}


# ============================================================================ main
def _compact_holdout(H: pd.DataFrame) -> pd.DataFrame:
    H = H[["crop", "split", "fips", "state", "year", "yield", "trend", "p10", "p50", "p90"]].copy()
    for c in ("crop", "split", "fips", "state"):
        H[c] = H[c].astype("category")
    H["year"] = H["year"].astype("int16")
    for c in ("yield", "trend", "p10", "p50", "p90"):
        H[c] = H[c].astype("float32").round(2)
    return H.reset_index(drop=True)



def run_all(crops: list[str] | None = None, loso: bool = True) -> dict:
    import pickle
    crops = crops or list(CROPS)
    out = {"model_id": MODEL_ID, "cutoff": CUTOFF, "created": date.today().isoformat(), "crops": {}, "validation": {}}
    holds = []
    for crop in crops:
        t0 = time.time()
        D = build_dataset(crop)
        res, hold = validate(crop, D, loso=loso)
        prod = train_production(crop, D)
        tm = res["temporal"]["model"]
        beats = all(tm["pinball_bu"] < res["temporal"][b]["pinball_bu"] for b in ("B1", "B2"))
        prod["deployed"] = bool(beats)
        if not beats:
            prod["not_deployed_reason"] = (f"M2 for {crop.replace('_', ' ')} did not beat the simple baselines on held-out "
                                           f"{TEST_YEARS[0]}–{TEST_YEARS[1]} county yields, so the app does not use it")
            prod["models"] = []  # keep validation only
        lo = (res.get("loso") or {}).get("pooled") or {}
        prod["validation_summary"] = {"temporal_coverage80": tm["coverage80"], "temporal_width80": tm["width80_bu"],
                                      "temporal_r2_anom": tm["r2_anom"], "loso_coverage80": lo.get("coverage80"),
                                      "test_years": list(TEST_YEARS)}
        out["crops"][crop] = prod
        out["validation"][crop] = res
        holds.append(hold)
        print(f"[{crop}] rows={len(D)} counties={D['fips'].nunique()} temporal={tm} B1={res['temporal']['B1']} "
              f"B2={res['temporal']['B2']} loso={lo} {time.time() - t0:.0f}s", flush=True)
    COMMITTED.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(COMMITTED, "wt", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    H = pd.concat(holds, ignore_index=True)
    with open(ARTIFACT, "wb") as f:
        pickle.dump({"artifact": out, "holdout": H}, f)
    (MODELS_DIR / "m02_yield" / "validation.json").write_text(json.dumps(out["validation"], indent=1), encoding="utf-8")
    _compact_holdout(H).to_parquet(MODELS_DIR / "m02_yield" / "holdout_predictions.parquet", compression="zstd")
    load.cache_clear()
    return out


if __name__ == "__main__":
    import sys
    run_all(sys.argv[1:] or None)
