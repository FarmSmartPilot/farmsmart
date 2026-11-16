"""What cropland around a field did: crop mix, year-to-year transitions and rotation types within about 5 km.

US: USDA NASS Cropland Data Layer (CDL), read as a raster window from the keyless USDA SCINet CDL_WM ImageServer
(exportImage, EPSG:5070, 30 m grid, nearest neighbour; 2024+ are 10 m editions sampled on the same 30 m grid).
CropScape GetCDLFile (the bbox download) timed out again on 2026-11-15, as in the 2026-11-14 source check.
Canada: AAFC Annual Crop Inventory (ACI), same exportImage approach on its per-year ImageServers (EPSG:3978, 30 m).
Elsewhere: not available (no open per-pixel crop-type series wired in).

A 10 km x 10 km box (334 x 334 pixels at 30 m) centred on the field, the same grid every year, so each pixel can be
followed through the years. All numbers are pixel counts of the satellite classification; nothing is modelled.
This describes what neighbours grew. It is never evidence that a rotation switch pays.
"""
from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

import numpy as np

from .. import config
from . import aafc, cdl

PEERS_VERSION = "u9.1"
HALF_M = 5010.0          # box half-side in metres (334 pixels of 30 m)
RES_M = 30
N_YEARS = 8              # crop mix and changes
ROT_YEARS = 6            # per-pixel rotation types
PAIRS = 5                # pooled year-to-year transitions
TIMEOUT_S = 30           # per raster request (two tries)
CACHE_DIR = config.CACHE / "peers"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

NOTE_EN = ("What cropland within ≈5 km did ({src} satellite classification, 30 m). Not proof that a switch pays.")
NOTE_ES = ("Lo que hizo la tierra de cultivo a ≈5 km ({src}, clasificación satelital, 30 m). "
           "No prueba que un cambio sea rentable.")
SCALE_EN = "≈5 km around your field"
SCALE_ES = "≈5 km alrededor de su campo"

ROT_TYPES = [
    ("continuous_corn", "Continuous corn (corn 5 or 6 of 6 years)", "Maíz continuo (maíz 5 o 6 de 6 años)"),
    ("corn_soy", "Corn and soybean only", "Solo maíz y soya"),
    ("with_hay_pasture", "Includes hay, alfalfa or pasture", "Incluye heno, alfalfa o pasto"),
    ("three_plus_crops", "Three or more crops", "Tres o más cultivos"),
    ("with_small_grain", "Includes a small grain (wheat, oats, barley…)",
     "Incluye un cereal de grano pequeño (trigo, avena, cebada…)"),
    ("other", "Other (one crop most years, orchards, vegetables, two non-grain crops…)",
     "Otro (un cultivo casi todos los años, frutales, hortalizas, dos cultivos sin cereal…)"),
]
ROT_RULES = ("Per 30 m pixel over the last 6 years. A pixel counts when it is cropland (a crop, fallow or hay) in at "
             "least 4 of the 6 years and never non-farm land (pasture/grassland years allowed). Types are checked in "
             "this order: continuous corn (corn in 5+ years); corn and soybean only (each 2+ years); any hay, alfalfa "
             "or pasture year; 3+ different crops (fallow not counted, double crops count both); any small-grain "
             "year; other.")

# --- USDA CDL ------------------------------------------------------------------------------------------------------
CDL_CROP = {1: "corn", 5: "soybean", 24: "winter_wheat", 23: "spring_wheat", 22: "durum", 28: "oats", 21: "barley",
            4: "sorghum", 6: "sunflower", 31: "canola", 53: "field_pea", 52: "lentil", 51: "chickpea", 42: "dry_bean",
            36: "alfalfa", 2: "cotton", 3: "rice", 29: "proso_millet", 33: "safflower", 32: "flax", 41: "sugar_beet",
            54: "processing_tomato", 205: "triticale", 27: "cereal_rye", 61: "fallow"}
CDL_DBL = {26: (24, 5), 225: (24, 1), 226: (28, 1), 228: (205, 1), 230: (227, 22), 231: (227, 209), 232: (227, 2),
           233: (227, 21), 234: (22, 4), 235: (21, 4), 236: (24, 4), 237: (21, 1), 238: (24, 2), 239: (5, 2),
           240: (5, 28), 241: (1, 5), 254: (21, 5)}
CDL_CROPLAND = set(range(1, 7)) | set(range(10, 15)) | set(range(21, 62)) | set(range(66, 78)) | set(range(204, 255))
CDL_CROPLAND -= {7, 8, 9, 15, 16, 17, 18, 19, 20, 62, 73}
CDL_PASTURE = {176}
CDL_NODATA = {0, 81}
CDL_GROUPS = {"corn": {1}, "soy": {5}, "small_grain": {21, 22, 23, 24, 25, 27, 28, 29, 30, 205},
              "hay": {36, 37, 58, 59, 60}, "fallow": {61}}
CDL_ES = {
    1: "Maíz", 2: "Algodón", 3: "Arroz", 4: "Sorgo", 5: "Soya", 6: "Girasol", 10: "Maní", 11: "Tabaco",
    12: "Maíz dulce", 13: "Maíz palomero u ornamental", 14: "Menta", 21: "Cebada", 22: "Trigo duro",
    23: "Trigo de primavera", 24: "Trigo de invierno", 25: "Otros cereales menores", 26: "Doble: trigo inv./soya",
    27: "Centeno", 28: "Avena", 29: "Mijo", 30: "Espelta", 31: "Canola", 32: "Lino", 33: "Cártamo", 34: "Colza",
    35: "Mostaza", 36: "Alfalfa", 37: "Otro heno (no alfalfa)", 38: "Camelina", 39: "Alforfón", 41: "Remolacha azucarera",
    42: "Frijol seco", 43: "Papa", 44: "Otros cultivos", 45: "Caña de azúcar", 46: "Camote",
    47: "Hortalizas y frutas varias", 48: "Sandía", 49: "Cebolla", 50: "Pepino", 51: "Garbanzo", 52: "Lenteja",
    53: "Arveja", 54: "Tomate", 55: "Moras de caña", 56: "Lúpulo", 57: "Hierbas aromáticas",
    58: "Trébol/flores silvestres", 59: "Césped/semilla de pasto", 60: "Pasto varilla (switchgrass)",
    61: "Barbecho/tierra de cultivo ociosa", 66: "Cerezo", 67: "Durazno", 68: "Manzano", 69: "Vid",
    70: "Árboles de Navidad", 71: "Otros cultivos arbóreos", 72: "Cítricos", 74: "Nogal pecanero", 75: "Almendro",
    76: "Nogal", 77: "Peral", 176: "Pastizal/pasto", 204: "Pistacho", 205: "Triticale", 206: "Zanahoria",
    207: "Espárrago", 208: "Ajo", 209: "Melón cantalupo", 210: "Ciruela pasa", 211: "Olivo", 212: "Naranjo",
    213: "Melón dulce", 214: "Brócoli", 215: "Aguacate", 216: "Pimiento", 217: "Granado", 218: "Nectarina",
    219: "Hortalizas de hoja", 220: "Ciruelo", 221: "Fresa", 222: "Calabacín/calabaza", 223: "Albaricoque",
    224: "Veza", 225: "Doble: trigo inv./maíz", 226: "Doble: avena/maíz", 227: "Lechuga",
    228: "Doble: triticale/maíz", 229: "Calabaza", 230: "Doble: lechuga/trigo duro", 231: "Doble: lechuga/melón",
    232: "Doble: lechuga/algodón", 233: "Doble: lechuga/cebada", 234: "Doble: trigo duro/sorgo",
    235: "Doble: cebada/sorgo", 236: "Doble: trigo inv./sorgo", 237: "Doble: cebada/maíz",
    238: "Doble: trigo inv./algodón", 239: "Doble: soya/algodón", 240: "Doble: soya/avena", 241: "Doble: maíz/soya",
    242: "Arándano azul", 243: "Repollo", 244: "Coliflor", 245: "Apio", 246: "Rábano", 247: "Nabo",
    248: "Berenjena", 249: "Calabaza ornamental", 250: "Arándano rojo", 254: "Doble: cebada/soya",
}

# --- AAFC ACI ------------------------------------------------------------------------------------------------------
ACI_CROP = {k: v for k, v in aafc.ACI_TO_CROP.items() if k != 122}
ACI_CROPLAND = {120, 121, 122, 130} | set(range(131, 200))
ACI_PASTURE = {110}
ACI_NODATA = {0, 10}
ACI_GROUPS = {"corn": {147}, "soy": {158}, "small_grain": {132, 133, 134, 135, 136, 137, 138, 139, 140, 145, 146},
              "hay": {122}, "fallow": {130, 131}}
ACI_ES = {
    120: "Agricultura (sin diferenciar)", 121: "Tierra de cultivo", 122: "Pastos/forrajes",
    130: "Demasiado húmedo para sembrar", 131: "Barbecho", 132: "Cereales", 133: "Cebada", 134: "Otros granos",
    135: "Mijo", 136: "Avena", 137: "Centeno", 138: "Espelta", 139: "Triticale", 140: "Trigo", 141: "Pasto varilla",
    142: "Sorgo", 143: "Quinua", 145: "Trigo de invierno", 146: "Trigo de primavera", 147: "Maíz para grano",
    148: "Tabaco", 149: "Ginseng", 150: "Oleaginosas", 151: "Borraja", 152: "Camelina", 153: "Canola/colza",
    154: "Lino", 155: "Mostaza", 156: "Cártamo", 157: "Girasol", 158: "Soya", 159: "Otras oleaginosas",
    160: "Legumbres", 161: "Otras legumbres", 162: "Arveja", 163: "Garbanzo", 167: "Frijol", 168: "Haba",
    174: "Lenteja", 175: "Hortalizas", 176: "Tomate", 177: "Papa", 178: "Remolacha azucarera",
    179: "Otras hortalizas", 180: "Frutales", 181: "Bayas", 182: "Arándano azul", 183: "Arándano rojo",
    185: "Otras bayas", 188: "Huertos frutales", 189: "Otras frutas", 190: "Viñedos", 191: "Lúpulo", 192: "Césped",
    193: "Hierbas aromáticas", 194: "Vivero", 195: "Alforfón", 196: "Alpiste", 197: "Cáñamo", 198: "Veza",
    199: "Otros cultivos", 110: "Pastizal",
}

SCHEMES: dict[str, dict] = {
    "us": {"source": "USDA NASS Cropland Data Layer", "source_short": "USDA CDL",
           "url": "https://www.nass.usda.gov/Research_and_Science/Cropland/SARS1a.php",
           "service": cdl.IMG, "epsg": 5070, "prefix": "cdl", "crop": CDL_CROP, "dbl": CDL_DBL,
           "cropland": CDL_CROPLAND, "pasture": CDL_PASTURE, "nodata": CDL_NODATA, "groups": CDL_GROUPS,
           "es": CDL_ES, "licence": "Public domain (USDA)",
           "citation": "USDA National Agricultural Statistics Service Cropland Data Layer. {years}. Published "
                       "crop-specific data layer. USDA-NASS, Washington, DC."},
    "ca": {"source": "AAFC Annual Crop Inventory", "source_short": "AAFC ACI",
           "url": "https://open.canada.ca/data/en/dataset/ba2645d5-4458-414d-b196-6303ac06c1c9",
           "service": aafc.IMG, "epsg": 3978, "prefix": "aci", "crop": ACI_CROP, "dbl": {},
           "cropland": ACI_CROPLAND, "pasture": ACI_PASTURE, "nodata": ACI_NODATA, "groups": ACI_GROUPS,
           "es": ACI_ES, "licence": "Open Government Licence - Canada",
           "citation": "Contains information licensed under the Open Government Licence - Canada. "
                       "AAFC Annual Crop Inventory {years}."},
}


def _names(country: str) -> dict[int, str]:
    return cdl.class_names() if country == "us" else dict(aafc.ACI_NAMES)


def _key(sc: dict, code: int) -> str:
    return sc["crop"].get(code) or f"{sc['prefix']}_{code}"


# --- raster fetch --------------------------------------------------------------------------------------------------

def _session():
    import requests
    s = requests.Session()
    s.headers["User-Agent"] = config.USER_AGENT
    return s


def _aci_box(x: float, y: float, half_m: float, year: int, session):
    """ACI class raster for a square box in EPSG:3978 (same grid every year)."""
    import io

    import rasterio
    n = int(round(2 * half_m / RES_M))
    half = n * RES_M / 2
    params = {"bbox": f"{x - half},{y - half},{x + half},{y + half}", "bboxSR": 3978, "imageSR": 3978,
              "size": f"{n},{n}", "format": "tiff", "pixelType": "U8", "interpolation": "RSP_NearestNeighbor",
              "noData": 0, "f": "image"}
    r = session.get(f"{aafc.IMG.format(year=year)}/exportImage", params=params, timeout=TIMEOUT_S)
    r.raise_for_status()
    if not r.headers.get("content-type", "").startswith("image"):
        raise RuntimeError(r.text[:200])
    with rasterio.open(io.BytesIO(r.content)) as ds:
        return np.asarray(ds.read(1), dtype=np.uint8), ds.transform


def _years(country: str) -> list[int]:
    ys = cdl.layer_years() if country == "us" else list(aafc.YEARS)
    return ys[-N_YEARS:]


def fetch_stack(country: str, lon: float, lat: float, years: list[int]) -> tuple[dict[int, np.ndarray], Any, dict]:
    """{year: uint8 array} on one grid, the grid transform, and {year: error} for years that failed."""
    from pyproj import Transformer
    sc = SCHEMES[country]
    x, y = Transformer.from_crs(4326, sc["epsg"], always_xy=True).transform(lon, lat)

    def one(yr):
        s = _session()
        last = None
        for attempt in range(2):
            try:
                if country == "us":
                    return yr, cdl.export_box(x, y, HALF_M, yr, RES_M, 5070, session=s, timeout=TIMEOUT_S), None
                return yr, _aci_box(x, y, HALF_M, yr, s), None
            except Exception as e:  # noqa: BLE001 - retried, then recorded as missing (never invented)
                last = str(e)[:200]
                time.sleep(1.5 * (attempt + 1))
        return yr, None, last

    stack, errors, transform = {}, {}, None
    with ThreadPoolExecutor(max_workers=4) as ex:
        for yr, res, err in ex.map(one, years):
            if res is None:
                errors[yr] = err
                continue
            arr, tr = res
            stack[yr] = arr
            transform = transform or tr
    return stack, transform, errors


# --- per-pixel logic -----------------------------------------------------------------------------------------------

def _lut(codes, dtype=bool) -> np.ndarray:
    a = np.zeros(256, dtype=dtype)
    for c in codes:
        if 0 <= c < 256:
            a[c] = True
    return a


def _tables(sc: dict) -> dict[str, np.ndarray]:
    crop = _lut(sc["cropland"])
    t = {"crop": crop, "pasture": _lut(sc["pasture"]), "nodata": _lut(sc["nodata"])}
    for g, codes in sc["groups"].items():
        lut = _lut(codes)
        for d, parts in sc["dbl"].items():
            if any(p in codes for p in parts):
                lut[d] = True
        t[g] = lut
    # two "crop slots" per class for counting distinct crops (double crops fill both; fallow and pasture none)
    c1 = np.full(256, -1, dtype=np.int16)
    c2 = np.full(256, -1, dtype=np.int16)
    fallow = sc["groups"]["fallow"]
    for c in range(1, 256):
        if not crop[c] or c in fallow:
            continue
        if c in sc["dbl"]:
            c1[c], c2[c] = sc["dbl"][c]
        else:
            c1[c] = c
    t["c1"], t["c2"] = c1, c2
    cs = np.zeros(256, dtype=bool)
    for c in sc["groups"]["corn"] | sc["groups"]["soy"]:
        cs[c] = True
    for d, parts in sc["dbl"].items():
        if all(p in sc["groups"]["corn"] | sc["groups"]["soy"] for p in parts):
            cs[d] = True
    t["only_cs"] = cs
    return t


def classify(seq: np.ndarray, t: dict[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """seq: (years, n) uint8 codes. Returns (valid mask, type index into ROT_TYPES, -1 where not valid)."""
    crop = t["crop"][seq]
    ok_year = crop | t["pasture"][seq]
    valid = ok_year.all(0) & (crop.sum(0) >= 4) & ~t["nodata"][seq].any(0)
    corn_y = t["corn"][seq].sum(0)
    soy_y = t["soy"][seq].sum(0)
    comps = np.concatenate([t["c1"][seq], t["c2"][seq]], 0)
    comps = np.sort(comps, 0)
    distinct = ((np.diff(comps, axis=0) != 0) & (comps[1:] >= 0)).sum(0) + (comps[0] >= 0)
    typ = np.full(seq.shape[1], 5, dtype=np.int8)  # other
    sg = t["small_grain"][seq].any(0)
    typ[sg] = 4
    typ[distinct >= 3] = 3
    typ[(t["hay"][seq] | t["pasture"][seq]).any(0)] = 2
    typ[t["only_cs"][seq].all(0) & (corn_y >= 2) & (soy_y >= 2)] = 1
    typ[corn_y >= 5] = 0
    typ[~valid] = -1
    return valid, typ


def _field_mask(geom: dict, epsg: int, transform, shape_hw) -> np.ndarray:
    from pyproj import Transformer
    from rasterio.features import geometry_mask
    from shapely.geometry import mapping, shape
    from shapely.ops import transform as stransform
    tr = Transformer.from_crs(4326, epsg, always_xy=True)
    g = stransform(lambda x, y, z=None: tr.transform(x, y), shape(geom))
    m = geometry_mask([mapping(g)], out_shape=shape_hw, transform=transform, invert=True, all_touched=False)
    if not m.any():  # tiny field: the pixel under its centre
        m = geometry_mask([mapping(g.representative_point().buffer(1))], out_shape=shape_hw, transform=transform,
                          invert=True, all_touched=True)
    return m


def summarize(country: str, stack: dict[int, np.ndarray], transform, geom: Optional[dict]) -> dict:
    sc = SCHEMES[country]
    names = _names(country)
    t = _tables(sc)
    years = sorted(stack)

    def lab(code: int) -> dict:
        en = names.get(code, f"class {code}")
        return {"crop": _key(sc, code), "code": int(code), "label_en": en, "label_es": sc["es"].get(code, en)}

    labels: dict[str, dict] = {}

    def reg(code: int) -> dict:
        d = lab(code)
        labels[d["crop"]] = {"en": d["label_en"], "es": d["label_es"], "code": d["code"]}
        return d

    # crop mix per year (share of that year's cropland pixels)
    mix, shares_by_year = [], {}
    n_box = None
    for y in years:
        a = stack[y].ravel()
        n_box = a.size
        cnt = np.bincount(a, minlength=256)
        cropc = np.where(t["crop"], cnt, 0)
        tot = int(cropc.sum())
        sh = {c: cropc[c] / tot for c in np.nonzero(cropc)[0]} if tot else {}
        shares_by_year[y] = sh
        items, rest = [], 0.0
        for c, s in sorted(sh.items(), key=lambda kv: -kv[1]):
            if s >= 0.005:
                items.append({**reg(int(c)), "share": round(float(s), 4)})
            else:
                rest += s
        if rest > 0:
            items.append({"crop": "other_small", "code": None, "label_en": "Other crops (each under 0.5%)",
                          "label_es": "Otros cultivos (cada uno bajo 0,5 %)", "share": round(float(rest), 4)})
        mix.append({"year": y, "cropland_pixels": tot, "cropland_ha": round(tot * RES_M * RES_M / 1e4, 1),
                    "cropland_share_of_box": round(tot / a.size, 4), "items": items})

    # pooled transitions over the last PAIRS consecutive year pairs (cropland in both years)
    pairs = [(a, b) for a, b in zip(years[:-1], years[1:]) if b == a + 1][-PAIRS:]
    pc = np.zeros(256 * 256, dtype=np.int64)
    for a, b in pairs:
        x0, x1 = stack[a].ravel().astype(np.int32), stack[b].ravel().astype(np.int32)
        m = t["crop"][x0] & t["crop"][x1]
        pc += np.bincount(x0[m] * 256 + x1[m], minlength=256 * 256)
    pc = pc.reshape(256, 256)
    from_tot = pc.sum(1)
    pooled = int(pc.sum())
    transitions = []
    for flat in np.argsort(-pc, axis=None)[:40]:
        fa, tb = divmod(int(flat), 256)
        n = int(pc[fa, tb])
        if n == 0 or n < 0.001 * pooled:
            break
        f, to = reg(fa), reg(tb)
        transitions.append({"from": f["crop"], "to": to["crop"], "share_of_from": round(n / from_tot[fa], 4),
                            "share_of_all": round(n / pooled, 4), "pixels": n,
                            "from_label_en": f["label_en"], "from_label_es": f["label_es"],
                            "to_label_en": to["label_en"], "to_label_es": to["label_es"]})

    # per-pixel rotation types over the last ROT_YEARS consecutive years
    ry = years[-ROT_YEARS:]
    rot_ok = len(ry) == ROT_YEARS and ry[-1] - ry[0] == ROT_YEARS - 1
    rotation_types, rot_pixels, this_type, this_seq, field_px, field_type_shares = [], 0, None, [], 0, None
    if rot_ok:
        seq = np.stack([stack[y].ravel() for y in ry], 0)
        valid, typ = classify(seq, t)
        rot_pixels = int(valid.sum())
        cnt = np.bincount(typ[valid].astype(np.int64), minlength=len(ROT_TYPES))
        for i, (rid, en, es) in enumerate(ROT_TYPES):
            rotation_types.append({"id": rid, "label_en": en, "label_es": es,
                                   "share": round(float(cnt[i] / rot_pixels), 4) if rot_pixels else 0.0,
                                   "pixels": int(cnt[i])})
        if geom is not None and transform is not None:
            fm = _field_mask(geom, sc["epsg"], transform, stack[ry[0]].shape).ravel()
            field_px = int(fm.sum())
            if field_px:
                dom = []
                for k, y in enumerate(ry):
                    v = np.bincount(seq[k][fm], minlength=256)
                    c = int(np.argmax(v))
                    dom.append(c)
                    this_seq.append({"year": y, **reg(c), "share_of_field": round(float(v[c] / field_px), 3)})
                dv, dt = classify(np.array(dom, dtype=np.uint8).reshape(-1, 1), t)
                this_type = ROT_TYPES[int(dt[0])][0] if dv[0] else None
                fv = valid & fm
                if fv.any():
                    fc = np.bincount(typ[fv].astype(np.int64), minlength=len(ROT_TYPES))
                    field_type_shares = {ROT_TYPES[i][0]: round(float(fc[i] / fv.sum()), 3)
                                         for i in range(len(ROT_TYPES)) if fc[i]}

    # changes: mean share in the latest 3 years vs the earliest 3 years of the window
    changes = []
    if len(years) >= 6:
        early, late = years[:3], years[-3:]
        codes = set().union(*[set(shares_by_year[y]) for y in early + late])
        for c in codes:
            sb = float(np.mean([shares_by_year[y].get(c, 0.0) for y in early]))
            sr = float(np.mean([shares_by_year[y].get(c, 0.0) for y in late]))
            if max(sb, sr) < 0.01:
                continue
            d = reg(int(c))
            changes.append({"crop": d["crop"], "label_en": d["label_en"], "label_es": d["label_es"],
                            "share_recent": round(sr, 4), "share_before": round(sb, 4), "delta": round(sr - sb, 4)})
        changes.sort(key=lambda r: -abs(r["delta"]))
        changes = changes[:10]

    return {
        "years": years, "mix": mix, "transitions": transitions,
        "transition_years": [f"{a}-{b}" for a, b in pairs], "transition_pixels": pooled,
        "rotation_types": rotation_types, "rotation_years": ry if rot_ok else [], "rotation_pixels": rot_pixels,
        "rotation_ha": round(rot_pixels * RES_M * RES_M / 1e4, 1), "rotation_rules": ROT_RULES,
        "changes": changes,
        "changes_basis": {"before": years[:3], "recent": years[-3:]} if len(years) >= 6 else None,
        "this_field_type": this_type,
        "this_field_note": None if this_type else (
            "No rotation type for this field: in the crop map its main class was not cropland in at least 4 of the "
            "last 6 years, or the field has no pixels in the map." if rot_ok else "Fewer than 6 consecutive years."),
        "this_field_note_es": None if this_type else (
            "Sin tipo de rotación para este campo: en el mapa de cultivos su clase principal no fue tierra de cultivo "
            "en al menos 4 de los últimos 6 años, o el campo no tiene píxeles en el mapa." if rot_ok
            else "Menos de 6 años consecutivos."),
        "this_field_sequence": this_seq, "this_field_pixels": field_px,
        "this_field_pixel_types": field_type_shares,
        "box_pixels": n_box, "labels": labels,
    }


# --- public entry --------------------------------------------------------------------------------------------------

def country_of(ctx: dict) -> Optional[str]:
    cc = ((ctx.get("place") or {}).get("country_code") or "").lower()
    if cc:
        return cc
    if ctx.get("statefips"):  # reverse geocoder gave no address, but the US state lookup worked
        return "us"
    region = (ctx.get("region") or {}).get("region") or ""
    if region.startswith(("saskatchewan", "manitoba", "alberta", "ontario")):
        return "ca"
    return None


def _unavailable(reason: str, **kw) -> dict:
    return {"available": False, "reason": reason, "version": PEERS_VERSION, "is_nasa": False, **kw}


_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _cache_paths(fid: str):
    return [config.PRECOMP / f"peers_{fid}.json", CACHE_DIR / f"{fid}.json"]


def cached(fid: str) -> Optional[dict]:
    for p in _cache_paths(fid):
        if p.exists():
            try:
                js = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if js.get("version") == PEERS_VERSION:
                return js
    return None


def build(fid: str, ctx: dict) -> dict:
    """Compute the peers block for a field context (no cache)."""
    t0 = time.time()
    cc = country_of(ctx)
    if cc not in SCHEMES:
        return _unavailable(
            "Crop patterns around the field come from yearly per-pixel crop maps: the USDA Cropland Data Layer (US) "
            "and the AAFC Annual Crop Inventory (Canada). No open map of this kind is connected for other "
            "countries yet.", field_id=fid,
            reason_es="Los patrones de cultivo alrededor del campo vienen de mapas anuales de cultivos por píxel: el "
                      "Cropland Data Layer del USDA (EE. UU.) y el Annual Crop Inventory de AAFC (Canadá). Aún no hay "
                      "un mapa abierto de este tipo conectado para otros países.")
    sc = SCHEMES[cc]
    from shapely.geometry import shape
    c = ctx.get("centroid")
    lon, lat = (float(c[0]), float(c[1])) if c else tuple(shape(ctx["geometry"]).centroid.coords[0])
    try:
        years = _years(cc)
    except Exception as e:  # noqa: BLE001
        return _unavailable(f"{sc['source']} catalogue unavailable: {str(e)[:160]}", field_id=fid)
    stack, transform, errors = fetch_stack(cc, lon, lat, years)
    # drop years with no classified pixels at all (outside coverage, e.g. Alaska/Hawaii or outside ACI)
    nod = _tables(sc)["nodata"]
    for y in list(stack):
        if not (~nod[stack[y]]).any():
            errors[y] = "no classified pixels (outside coverage)"
            del stack[y]
    if len(stack) < 2:
        return _unavailable(f"{sc['source']} has no usable years around this field "
                            f"({'; '.join(f'{k}: {v}' for k, v in sorted(errors.items()))[:300]}).", field_id=fid)
    body = summarize(cc, stack, transform, ctx.get("geometry"))
    if not body["mix"] or all(m["cropland_pixels"] == 0 for m in body["mix"]):
        return _unavailable(f"No cropland pixels in the {sc['source']} within ≈5 km of this field.", field_id=fid)
    ys = body["years"]
    yrs = f"{ys[0]}-{ys[-1]}"
    note_src = f"{sc['source_short']}"
    return {
        "available": True, "version": PEERS_VERSION, "field_id": fid, "country": cc,
        "source": sc["source"], "url": sc["url"], "service": sc["service"].replace("/{year}/", "/{YYYY}/"),
        "citation": sc["citation"].format(years=yrs), "licence": sc["licence"], "is_nasa": False,
        "radius_km": 5, "box_km": round(2 * HALF_M / 1000, 1), "res_m": RES_M,
        "centre": [round(lon, 5), round(lat, 5)],
        **body,
        "missing_years": {str(k): v for k, v in sorted(errors.items())},
        "note": NOTE_EN.format(src=note_src), "note_es": NOTE_ES.format(src=note_src),
        "scale": SCALE_EN, "scale_es": SCALE_ES,
        "caveats": [
            "Satellite crop classification: accuracy is high for major crops but lower for minor crops, hay and "
            "pasture; pixels on field edges mix two classes.",
            "Shares are of cropland pixels in a 10 km square, not of farms or of reported acres.",
            "Patterns show what neighbours grew, not why, and not whether it paid.",
        ] + (["2024 onward are 10 m CDL editions, read on the same 30 m grid as earlier years."]
             if cc == "us" and any(y >= 2024 for y in ys) else []),
        "caveats_es": [
            "Clasificación satelital de cultivos: alta exactitud en cultivos principales, menor en cultivos menores, "
            "heno y pasto; los píxeles en bordes de campo mezclan dos clases.",
            "Las proporciones son de píxeles de cultivo en un cuadro de 10 km, no de fincas ni de acres declarados.",
            "Los patrones muestran lo que sembraron los vecinos, no por qué ni si fue rentable.",
        ] + (["Desde 2024 son ediciones del CDL de 10 m, leídas en la misma cuadrícula de 30 m que los años previos."]
             if cc == "us" and any(y >= 2024 for y in ys) else []),
        "elapsed_s": round(time.time() - t0, 2),
    }


def get(fid: str, ctx: dict, refresh: bool = False) -> dict:
    """Cached peers block (data/precomputed/peers_{fid}.json, then data/cache/peers/{fid}.json, else live)."""
    if not refresh:
        hit = cached(fid)
        if hit is not None:
            return hit
    with _locks_guard:
        lock = _locks.setdefault(fid, threading.Lock())
    with lock:
        if not refresh:
            hit = cached(fid)
            if hit is not None:
                return hit
        out = build(fid, ctx)
        # cache real results and the stable "not covered" answer; transient failures are retried next time
        stable = out.get("available") or country_of(ctx) not in SCHEMES
        if stable:
            (CACHE_DIR / f"{fid}.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        return out
