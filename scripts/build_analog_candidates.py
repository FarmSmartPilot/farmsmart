"""Build the present-day cropland analog candidate set for Climate Twins (M7).

Outputs (committed, compact):
  data/reference/analog_candidates.parquet  one row per 1° cropland cell: lat, lon, POWER cell, country, admin1,
                                            nearest town, cropland share, monthly T/Tmax/Tmin/precip normals
  data/reference/faostat_top_crops.json     top crops by harvested area per country (FAOSTAT, country scale)

Sources (all keyless, real data):
  * Cropland mask: FAO GAEZ v4 land-cover share layer GLCSv11_02 (cropland % of each 5' cell), aggregated to 1°.
  * Climate: NASA POWER climatology/regional (MERRA-2), monthly normals for its fixed 2001-2025 period.
    (The regional climatology endpoint ignores start/end; tested 2026-11-14.)
  * Country / admin1: Natural Earth 50m admin-0 and 10m admin-1 polygons. Nearest town: GeoNames cities15000.
  * Crops: FAOSTAT Production_Crops_Livestock bulk (normalized), element "Area harvested", mean of the latest 5 years.

Run: PYTHONPATH=. python scripts/build_analog_candidates.py
"""
from __future__ import annotations

import io
import json
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from fieldshift.config import CACHE, DATA, USER_AGENT, http

REF = DATA / "reference"
REF.mkdir(parents=True, exist_ok=True)
DL = CACHE / "reference_dl"
DL.mkdir(parents=True, exist_ok=True)

GAEZ_URL = "https://s3.eu-west-1.amazonaws.com/data.gaezdev.aws.fao.org/LR/lco/GLCSv11_02_5m.tif"
NE_ADM0 = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson"
NE_ADM1 = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson"
GEONAMES = "https://download.geonames.org/export/dump/cities15000.zip"
FAOSTAT = "https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip"
POWER_REG = "https://power.larc.nasa.gov/api/temporal/climatology/regional"

MIN_CROP_SHARE = 15.0      # % of the 1° cell that GAEZ v4 classes as cropland
PARAMS = ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR"]
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def download(url: str, name: str) -> Path:
    p = DL / name
    if p.exists() and p.stat().st_size > 0:
        return p
    log(f"download {url}")
    with requests.get(url, headers={"User-Agent": USER_AGENT}, stream=True, timeout=600) as r:
        r.raise_for_status()
        tmp = p.with_suffix(p.suffix + ".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.replace(p)
    return p


def cropland_cells() -> pd.DataFrame:
    import rasterio
    with rasterio.open(download(GAEZ_URL, "GLCSv11_02_5m.tif")) as r:
        a = r.read(1).astype("float64")       # 2160 x 4320, 5 arc-min, % cropland
    a[(a < 0) | (a > 100)] = np.nan
    blk = np.nanmean(a.reshape(180, 12, 360, 12), axis=(1, 3))  # 1° mean share
    rows = []
    for i in range(180):
        lat = 89.5 - i
        for j in range(360):
            v = blk[i, j]
            if np.isfinite(v) and v >= MIN_CROP_SHARE and -60 <= lat <= 75:
                rows.append((lat, -179.5 + j, float(v)))
    return pd.DataFrame(rows, columns=["lat", "lon", "crop_share_pct"])


def power_box(args):
    param, s, w = args
    r = http().get(POWER_REG, params={"parameters": param, "community": "AG", "latitude-min": s,
                                      "latitude-max": s + 10, "longitude-min": w, "longitude-max": w + 10,
                                      "format": "JSON"}, timeout=180)
    if r.status_code != 200:
        return param, s, w, None, r.text[:200]
    js = r.json()
    out = []
    for f in js.get("features", []):
        lon, lat = f["geometry"]["coordinates"][:2]
        vals = f["properties"]["parameter"][param]
        out.append((lat, lon, [vals[m] for m in MONTHS]))
    return param, s, w, (out, js.get("header", {})), None


def attach_climate(cells: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    boxes = sorted({(int(np.floor(la / 10) * 10), int(np.floor(lo / 10) * 10)) for la, lo in zip(cells.lat, cells.lon)})
    log(f"{len(cells)} cropland cells in {len(boxes)} POWER 10° boxes")
    jobs = [(p, s, w) for p in PARAMS for s, w in boxes]
    grids: dict[str, dict[tuple[float, float], list[float]]] = {p: {} for p in PARAMS}
    header = {}
    with ThreadPoolExecutor(4) as ex:
        for k, (param, s, w, res, err) in enumerate(ex.map(power_box, jobs)):
            if err:
                log(f"POWER {param} {s},{w} failed: {err}")
                continue
            pts, header = res
            for la, lo, v in pts:
                grids[param][(round(la, 3), round(lo, 3))] = v
            if k % 100 == 0:
                log(f"  {k}/{len(jobs)} boxes")
    keys = np.array(list(grids["T2M"].keys()))
    from scipy.spatial import cKDTree
    tree = cKDTree(keys)
    d, idx = tree.query(cells[["lat", "lon"]].values)
    recs = []
    for (_, c), di, ii in zip(cells.iterrows(), d, idx):
        k = (keys[ii][0], keys[ii][1])
        rec = {"power_lat": k[0], "power_lon": k[1]}
        ok = di < 0.75
        for p, short in zip(PARAMS, ["t", "tmax", "tmin", "pr"]):
            v = grids[p].get(k)
            for m in range(12):
                val = v[m] if (ok and v is not None) else np.nan
                rec[f"{short}{m + 1:02d}"] = np.nan if val in (None, -999.0) else float(val)
        recs.append(rec)
    out = pd.concat([cells.reset_index(drop=True), pd.DataFrame(recs)], axis=1)
    return out.dropna(subset=[f"t{m:02d}" for m in range(1, 13)] + [f"pr{m:02d}" for m in range(1, 13)]), header


def attach_places(df: pd.DataFrame) -> pd.DataFrame:
    from shapely import STRtree, points
    from shapely.geometry import shape
    adm0 = json.loads(download(NE_ADM0, "ne_50m_admin_0_countries.geojson").read_text(encoding="utf-8"))
    adm1 = json.loads(download(NE_ADM1, "ne_10m_admin_1_states_provinces.geojson").read_text(encoding="utf-8"))
    pts = points(df["lon"].values, df["lat"].values)

    def join(feats, getter):
        geoms = [shape(f["geometry"]) for f in feats]
        tree = STRtree(geoms)
        res = [None] * len(pts)
        pi, gi = tree.query(pts, predicate="intersects")
        for a, b in zip(pi, gi):
            if res[a] is None:
                res[a] = getter(feats[b]["properties"])
        # cells whose centre is offshore: nearest polygon
        miss = [i for i, v in enumerate(res) if v is None]
        if miss:
            near = tree.nearest(pts[miss])
            for i, b in zip(miss, near):
                res[i] = getter(feats[b]["properties"])
        return res

    def iso(p):
        for k in ("ISO_A3", "ISO_A3_EH", "ADM0_A3"):
            if p.get(k) and p[k] != "-99":
                return p[k], p.get("NAME") or p.get("ADMIN"), p.get("ISO_N3") if p.get("ISO_N3") != "-99" else p.get("ISO_N3_EH")
        return None, p.get("NAME"), None

    c = join(adm0["features"], iso)
    df["iso3"] = [x[0] for x in c]
    df["country"] = [x[1] for x in c]
    df["iso_n3"] = [x[2] for x in c]
    df["admin1"] = join(adm1["features"], lambda p: p.get("name") or p.get("name_en"))

    z = zipfile.ZipFile(download(GEONAMES, "cities15000.zip"))
    cities = pd.read_csv(z.open("cities15000.txt"), sep="\t", header=None, quoting=3, low_memory=False,
                         usecols=[1, 4, 5, 8, 14], names=["name", "lat", "lon", "cc", "pop"])
    from scipy.spatial import cKDTree
    xyz = lambda la, lo: np.c_[np.cos(np.radians(la)) * np.cos(np.radians(lo)),  # noqa: E731
                               np.cos(np.radians(la)) * np.sin(np.radians(lo)), np.sin(np.radians(la))]
    t = cKDTree(xyz(cities.lat.values, cities.lon.values))
    d, i = t.query(xyz(df.lat.values, df.lon.values))
    df["near_town"] = cities.name.values[i]
    df["near_town_km"] = np.round(2 * 6371 * np.arcsin(np.clip(d / 2, 0, 1)), 0)
    return df


def faostat_top_crops() -> dict:
    p = download(FAOSTAT, "faostat_qcl_normalized.zip")
    z = zipfile.ZipFile(p)
    name = [n for n in z.namelist() if n.endswith(".csv") and "All_Data" in n][0]
    log(f"read FAOSTAT {name}")
    parts = []
    for ch in pd.read_csv(z.open(name), encoding="latin-1", chunksize=500_000, low_memory=False,
                          usecols=["Area Code (M49)", "Area", "Item Code", "Item", "Element", "Year", "Unit", "Value"]):
        parts.append(ch[ch["Element"] == "Area harvested"])
    fa = pd.concat(parts)
    fa = fa[fa["Item Code"] < 1700]          # drop FAOSTAT aggregate items (Cereals, primary etc.)
    last = int(fa["Year"].max())
    yrs = list(range(last - 4, last + 1))
    fa = fa[fa["Year"].isin(yrs)]
    fa["m49"] = fa["Area Code (M49)"].astype(str).str.strip("'").str.lstrip("0")
    g = fa.groupby(["m49", "Area", "Item"])["Value"].mean().reset_index()
    out = {"source": "FAOSTAT Production_Crops_Livestock (normalized bulk), element 'Area harvested'",
           "years": [yrs[0], yrs[-1]], "unit": "ha (mean over the years)", "scale": "country",
           "url": FAOSTAT, "countries": {}}
    for (m49, area), sub in g.groupby(["m49", "Area"]):
        tot = sub["Value"].sum()
        if tot <= 0:
            continue
        top = sub.sort_values("Value", ascending=False).head(8)
        out["countries"][m49] = {"name": area, "total_harvested_ha": round(float(tot)),
                                 "top": [{"crop": r.Item, "ha": round(float(r.Value)),
                                          "share": round(float(r.Value / tot), 4)} for r in top.itertuples()]}
    return out


def main() -> None:
    t0 = time.time()
    cells = cropland_cells()
    log(f"GAEZ cropland cells >= {MIN_CROP_SHARE}%: {len(cells)}")
    df, header = attach_climate(cells)
    log(f"with POWER climate: {len(df)}; POWER header {header}")
    df = attach_places(df)
    df["iso_n3"] = df["iso_n3"].astype(str).str.lstrip("0")
    num = df.select_dtypes("float64").columns
    df[num] = df[num].astype("float32")
    df.attrs = {}
    out = REF / "analog_candidates.parquet"
    df.to_parquet(out, index=False)
    meta = {"rows": len(df), "built": time.strftime("%Y-%m-%d"), "min_crop_share_pct": MIN_CROP_SHARE,
            "grid": "1° cells (centres at x.5); climate from the nearest NASA POWER 0.5°x0.625° cell",
            "cropland_mask": "FAO GAEZ v4 GLCSv11_02 cropland share (5 arc-min), mean over each 1° cell",
            "climate": "NASA POWER climatology/regional, MERRA-2 monthly normals", "climate_period": [
                header.get("start"), header.get("end")], "power_api": header.get("api"),
            "columns": "t = monthly mean of daily T2M (°C); pr = PRECTOTCORR monthly mean (mm/day); tmax/tmin = POWER climatology T2M_MAX/T2M_MIN monthly values, which are period EXTREMES (not means of daily max/min) and are not used for analog matching"}
    (REF / "analog_candidates.meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    log(f"wrote {out} ({out.stat().st_size/1e3:.0f} kB)")
    fs = faostat_top_crops()
    (REF / "faostat_top_crops.json").write_text(json.dumps(fs, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    log(f"FAOSTAT top crops for {len(fs['countries'])} areas; years {fs['years']}; done in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
