"""Build compact country + state/province outline files for the web globe.

Inputs (downloaded once, see docs/reference/ENDPOINTS.md "Natural Earth"):
  data/cache/reference_dl/ne_50m_admin_0_countries.geojson
  data/cache/reference_dl/ne_10m_admin_1_states_provinces.geojson
Outputs:
  web/public/data/admin0.geojson  (country outlines, MultiLineString per country)
  web/public/data/admin1.geojson  (state/province outlines, simplified)

Natural Earth is public domain ("Boundaries: Natural Earth").
Run: python scripts/web_data_boundaries.py
"""
from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union  # noqa: F401  (kept for future dissolves)

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "cache" / "reference_dl"
OUT = ROOT / "web" / "public" / "data"


def round_coords(obj, nd):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(obj[0], nd), round(obj[1], nd)]
        return [round_coords(o, nd) for o in obj]
    return obj


def outlines(geom):
    """Polygon/MultiPolygon -> list of exterior + interior rings as line coords."""
    polys = [geom] if geom.geom_type == "Polygon" else list(getattr(geom, "geoms", []))
    rings = []
    for p in polys:
        if p.is_empty:
            continue
        rings.append(list(p.exterior.coords))
        rings.extend(list(r.coords) for r in p.interiors)
    return rings


def build(src: Path, dst: Path, tol: float, nd: int, props_fn, min_ring_pts=4):
    data = json.loads(src.read_text(encoding="utf-8", errors="replace"))
    feats = []
    for f in data["features"]:
        if not f.get("geometry"):
            continue
        g = shape(f["geometry"]).simplify(tol, preserve_topology=True)
        rings = [r for r in outlines(g) if len(r) >= min_ring_pts]
        if not rings:
            continue
        feats.append(
            {
                "type": "Feature",
                "properties": props_fn(f["properties"]),
                "geometry": {"type": "MultiLineString", "coordinates": round_coords(rings, nd)},
            }
        )
    fc = {"type": "FeatureCollection", "attribution": "Boundaries: Natural Earth (public domain)", "features": feats}
    dst.write_text(json.dumps(fc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{dst.name}: {len(feats)} features, {dst.stat().st_size/1e6:.2f} MB")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    build(
        SRC / "ne_50m_admin_0_countries.geojson",
        OUT / "admin0.geojson",
        tol=0.02,
        nd=3,
        props_fn=lambda p: {"name": p.get("NAME") or p.get("ADMIN"), "iso_a2": p.get("ISO_A2_EH") or p.get("ISO_A2")},
    )
    build(
        SRC / "ne_10m_admin_1_states_provinces.geojson",
        OUT / "admin1.geojson",
        tol=0.04,
        nd=2,
        props_fn=lambda p: {"name": p.get("name"), "iso": p.get("iso_3166_2"), "adm0": p.get("adm0_a3")},
    )


if __name__ == "__main__":
    main()
