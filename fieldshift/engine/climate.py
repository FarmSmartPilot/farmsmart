"""Climate normals, trends, this-season anomalies and weekly hazard climatology (M5 climatology layer)
from NASA POWER daily data. Every function works on real observations only; missing data -> None."""
from __future__ import annotations

import math
from datetime import date

import numpy as np
import pandas as pd
from scipy import stats

NORMAL = (1991, 2020)
WIND_THRESHOLD_10M = 8.0      # m/s at 10 m: approximate threshold for wind erosion of bare loose soil
                              # (Fryrear et al. 1998 RWEQ; Bagnold 1941). Reported as "wind exposure", not soil loss.
HEAT_C = 35.0                 # daily max: heat stress for most summer grain crops at flowering
FROST_C = 0.0                 # daily min (2 m air) at or below 0 °C
HEAVY_RAIN_MM = 25.4          # 1 inch/day


def _years(df: pd.DataFrame, a: int, b: int) -> pd.DataFrame:
    return df[(df.index.year >= a) & (df.index.year <= b)]


def full_years(df: pd.DataFrame) -> list[int]:
    cnt = df["T2M"].groupby(df.index.year).count()
    return [int(y) for y, n in cnt.items() if n >= 360]


def et0_pm(df: pd.DataFrame, lat: float, elev_m: float) -> pd.Series:
    """FAO-56 Penman-Monteith reference ET (mm/day), eq. 6, from POWER daily fields.
    Uses ALLSKY_SFC_SW_DWN (MJ m-2 d-1), RH2M, WS2M, T2M_MAX/MIN."""
    tmax, tmin = df["T2M_MAX"], df["T2M_MIN"]
    tmean = (tmax + tmin) / 2
    rs = df["ALLSKY_SFC_SW_DWN"]
    if rs.median() < 12 and rs.max() < 12:  # POWER may return kWh m-2 d-1; convert
        rs = rs * 3.6
    u2 = df["WS2M"]
    P = 101.3 * ((293 - 0.0065 * elev_m) / 293) ** 5.26
    gamma = 0.000665 * P
    es = lambda t: 0.6108 * np.exp(17.27 * t / (t + 237.3))  # noqa: E731
    es_ = (es(tmax) + es(tmin)) / 2
    ea = es_ * df["RH2M"] / 100
    delta = 4098 * es(tmean) / (tmean + 237.3) ** 2
    J = df.index.dayofyear.values
    phi = math.radians(lat)
    dr = 1 + 0.033 * np.cos(2 * np.pi * J / 365)
    dec = 0.409 * np.sin(2 * np.pi * J / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(dec), -1, 1))
    Ra = 24 * 60 / np.pi * 0.0820 * dr * (ws * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(ws))
    Rso = (0.75 + 2e-5 * elev_m) * Ra
    Rns = 0.77 * rs
    sigma = 4.903e-9
    Rnl = sigma * (((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2) * (0.34 - 0.14 * np.sqrt(ea.clip(lower=0))) * \
        (1.35 * np.clip(rs / Rso, 0.3, 1.0) - 0.35)
    Rn = Rns - Rnl
    et0 = (0.408 * delta * Rn + gamma * 900 / (tmean + 273) * u2 * (es_ - ea)) / (delta + gamma * (1 + 0.34 * u2))
    return et0.clip(lower=0)


def frost_dates(df: pd.DataFrame, years: list[int]) -> dict:
    last_spring, first_fall, ffd = [], [], []
    for y in years:
        d = df[df.index.year == y]["T2M_MIN"]
        spring = d[(d.index.month <= 7) & (d <= FROST_C)]
        fall = d[(d.index.month >= 7) & (d <= FROST_C)]
        ls = spring.index.max().dayofyear if len(spring) else None
        ff = fall.index.min().dayofyear if len(fall) else None
        if ls is not None:
            last_spring.append(ls)
        if ff is not None:
            first_fall.append(ff)
        if ls is not None and ff is not None:
            ffd.append(ff - ls - 1)
    def q(a, p):
        return int(np.percentile(a, p)) if a else None
    return {
        "last_spring_frost_doy_median": q(last_spring, 50), "last_spring_frost_doy_p90": q(last_spring, 90),
        "first_fall_frost_doy_median": q(first_fall, 50), "first_fall_frost_doy_p10": q(first_fall, 10),
        "frost_free_days_median": q(ffd, 50), "frost_free_days_p10": q(ffd, 10),
        "frost_free_years": len(years) - len(first_fall),  # years with no fall frost (tropics)
    }


def gdd(df: pd.DataFrame, base: float = 10.0, cap: float = 30.0) -> pd.Series:
    tmax = df["T2M_MAX"].clip(upper=cap)
    tmin = df["T2M_MIN"].clip(lower=base)
    return (((tmax + tmin) / 2) - base).clip(lower=0)


def _trend(series: pd.Series) -> dict:
    s = series.dropna()
    if len(s) < 10:
        return {"per_decade": None, "p_value": None, "n_years": int(len(s))}
    x = np.array(s.index, float)
    ts = stats.theilslopes(s.values, x)
    tau = stats.kendalltau(x, s.values)
    return {"per_decade": float(ts.slope * 10), "low": float(ts.low_slope * 10), "high": float(ts.high_slope * 10),
            "p_value": float(tau.pvalue), "n_years": int(len(s)), "first_year": int(x[0]), "last_year": int(x[-1])}


def summarize(df: pd.DataFrame, lat: float) -> dict:
    yrs = full_years(df)
    norm_yrs = [y for y in yrs if NORMAL[0] <= y <= NORMAL[1]]
    n = _years(df, *NORMAL)
    elev = df.attrs.get("elevation_m", 0) or 0
    et0 = et0_pm(df, lat, elev)
    g = gdd(df)
    annual = pd.DataFrame({
        "tmean": df["T2M"].groupby(df.index.year).mean(),
        "precip": df["PRECTOTCORR"].groupby(df.index.year).sum(min_count=330),
        "hot_days": (df["T2M_MAX"] >= HEAT_C).groupby(df.index.year).sum(),
        "heavy_rain_days": (df["PRECTOTCORR"] >= HEAVY_RAIN_MM).groupby(df.index.year).sum(),
        "et0": et0.groupby(df.index.year).sum(min_count=330),
        "gdd10": g.groupby(df.index.year).sum(),
        "windy_days": (df["WS10M_MAX"] >= WIND_THRESHOLD_10M).groupby(df.index.year).sum(),
    }).loc[yrs]
    annual["water_balance"] = annual["precip"] - annual["et0"]
    normals = {k: float(annual.loc[norm_yrs, k].mean()) for k in annual.columns} if norm_yrs else {}
    monthly = pd.DataFrame({
        "tmean": n["T2M"].groupby(n.index.month).mean(),
        "tmax": n["T2M_MAX"].groupby(n.index.month).mean(),
        "tmin": n["T2M_MIN"].groupby(n.index.month).mean(),
        "precip": n["PRECTOTCORR"].groupby([n.index.year, n.index.month]).sum().groupby(level=1).mean(),
        "et0": et0[n.index].groupby([n.index.year, n.index.month]).sum().groupby(level=1).mean(),
        "wind10_max": n["WS10M_MAX"].groupby(n.index.month).mean(),
    })
    trends = {k: _trend(annual[k]) for k in ["tmean", "precip", "hot_days", "heavy_rain_days", "water_balance", "gdd10"]}
    return {
        "years": [yrs[0], yrs[-1]] if yrs else None, "normal_period": list(NORMAL), "n_normal_years": len(norm_yrs),
        "normals": normals, "monthly": monthly.round(2).reset_index(names="month").to_dict("records"),
        "frost": frost_dates(df, norm_yrs or yrs), "trends": trends,
        "annual": annual.round(2).reset_index(names="year").to_dict("records"),
        "elevation_m": elev,
    }


def this_season(df: pd.DataFrame, lat: float, today: date | None = None) -> dict:
    """Year-to-date vs the same calendar window in every full prior year (percentile ranks)."""
    last = df["T2M"].dropna().index.max()
    today = (today and pd.Timestamp(today)) or last
    y = today.year
    doy = today.dayofyear
    elev = df.attrs.get("elevation_m", 0) or 0
    et0 = et0_pm(df, lat, elev)
    g = gdd(df)
    rows = []
    for yy in full_years(df) + [y]:
        sl = df[(df.index.year == yy) & (df.index.dayofyear <= doy)]
        if len(sl) < doy * 0.9:
            continue
        rows.append({"year": yy, "precip": sl["PRECTOTCORR"].sum(), "gdd10": g[sl.index].sum(),
                     "et0": et0[sl.index].sum(), "tmean": sl["T2M"].mean(),
                     "rootzone_wetness": df["GWETROOT"][sl.index][-30:].mean(),
                     "heavy_rain_days": int((sl["PRECTOTCORR"] >= HEAVY_RAIN_MM).sum()),
                     "hot_days": int((sl["T2M_MAX"] >= HEAT_C).sum())})
    t = pd.DataFrame(rows).set_index("year")
    if y not in t.index:
        return {"available": False, "reason": f"POWER data for {y} incomplete"}
    cur = t.loc[y]
    hist = t.drop(index=y)
    out = {"available": True, "as_of": str(today.date()), "year": y, "n_years_compared": int(len(hist)), "metrics": {}}
    for k in t.columns:
        h = hist[k].dropna()
        v = cur[k]
        if pd.isna(v) or len(h) < 10:
            out["metrics"][k] = {"value": None}
            continue
        out["metrics"][k] = {"value": float(v), "normal": float(h.mean()),
                             "percentile": float(stats.percentileofscore(h.values, v, kind="mean"))}
    return out


def weekly_hazards(df: pd.DataFrame, lat: float, years: list[int] | None = None) -> pd.DataFrame:
    """52-week climatology of hazard probabilities and erosivity share. Week w covers DOY 7w+1..7w+7."""
    yrs = years or full_years(df)
    d = df[df.index.year.isin(yrs)].copy()
    d["week"] = np.minimum((d.index.dayofyear - 1) // 7, 51)
    d["year"] = d.index.year
    p = d["PRECTOTCORR"].fillna(0)
    wet = p[p >= 1]
    p95 = float(np.percentile(wet, 95)) if len(wet) > 50 else HEAVY_RAIN_MM
    d["frost"] = d["T2M_MIN"] <= FROST_C
    d["heat"] = d["T2M_MAX"] >= HEAT_C
    d["heavy"] = p >= max(p95, 12.7)
    d["windy"] = d["WS10M_MAX"] >= WIND_THRESHOLD_10M
    d["p14"] = p.rolling(14, min_periods=10).sum()
    d["dry"] = d["p14"] < 5
    # Richardson-type daily erosivity shape (erosive days >= 12.7 mm), scaled to annual R below
    d["ei_shape"] = np.where(p >= 12.7, p ** 1.81, 0.0)
    wk = d.groupby(["year", "week"]).agg(frost=("frost", "any"), heat=("heat", "any"), heavy=("heavy", "any"),
                                         windy_days=("windy", "sum"), dry=("dry", "any"), ei=("ei_shape", "sum"),
                                         precip=("PRECTOTCORR", "sum"), wind_max=("WS10M_MAX", "mean"))
    clim = wk.groupby(level="week").agg(p_frost=("frost", "mean"), p_heat=("heat", "mean"), p_heavy=("heavy", "mean"),
                                        windy_days=("windy_days", "mean"), p_dry=("dry", "mean"), ei=("ei", "mean"),
                                        precip=("precip", "mean"), wind_max=("wind_max", "mean"))
    clim["erosivity_share"] = clim["ei"] / clim["ei"].sum() if clim["ei"].sum() > 0 else 0
    clim["p_windy"] = clim["windy_days"] / 7
    clim.attrs["heavy_rain_threshold_mm"] = max(p95, 12.7)
    return clim.drop(columns=["ei"])


def r_factor(annual_precip_mm: float) -> float:
    """RUSLE rainfall erosivity R (MJ mm ha-1 h-1 yr-1) from mean annual precipitation,
    Renard & Freimund (1994) J. Hydrology 157:287-306."""
    P = annual_precip_mm
    return 0.0483 * P ** 1.61 if P <= 850 else 587.8 - 1.219 * P + 0.004105 * P ** 2
