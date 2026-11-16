"""USDA Cropland Data Layer history for a field (keyless USDA SCINet CDL_WM ImageServer).

computeHistograms over the field polygon, one call per year (≈0.4 s). 2024+ are the 10 m CDL editions."""
from __future__ import annotations

import json
import re

from shapely.geometry import shape

from ..config import http

IMG = "https://pdi.scinet.usda.gov/image/rest/services/CDL_WM/ImageServer"
GMU = "https://nassgeodata.gmu.edu/axis2/services/CDLService"

CDL_NAMES = {
    1: "Corn", 2: "Cotton", 3: "Rice", 4: "Sorghum", 5: "Soybeans", 6: "Sunflower", 10: "Peanuts", 12: "Sweet Corn",
    21: "Barley", 22: "Durum Wheat", 23: "Spring Wheat", 24: "Winter Wheat", 25: "Other Small Grains",
    26: "Dbl Crop WinWht/Soybeans", 27: "Rye", 28: "Oats", 29: "Millet", 31: "Canola", 32: "Flaxseed",
    33: "Safflower", 36: "Alfalfa", 37: "Other Hay/Non Alfalfa", 41: "Sugarbeets", 42: "Dry Beans", 43: "Potatoes",
    52: "Lentils", 53: "Peas", 54: "Tomatoes", 58: "Clover/Wildflowers", 59: "Sod/Grass Seed", 61: "Fallow/Idle Cropland",
    69: "Grapes", 75: "Almonds", 76: "Walnuts", 111: "Open Water", 121: "Developed/Open Space", 122: "Developed/Low",
    123: "Developed/Med", 124: "Developed/High", 141: "Deciduous Forest", 142: "Evergreen Forest", 152: "Shrubland",
    176: "Grassland/Pasture", 190: "Woody Wetlands", 195: "Herbaceous Wetlands",
    205: "Triticale", 225: "Dbl Crop WinWht/Corn", 236: "Dbl Crop WinWht/Sorghum", 238: "Dbl Crop WinWht/Cotton",
    240: "Dbl Crop Soybeans/Oats", 241: "Dbl Crop Corn/Soybeans", 254: "Dbl Crop Barley/Soybeans",
}
CDL_TO_CROP = {1: "corn", 5: "soybean", 24: "winter_wheat", 23: "spring_wheat", 22: "durum", 28: "oats",
               21: "barley", 4: "sorghum", 6: "sunflower", 31: "canola", 53: "field_pea", 52: "lentil",
               42: "dry_bean", 36: "alfalfa", 2: "cotton", 3: "rice", 29: "proso_millet", 33: "safflower",
               32: "flax", 41: "sugar_beet", 54: "processing_tomato", 205: "triticale", 27: "cereal_rye",
               61: "fallow", 26: "winter_wheat", 225: "winter_wheat", 236: "winter_wheat", 238: "winter_wheat",
               241: "corn", 254: "barley", 240: "soybean", 37: "grass_hay", 176: "pasture", 58: "red_clover"}
NON_CROP = {111, 121, 122, 123, 124, 141, 142, 143, 152, 190, 195, 131, 112}


def _layer(year: int) -> str:
    return f"{year}_10m_cdls" if year >= 2024 else f"{year}_30m_cdls"


def year_histogram(geom: dict, year: int) -> dict[int, int]:
    g = shape(geom).simplify(0.00005)
    if g.geom_type == "MultiPolygon":
        rings = [list(p.exterior.coords) for p in g.geoms]
    else:
        rings = [list(g.exterior.coords)]
    params = {
        "geometry": json.dumps({"rings": rings, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryPolygon",
        "mosaicRule": json.dumps({"where": f"Name='{_layer(year)}'", "mosaicMethod": "esriMosaicNone"}),
        "f": "json",
    }
    r = http().post(f"{IMG}/computeHistograms", data=params, timeout=60)
    r.raise_for_status()
    js = r.json()
    hs = js.get("histograms") or []
    if not hs:
        raise RuntimeError(js.get("error", {}).get("message", "no histogram"))
    counts = hs[0]["counts"]
    return {i: int(c) for i, c in enumerate(counts) if c and i > 0}


def history(geom: dict, years) -> list[dict]:
    out = []
    for y in years:
        try:
            h = year_histogram(geom, y)
        except Exception as e:  # noqa: BLE001 - recorded as missing, never invented
            out.append({"year": y, "available": False, "error": str(e)[:200]})
            continue
        tot = sum(h.values())
        if tot == 0:
            out.append({"year": y, "available": False, "error": "no pixels"})
            continue
        classes = [{"code": c, "name": CDL_NAMES.get(c, f"class {c}"), "crop_id": CDL_TO_CROP.get(c),
                    "share": n / tot} for c, n in sorted(h.items(), key=lambda kv: -kv[1])[:4]]
        out.append({"year": y, "available": True, "pixels": tot, "res_m": 10 if y >= 2024 else 30,
                    "classes": classes, "dominant": classes[0]})
    return out


def point_history(lat: float, lon: float) -> list[dict]:
    """All CDL years at one point in one call."""
    params = {"geometry": json.dumps({"x": lon, "y": lat, "spatialReference": {"wkid": 4326}}),
              "geometryType": "esriGeometryPoint", "returnGeometry": "false", "returnCatalogItems": "true", "f": "json"}
    js = http().get(f"{IMG}/identify", params=params, timeout=60).json()
    vals = js.get("properties", {}).get("Values", [])
    feats = js.get("catalogItems", {}).get("features", [])
    out = []
    for v, f in zip(vals, feats):
        name = f["attributes"].get("Name", "")
        m = re.match(r"(\d{4})_", name)
        if not m:
            continue
        try:
            code = int(float(v))
        except ValueError:
            continue
        out.append({"year": int(m.group(1)), "code": code, "name": CDL_NAMES.get(code, f"class {code}"),
                    "crop_id": CDL_TO_CROP.get(code)})
    return sorted(out, key=lambda x: x["year"])


def _lenient_json(txt: str):
    txt = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', txt)
    return json.loads(txt)


def county_stats(fips: str, year: int) -> list[dict]:
    """Acreage by CDL class for a county -> 'commonly grown here'."""
    r = http().get(f"{GMU}/GetCDLStat", params={"year": year, "fips": fips, "format": "json"}, timeout=60)
    r.raise_for_status()
    m = re.search(r"<returnURL>(.*?)</returnURL>", r.text)
    if not m:
        return []
    raw = http().get(m.group(1), timeout=60).text
    try:
        js = json.loads(raw)
    except json.JSONDecodeError:
        js = _lenient_json(raw)
    rows = js.get("rows") or js.get("Rows") or []
    out = []
    for row in rows:
        try:
            code = int(row.get("value") or row.get("Value"))
            acres = float(str(row.get("acreage") or row.get("Acreage")).replace(",", ""))
        except (TypeError, ValueError):
            continue
        if code in NON_CROP:
            continue
        out.append({"code": code, "name": row.get("category") or row.get("Category") or CDL_NAMES.get(code),
                    "crop_id": CDL_TO_CROP.get(code), "acres": acres})
    return sorted(out, key=lambda x: -x["acres"])


# --- U9 peers additions: the full CDL legend and a raster window around a point -------------------------------------

def class_names() -> dict[int, str]:
    """Official CDL class names from the ImageServer raster attribute table (cached on disk by http())."""
    try:
        js = http().get(f"{IMG}/rasterAttributeTable", params={"f": "json"}, timeout=60).json()
        out = {int(f["attributes"]["Value"]): str(f["attributes"]["Class_Names"]).strip()
               for f in js.get("features", []) if f["attributes"].get("Class_Names")}
        return out or dict(CDL_NAMES)
    except Exception:  # noqa: BLE001 - fall back to the short table above
        return dict(CDL_NAMES)


def layer_years() -> list[int]:
    """Years with a CDL layer in the ImageServer catalogue (refreshed daily)."""
    js = http().get(f"{IMG}/query", params={"where": "1=1", "outFields": "Name", "returnGeometry": "false", "f": "json"},
                    timeout=60, expire_after=86400).json()
    ys = set()
    for f in js.get("features", []):
        m = re.match(r"(\d{4})_(10|30)m_cdls$", f["attributes"].get("Name", ""))
        if m:
            ys.add(int(m.group(1)))
    return sorted(ys)


def export_box(x: float, y: float, half_m: float, year: int, res_m: int = 30, epsg: int = 5070, session=None,
               timeout: int = 60):
    """CDL class raster for a square box (EPSG:5070 metres, centre x/y), nearest-neighbour on a fixed res_m grid.

    The same box and size every year gives the same pixel grid, so pixels can be followed through the years.
    2024+ (10 m editions) are sampled onto the 30 m grid. Returns (uint8 array, affine transform)."""
    import io

    import numpy as np
    import rasterio

    n = int(round(2 * half_m / res_m))
    half = n * res_m / 2
    params = {"bbox": f"{x - half},{y - half},{x + half},{y + half}", "bboxSR": epsg, "imageSR": epsg,
              "size": f"{n},{n}", "format": "tiff", "pixelType": "U8", "interpolation": "RSP_NearestNeighbor",
              "noData": 0, "f": "image",
              "mosaicRule": json.dumps({"mosaicMethod": "esriMosaicLockRaster", "where": f"Name='{_layer(year)}'"})}
    s = session or http()
    r = s.get(f"{IMG}/exportImage", params=params, timeout=timeout)
    r.raise_for_status()
    if not r.headers.get("content-type", "").startswith("image"):
        raise RuntimeError(r.text[:200])
    with rasterio.open(io.BytesIO(r.content)) as ds:
        return np.asarray(ds.read(1), dtype=np.uint8), ds.transform
