"""Build a compact US county outline file for the web globe (State / County zoom levels).

Input (downloaded once into data/cache/reference_dl/, git-ignored):
  https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_20m.zip
  (US Census Bureau cartographic boundary file, 1:20,000,000, public domain)
Output:
  web/public/data/us_counties.geojson  (one MultiLineString outline per county; properties NAME, STATEFP)

Attribution in the app: "Counties: US Census Bureau".
Run: python scripts/web_data_counties.py
"""
from __future__ import annotations

import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

from shapely.geometry import mapping, shape

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "cache" / "reference_dl"
OUT = ROOT / "web" / "public" / "data" / "us_counties.geojson"
URL = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_20m.zip"
ZIP = SRC / "cb_2023_us_county_20m.zip"
SIMPLIFY_DEG = 0.002  # ≈200 m: outlines are a visual guide at State / County zoom, not survey lines
DECIMALS = 4
MAX_BYTES = 2_500_000


def download() -> None:
    if ZIP.exists() and ZIP.stat().st_size > 10_000:
        return
    SRC.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(URL, headers={"User-Agent": "farmsmart-data-script"})
    with urllib.request.urlopen(req, timeout=120) as r:
        ZIP.write_bytes(r.read())
    print(f"downloaded {ZIP.name} ({ZIP.stat().st_size / 1e6:.1f} MB)")


def read_features() -> list[tuple[dict, dict]]:
    """[(properties, geojson geometry)] from the zipped shapefile, with pyshp (pure python) or pyogrio as fallback."""
    with zipfile.ZipFile(ZIP) as z:
        names = {Path(n).suffix.lower(): n for n in z.namelist()}
        try:
            import shapefile  # pyshp

            rdr = shapefile.Reader(
                shp=io.BytesIO(z.read(names[".shp"])),
                shx=io.BytesIO(z.read(names[".shx"])),
                dbf=io.BytesIO(z.read(names[".dbf"])),
                encoding="latin-1",
            )
            fields = [f[0] for f in rdr.fields[1:]]
            return [(dict(zip(fields, sr.record)), sr.shape.__geo_interface__) for sr in rdr.iterShapeRecords()]
        except ImportError:
            pass
    import pyogrio

    df = pyogrio.read_dataframe(f"/vsizip/{ZIP.as_posix()}")
    return [({"NAME": r.NAME, "STATEFP": r.STATEFP}, mapping(r.geometry)) for r in df.itertuples()]


def rnd(coords, nd=DECIMALS):
    return [[round(x, nd), round(y, nd)] for x, y in coords]


def main() -> int:
    download()
    feats = []
    for props, geom in read_features():
        g = shape(geom)
        if g.is_empty:
            continue
        g = g.simplify(SIMPLIFY_DEG, preserve_topology=True)
        polys = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
        lines = []
        for p in polys:
            if p.is_empty:
                continue
            lines.append(rnd(p.exterior.coords))
            lines.extend(rnd(i.coords) for i in p.interiors)
        lines = [ln for ln in lines if len(ln) >= 3]
        if not lines:
            continue
        feats.append({
            "type": "Feature",
            "properties": {"NAME": str(props.get("NAME", "")), "STATEFP": str(props.get("STATEFP", ""))},
            "geometry": {"type": "MultiLineString", "coordinates": lines},
        })
    fc = {"type": "FeatureCollection", "attribution": "Counties: US Census Bureau (cartographic boundary 2023, 1:20m)",
          "features": feats}
    text = json.dumps(fc, separators=(",", ":"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(feats)} counties, {len(text) / 1e6:.2f} MB")
    if len(text) > MAX_BYTES:
        print("warning: file is larger than the 2.5 MB budget", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
