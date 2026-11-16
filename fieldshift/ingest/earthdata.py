"""NASA Earthdata products at field-sized subsets (EDL bearer token from .env, never logged).

Routes (tested 2026-11-14, see docs/DATA_SOURCES.md "Earthdata ingest"):
- SMAP L4 SPL4SMGP.008: Earthdata cloud OPeNDAP (Hyrax, DAP4 CSV), one 3-hourly granule per day, 9 km cell.
  AppEEARS rejects a plain EDL bearer token (403) and .env has no EDL username/password for /api/login.
- GPM IMERG GPM_3IMERGDF.07: GES DISC returns 403 "EULA Acceptance Failure" until the account owner approves
  the GES DISC application in their Earthdata profile. Code tries Giovanni time series, then cloud OPeNDAP,
  and otherwise returns None plus the reason.
- GRACE/GRACE-FO JPL mascon RL06.3Mv04 CRI: one NetCDF from PO.DAAC, downloaded once to data/cache/grace.
- HLS v2.0 (HLSL30 + HLSS30): CMR-STAC LPCLOUD search, then windowed COG reads (/vsicurl on the
  signed redirect URL, so the token never goes to GDAL or into a URL).

Every function returns real values or None plus a reason. Nothing is invented.
"""
from __future__ import annotations

import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import numpy as np
import pandas as pd
import requests

from ..config import CACHE, env

CMR = "https://cmr.earthdata.nasa.gov/search"
OPENDAP = "https://opendap.earthdata.nasa.gov/collections"
SMAP_CID = "C3480440870-NSIDC_CPRD"
IMERG_CID = "C2723754864-GES_DISC"      # GPM_3IMERGDF V07 (Final)
IMERG_LATE_CID = "C2723754859-GES_DISC"  # GPM_3IMERGDL V07 (Late), after Final ends
GRACE_CID = "C3195527175-POCLOUD"
STAC_LP = "https://cmr.earthdata.nasa.gov/stac/LPCLOUD"
GES_DISC_EULA_URL = "https://urs.earthdata.nasa.gov/approve_app?client_id=e2WVk8Pw6weeLUKZYOxvTQ"

EDC = CACHE / "earthdata"
EDC.mkdir(parents=True, exist_ok=True)

_local = threading.local()


class EarthdataUnavailable(RuntimeError):
    """Raised when a route is blocked (auth, EULA, service down). Message is safe to show (no secrets)."""


# --------------------------------------------------------------------------- HTTP helpers

def _token() -> str:
    t = env("EARTHDATA_TOKEN")
    if not t:
        raise EarthdataUnavailable("EARTHDATA_TOKEN is not set in .env")
    return t


class _EDLSession(requests.Session):
    """Keeps the bearer header only for NASA Earthdata hosts across redirects (drops it for S3/CloudFront)."""

    def rebuild_auth(self, prepared_request, response):  # noqa: D401
        host = urlparse(prepared_request.url).hostname or ""
        if not (host.endswith(".earthdata.nasa.gov") or host.endswith(".eosdis.nasa.gov")
                or host.endswith(".earthdatacloud.nasa.gov")):
            prepared_request.headers.pop("Authorization", None)


def _sess() -> requests.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = _EDLSession()
        s.headers["Authorization"] = f"Bearer {_token()}"
        s.headers["User-Agent"] = "FarmSmart/0.1 (Space Apps 2026)"
        _local.s = s
    return s


def _get(url: str, *, params=None, timeout=120, tries=4, **kw) -> requests.Response:
    last = None
    for i in range(tries):
        try:
            r = _sess().get(url, params=params, timeout=timeout, **kw)
            if r.status_code in (200, 206):
                return r
            if r.status_code in (401, 403):
                msg = r.text[:300]
                if "EULA" in msg:
                    raise EarthdataUnavailable(f"HTTP 403 EULA Acceptance Failure at {urlparse(url).hostname}: "
                                               f"approve the application in your Earthdata profile ({GES_DISC_EULA_URL})")
                raise EarthdataUnavailable(f"HTTP {r.status_code} at {urlparse(url).hostname} (token rejected or app not approved)")
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:  # network hiccup; retry
            last = type(e).__name__
        time.sleep(1.5 * (i + 1))
    raise EarthdataUnavailable(f"{urlparse(url).hostname}: {last} after {tries} tries")


def _cmr_granules(concept_id: str, temporal: str, name_pattern: str | None = None) -> list[dict]:
    """All granules (GranuleUR + https data URL + start time) for a collection and time range. Cached."""
    key = re.sub(r"[^A-Za-z0-9]+", "_", f"{concept_id}_{temporal}_{name_pattern}")
    f = EDC / f"cmr_{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    out, search_after = [], None
    while True:
        params = {"collection_concept_id": concept_id, "temporal": temporal, "page_size": 2000, "sort_key": "start_date"}
        if name_pattern:
            params["readable_granule_name"] = name_pattern
            params["options[readable_granule_name][pattern]"] = "true"
        hdr = {"CMR-Search-After": search_after} if search_after else {}
        r = requests.get(f"{CMR}/granules.umm_json", params=params, headers=hdr, timeout=120)
        r.raise_for_status()
        for it in r.json()["items"]:
            u = it["umm"]
            urls = [x["URL"] for x in u.get("RelatedUrls", []) if x.get("Type") == "GET DATA" and x["URL"].startswith("https")]
            out.append({"ur": u["GranuleUR"], "start": u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"],
                        "url": urls[0] if urls else None})
        search_after = r.headers.get("CMR-Search-After")
        if not search_after or not r.json()["items"]:
            break
    # only cache ranges fully in the past (so new granules are picked up later)
    end = temporal.split(",")[1][:10]
    if end and date.fromisoformat(end) < date.today() - timedelta(days=10):
        f.write_text(json.dumps(out))
    return out


def _dap4_csv(cid: str, ur: str, ce: str) -> dict[str, np.ndarray]:
    """Fetch a DAP4 constraint as CSV from Earthdata cloud OPeNDAP; returns {var: 2-D array}."""
    r = _get(f"{OPENDAP}/{cid}/granules/{quote(ur, safe='')}.dap.csv", params={"dap4.ce": ce}, timeout=120)
    rows: dict[str, list[list[float]]] = {}
    for line in r.text.splitlines():
        m = re.match(r"^(/[\w/]+)(\[\d+\])?,\s*(.*)$", line)
        if not m:
            continue
        rows.setdefault(m.group(1), []).append([float(v) for v in m.group(3).split(",") if v.strip()])
    return {k: np.array(v) for k, v in rows.items()}


def _evidence(key: str, footprint: str, start, end, *, effective_res=None, units=None, qa=None,
              transformation=None, extra=None) -> dict[str, Any]:
    from ..evidence import make
    def _d(x):
        return pd.Timestamp(x).date() if x is not None else None
    return make(key, footprint, obs=(_d(start), _d(end)), effective_res=effective_res, units=units, qa=qa,
                transformation=transformation, extra=extra).model_dump(mode="json")


# --------------------------------------------------------------------------- SMAP L4

SMAP_VARS = ("sm_rootzone", "sm_surface", "sm_rootzone_pctl")
SMAP_START = date(2015, 4, 1)
SMAP_HOUR = "T103000"  # 3-hourly granule centred 10:30 UTC (09:00-12:00 UTC average); one per day


# EASE-Grid 2.0 global 9 km (EPSG:6933): 3856 x 1624 cells (NSIDC grid definition)
_EASE_CELL = 9008.055210146
_EASE_X0, _EASE_Y0 = -17367530.44516138, 7314540.830638
_EASE_NCOL, _EASE_NROW = 3856, 1624


def smap_cell(lat: float, lon: float) -> tuple[int, int, float, float]:
    """EASE-Grid 2.0 9 km (row, col, cell-centre lat, lon) containing the point."""
    from pyproj import Transformer
    fwd = Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True)
    x, y = fwd.transform(lon, lat)
    c = int(np.floor((x - _EASE_X0) / _EASE_CELL))
    r = int(np.floor((_EASE_Y0 - y) / _EASE_CELL))
    if not (0 <= r < _EASE_NROW and 0 <= c < _EASE_NCOL):
        raise EarthdataUnavailable("point outside the SMAP EASE-Grid 2.0 9 km grid")
    clon, clat = Transformer.from_crs("EPSG:6933", "EPSG:4326", always_xy=True).transform(
        _EASE_X0 + (c + 0.5) * _EASE_CELL, _EASE_Y0 - (r + 0.5) * _EASE_CELL)
    return r, c, float(clat), float(clon)


def _smap_check_cell(r: int, c: int) -> tuple[float, float]:
    """cell_lat / cell_lon stored in the granule for (r, c): used to verify the grid maths."""
    g = _cmr_granules(SMAP_CID, "2020-01-14T22:00:00Z,2020-01-14T23:59:59Z")[0]
    a = _dap4_csv(SMAP_CID, g["ur"], f"/cell_lat[{r}:1:{r + 1}][{c}:1:{c + 1}];/cell_lon[{r}:1:{r + 1}][{c}:1:{c + 1}]")
    return float(a["/cell_lat"][0, 0]), float(a["/cell_lon"][0, 0])


def _smap_fetch_block(r0: int, r1: int, c0: int, c1: int, start: date, end: date, workers: int = 16) -> dict[tuple, pd.DataFrame]:
    """Daily (one granule/day) values for every cell in a small row/col block. Cached per year.
    Hyrax's CSV writer returns empty rows for a 1-cell slab, so blocks are at least 2 x 2."""
    r1, c1 = max(r1, r0 + 1), max(c1, c0 + 1)
    out: dict[tuple, list[pd.DataFrame]] = {}
    for y in range(start.year, end.year + 1):
        ys, ye = max(start, date(y, 1, 1)), min(end, date(y, 12, 31))
        pq = EDC / f"smap_{r0}_{r1}_{c0}_{c1}_{y}.parquet"
        have = pd.read_parquet(pq) if pq.exists() else pd.DataFrame()
        gran = _cmr_granules(SMAP_CID, f"{ys}T00:00:00Z,{ye}T23:59:59Z", f"SMAP_L4_SM_gph_*{SMAP_HOUR}_*")
        done = set(have["date"].astype(str)) if len(have) else set()
        todo = [g for g in gran if g["start"][:10] not in done]
        ce = ";".join(f"/Geophysical_Data/{v}[{r0}:1:{r1}][{c0}:1:{c1}]" for v in SMAP_VARS)

        def one(g):
            try:
                a = _dap4_csv(SMAP_CID, g["ur"], ce)
            except EarthdataUnavailable:
                return []
            rows = []
            for i, rr in enumerate(range(r0, r1 + 1)):
                for j, cc in enumerate(range(c0, c1 + 1)):
                    rec = {"date": g["start"][:10], "row": rr, "col": cc, "granule": g["ur"]}
                    for v in SMAP_VARS:
                        arr = a.get(f"/Geophysical_Data/{v}")
                        val = float(arr[i, j]) if arr is not None and arr.shape == (r1 - r0 + 1, c1 - c0 + 1) else np.nan
                        rec[v] = np.nan if val <= -9990 else val
                    rows.append(rec)
            return rows

        new = []
        if todo:
            with ThreadPoolExecutor(workers) as ex:
                for rows in ex.map(one, todo):
                    new.extend(rows)
        df = pd.concat([have, pd.DataFrame(new)], ignore_index=True) if new else have
        if len(df):
            df = df.drop_duplicates(["date", "row", "col"]).sort_values("date")
            df.to_parquet(pq)
            for (rr, cc), g in df.groupby(["row", "col"]):
                out.setdefault((int(rr), int(cc)), []).append(g)
    return {k: pd.concat(v) for k, v in out.items()}


def _cached_block(r: int, c: int) -> tuple[int, int, int, int] | None:
    """Reuse an already-cached SMAP block that contains this cell (e.g. one fetched for a neighbouring pilot)."""
    for f in EDC.glob("smap_*_*_*_*_*.parquet"):
        r0, r1, c0, c1 = (int(x) for x in f.stem.split("_")[1:5])
        if r0 <= r <= r1 and c0 <= c <= c1:
            return r0, r1, c0, c1
    return None


def smap_l4_rootzone(lat: float, lon: float, start: date | str = SMAP_START, end: date | str | None = None,
                     _block: tuple[int, int, int, int] | None = None) -> tuple[pd.DataFrame | None, dict]:
    """Daily SMAP L4 root-zone (0-100 cm) and surface (0-5 cm) soil moisture, m3/m3, at the 9 km cell.

    Returns (DataFrame indexed by date with sm_rootzone, sm_surface, sm_rootzone_pctl, or None; evidence dict).
    One 3-hourly analysis granule per day (09:00-12:00 UTC); root-zone moisture changes slowly, so this is a
    fair daily value, but surface moisture is a morning snapshot, not a daily mean."""
    start = pd.Timestamp(start).date()
    end = pd.Timestamp(end).date() if end else date.today()
    t0 = time.time()
    try:
        r, c, clat, clon = smap_cell(lat, lon)
        blk = _block or _cached_block(r, c) or (r, r, c, c)
        data = _smap_fetch_block(*blk, start, end)
    except (EarthdataUnavailable, requests.RequestException) as e:
        return None, {"available": False, "reason": f"SMAP L4 not retrieved: {e}"}
    df = data.get((r, c))
    if df is None or df[["sm_rootzone"]].dropna().empty:
        return None, {"available": False, "reason": "SMAP L4: no valid values at this 9 km cell (water, ice or outside grid)"}
    df = df.assign(date=pd.to_datetime(df["date"])).set_index("date")[list(SMAP_VARS)].sort_index()
    df = df.loc[str(start):str(end)]
    exp = pd.date_range(df.index.min(), df.index.max(), freq="D")
    missing = len(exp.difference(df.index))
    ev = _evidence("smap_l4", f"9 km EASE-Grid 2.0 cell row {r} col {c} (centre {clat:.3f}, {clon:.3f}) containing {lat:.4f},{lon:.4f}",
                   df.index.min(), df.index.max(), effective_res="9 km (regional value, not field soil moisture)", units="m3/m3",
                   qa=[f"one 3-hourly granule per day ({SMAP_HOUR[1:3]}:30 UTC centre)",
                       f"{missing} days missing in {df.index.min().date()}..{df.index.max().date()}",
                       "model-based analysis (GEOS land model + SMAP brightness-temperature assimilation)",
                       "sm_rootzone_pctl is the product's own percentile vs its model climatology"],
                   transformation="Earthdata cloud OPeNDAP DAP4 subset of Geophysical_Data/{sm_rootzone, sm_surface, sm_rootzone_pctl}")
    ev.update({"available": True, "product": "SPL4SMGP.008", "fetch_seconds": round(time.time() - t0, 1)})
    return df, ev


# --------------------------------------------------------------------------- IMERG

def _imerg_giovanni(lat: float, lon: float, start: date, end: date) -> pd.DataFrame:
    """Giovanni time-series API (one call for the whole series). Needs the GES DISC app approved in EDL."""
    r = requests.get("https://api.giovanni.earthdata.nasa.gov/timeseries",
                     params={"data": "GPM_3IMERGDF_07_precipitation", "location": f"[{lat:.4f},{lon:.4f}]",
                             "time": f"{start}T00:00:00/{end}T23:59:59"},
                     headers={"authorizationtoken": _token()}, timeout=600)
    if r.status_code != 200:
        msg = "token not accepted (approve GES DISC / Giovanni in your Earthdata profile)" if r.status_code in (401, 403) else f"HTTP {r.status_code}"
        raise EarthdataUnavailable(f"Giovanni time series: {msg}")
    lines = [ln for ln in r.text.splitlines() if re.match(r"^\d{4}-\d{2}-\d{2}", ln)]
    if not lines:
        raise EarthdataUnavailable("Giovanni time series: empty response")
    df = pd.DataFrame([ln.split(",")[:2] for ln in lines], columns=["date", "precip_mm"])
    df["date"] = pd.to_datetime(df["date"].str[:10])
    df["precip_mm"] = pd.to_numeric(df["precip_mm"], errors="coerce")
    return df.set_index("date")


def _imerg_opendap(lat: float, lon: float, start: date, end: date, workers: int = 16) -> pd.DataFrame:
    """Per-day cloud OPeNDAP point read (slow: one request per day). Cached per year."""
    i = int(np.floor((lon + 180) / 0.1))
    j = int(np.floor((lat + 90) / 0.1))
    frames = []
    for y in range(start.year, end.year + 1):
        pq = EDC / f"imerg_{i}_{j}_{y}.parquet"
        if pq.exists() and y < date.today().year - 1:
            frames.append(pd.read_parquet(pq))
            continue
        ys, ye = max(start, date(y, 1, 1)), min(end, date(y, 12, 31))
        rows = []
        for cid, tag in ((IMERG_CID, "Final"), (IMERG_LATE_CID, "Late")):
            gran = _cmr_granules(cid, f"{ys}T00:00:00Z,{ye}T23:59:59Z")
            have = {r_["date"] for r_ in rows}
            todo = [g for g in gran if g["start"][:10] not in have]

            def one(g, cid=cid, tag=tag):
                a = _dap4_csv(cid, g["ur"], f"/precipitation[0][{i}][{j}]")
                v = a.get("/precipitation")
                return {"date": g["start"][:10], "precip_mm": float(v.ravel()[0]) if v is not None else np.nan, "run": tag}

            with ThreadPoolExecutor(workers) as ex:
                rows.extend(ex.map(one, todo))
        df = pd.DataFrame(rows)
        if len(df):
            df.to_parquet(pq)
            frames.append(df)
    df = pd.concat(frames)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date").sort_index()


def imerg_daily(lat: float, lon: float, start: date | str = date(2001, 1, 1), end: date | str | None = None) -> tuple[pd.DataFrame | None, dict]:
    """GPM IMERG V07 daily precipitation (mm/day) at the 0.1° cell. Final run, then Late after Final ends."""
    start = pd.Timestamp(start).date()
    end = pd.Timestamp(end).date() if end else date.today() - timedelta(days=2)
    reasons = []
    for name, fn in (("giovanni", _imerg_giovanni), ("opendap", _imerg_opendap)):
        try:
            # probe one day first so a blocked route fails fast
            if name == "opendap":
                g = _cmr_granules(IMERG_CID, "2020-01-15T00:00:00Z,2020-01-15T23:59:59Z")[0]
                _dap4_csv(IMERG_CID, g["ur"], "/precipitation[0][0][0]")
            df = fn(lat, lon, start, end)
        except (EarthdataUnavailable, requests.RequestException) as e:
            reasons.append(f"{name}: {e}")
            continue
        clat, clon = np.floor(lat * 10) / 10 + 0.05, np.floor(lon * 10) / 10 + 0.05
        ev = _evidence("imerg", f"0.1° IMERG cell centred {clat:.2f}, {clon:.2f} containing {lat:.4f},{lon:.4f}",
                       df.index.min(), df.index.max(), effective_res="0.1° (≈10 km, regional value)", units="mm/day",
                       qa=["Final run (gauge-adjusted) to its end date, Late run after", "satellite estimate, not a rain gauge"],
                       transformation=f"route={name}")
        ev.update({"available": True, "product": "GPM_3IMERGDF.07"})
        return df, ev
    return None, {"available": False, "product": "GPM_3IMERGDF.07",
                  "reason": "IMERG not retrieved. " + " | ".join(reasons),
                  "fix": f"Account owner: sign in to Earthdata and approve the GES DISC application at {GES_DISC_EULA_URL}"}


# --------------------------------------------------------------------------- GRACE / GRACE-FO

def _grace_file() -> Path:
    d = CACHE / "grace"
    d.mkdir(exist_ok=True)
    have = sorted(d.glob("GRCTellus.JPL.*.nc"))
    if have and (time.time() - have[-1].stat().st_mtime) < 30 * 86400:
        return have[-1]
    g = _cmr_granules(GRACE_CID, f"2002-01-01T00:00:00Z,{date.today()}T23:59:59Z")
    url = [x for x in g if x["url"] and x["url"].endswith(".nc")][-1]["url"]
    f = d / url.rsplit("/", 1)[1]
    if not f.exists():
        r = _get(url, timeout=600, stream=True)
        tmp = f.with_suffix(".part")
        with open(tmp, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
        tmp.replace(f)
    return f


def grace_storage(lat: float, lon: float, trend_start: str = "2003-01-01") -> tuple[pd.DataFrame | None, dict]:
    """Monthly terrestrial water storage anomaly (cm water equivalent, vs 2004.0-2009.999 mean) at the
    0.5° CRI grid cell containing the point, which carries the value of its ~3° (≈300 km) mascon.
    Trend: Theil-Sen slope on de-seasonalised anomalies, trend_start..latest, using only months that
    exist (the 2017-07..2018-05 GRACE / GRACE-FO gap and single missing months are not filled)."""
    try:
        f = _grace_file()
    except (EarthdataUnavailable, requests.RequestException) as e:
        return None, {"available": False, "reason": f"GRACE mascon file not retrieved: {e}"}
    import netCDF4
    from scipy.stats import theilslopes
    with netCDF4.Dataset(f) as nc:
        lats = nc["lat"][:].data
        lons = nc["lon"][:].data
        lon360 = lon % 360
        i = int(np.argmin(np.abs(lats - lat)))
        j = int(np.argmin(np.abs(lons - lon360)))
        t = nc["time"]
        times = netCDF4.num2date(t[:], t.units, only_use_cftime_datetimes=False)
        lwe = nc["lwe_thickness"][:, i, j]
        unc = nc["uncertainty"][:, i, j] if "uncertainty" in nc.variables else None
        land = float(nc["land_mask"][i, j]) if "land_mask" in nc.variables else None
        title = getattr(nc, "title", "")
    df = pd.DataFrame({"lwe_cm": np.ma.filled(lwe.astype(float), np.nan),
                       "uncertainty_cm": np.ma.filled(unc.astype(float), np.nan) if unc is not None else np.nan},
                      index=pd.to_datetime([pd.Timestamp(x.year, x.month, x.day) for x in times]))
    df.index.name = "date"
    df["month"] = df.index.to_period("M").astype(str)
    s = df.loc[trend_start:, "lwe_cm"].dropna()
    clim = s.groupby(s.index.month).transform("mean")
    des = s - clim
    yrs = s.index.year + (s.index.day_of_year - 0.5) / 365.25
    slope, icpt, lo, hi = theilslopes(des.values, yrs.values, 0.95)
    allm = pd.period_range(df.index.min(), df.index.max(), freq="M")
    gap = len(allm) - df["month"].nunique()
    trend = {"cm_per_yr": round(float(slope), 3), "ci95_cm_per_yr": [round(float(lo), 3), round(float(hi), 3)],
             "method": "Theil-Sen on de-seasonalised monthly anomalies (month-of-year mean removed); gaps not filled",
             "period": [str(s.index.min().date()), str(s.index.max().date())], "n_months": int(len(s)),
             "missing_months_in_record": int(gap)}
    ev = _evidence("grace", f"0.5° CRI cell {lats[i]:.2f}, {lons[j] - 360 if lons[j] > 180 else lons[j]:.2f} (inside a ~3° mascon) containing {lat:.4f},{lon:.4f}",
                   df.index.min(), df.index.max(),
                   effective_res="regional (~300 km mascon), not a well",
                   units="cm water-equivalent anomaly vs 2004.0-2009.999",
                   qa=["Regional water storage (soil + groundwater + surface water + snow); it does not describe any one well",
                       f"{gap} months missing in the record (incl. GRACE→GRACE-FO gap 2017-07..2018-05)",
                       f"land_mask={land}"],
                   transformation=f"file {f.name}; Theil-Sen trend {trend['period'][0]}..{trend['period'][1]}")
    ev.update({"available": True, "product": "TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4", "scale_label": "regional (~300 km mascon), not a well",
               "file_title": title})
    df.attrs["trend"] = trend
    return df, ev


# --------------------------------------------------------------------------- HLS NDVI

HLS_BANDS = {"HLSL30_2.0": ("B04", "B05"), "HLSS30_2.0": ("B04", "B8A")}
# Fmask v2.0 bits: 1 cloud, 2 adjacent to cloud/shadow, 3 cloud shadow, 4 snow/ice, 5 water
FMASK_BAD = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5)
GREEN_NDVI = 0.25
STATUS_LABEL = "satellite greenness status (not residue amount)"


def _stac_items(bbox, year: int, max_cloud: int) -> list[dict]:
    f = EDC / f"hls_stac_{'_'.join(f'{b:.4f}' for b in bbox)}_{year}_{max_cloud}.json"
    if f.exists():
        return json.loads(f.read_text())
    body = {"collections": list(HLS_BANDS), "bbox": list(bbox), "limit": 250,
            "datetime": f"{year}-01-01T00:00:00Z/{year}-12-31T23:59:59Z"}
    items, url = [], f"{STAC_LP}/search"
    while url:
        r = requests.post(url, json=body, timeout=120)
        r.raise_for_status()
        j = r.json()
        for ft in j.get("features", []):
            cc = ft["properties"].get("eo:cloud_cover")
            if cc is not None and cc > max_cloud:
                continue
            red, nir = HLS_BANDS[ft["collection"]]
            items.append({"id": ft["id"], "collection": ft["collection"], "datetime": ft["properties"]["datetime"],
                          "cloud": cc, "red": ft["assets"][red]["href"], "nir": ft["assets"][nir]["href"],
                          "fmask": ft["assets"]["Fmask"]["href"]})
        nxt = [l for l in j.get("links", []) if l.get("rel") == "next"]
        if nxt:
            url, body = nxt[0]["href"], nxt[0].get("body", body)
        else:
            url = None
    if year < date.today().year:
        f.write_text(json.dumps(items))
    return items


def _signed(url: str) -> str:
    for i in range(4):
        r = _sess().get(url, allow_redirects=False, timeout=60)
        if r.status_code < 500:
            break
        time.sleep(2 * (i + 1))  # LP DAAC gives occasional 502/503 under load
    if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
        return r.headers["location"]
    if r.status_code in (401, 403):
        raise EarthdataUnavailable(f"LP DAAC HTTP {r.status_code} (token rejected or LP DAAC app not approved)")
    raise EarthdataUnavailable(f"LP DAAC: unexpected HTTP {r.status_code}")


def _pad_window(w):
    """Integer window that fully covers a fractional one (plus one pixel margin)."""
    from rasterio.windows import Window
    c0, r0 = int(np.floor(w.col_off)) - 1, int(np.floor(w.row_off)) - 1
    c1, r1 = int(np.ceil(w.col_off + w.width)) + 1, int(np.ceil(w.row_off + w.height)) + 1
    return Window(c0, r0, c1 - c0, r1 - r0)


def _hls_scene(item: dict, geom) -> dict:
    import rasterio
    from rasterio.features import geometry_mask
    from rasterio.warp import transform_geom
    from rasterio.windows import from_bounds
    from shapely.geometry import shape
    out = {"id": item["id"], "date": item["datetime"][:10], "sensor": "L30" if "L30" in item["collection"] else "S30",
           "scene_cloud_pct": item["cloud"]}
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                      GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="1"):
        with rasterio.open("/vsicurl/" + _signed(item["fmask"])) as ds:
            g = transform_geom("EPSG:4326", ds.crs, geom)
            w = _pad_window(from_bounds(*shape(g).bounds, ds.transform))
            fm = ds.read(1, window=w, boundless=True, fill_value=255)
            inside = ~geometry_mask([g], out_shape=fm.shape, transform=ds.window_transform(w), all_touched=False)
        bands = {}
        for k in ("red", "nir"):
            with rasterio.open("/vsicurl/" + _signed(item[k])) as ds:
                a = ds.read(1, window=w, boundless=True, fill_value=-9999).astype("float32")
                a[a == -9999] = np.nan
                bands[k] = a * 0.0001
    n_field = int(inside.sum())
    valid = inside & ((fm & FMASK_BAD) == 0) & (fm != 255) & np.isfinite(bands["red"]) & np.isfinite(bands["nir"])
    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = (bands["nir"] - bands["red"]) / (bands["nir"] + bands["red"])
    v = ndvi[valid]
    v = v[(v >= -1) & (v <= 1)]
    out.update({"field_pixels": n_field, "valid_pixels": int(v.size),
                "valid_fraction": round(v.size / n_field, 3) if n_field else 0.0,
                "ndvi_median": round(float(np.median(v)), 4) if v.size else None,
                "ndvi_p25": round(float(np.percentile(v, 25)), 4) if v.size else None,
                "ndvi_p75": round(float(np.percentile(v, 75)), 4) if v.size else None})
    return out


def hls_ndvi(geom: dict, years: list[int], *, max_cloud: int = 80, min_valid: float = 0.5,
             workers: int = 8, field_key: str | None = None) -> tuple[pd.DataFrame | None, pd.DataFrame | None, dict]:
    """Field-median NDVI per HLS scene (Fmask cloud, shadow, adjacent, snow, water removed) and a monthly
    bare / green status. Returns (scenes DataFrame, monthly DataFrame, evidence)."""
    from shapely.geometry import shape
    shp = shape(geom)
    bbox = shp.bounds
    key = field_key or f"{bbox[0]:.4f}_{bbox[1]:.4f}"
    t0 = time.time()
    frames, reasons = [], []
    for y in years:
        pq = EDC / f"hls_scenes_{key}_{y}.parquet"
        if pq.exists():
            frames.append(pd.read_parquet(pq))
            continue
        try:
            items = _stac_items(bbox, y, max_cloud)
        except requests.RequestException as e:
            reasons.append(f"{y}: STAC search failed ({type(e).__name__})")
            continue

        def one(it):
            try:
                return _hls_scene(it, geom)
            except EarthdataUnavailable as e:
                return {"id": it["id"], "date": it["datetime"][:10], "error": str(e)}
            except Exception as e:  # noqa: BLE001  (one bad COG should not stop the series)
                return {"id": it["id"], "date": it["datetime"][:10], "error": type(e).__name__}

        with ThreadPoolExecutor(workers) as ex:
            rows = list(ex.map(one, items))
        df = pd.DataFrame(rows)
        errs = int(df["error"].notna().sum()) if "error" in df else 0
        if errs and errs == len(df):
            reasons.append(f"{y}: all {errs} scene reads failed ({df['error'].iloc[0]})")
            continue
        df.to_parquet(pq)
        frames.append(df)
    if not frames:
        return None, None, {"available": False, "reason": "HLS: " + "; ".join(reasons or ["no scenes"])}
    sc = pd.concat(frames, ignore_index=True)
    sc["date"] = pd.to_datetime(sc["date"])
    if "error" not in sc:
        sc["error"] = None
    n_err = int(sc["error"].notna().sum())
    ok = sc[sc["error"].isna() & (sc["valid_fraction"] >= min_valid) & sc["ndvi_median"].notna()].copy()
    # same date from overlapping MGRS tiles: keep the read with most valid pixels
    ok = ok.sort_values("valid_pixels").drop_duplicates(["date", "sensor"], keep="last").sort_values("date")
    ok["month"] = ok["date"].dt.to_period("M").astype(str)
    allm = pd.period_range(f"{min(years)}-01", f"{max(years)}-12", freq="M").astype(str)
    g = ok.groupby("month")["ndvi_median"]
    mo = pd.DataFrame({"month": allm})
    mo["n_clear_scenes"] = mo["month"].map(g.size()).fillna(0).astype(int)
    mo["ndvi_median"] = mo["month"].map(g.median()).round(3)
    mo["ndvi_max"] = mo["month"].map(g.max()).round(3)
    mo["status"] = np.where(mo["n_clear_scenes"] == 0, "no_clear_scene",
                            np.where(mo["ndvi_median"] >= GREEN_NDVI, "green", "bare_or_residue"))
    ev = _evidence("hls", f"field polygon (bbox {', '.join(f'{b:.4f}' for b in bbox)}), 30 m pixels inside the outline",
                   ok["date"].min() if len(ok) else None, ok["date"].max() if len(ok) else None,
                   effective_res="30 m (field scale)", units="NDVI (unitless)",
                   qa=[f"Fmask removed: cloud, adjacent cloud/shadow, shadow, snow/ice, water",
                       f"scenes kept if ≥{int(min_valid*100)}% of field pixels clear; scene-level cloud ≤{max_cloud}% pre-filter",
                       f"{len(sc)} scenes read, {len(ok)} usable, {n_err} read errors",
                       f"monthly status: median NDVI < {GREEN_NDVI} = bare or residue, else green cover",
                       "NDVI shows greenness only; it does not measure yield, residue amount or carbon"],
                   transformation="field median of per-pixel NDVI = (NIR−Red)/(NIR+Red); L30 B05/B04, S30 B8A/B04")
    ev.update({"available": True, "product": "HLSL30.020 + HLSS30.020", "status_label": STATUS_LABEL,
               "fetch_seconds": round(time.time() - t0, 1), "notes": reasons})
    return sc, mo, ev


# --------------------------------------------------------------------------- precompute

def _week_of_year(idx: pd.DatetimeIndex) -> np.ndarray:
    return np.minimum((idx.day_of_year - 1) // 7 + 1, 52)


def _smap_summary(df: pd.DataFrame) -> dict:
    rz = df["sm_rootzone"].dropna()
    w = rz.resample("W-SUN").mean().dropna()
    wk = pd.Series(_week_of_year(w.index), index=w.index)
    clim = w.groupby(wk.values).quantile([0.1, 0.25, 0.5, 0.75, 0.9]).unstack()
    climatology = [{"week": int(k), "p10": round(r[0.1], 4), "p25": round(r[0.25], 4), "p50": round(r[0.5], 4),
                    "p75": round(r[0.75], 4), "p90": round(r[0.9], 4), "n_years": int((wk == k).sum())}
                   for k, r in clim.iterrows()]
    # percentile of each recent week vs all years' same week (empirical, inclusive)
    last = w[w.index > w.index.max() - pd.Timedelta(days=365)]
    recent = []
    for t, v in last.items():
        k = int(_week_of_year(pd.DatetimeIndex([t]))[0])
        ref = w[wk == k]
        pct = float((ref <= v).mean() * 100)
        p50 = clim.loc[k, 0.5]
        native = df["sm_rootzone_pctl"].loc[t - pd.Timedelta(days=6):t].mean()
        end = min(t, rz.index.max())  # the last week may be partial: never label it with a future date
        recent.append({"week_ending": str(end.date()), "partial_week": bool(end < t), "sm_rootzone": round(float(v), 4),
                       "anomaly_vs_median": round(float(v - p50), 4), "percentile": round(pct, 1),
                       "product_pctl": None if pd.isna(native) else round(float(native), 1)})
    daily12 = rz[rz.index > rz.index.max() - pd.Timedelta(days=365)]
    return {"weekly_climatology": climatology, "last_12_months_weekly": recent,
            "last_12_months_daily": [[str(d.date()), round(float(v), 4)] for d, v in daily12.items()],
            "record": [str(rz.index.min().date()), str(rz.index.max().date())], "n_days": int(len(rz)),
            "units": "m3/m3", "percentile_method": "empirical rank of the week's mean among the same week in all SMAP years (2015→)"}


def _imerg_summary(df: pd.DataFrame) -> dict:
    p = df["precip_mm"]
    m = p.resample("MS").sum(min_count=25)
    heavy = (p >= 25.4).resample("MS").sum()
    return {"monthly": [{"month": str(t.to_period('M')), "total_mm": None if pd.isna(v) else round(float(v), 1),
                         "heavy_days_ge_25mm": int(heavy.get(t, 0))} for t, v in m.items()],
            "annual_mean_mm": round(float(p.resample("YS").sum(min_count=330).mean()), 1),
            "heavy_rain_days_per_year": round(float((p >= 25.4).resample("YS").sum().mean()), 2)}


def precompute_pilots(pilots_path: Path | None = None, hls_years=(2022, 2023, 2024), only: list[str] | None = None) -> list[Path]:
    from ..config import PRECOMP
    pilots = json.loads((pilots_path or PRECOMP / "pilots.json").read_text(encoding="utf-8"))["pilots"]
    if only:
        pilots = [p for p in pilots if p["field_id"] in only]
    # SMAP: fetch one small block per region so neighbouring pilots share requests
    cells = {p["field_id"]: smap_cell(p["lat"], p["lon"]) for p in pilots}
    blocks: list[list[str]] = []
    for fid, (r, c, *_rest) in cells.items():
        for b in blocks:
            r0, c0 = cells[b[0]][:2]
            if abs(r - r0) <= 6 and abs(c - c0) <= 6:
                b.append(fid)
                break
        else:
            blocks.append([fid])
    blk_of = {}
    for b in blocks:
        rs = [cells[f][0] for f in b]
        cs = [cells[f][1] for f in b]
        for f in b:
            blk_of[f] = (min(rs), max(rs), min(cs), max(cs))
    written = []
    for p in pilots:
        fid, lat, lon = p["field_id"], p["lat"], p["lon"]
        t0 = time.time()
        res: dict[str, Any] = {"field_id": fid, "name": p.get("name"), "lat": lat, "lon": lon,
                               "generated": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        sm, ev = smap_l4_rootzone(lat, lon, _block=blk_of[fid])
        res["smap"] = {**(_smap_summary(sm) if sm is not None else {"value": None}), "evidence": ev}
        im, ev = imerg_daily(lat, lon)
        res["imerg"] = {**(_imerg_summary(im) if im is not None else {"value": None}), "evidence": ev}
        gr, ev = grace_storage(lat, lon)
        if gr is not None:
            res["grace"] = {"monthly": [[m, None if pd.isna(v) else round(float(v), 2)] for m, v in zip(gr["month"], gr["lwe_cm"])],
                            "trend": gr.attrs["trend"], "units": "cm water-equivalent anomaly",
                            "scale_label": "regional (~300 km mascon), not a well", "evidence": ev}
        else:
            res["grace"] = {"value": None, "evidence": ev}
        sc, mo, ev = hls_ndvi(p["feature"]["geometry"], list(hls_years), field_key=fid)
        if mo is not None:
            res["hls"] = {"label": STATUS_LABEL, "threshold_ndvi": GREEN_NDVI,
                          "monthly": mo.where(mo.notna(), None).to_dict("records"),
                          "scenes_usable": int((sc["valid_fraction"] >= 0.5).sum()) if "valid_fraction" in sc else 0,
                          "evidence": ev}
        else:
            res["hls"] = {"value": None, "evidence": ev}
        res["elapsed_s"] = round(time.time() - t0, 1)
        out = PRECOMP / f"nasa_{fid}.json"
        out.write_text(json.dumps(res, separators=(",", ":"), default=str), encoding="utf-8")
        written.append(out)
        print(f"{fid}: wrote {out.name} ({out.stat().st_size // 1024} kB, {res['elapsed_s']} s)")
    return written


if __name__ == "__main__":
    import sys
    precompute_pilots(only=sys.argv[1:] or None)
