"""Soil properties outside SSURGO: ISRIC SoilGrids v2.0 at the field centroid (REST, WCS fallback).

SoilGrids is a *modelled* global soil map at 250 m (machine-learning predictions from soil profiles and
covariates). It is not a soil survey and is always labelled that way. Values are returned under the same
property names as fieldshift.ingest.ssurgo so the engine can use either source:

  om_r, claytotal_r, sandtotal_r, silttotal_r, ph1to1h2o_r, awc_r, aws100_cm, kwfact, texture_class

Derivations (all cited, see METHOD below):
  * OM % = SOC % x 1.724 (van Bemmelen factor; the true ratio varies about 1.4-2.5, Pribyl 2010).
  * AWC = theta_33 - theta_1500 from the Saxton & Rawls (2006) pedotransfer functions, reduced by the
    coarse-fragment volume (Saxton & Rawls 2006 gravel correction).
  * K factor from Williams (1995) EPIC (sand, silt, clay, organic C), US customary units like SSURGO kwfact.
Drainage class, hydrologic group and wind erodibility index (WEI) cannot be derived and are None.
"""
from __future__ import annotations

import math
from typing import Any

from ..config import http
from .ssurgo import usda_texture

REST = "https://rest.isric.org/soilgrids/v2.0/properties/query"
WCS = ("https://maps.isric.org/mapserv?map=/map/{prop}.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
       "&COVERAGEID={prop}_{depth}_mean&FORMAT=image/tiff&SUBSET=X({w},{e})&SUBSET=Y({s},{n})"
       "&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326")
PROPS = ["clay", "sand", "silt", "soc", "phh2o", "bdod", "cfvo"]
DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"]
THICK = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15, "30-60cm": 30, "60-100cm": 40}
# conventional factor from mapped units to target units (SoilGrids FAQ; also returned per layer as d_factor)
D_FACTOR = {"clay": 10, "sand": 10, "silt": 10, "soc": 10, "phh2o": 10, "bdod": 100, "cfvo": 10}
SURFACE = ["0-5cm", "5-15cm", "15-30cm"]  # 0-30 cm thickness-weighted = "surface" (plough layer)
OM_FACTOR = 1.724

LABEL = "modelled soil map (SoilGrids 250 m), not a soil survey"
METHOD = {
    "soilgrids": "Poggio, L., de Sousa, L.M., Batjes, N.H., et al. (2021). SoilGrids 2.0: producing soil information "
                 "for the globe with quantified spatial uncertainty. SOIL 7, 217-240. doi:10.5194/soil-7-217-2021",
    "awc": "Saxton, K.E. & Rawls, W.J. (2006). Soil water characteristic estimates by texture and organic matter for "
           "hydrologic solutions. Soil Sci. Soc. Am. J. 70:1569-1578 (Eqs. 1-2 with gravel correction)",
    "kfactor": "Williams, J.R. (1995). The EPIC model. In: Singh, V.P. (ed.) Computer Models of Watershed Hydrology, "
               "pp. 909-1000. Water Resources Publications (K from sand, silt, clay, organic C)",
    "om": "OM = SOC x 1.724 (van Bemmelen factor). Uncertain: measured OM/OC ratios range about 1.4-2.5 "
          "(Pribyl, D.W. 2010, Geoderma 156:75-83)",
}
NOT_DERIVABLE = {
    "drainage_class": "Not derivable from SoilGrids (no drainage-class layer). Enter it if you know it.",
    "wei": "Wind erodibility index needs SSURGO/NRCS group data; not derivable from SoilGrids.",
    "hydgrp": "Hydrologic soil group is not in SoilGrids.",
}


def _fetch_rest(lat: float, lon: float) -> dict:
    params = [("lon", round(lon, 5)), ("lat", round(lat, 5))] + [("property", p) for p in PROPS] + \
             [("depth", d) for d in DEPTHS] + [("value", v) for v in ("mean", "Q0.05", "Q0.95")]
    r = http().get(REST, params=params, timeout=120)
    r.raise_for_status()
    js = r.json()
    out: dict[str, dict[str, dict]] = {}
    for layer in js["properties"]["layers"]:
        f = (layer.get("unit_measure") or {}).get("d_factor") or D_FACTOR[layer["name"]]
        out[layer["name"]] = {}
        for d in layer["depths"]:
            v = d.get("values") or {}
            out[layer["name"]][d["label"]] = {k: (None if v.get(k) is None else v[k] / f) for k in ("mean", "Q0.05", "Q0.95")}
    return out


def _fetch_wcs(lat: float, lon: float) -> dict:
    """WCS fallback: one tiny GeoTIFF per property x depth (mean only)."""
    import io

    import rasterio
    out: dict[str, dict[str, dict]] = {}
    h = 0.003
    for p in PROPS:
        out[p] = {}
        for d in DEPTHS:
            url = WCS.format(prop=p, depth=d, w=lon - h, e=lon + h, s=lat - h, n=lat + h)
            r = http().get(url, timeout=120)
            r.raise_for_status()
            with rasterio.open(io.BytesIO(r.content)) as src:
                row, col = src.index(lon, lat)
                a = src.read(1)
                row = min(max(row, 0), a.shape[0] - 1)
                col = min(max(col, 0), a.shape[1] - 1)
                v = float(a[row, col])
                nod = src.nodata
            out[p][d] = {"mean": None if (nod is not None and v == nod) or v < 0 else v / D_FACTOR[p],
                         "Q0.05": None, "Q0.95": None}
    return out


def saxton_rawls_awc(sand_pct: float, clay_pct: float, om_pct: float, gravel_vol_pct: float = 0.0) -> dict:
    """Saxton & Rawls (2006) Eqs. 1-2: theta_1500 and theta_33 (m3/m3); AWC = theta_33 - theta_1500.

    S, C as decimal fractions, OM in % by weight. Gravel: available water scales with (1 - Rv)."""
    S, C, OM = sand_pct / 100, clay_pct / 100, min(om_pct, 8.0)  # equations fitted for OM <= 8 %
    t1500t = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031
    t1500 = t1500t + (0.14 * t1500t - 0.02)
    t33t = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299
    t33 = t33t + (1.283 * t33t ** 2 - 0.374 * t33t - 0.015)
    awc = max(t33 - t1500, 0.0) * (1 - gravel_vol_pct / 100)
    return {"theta_33": t33, "theta_1500": t1500, "awc": awc, "om_clipped": om_pct > 8.0}


def williams_k(sand_pct: float, silt_pct: float, clay_pct: float, oc_pct: float) -> float:
    """Williams (1995) EPIC soil erodibility K (US customary, same units as SSURGO kwfact)."""
    ms, msilt, mc, orgc = sand_pct, silt_pct, clay_pct, oc_pct
    f_csand = 0.2 + 0.3 * math.exp(-0.256 * ms * (1 - msilt / 100))
    f_clsi = (msilt / (mc + msilt)) ** 0.3 if (mc + msilt) > 0 else 0.0
    f_orgc = 1 - 0.25 * orgc / (orgc + math.exp(3.72 - 2.95 * orgc))
    sn = 1 - ms / 100
    f_hisand = 1 - 0.7 * sn / (sn + math.exp(-5.51 + 22.9 * sn))
    return f_csand * f_clsi * f_orgc * f_hisand


def _wmean(raw: dict, prop: str, depths: list[str], stat: str = "mean") -> float | None:
    num = den = 0.0
    for d in depths:
        v = (raw.get(prop) or {}).get(d, {}).get(stat)
        if v is not None:
            num += v * THICK[d]
            den += THICK[d]
    return num / den if den else None


def query(lat: float, lon: float) -> dict[str, Any]:
    """SoilGrids at a point -> SSURGO-shaped properties. {'available': False, 'reason': ...} if no data."""
    via = "REST"
    try:
        raw = _fetch_rest(lat, lon)
    except Exception as e_rest:  # noqa: BLE001 - REST is a beta service; fall back to WCS
        try:
            raw = _fetch_wcs(lat, lon)
            via = "WCS"
        except Exception as e_wcs:  # noqa: BLE001
            return {"available": False, "reason": f"SoilGrids unavailable (REST: {str(e_rest)[:80]}; WCS: {str(e_wcs)[:80]})"}
    clay, sand, silt = (_wmean(raw, p, SURFACE) for p in ("clay", "sand", "silt"))
    soc_gkg = _wmean(raw, "soc", SURFACE)
    if clay is None or sand is None or soc_gkg is None:
        return {"available": False, "reason": "SoilGrids has no prediction here (water, urban or outside the land mask)"}
    tot = (clay or 0) + (sand or 0) + (silt or 0)
    if silt is None:
        silt = 100 - clay - sand
    elif tot and abs(tot - 100) > 0.5:  # predictions are independent; renormalise to 100 %
        clay, sand, silt = (100 * v / tot for v in (clay, sand, silt))
    oc_pct = soc_gkg / 10
    om = oc_pct * OM_FACTOR
    layers = []
    aws = 0.0
    for d in DEPTHS:
        c, s, si, so, cf = (raw.get(p, {}).get(d, {}).get("mean") for p in ("clay", "sand", "silt", "soc", "cfvo"))
        if c is None or s is None or so is None:
            aws = None
            break
        sr = saxton_rawls_awc(s, c, so / 10 * OM_FACTOR, cf or 0.0)
        aws = None if aws is None else aws + sr["awc"] * THICK[d]
        layers.append({"depth": d, "clay": c, "sand": s, "silt": si, "soc_g_kg": so, "ph": raw.get("phh2o", {}).get(d, {}).get("mean"),
                       "bdod": raw.get("bdod", {}).get(d, {}).get("mean"), "cfvo_pct": cf,
                       "awc": round(sr["awc"], 4), "theta_33": round(sr["theta_33"], 4), "theta_1500": round(sr["theta_1500"], 4)})
    surf = saxton_rawls_awc(sand, clay, om, _wmean(raw, "cfvo", SURFACE) or 0.0)
    props = {
        "om_r": om, "claytotal_r": clay, "sandtotal_r": sand, "silttotal_r": silt,
        "ph1to1h2o_r": _wmean(raw, "phh2o", SURFACE),
        "awc_r": surf["awc"], "aws100_cm": aws, "kwfact": williams_k(sand, silt, clay, oc_pct),
        "texture_class": usda_texture(sand, clay),
        "bulk_density_g_cm3": _wmean(raw, "bdod", SURFACE), "coarse_fragments_pct": _wmean(raw, "cfvo", SURFACE),
        "soc_g_kg": soc_gkg,
        "drainagecl": None, "wei": None, "hydgrp": None, "slope_r": None, "weg": None,
    }
    ranges = {"clay_pct_q05_q95": [_wmean(raw, "clay", SURFACE, "Q0.05"), _wmean(raw, "clay", SURFACE, "Q0.95")],
              "soc_g_kg_q05_q95": [_wmean(raw, "soc", SURFACE, "Q0.05"), _wmean(raw, "soc", SURFACE, "Q0.95")]}
    return {"available": True, "source": "soilgrids", "label": LABEL, "via": via, "point": [lon, lat],
            "properties": props, "layers": layers, "prediction_interval_90": ranges,
            "surface_depth": "0-30 cm thickness-weighted (SoilGrids 0-5, 5-15, 15-30 cm)",
            "not_derivable": NOT_DERIVABLE, "method": METHOD, "units": [],
            "notes": ["pH is SoilGrids pH(H2O); laboratory ratios vary (often 1:5), SSURGO uses 1:1",
                      "Williams K ignores rock fragments and structure; SSURGO kwfact includes them",
                      "Saxton & Rawls equations are fitted for OM <= 8 %" + (" (clipped here)" if surf["om_clipped"] else "")]}
