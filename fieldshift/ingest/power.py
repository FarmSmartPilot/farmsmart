"""NASA POWER daily and hourly point time series (keyless)."""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

from ..config import CACHE, http

DAILY_PARAMS = ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "WS2M", "WS2M_MAX", "WS10M", "WS10M_MAX",
                "RH2M", "ALLSKY_SFC_SW_DWN", "GWETTOP", "GWETROOT", "EVPTRNS", "T2MDEW", "PS"]
BASE = "https://power.larc.nasa.gov/api/temporal"


def _grid_key(lat: float, lon: float) -> tuple[float, float]:
    # POWER meteorology grid is 0.5 x 0.625; snap so nearby fields share one cache entry
    return round(lat * 2) / 2, round(lon / 0.625) * 0.625


def _latest_end() -> date:
    # POWER daily latency is a few days for MERRA-2 based parameters; request to ~yesterday and drop -999
    return date.today() - timedelta(days=2)


def daily(lat: float, lon: float, start: date = date(1991, 1, 1), end: date | None = None) -> pd.DataFrame:
    """Daily weather DataFrame indexed by date. Missing values (-999) -> NaN."""
    end = end or _latest_end()
    glat, glon = _grid_key(lat, lon)
    pq = CACHE / f"power_daily_{glat:.2f}_{glon:.3f}_{start:%Y%m%d}_{end:%Y%m}.parquet"
    if pq.exists():
        return pd.read_parquet(pq)
    url = f"{BASE}/daily/point"
    params = dict(parameters=",".join(DAILY_PARAMS), community="AG", longitude=glon, latitude=glat,
                  start=f"{start:%Y%m%d}", end=f"{end:%Y%m%d}", format="JSON", **{"time-standard": "LST"})
    r = http().get(url, params=params, timeout=180)
    r.raise_for_status()
    js = r.json()
    p = js["properties"]["parameter"]
    df = pd.DataFrame(p)
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    df = df.replace(-999.0, np.nan).astype(float)
    df.attrs["elevation_m"] = js["geometry"]["coordinates"][2]
    df.to_parquet(pq)
    return df


def hourly_wind(lat: float, lon: float, years: list[int]) -> pd.DataFrame:
    """Hourly 10 m wind speed (m/s) and direction (deg) for given years."""
    glat, glon = _grid_key(lat, lon)
    frames = []
    for y in years:
        pq = CACHE / f"power_hourly_wind_{glat:.2f}_{glon:.3f}_{y}.parquet"
        if pq.exists():
            frames.append(pd.read_parquet(pq))
            continue
        end = min(date(y, 12, 31), _latest_end())
        r = http().get(f"{BASE}/hourly/point", params=dict(
            parameters="WS10M,WD10M", community="AG", longitude=glon, latitude=glat,
            start=f"{y}0101", end=f"{end:%Y%m%d}", format="JSON", **{"time-standard": "LST"}), timeout=180)
        r.raise_for_status()
        p = r.json()["properties"]["parameter"]
        df = pd.DataFrame(p)
        df.index = pd.to_datetime(df.index, format="%Y%m%d%H")
        df = df.replace(-999.0, np.nan).astype(float)
        df.to_parquet(pq)
        frames.append(df)
    return pd.concat(frames).sort_index() if frames else pd.DataFrame()


def footprint(lat: float, lon: float) -> str:
    glat, glon = _grid_key(lat, lon)
    return f"POWER grid cell centred {glat:.2f}, {glon:.3f} (≈50 km); field at {lat:.4f}, {lon:.4f}"
