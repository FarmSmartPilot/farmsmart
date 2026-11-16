"""Crop history in Canada: AAFC Annual Crop Inventory (ACI), 2009-2025, keyless ArcGIS ImageServer.

computeHistograms over the field polygon, one call per year (same output shape as cdl.history).
ACI resolution: 56 m for 2009-2010, 30 m from 2011. Licence: Open Government Licence - Canada.
Class codes and labels: AAFC aci_crop_classifications_iac_classifications_des_cultures.csv.
"""
from __future__ import annotations

import json

from shapely.geometry import shape

from ..config import http

IMG = "https://www.agr.gc.ca/imagery-images/rest/services/annual_crop_inventory/{year}/ImageServer"
YEARS = range(2009, 2026)
ACI_NAMES = {
    10: "Cloud", 20: "Water", 30: "Exposed land/barren", 34: "Urban/developed", 35: "Greenhouses", 50: "Shrubland",
    60: "Forest fire/burnt area", 80: "Wetland", 85: "Peatland", 110: "Grassland", 120: "Agriculture (undifferentiated)",
    121: "Cropland", 122: "Pasture/forages", 130: "Too wet to be seeded", 131: "Fallow", 132: "Cereals", 133: "Barley",
    134: "Other grains", 135: "Millet", 136: "Oats", 137: "Rye", 138: "Spelt", 139: "Triticale", 140: "Wheat",
    141: "Switchgrass", 142: "Sorghum", 143: "Quinoa", 145: "Winter wheat", 146: "Spring wheat", 147: "Corn for grain",
    148: "Tobacco", 149: "Ginseng", 150: "Oilseeds", 151: "Borage", 152: "Camelina", 153: "Canola/rapeseed",
    154: "Flaxseed", 155: "Mustard", 156: "Safflower", 157: "Sunflower", 158: "Soybeans", 159: "Other oilseeds",
    160: "Pulses", 161: "Other pulses", 162: "Peas", 163: "Chickpeas", 167: "Beans", 168: "Fababeans", 174: "Lentils",
    175: "Vegetables", 176: "Tomatoes", 177: "Potatoes", 178: "Sugarbeets", 179: "Other vegetables", 180: "Fruits",
    181: "Berries", 182: "Blueberry", 183: "Cranberry", 185: "Other berries", 188: "Orchards", 189: "Other fruits",
    190: "Vineyards", 191: "Hops", 192: "Sod", 193: "Herbs", 194: "Nursery", 195: "Buckwheat", 196: "Canaryseed",
    197: "Hemp", 198: "Vetch", 199: "Other crops", 200: "Forest (undifferentiated)", 210: "Coniferous",
    220: "Broadleaf", 230: "Mixedwood",
}
# ACI class -> FarmSmart crop id. Generic classes (Wheat, Cereals, Pulses, Oilseeds...) stay None: we do not guess
# the species. The ACI legend has no durum class, so a durum field may appear as "Spring wheat" or "Wheat".
ACI_TO_CROP = {131: "fallow", 133: "barley", 135: "proso_millet", 136: "oats", 137: "cereal_rye", 139: "triticale",
               142: "sorghum", 145: "winter_wheat", 146: "spring_wheat", 147: "corn", 153: "canola", 154: "flax",
               156: "safflower", 157: "sunflower", 158: "soybean", 162: "field_pea", 163: "chickpea", 167: "dry_bean",
               174: "lentil", 178: "sugar_beet", 122: "pasture"}
NON_CROP = {10, 20, 30, 34, 35, 50, 60, 80, 85, 110, 200, 210, 220, 230}


def res_m(year: int) -> int:
    return 56 if year <= 2010 else 30


def year_histogram(geom: dict, year: int) -> dict[int, int]:
    g = shape(geom).simplify(0.00005)
    rings = [list(p.exterior.coords) for p in g.geoms] if g.geom_type == "MultiPolygon" else [list(g.exterior.coords)]
    params = {"geometry": json.dumps({"rings": rings, "spatialReference": {"wkid": 4326}}),
              "geometryType": "esriGeometryPolygon", "f": "json"}
    r = http().post(f"{IMG.format(year=year)}/computeHistograms", data=params, timeout=90)
    r.raise_for_status()
    js = r.json()
    hs = js.get("histograms") or []
    if not hs:
        raise RuntimeError((js.get("error") or {}).get("message", "no histogram"))
    h = hs[0]
    lo = int(round(h.get("min", -0.5) + 0.5))
    return {lo + i: int(c) for i, c in enumerate(h["counts"]) if c and lo + i > 0}


def identify(lat: float, lon: float, year: int) -> int | None:
    """ACI class at a point (for quick checks / tiny fields)."""
    params = {"geometry": json.dumps({"x": lon, "y": lat, "spatialReference": {"wkid": 4326}}),
              "geometryType": "esriGeometryPoint", "returnGeometry": "false", "returnCatalogItems": "false", "f": "json"}
    r = http().get(f"{IMG.format(year=year)}/identify", params=params, timeout=60)
    r.raise_for_status()
    v = r.json().get("value")
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def history(geom: dict, years=YEARS) -> list[dict]:
    """Same shape as cdl.history: [{year, available, pixels, res_m, classes, dominant}]."""
    out = []
    for y in years:
        try:
            h = year_histogram(geom, y)
        except Exception as e:  # noqa: BLE001 - recorded as missing, never invented
            out.append({"year": y, "available": False, "error": str(e)[:200]})
            continue
        h = {c: n for c, n in h.items() if c != 10}  # cloud is "no observation", not a land class
        tot = sum(h.values())
        if tot == 0:
            out.append({"year": y, "available": False, "error": "no pixels (outside ACI coverage or all cloud)"})
            continue
        classes = [{"code": c, "name": ACI_NAMES.get(c, f"class {c}"), "crop_id": ACI_TO_CROP.get(c), "share": n / tot}
                   for c, n in sorted(h.items(), key=lambda kv: -kv[1])[:4]]
        out.append({"year": y, "available": True, "pixels": tot, "res_m": res_m(y), "classes": classes,
                    "dominant": classes[0], "source": "AAFC ACI"})
    return out


REGION_KM = 20.0  # side of the box used for "crops grown around here" (AAFC has no county summary service here)


def regional_crops(lat: float, lon: float, year: int, km: float = REGION_KM) -> list[dict]:
    """Crop areas in a km x km box around a point (AAFC ACI). Same row shape as cdl.county_stats."""
    import math
    dlat = km / 2 / 111.32
    dlon = km / 2 / (111.32 * math.cos(math.radians(lat)))
    ring = [[lon - dlon, lat - dlat], [lon + dlon, lat - dlat], [lon + dlon, lat + dlat], [lon - dlon, lat + dlat],
            [lon - dlon, lat - dlat]]
    h = year_histogram({"type": "Polygon", "coordinates": [ring]}, year)
    px_m2 = res_m(year) ** 2
    rows = []
    for c, n in sorted(h.items(), key=lambda kv: -kv[1]):
        if c in NON_CROP or c == 10:
            continue
        ha = n * px_m2 / 1e4
        rows.append({"code": c, "name": ACI_NAMES.get(c, f"class {c}"), "crop_id": ACI_TO_CROP.get(c) if c != 122 else None,
                     "hectares": round(ha, 1), "acres": round(ha * 2.47105, 1)})
    return rows
