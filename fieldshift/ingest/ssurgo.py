"""SSURGO soil properties for a field polygon via USDA Soil Data Access (keyless)."""
from __future__ import annotations

import json
from typing import Any

from shapely.geometry import shape

from ..config import http

SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"

# Map units intersecting the polygon, the area of each intersection, and dominant-component
# properties of the surface horizon. Area weighting happens in Python.
SQL = """
SELECT k.mukey, k.area_ac, mu.muname, mu.musym,
  c.cokey, c.compname, c.comppct_r, c.slope_r, c.hydgrp, c.drainagecl, c.wei, c.weg,
  c.taxorder, c.nirrcapcl, ch.om_r, ch.claytotal_r, ch.sandtotal_r, ch.silttotal_r, ch.awc_r,
  ch.kwfact, ch.ph1to1h2o_r, ch.hzdept_r, ch.hzdepb_r,
  (SELECT SUM(ch2.awc_r * (CASE WHEN ch2.hzdepb_r > 100 THEN 100 ELSE ch2.hzdepb_r END - ch2.hzdept_r))
     FROM chorizon ch2 WHERE ch2.cokey = c.cokey AND ch2.hzdept_r < 100) AS aws100_cm
FROM (
  SELECT mukey, SUM(area_ac) AS area_ac FROM (
    SELECT mukey, mupolygongeo.STIntersection(geometry::STGeomFromText('{wkt}', 4326))
       .MakeValid().STArea() AS area_ac
    FROM mupolygon WHERE mupolygongeo.STIntersects(geometry::STGeomFromText('{wkt}', 4326)) = 1
  ) a GROUP BY mukey
) k
INNER JOIN mapunit mu ON mu.mukey = k.mukey
INNER JOIN component c ON c.mukey = k.mukey AND c.majcompflag = 'Yes'
LEFT JOIN chorizon ch ON ch.cokey = c.cokey AND ch.hzdept_r = 0
"""


def _num(x: Any) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def query(geom: dict) -> dict[str, Any]:
    poly = shape(geom).simplify(0.00005)
    wkt = poly.wkt
    r = http().post(SDA, json={"query": SQL.format(wkt=wkt), "format": "JSON+COLUMNNAME"}, timeout=120)
    r.raise_for_status()
    js = r.json()
    if "Table" not in js or len(js["Table"]) < 2:
        return {"available": False, "units": []}
    cols, *rows = js["Table"]
    recs = [dict(zip(cols, row)) for row in rows]
    # weight = intersection area share * component percent
    tot_area = sum(_num(r["area_ac"]) or 0 for r in {r["mukey"]: r for r in recs}.values()) or 1.0
    units: dict[str, dict] = {}
    for rec in recs:
        u = units.setdefault(rec["mukey"], {"mukey": rec["mukey"], "musym": rec["musym"], "muname": rec["muname"],
                                            "share": (_num(rec["area_ac"]) or 0) / tot_area, "components": []})
        u["components"].append(rec)

    numeric = ["om_r", "claytotal_r", "sandtotal_r", "silttotal_r", "awc_r", "kwfact", "ph1to1h2o_r",
               "slope_r", "aws100_cm", "wei"]
    acc = {k: [0.0, 0.0] for k in numeric}
    cat: dict[str, dict[str, float]] = {"hydgrp": {}, "drainagecl": {}, "weg": {}, "texture": {}}
    for u in units.values():
        cp_tot = sum(_num(c["comppct_r"]) or 0 for c in u["components"]) or 1
        for c in u["components"]:
            w = u["share"] * (_num(c["comppct_r"]) or 0) / cp_tot
            for k in numeric:
                v = _num(c.get(k))
                if v is not None:
                    acc[k][0] += v * w
                    acc[k][1] += w
            for k in ("hydgrp", "drainagecl", "weg"):
                if c.get(k):
                    cat[k][str(c[k])] = cat[k].get(str(c[k]), 0) + w
    props = {k: (s / w if w > 0 else None) for k, (s, w) in acc.items()}
    for k, d in cat.items():
        props[k] = max(d, key=d.get) if d else None
    props["texture_class"] = usda_texture(props.get("sandtotal_r"), props.get("claytotal_r"))
    unit_list = sorted(({"mukey": u["mukey"], "musym": u["musym"], "name": u["muname"], "share": round(u["share"], 3)}
                        for u in units.values()), key=lambda x: -x["share"])
    return {"available": True, "properties": props, "units": unit_list, "query_wkt_vertices": len(poly.exterior.coords)}


def usda_texture(sand: float | None, clay: float | None) -> str | None:
    if sand is None or clay is None:
        return None
    silt = 100 - sand - clay
    if silt + 1.5 * clay < 15: return "sand"
    if silt + 1.5 * clay >= 15 and silt + 2 * clay < 30: return "loamy sand"
    if (7 <= clay < 20 and sand > 52 and silt + 2 * clay >= 30) or (clay < 7 and silt < 50 and silt + 2 * clay >= 30): return "sandy loam"
    if 7 <= clay < 27 and 28 <= silt < 50 and sand <= 52: return "loam"
    if (silt >= 50 and 12 <= clay < 27) or (50 <= silt < 80 and clay < 12): return "silt loam"
    if silt >= 80 and clay < 12: return "silt"
    if 20 <= clay < 35 and silt < 28 and sand > 45: return "sandy clay loam"
    if 27 <= clay < 40 and 20 < sand <= 45: return "clay loam"
    if 27 <= clay < 40 and sand <= 20: return "silty clay loam"
    if clay >= 35 and sand > 45: return "sandy clay"
    if clay >= 40 and silt >= 40: return "silty clay"
    if clay >= 40 and sand <= 45 and silt < 40: return "clay"
    return None
