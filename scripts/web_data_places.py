"""Precompute level-of-detail place labels for the globe.

Input:  data/cache/reference_dl/cities15000.zip (GeoNames, CC BY 4.0)
Output: web/public/data/places.json

Keeps national capitals (PPLC), admin-1 capitals (PPLA) and the 5 most
populous places per admin-1 region. Each row is
  [name, lon, lat, population, tier, country_code]
tier 0 = national capital, 1 = admin-1 capital, 2 = top-5 city.
Attribution: "Place names: GeoNames.org" (CC BY 4.0).
Run: python scripts/web_data_places.py
"""
from __future__ import annotations

import csv
import io
import json
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "cache" / "reference_dl" / "cities15000.zip"
OUT = ROOT / "web" / "public" / "data" / "places.json"
TOP_N = 5


def main():
    rows = []
    with zipfile.ZipFile(SRC) as z:
        with z.open("cities15000.txt") as fh:
            reader = csv.reader(io.TextIOWrapper(fh, encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE)
            for r in reader:
                if len(r) < 15:
                    continue
                rows.append(
                    {
                        "name": r[1],
                        "lat": float(r[4]),
                        "lon": float(r[5]),
                        "code": r[7],
                        "cc": r[8],
                        "a1": r[10],
                        "pop": int(r[14] or 0),
                    }
                )
    by_a1 = defaultdict(list)
    for r in rows:
        by_a1[(r["cc"], r["a1"])].append(r)
    keep = {}
    for r in rows:
        if r["code"] == "PPLC":
            keep[id(r)] = (r, 0)
        elif r["code"] == "PPLA":
            keep.setdefault(id(r), (r, 1))
    for group in by_a1.values():
        group.sort(key=lambda x: -x["pop"])
        for r in group[:TOP_N]:
            keep.setdefault(id(r), (r, 2))
    out = [
        [r["name"], round(r["lon"], 3), round(r["lat"], 3), r["pop"], tier, r["cc"]]
        for r, tier in keep.values()
    ]
    out.sort(key=lambda x: (x[4], -x[3]))
    payload = {
        "attribution": "Place names: GeoNames.org (CC BY 4.0)",
        "columns": ["name", "lon", "lat", "population", "tier", "country"],
        "tiers": {"0": "national capital", "1": "admin-1 capital", "2": f"top {TOP_N} city in admin-1"},
        "rows": out,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    counts = defaultdict(int)
    for row in out:
        counts[row[4]] += 1
    print(f"places.json: {len(out)} rows {dict(counts)}, {OUT.stat().st_size/1e6:.2f} MB")


if __name__ == "__main__":
    main()
