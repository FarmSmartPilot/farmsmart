"""Field terrain from AWS Terrain Tiles (terrarium PNG, keyless): elevation, slope, LS factor, low spots."""
from __future__ import annotations

import math
from io import BytesIO

import numpy as np
from shapely.geometry import Point, mapping, shape

from ..config import CACHE, http

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
Z = 14  # ≈9.5 m pixels at 42°N (source data is 1/3" 3DEP in the US, SRTM/NASADEM elsewhere)


def _tile(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def _fetch(z: int, x: int, y: int) -> np.ndarray:
    from PIL import Image
    p = CACHE / f"terrarium_{z}_{x}_{y}.png"
    if not p.exists():
        r = http().get(URL.format(z=z, x=x, y=y), timeout=60)
        r.raise_for_status()
        p.write_bytes(r.content)
    im = np.asarray(Image.open(p).convert("RGB")).astype(np.float64)
    return im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768


def dem(geom: dict, z: int = Z):
    """Mosaic tiles covering the field bbox. Returns elev array, lon/lat of pixel centres, pixel size (m)."""
    g = shape(geom)
    minx, miny, maxx, maxy = g.bounds
    x0, y0 = _tile(minx, maxy, z)
    x1, y1 = _tile(maxx, miny, z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    rows = []
    for ty in range(ty0, ty1 + 1):
        rows.append(np.hstack([_fetch(z, tx, ty) for tx in range(tx0, tx1 + 1)]))
    mosaic = np.vstack(rows)
    n = 2 ** z
    px = (np.arange(mosaic.shape[1]) + 0.5) / 256 + tx0
    py = (np.arange(mosaic.shape[0]) + 0.5) / 256 + ty0
    lons = px / n * 360 - 180
    lats = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * py / n))))
    lat_c = (miny + maxy) / 2
    pix_m = 40075016.686 * math.cos(math.radians(lat_c)) / (n * 256)
    return mosaic, lons, lats, pix_m


def analyse(geom: dict) -> dict:
    g = shape(geom)
    elev, lons, lats, pix = dem(geom)
    c = g.centroid
    conus = -125 < c.x < -66 and 24 < c.y < 50
    if not conus:
        # Outside the US the tiles come from ~30 m SRTM/NASADEM resampled to ~10 m: pixel-scale noise inflates
        # slope on flat fields. Smooth over ~5 pixels (~45 m) before differencing.
        from scipy.ndimage import uniform_filter
        elev = uniform_filter(elev, size=5, mode="nearest")
    gy, gx = np.gradient(elev, pix)
    slope_pct = np.hypot(gx, gy) * 100
    LON, LAT = np.meshgrid(lons, lats)
    from shapely import contains_xy
    inside = contains_xy(g, LON, LAT)
    if inside.sum() < 4:
        inside = np.ones_like(inside, bool)
    s = slope_pct[inside]
    e = elev[inside]
    # RUSLE LS (McCool et al. 1987/1989 as used in RUSLE, AH-703), slope length assumed 50 m for row fields
    theta = np.arctan(s / 100)
    sin_t = np.sin(theta)
    S = np.where(s < 9, 10.8 * sin_t + 0.03, 16.8 * sin_t - 0.50)
    beta = (sin_t / 0.0896) / (3 * sin_t ** 0.8 + 0.56)
    m = beta / (1 + beta)
    L = (50 / 22.13) ** m
    LS = L * S
    # frost-pocket / wet-spot proxy: cells >= 1.5 m below the field's 75th percentile elevation and in local lows
    rel = e - np.percentile(e, 75)
    low_share = float((rel < -1.5).mean())
    # zones grid (coarsened) for the map: slope class per cell, returned as points
    zones = []
    step = max(1, int(round(30 / pix)))
    for i in range(0, elev.shape[0], step):
        for j in range(0, elev.shape[1], step):
            if inside[i, j]:
                zones.append([round(float(lons[j]), 6), round(float(lats[i]), 6),
                              round(float(slope_pct[i, j]), 2), round(float(elev[i, j] - np.median(e)), 2)])
    out = {
        "elev_mean_m": float(e.mean()), "elev_range_m": float(e.max() - e.min()),
        "slope_mean_pct": float(s.mean()), "slope_p90_pct": float(np.percentile(s, 90)),
        "share_slope_gt5": float((s > 5).mean()), "ls_mean": float(np.mean(LS)),
        "low_spot_share": low_share, "pixel_m": pix, "n_pixels": int(inside.sum()),
        "zones": zones[:4000], "method": "finite differences on ≈10 m elevation (USGS 3DEP)",
    }
    if not conus:
        # Global tiles here are whole-metre SRTM: 1 m steps create false 3-5 % slopes on flat land. Fit a plane to
        # the field + 300 m surroundings instead (robust to the steps); within-field zones are not resolvable.
        e2, lo2, la2, pix2 = dem(mapping(g.buffer(0.003)), 13)
        X, Y = np.meshgrid(np.arange(e2.shape[1]) * pix2, np.arange(e2.shape[0]) * pix2)
        A = np.column_stack([X.ravel(), Y.ravel(), np.ones(X.size)])
        coef, *_ = np.linalg.lstsq(A, e2.ravel(), rcond=None)
        sp = float(np.hypot(coef[0], coef[1]) * 100)
        st = np.sin(np.arctan(sp / 100))
        Sx = 10.8 * st + 0.03 if sp < 9 else 16.8 * st - 0.50
        bx = (st / 0.0896) / (3 * st ** 0.8 + 0.56)
        out.update({"slope_mean_pct": sp, "slope_p90_pct": sp, "share_slope_gt5": float(sp > 5),
                    "ls_mean": float((50 / 22.13) ** (bx / (1 + bx)) * Sx), "low_spot_share": None, "zones": [],
                    "method": "plane fit over field + 300 m on SRTM (whole-metre elevations); within-field slope zones not resolvable",
                    "elev_range_m": float(e2.max() - e2.min())})
    return out
