"""MODIS MOD13Q1 NDVI point time series via the ORNL DAAC MODIS web service (keyless)."""
from __future__ import annotations

import time

import pandas as pd

from ..config import CACHE, http

API = "https://modis.ornl.gov/rst/api/v1"


def ndvi(lat: float, lon: float, year: int, product: str = "MOD13Q1") -> pd.DataFrame:
    """16-day NDVI for one year at the 250 m pixel containing the point. Pixel-reliability QA applied
    (0 good, 1 marginal kept; 2 snow, 3 cloud dropped)."""
    pq = CACHE / f"ndvi_{product}_{lat:.4f}_{lon:.4f}_{year}.parquet"
    if pq.exists():
        return pd.read_parquet(pq)
    hdr = {"Accept": "application/json"}
    dates = http().get(f"{API}/{product}/dates", params={"latitude": lat, "longitude": lon}, headers=hdr, timeout=60).json()["dates"]
    sel = [d for d in dates if d["calendar_date"].startswith(str(year))]
    rows = []
    # service allows max 10 dates per request
    for i in range(0, len(sel), 10):
        chunk = sel[i:i + 10]
        params = {"latitude": lat, "longitude": lon, "startDate": chunk[0]["modis_date"],
                  "endDate": chunk[-1]["modis_date"], "kmAboveBelow": 0, "kmLeftRight": 0}
        js = None
        for attempt in range(4):  # service is slow (15-90 s) and occasionally returns an empty body
            try:
                with http().cache_disabled():  # results are cached as parquet; never cache an empty body
                    r = http().get(f"{API}/{product}/subset", params=params, headers=hdr, timeout=180)
                if r.status_code == 200 and r.text.strip():
                    js = r.json()
                    break
            except Exception:  # noqa: BLE001
                pass
            time.sleep(3 * (attempt + 1))
        if js is None:
            raise RuntimeError(f"ORNL MODIS service gave no data for {chunk[0]['calendar_date']}")
        by_date: dict[str, dict] = {}
        for s in js.get("subset", []):
            d = by_date.setdefault(s["calendar_date"], {})
            d[s["band"]] = s["data"][0]
        for cd, bands in by_date.items():
            nd = bands.get("250m_16_days_NDVI")
            rel = bands.get("250m_16_days_pixel_reliability")
            if nd is None:
                continue
            ok = rel in (0, 1)
            rows.append({"date": pd.Timestamp(cd), "ndvi": nd * 0.0001 if ok and nd > -3000 else None,
                         "reliability": rel})
    df = pd.DataFrame(rows).sort_values("date").reset_index(drop=True) if rows else pd.DataFrame(columns=["date", "ndvi", "reliability"])
    df.to_parquet(pq)
    return df
