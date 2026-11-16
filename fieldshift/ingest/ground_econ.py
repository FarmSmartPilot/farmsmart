"""Ground economics for crops USDA ERS Costs and Returns does not survey: sunflower (oil type).

USDA ERS covers nine field crops only, so a rotation with sunflower had no cost or price record and dropped out of
profit and whole-farm totals. This module fills that gap from published public records, in the same shape the
engine reads from `econ.crop_economics` / `econ.ers_line_items`:

    Costs    NDSU Extension, "Projected Crop Budgets" (North Dakota, nine regions), the oil-sunflower sheet of each
             region's Excel budget, last 5 budget years. Direct costs -> operating lines, indirect costs -> overhead.
             ND fields use their own NDSU region (by county); fields in other states use South Central ND, the
             region that borders South Dakota (no other US state publishes a sunflower budget we could find; said
             in the notes and the evidence scale).
    Prices   USDA NASS Quick Stats, marketing-year price received, SUNFLOWER, OIL TYPE, by state (US average when the
             state is not published), $/cwt converted to $/lb (crops.yaml: sunflower yield unit lb/acre).
    Yields   USDA NASS Quick Stats survey yields, SUNFLOWER, OIL TYPE, lb per harvested acre: the field's county when
             NASS published at least 5 of the last 10 years there, else the state, else the US.

Every value comes from the downloaded files; nothing is typed in. Each budget's direct and indirect line items are
checked against the budget's own "SUM OF LISTED ..." rows when parsed. Crop insurance is listed by NDSU as a direct
cost but is left out of the operating total so sunflower sits on the same basis as the ERS crops (ERS excludes crop
insurance premiums); its value is kept and reported.

Build:   python -m fieldshift.ingest.ground_econ   (writes data/reference/ground_sunflower.json; files in
         data/cache/ground_econ/; needs NASS_API_KEY for the NASS part)
API:     covers(crop_id), crop_economics(crop_id, fips, price_window), line_items(crop_id, region),
         county_yields(crop_id), state_yields(crop_id), budget_region(fips)
"""
from __future__ import annotations

import io
import json
import re
import warnings
from datetime import date, datetime, timezone
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd

from ..config import CACHE, DATA, http

REF = DATA / "reference" / "ground_sunflower.json"
RAW = CACHE / "ground_econ"

NDSU_BASE = "https://www.ndsu.edu"
NDSU_LANDING = f"{NDSU_BASE}/agriculture/ag-hub/ag-topics/farm-management/crop-economics/projected-crop-budgets"
NDSU_CITATION = ("Haugen, R. North Dakota {year} Projected Crop Budgets ({region}). NDSU Extension, North Dakota State "
                 "University, Fargo. " + NDSU_LANDING)
NASS_URL = "https://quickstats.nass.usda.gov"
NASS_CITATION = ("USDA National Agricultural Statistics Service, Quick Stats (survey). This product uses the NASS API "
                 "but is not endorsed or certified by NASS. https://quickstats.nass.usda.gov")
BUDGET_YEARS = 5

# NDSU budget regions: code -> (label, file-name tokens, counties as listed on the NDSU landing page)
NDSU_REGIONS: dict[str, tuple[str, tuple[str, ...], list[str]]] = {
    "NW": ("North West ND", ("NW", "NorthWest"), ["Burke", "Divide", "Mountrail", "McKenzie", "Williams"]),
    "NC": ("North Central ND", ("NC", "NorthCent"),
           ["Benson", "Bottineau", "McHenry", "McLean", "Pierce", "Renville", "Rolette", "Ward"]),
    "NE": ("North East ND", ("NE", "NorthEast"), ["Cavalier", "Nelson", "Ramsey", "Towner"]),
    "NV": ("North Valley ND", ("NV", "NorthRRV"), ["Grand Forks", "Pembina", "Walsh"]),
    "SW": ("South West ND", ("SW", "SouthWest"),
           ["Adams", "Billings", "Bowman", "Dunn", "Golden Valley", "Grant", "Hettinger", "Mercer", "Morton", "Oliver",
            "Sioux", "Slope", "Stark"]),
    "SC": ("South Central ND", ("SC", "SouthCent"), ["Burleigh", "Emmons", "Kidder", "Logan", "McIntosh", "Sheridan"]),
    "EC": ("East Central ND", ("EC", "EastCent"), ["Eddy", "Foster", "Griggs", "Stutsman", "Wells"]),
    "SE": ("South East ND", ("SE", "SouthEast"), ["Barnes", "Dickey", "LaMoure", "Ransom", "Sargent", "Steele"]),
    "SV": ("South Valley ND", ("SV", "SouthRRV"), ["Cass", "Richland", "Traill"]),
}
OUT_OF_STATE_REGION = "SC"  # borders South Dakota; used for fields outside North Dakota (said in notes)
ND_FIPS = "38"

# FarmSmart crop id -> NDSU sheet and NASS series
CROPS = {
    "sunflower": {"ndsu_sheet": "Oil_SF", "ndsu_title": "OIL SUNFLOWER", "nass_commodity": "SUNFLOWER",
                  "nass_price": "SUNFLOWER, OIL TYPE - PRICE RECEIVED, MEASURED IN $ / CWT",
                  "nass_yield": "SUNFLOWER, OIL TYPE - YIELD, MEASURED IN LB / ACRE",
                  "label": "oil-type sunflower"},
}

# Calculator cost-line id -> (NDSU item names, EN label, ES label). Ids match econ.ERS_LINES where the meaning matches.
LINES = {
    "operating": {
        "seed": (["Seed"], "Seed", "Semilla"),
        "fertilizer": (["Fertilizer"], "Fertilizer", "Fertilizante"),
        "chemicals": (["Herbicides", "Fungicides", "Insecticides"], "Chemicals (herbicides, fungicides, insecticides)",
                      "Agroquímicos (herbicidas, fungicidas, insecticidas)"),
        "fuel": (["Fuel & Lubrication"], "Fuel and lubrication", "Combustible y lubricantes"),
        "repairs": (["Repairs"], "Repairs", "Reparaciones"),
        "interest": (["Operating Interest"], "Interest on operating capital", "Intereses del capital operativo"),
        "other": (["Drying", "Miscellaneous"], "Other operating costs (drying, miscellaneous)",
                  "Otros costos operativos (secado, varios)"),
    },
    "overhead": {
        "land": (["Land Charge"], "Land charge", "Cargo por la tierra"),
        "machinery": (["Machinery Depreciation", "Machinery Investment"],
                      "Machinery ownership (depreciation and interest on the investment)",
                      "Propiedad de maquinaria (depreciación e intereses de la inversión)"),
        "general": (["Misc. Overhead"], "Miscellaneous overhead", "Gastos generales varios"),
    },
}
EXCLUDED_DIRECT = {"Crop Insurance": "left out of the operating total: USDA ERS cost lines exclude crop-insurance "
                                     "premiums, so all crops stay on one basis"}
DIRECT_TOTAL, INDIRECT_TOTAL = "SUM OF LISTED DIRECT COSTS", "SUM OF LISTED INDIRECT COSTS"


def covers(crop_id: str) -> bool:
    return crop_id in CROPS


# ----------------------------------------------------------------------------------------------- NDSU budgets
def _ndsu_links() -> dict[tuple[str, int], str]:
    """(region code, budget year) -> Excel URL, read from the NDSU landing page."""
    html = http().get(NDSU_LANDING, timeout=60).text
    tok = {t: code for code, (_, toks, _) in NDSU_REGIONS.items() for t in toks}
    out: dict[tuple[str, int], str] = {}
    for m in re.finditer(r'href="([^"]+?\.xls)"', html):
        href = m.group(1)
        name = href.rsplit("/", 1)[-1].replace("%20", " ")
        mm = re.match(r"([A-Za-z]+)_(\d{2}|\d{4})Bud", name)
        if not mm or mm.group(1) not in tok:
            continue
        y = int(mm.group(2))
        y = y + 2000 if y < 100 else y
        url = href if href.startswith("http") else NDSU_BASE + href
        out.setdefault((tok[mm.group(1)], y), url)
    if not out:
        raise RuntimeError("no NDSU budget workbooks found on the landing page")
    return out


def parse_ndsu_sheet(raw: bytes, sheet: str, title: str) -> dict:
    """One crop sheet of an NDSU budget workbook -> {items: {name: $/ac}, yield, price, totals}. Checks the line
    items against the sheet's own totals."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        d = pd.read_excel(io.BytesIO(raw), sheet_name=sheet, header=None, engine="xlrd")
    if not str(d.iat[0, 0]).strip().upper().startswith(title):
        raise ValueError(f"sheet {sheet} does not hold the {title} budget")
    rows, section = {}, None
    items: dict[str, dict[str, float]] = {"direct": {}, "indirect": {}}
    notes = {}
    for i in range(len(d)):
        lab = d.iat[i, 0]
        if not isinstance(lab, str) or not lab.strip():
            continue
        raw_lab = lab.strip()
        name = raw_lab.lstrip("-").strip()
        val = pd.to_numeric(d.iat[i, 1], errors="coerce") if d.shape[1] > 1 else np.nan
        if raw_lab.upper().startswith("DIRECT COSTS"):
            section = "direct"
            continue
        if raw_lab.upper().startswith("INDIRECT"):
            section = "indirect"
            continue
        if raw_lab.upper().startswith("LISTED COSTS PER BUDGET UNIT"):
            section = None
            continue
        if raw_lab.startswith("-") and section and pd.notna(val):
            items[section][name] = round(float(val), 2)
            if d.shape[1] > 2 and isinstance(d.iat[i, 2], str) and d.iat[i, 2].strip():
                notes[name] = d.iat[i, 2].strip()
        elif pd.notna(val):
            rows[name] = float(val)
    for sec, total in (("direct", DIRECT_TOTAL), ("indirect", INDIRECT_TOTAL)):
        if total not in rows:
            raise ValueError(f"{total} not found")
        if abs(sum(items[sec].values()) - rows[total]) > 0.05:
            raise ValueError(f"{sec} items add to {sum(items[sec].values()):.2f}, sheet says {rows[total]:.2f}")
    return {"yield_lb_ac": rows.get("Market Yield"), "price_usd_lb": rows.get("Market Price"),
            "revenue_usd_ac": rows.get("Market Revenue"), "direct": items["direct"], "indirect": items["indirect"],
            "direct_total": round(rows[DIRECT_TOTAL], 2), "indirect_total": round(rows[INDIRECT_TOTAL], 2),
            "return_to_labor_mgmt": round(rows["RETURN TO LABOR & MGMT"], 2) if "RETURN TO LABOR & MGMT" in rows else None,
            "notes": notes}


def fetch_ndsu(crop_id: str = "sunflower", years: int = BUDGET_YEARS) -> dict:
    spec = CROPS[crop_id]
    links = _ndsu_links()
    last = max(y for _, y in links)
    want = list(range(last - years + 1, last + 1))
    RAW.mkdir(parents=True, exist_ok=True)
    out: dict[str, Any] = {}
    errors = []
    for code in NDSU_REGIONS:
        for y in want:
            url = links.get((code, y))
            if not url:
                errors.append(f"{code} {y}: no workbook link")
                continue
            p = RAW / f"ndsu_{code}_{y}.xls"
            if not p.exists():
                r = http().get(url, timeout=120)
                r.raise_for_status()
                p.write_bytes(r.content)
            try:
                b = parse_ndsu_sheet(p.read_bytes(), spec["ndsu_sheet"], spec["ndsu_title"])
            except Exception as e:  # noqa: BLE001 - kept as a reason, never filled in
                errors.append(f"{code} {y}: {e}")
                continue
            out.setdefault(code, {})[str(y)] = {**b, "url": url}
    return {"years": want, "regions": out, "errors": errors}


def _nd_county_fips() -> dict[str, str]:
    """ND county FIPS -> NDSU region code, matching the landing page's county names to USDA NASS county names."""
    from . import nass
    t = nass.county_table()
    t = t[t["fips"].astype(str).str[:2] == ND_FIPS][["fips", "county"]].drop_duplicates()
    key = lambda s: re.sub(r"[^a-z]", "", str(s).lower())  # noqa: E731
    by_name = {key(c): str(f) for f, c in zip(t["fips"], t["county"])}
    out, miss = {}, []
    for code, (_, _, counties) in NDSU_REGIONS.items():
        for c in counties:
            f = by_name.get(key(c))
            if f:
                out[f] = code
            else:
                miss.append(c)
    if miss:
        raise RuntimeError(f"ND counties not matched to FIPS: {miss}")
    return out


# ----------------------------------------------------------------------------------------------- USDA NASS
def fetch_nass(crop_id: str = "sunflower", year0: int = 2000) -> dict:
    """Marketing-year price received (state + US), county and state survey yields for the crop's NASS series."""
    from . import nass
    spec = CROPS[crop_id]
    com = spec["nass_commodity"]

    def rows(q):
        n = int(nass._get("get_counts", q).get("count", 0))
        return nass._get("api_GET", q).get("data", []) if n else []

    base = dict(source_desc="SURVEY", sector_desc="CROPS", commodity_desc=com, year__GE=year0)
    prices: dict[str, dict[str, float]] = {}
    for agg in ("STATE", "NATIONAL"):
        for x in rows({**base, "agg_level_desc": agg, "statisticcat_desc": "PRICE RECEIVED",
                       "reference_period_desc": "MARKETING YEAR"}):
            if x.get("short_desc") != spec["nass_price"] or x.get("domain_desc") != "TOTAL":
                continue
            v = nass._num(x["Value"])
            if v is not None:
                prices.setdefault(x["state_alpha"], {})[str(x["year"])] = v
    cy: dict[str, dict[str, Any]] = {}
    for x in rows({**base, "agg_level_desc": "COUNTY", "statisticcat_desc": "YIELD"}):
        if (x.get("short_desc") != spec["nass_yield"] or x.get("domain_desc") != "TOTAL"
                or x.get("county_code") in ("998", "999", "") or x.get("reference_period_desc") != "YEAR"
                or x.get("prodn_practice_desc") != "ALL PRODUCTION PRACTICES"):
            continue
        v = nass._num(x["Value"])
        if v is None:
            continue
        f = f"{x['state_fips_code']}{x['county_code']}"
        e = cy.setdefault(f, {"county": x["county_name"].title(), "state": x["state_alpha"], "values": {}})
        e["values"][str(x["year"])] = v
    sy: dict[str, dict[str, Any]] = {}
    for agg in ("STATE", "NATIONAL"):
        for x in rows({**base, "agg_level_desc": agg, "statisticcat_desc": "YIELD", "reference_period_desc": "YEAR"}):
            if (x.get("short_desc") != spec["nass_yield"] or x.get("domain_desc") != "TOTAL"
                    or x.get("prodn_practice_desc") != "ALL PRODUCTION PRACTICES"):
                continue
            v = nass._num(x["Value"])
            if v is None:
                continue
            e = sy.setdefault(x["state_alpha"], {"state_fips": x.get("state_fips_code") or "", "values": {}})
            e["values"][str(x["year"])] = v
    return {"price_series": spec["nass_price"], "yield_series": spec["nass_yield"],
            "prices_usd_cwt": prices, "county_yields": cy, "state_yields": sy}


# ----------------------------------------------------------------------------------------------- build / read
def build(crop_id: str = "sunflower") -> dict:
    nd = fetch_ndsu(crop_id)
    ns = fetch_nass(crop_id)
    js = {"meta": {"crop_id": crop_id, "label": CROPS[crop_id]["label"],
                   "retrieved": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "costs": {"source": "NDSU Extension", "product": "North Dakota Projected Crop Budgets (oil sunflower)",
                             "url": NDSU_LANDING, "sheet": CROPS[crop_id]["ndsu_sheet"], "years": nd["years"],
                             "licence": "Public extension publication (NDSU Extension); cited with attribution",
                             "author": "Ron Haugen, NDSU Extension", "errors": nd["errors"]},
                   "prices": {"source": "USDA NASS Quick Stats", "series": ns["price_series"],
                              "period": "marketing year", "url": NASS_URL, "licence": "Public domain (USDA)"},
                   "yields": {"source": "USDA NASS Quick Stats", "series": ns["yield_series"],
                              "basis": "per harvested acre", "url": NASS_URL, "licence": "Public domain (USDA)"},
                   "lines": {g: {k: {"items": v[0], "label_en": v[1], "label_es": v[2]} for k, v in L.items()}
                             for g, L in LINES.items()},
                   "excluded_direct": EXCLUDED_DIRECT, "out_of_state_region": OUT_OF_STATE_REGION,
                   "regions": {k: {"label": v[0], "counties": v[2]} for k, v in NDSU_REGIONS.items()}},
          "nd_county_region": _nd_county_fips(), "budgets": nd["regions"],
          "prices_usd_cwt": ns["prices_usd_cwt"], "county_yields": ns["county_yields"],
          "state_yields": ns["state_yields"]}
    REF.parent.mkdir(parents=True, exist_ok=True)
    REF.write_text(json.dumps(js, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    _ref.cache_clear()
    return js


@lru_cache(maxsize=1)
def _ref() -> dict:
    return json.loads(REF.read_text(encoding="utf-8"))


def _state_alpha(st_fips: str) -> str | None:
    js = _ref()
    return next((a for a, e in js["state_yields"].items() if e.get("state_fips") == st_fips and a not in ("US", "OT")),
                None) or _STATE_ALPHA.get(st_fips)


_STATE_ALPHA = {"01": "AL", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "12": "FL",
                "13": "GA", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA",
                "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
                "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
                "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN",
                "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"}


def budget_region(fips: str | None) -> tuple[str, str | None]:
    """NDSU budget region code for a county (5-digit) or state (2-digit) FIPS, and a note when it is not the
    field's own region."""
    f = str(fips or "")
    js = _ref()
    if len(f) == 5 and f in js["nd_county_region"]:
        return js["nd_county_region"][f], None
    code = OUT_OF_STATE_REGION
    lab = NDSU_REGIONS[code][0]
    if f[:2] == ND_FIPS:
        return code, f"No NDSU region found for county FIPS {f}; using {lab}."
    return code, (f"No public sunflower budget found for this state; using the NDSU {lab} budget, the North Dakota "
                  "region that borders South Dakota. Costs in your state may differ.")


def _region_code(region: str | None) -> str | None:
    r = str(region or "").replace("NDSU ", "").strip()
    return next((k for k, v in NDSU_REGIONS.items() if r in (k, v[0])), None)


def _dist(years: list[int], vals: list[float], nd: int = 2) -> dict:
    """econ._dist with a chosen number of decimals ($/lb prices need 4: 0.2110, not 0.21)."""
    a = np.asarray(vals, float)
    r = lambda v: round(float(v), nd)  # noqa: E731
    return {"years": [int(y) for y in years], "values": [r(v) for v in a], "n": int(a.size), "mean": r(a.mean()),
            "min": r(a.min()), "max": r(a.max()), "p10": r(np.percentile(a, 10)), "p50": r(np.percentile(a, 50)),
            "p90": r(np.percentile(a, 90)), "sd": r(a.std(ddof=1)) if a.size > 1 else None}


def _budget_years(code: str) -> list[tuple[int, dict]]:
    b = _ref()["budgets"].get(code) or {}
    return sorted((int(y), v) for y, v in b.items())


def _op_total(b: dict) -> float:
    return round(sum(v for k, v in b["direct"].items() if k not in EXCLUDED_DIRECT), 2)


def _line_values(code: str) -> dict:
    yrs = _budget_years(code)
    out = {"years": [y for y, _ in yrs]}
    for grp, sec in (("operating", "direct"), ("overhead", "indirect")):
        lines = []
        for lid, (names, en, es) in LINES[grp].items():
            have = [n for n in names if any(n in b[sec] for _, b in yrs)]
            if not have:
                continue
            vals = [round(sum(b[sec].get(n, 0.0) for n in have), 2) if any(n in b[sec] for n in have) else None
                    for _, b in yrs]
            ok = [v for v in vals if v is not None]
            lines.append({"id": lid, "items": have, "label_en": en, "label_es": es, "values": vals,
                          "median": round(float(np.median(ok)), 2)})
        out[grp] = lines
    out["operating_total"] = [_op_total(b) for _, b in yrs]
    out["overhead_total"] = [b["indirect_total"] for _, b in yrs]
    out["excluded"] = {k: [b["direct"].get(k) for _, b in yrs] for k in EXCLUDED_DIRECT}
    return out


def _yield_series(crop_id: str, fips: str | None) -> tuple[list[int], list[float], str, str]:
    """(years, lb/ac, level label, scale) for the field's county, else state, else US; complete seasons only."""
    js = _ref()
    last_full = date.today().year - 1
    f = str(fips or "")
    cy = js["county_yields"].get(f) if len(f) == 5 else None
    st = _state_alpha(f[:2]) if f else None
    sy = (js["state_yields"].get(st) or {}).get("values") if st else None
    s_last = max((int(y) for y in (sy or {}) if int(y) <= last_full), default=last_full)
    if cy:
        yv = sorted((int(y), v) for y, v in cy["values"].items() if int(y) <= last_full)
        recent = [p for p in yv if p[0] > s_last - 10]
        if len(recent) >= 5:
            return ([y for y, _ in yv], [v for _, v in yv], f"{cy['county']} County, {cy['state']}",
                    "county average (per harvested acre), not your field")
    if sy:
        yv = sorted((int(y), v) for y, v in sy.items() if int(y) <= last_full)
        if len(yv) >= 5:
            return [y for y, _ in yv], [v for _, v in yv], f"{st} state", "state average (per harvested acre), not your field"
    us = (js["state_yields"].get("US") or {}).get("values") or {}
    yv = sorted((int(y), v) for y, v in us.items() if int(y) <= last_full)
    return [y for y, _ in yv], [v for _, v in yv], "US", "US average (per harvested acre), not your field"


PRICE_MIN_SHARE = 0.8  # the state series must cover this share of the price window, else the US average is used


def _price_series(fips: str | None, window: tuple[int, int] | None) -> tuple[list[int], list[float], str, str | None]:
    """(years, $/lb, 'SD' or 'US', note). One level only: NASS withholds many state years (e.g. SD 2016–2024),
    and a series switching between state and US values would not be one price record."""
    js = _ref()
    st = _state_alpha(str(fips or "")[:2]) if fips else None

    def pick(loc):
        p = js["prices_usd_cwt"].get(loc) or {}
        return sorted((int(y), v) for y, v in p.items() if window is None or window[0] <= int(y) <= window[1])
    note = None
    yv, loc = (pick(st), st) if st else ([], None)
    need = PRICE_MIN_SHARE * ((window[1] - window[0] + 1) if window else 10)
    if len(yv) < need:
        if st:
            note = (f"USDA NASS publishes the {st} sunflower price for only {len(yv)} of the "
                    + (f"{window[0]}–{window[1]} " if window else "") + "marketing years; using the US average.")
        yv, loc = pick("US"), "US"
    return [y for y, _ in yv], [round(v / 100.0, 4) for _, v in yv], loc, note


def crop_economics(crop_id: str, fips: str | None = None, price_window: tuple[int, int] | None = None) -> dict:
    """Same shape as econ.crop_economics for the keys the engine reads (last5/last10 yield, price, operating_cost,
    overhead; units; region; evidence). `fips`: the field's county (5 digits) or state (2 digits).
    `price_window`: the ERS price years, so a non-ERS crop never adds price years the ERS crops lack."""
    if crop_id not in CROPS:
        return {"value": None, "crop_id": crop_id, "reason": f"no ground economics for '{crop_id}'"}
    try:
        _ref()
    except FileNotFoundError:
        return {"value": None, "crop_id": crop_id, "reason": "sunflower reference data not built"}
    code, rnote = budget_region(fips)
    lv = _line_values(code)
    if not lv["years"]:
        return {"value": None, "crop_id": crop_id, "reason": f"no NDSU budget parsed for {NDSU_REGIONS[code][0]}"}
    yy, yv, ylevel, yscale = _yield_series(crop_id, fips)
    py, pv, ploc, pnote = _price_series(fips, price_window)
    if len(yy) < 5 or len(py) < 5:
        return {"value": None, "crop_id": crop_id, "reason": "too few USDA NASS sunflower yields or prices here"}
    label = CROPS[crop_id]["label"]
    region = f"NDSU {NDSU_REGIONS[code][0]}"
    notes = [n for n in (rnote,) if n]
    notes.append("Costs: NDSU Extension projected budgets (oil sunflower), not a USDA ERS survey; NDSU leaves out "
                 "unpaid labour and management, so there is no labour line.")
    exc = [v for v in lv["excluded"].get("Crop Insurance", []) if v is not None]
    if exc:
        notes.append(f"NDSU lists crop insurance at ${float(np.median(exc)):.2f}/acre (median); "
                     + EXCLUDED_DIRECT["Crop Insurance"] + ".")
    notes.append(f"Price: USDA NASS marketing-year price received for {label}, "
                 + (f"{ploc}" if ploc != "US" else "US average") + ", $/cwt ÷ 100 = $/lb.")
    if pnote:
        notes.append(pnote)
    notes.append(f"Yield: USDA NASS {label} survey yield, {ylevel}, per harvested acre (NDSU costs are per acre).")
    units = {"yield": "pounds per harvested acre", "price": "dollars per pound (marketing-year average)",
             "operating_cost": "dollars per acre (NDSU direct costs less crop insurance)",
             "overhead": "dollars per acre (NDSU indirect costs)"}
    out: dict[str, Any] = {"crop_id": crop_id, "ers_commodity": None, "source_id": "ndsu_nass", "region": region,
                           "region_requested": fips, "units": units, "notes": notes,
                           "yield_source": f"USDA NASS {ylevel} 5-year median ({label}, per harvested acre)",
                           "yield_level": ylevel, "price_location": ploc}
    by, bops, bovh = lv["years"], lv["operating_total"], lv["overhead_total"]
    for n in (5, 10):
        out[f"last{n}"] = {"yield": _dist(yy[-n:], yv[-n:]), "price": _dist(py[-n:], pv[-n:], 4),
                           "operating_cost": _dist(by[-n:], bops[-n:]), "overhead": _dist(by[-n:], bovh[-n:])}
    out["latest_year"] = max(py[-1], by[-1])
    price_lab = (f"USDA NASS marketing-year price received, {label}, "
                 + (f"{ploc} state average" if ploc != "US" else "US average") + " (nominal)")
    out["evidence"] = {
        "source_id": "ndsu_nass", "source": "NDSU Extension; USDA NASS Quick Stats",
        "product": "Projected Crop Budgets (oil sunflower) + marketing-year prices and survey yields",
        "is_nasa": False, "years": [min(by[0], py[0]), max(by[-1], py[-1])], "region": region,
        "scale": f"NDSU {NDSU_REGIONS[code][0]} budget and USDA NASS {ploc if ploc != 'US' else 'US'} averages, not "
                 "your farm",
        "url": NDSU_LANDING, "urls": [NDSU_LANDING, NASS_URL],
        "citation": NDSU_CITATION.format(year=f"{by[0]}–{by[-1]}", region=NDSU_REGIONS[code][0]) + " " + NASS_CITATION,
        "licence": "NDSU: public extension publication, cited; USDA NASS: public domain",
        "price_source_label": price_lab,
        "price_scale_label": ("USDA NASS state average, not your farm-gate price" if ploc != "US"
                              else "USDA NASS US average, not your farm-gate price"),
        "yield_scale_label": yscale,
        "cost_note": (f"Sunflower costs are the NDSU Extension {NDSU_REGIONS[code][0]} projected budgets "
                      f"({by[0]}–{by[-1]} median, per acre), not USDA ERS and not your farm's costs."),
        "price_note": (f"Sunflower prices are USDA NASS marketing-year prices received {py[0]}–{py[-1]} "
                       f"({ploc if ploc != 'US' else 'US average'}, nominal dollars), not your local price."),
        "offline_fallback": False}
    return out


def line_items(crop_id: str, region: str | None = None) -> dict:
    """Same shape as econ.ers_line_items: operating lines (`costs`) and overhead, each the 5-year median $/acre of
    its NDSU items. `region`: an NDSU region label ("NDSU South Central ND") or code."""
    if crop_id not in CROPS:
        return {"available": False, "crop_id": crop_id, "reason": f"no ground cost lines for '{crop_id}'"}
    try:
        _ref()
    except FileNotFoundError:
        return {"available": False, "crop_id": crop_id, "reason": "sunflower reference data not built"}
    code = _region_code(region) or OUT_OF_STATE_REGION
    lv = _line_values(code)
    if not lv["years"]:
        return {"available": False, "crop_id": crop_id, "reason": f"no NDSU budget for {NDSU_REGIONS[code][0]}"}
    y0, y1 = lv["years"][0], lv["years"][-1]
    lab = NDSU_REGIONS[code][0]
    files = [(_ref()["budgets"][code][str(y)] or {}).get("url") for y in lv["years"]]

    def lines(grp):
        return [{"id": x["id"], "label_en": x["label_en"], "label_es": x["label_es"], "usd_ac": x["median"],
                 "ers_items": x["items"], "source_items": x["items"], "values": x["values"]} for x in lv[grp]]
    exc = [v for v in lv["excluded"].get("Crop Insurance", []) if v is not None]
    notes = ["NDSU Extension projected budget (oil sunflower), not a USDA ERS survey; NDSU leaves out unpaid labour "
             "and management (no labour line) and has no custom-hire line."]
    if exc:
        notes.append(f"NDSU's crop-insurance line (${float(np.median(exc)):.2f}/acre median) is "
                     + EXCLUDED_DIRECT["Crop Insurance"] + ".")
    return {"available": True, "crop_id": crop_id, "ers_commodity": None, "region": f"NDSU {lab}",
            "region_requested": region, "years": lv["years"], "cost_years": f"{y0}–{y1} median",
            "costs": lines("operating"), "overhead": lines("overhead"),
            "operating_total_usd_ac": round(float(np.median(lv["operating_total"])), 2),
            "overhead_total_usd_ac": round(float(np.median(lv["overhead_total"])), 2),
            "excluded": {"crop_insurance_usd_ac": round(float(np.median(exc)), 2) if exc else None,
                         "reason": EXCLUDED_DIRECT["Crop Insurance"]},
            "notes": notes,
            "evidence": {"source_id": "ndsu", "source": "NDSU Extension",
                         "product": f"North Dakota Projected Crop Budgets, {lab} (oil sunflower, line items)",
                         "is_nasa": False, "years": [y0, y1], "region": f"NDSU {lab}",
                         "scale": "North Dakota extension budget for one region, per acre, not your farm",
                         "url": NDSU_LANDING, "files": files,
                         "citation": NDSU_CITATION.format(year=f"{y0}–{y1}", region=lab),
                         "licence": "Public extension publication (NDSU Extension); cited with attribution",
                         "statistic": f"{len(lv['years'])}-year median of each line"}}


def county_yields(crop_id: str) -> pd.DataFrame:
    """Same columns as nass.county_yields: fips, state, county, year, yield, unit, harvested_ac (not held: NaN)."""
    cols = ["fips", "state", "county", "year", "yield", "unit", "harvested_ac"]
    if crop_id not in CROPS or not REF.exists():
        return pd.DataFrame(columns=cols)
    rows = [{"fips": f, "state": e["state"], "county": e["county"], "year": int(y), "yield": float(v), "unit": "lb/ac",
             "harvested_ac": np.nan}
            for f, e in _ref()["county_yields"].items() for y, v in e["values"].items()]
    return pd.DataFrame(rows, columns=cols).sort_values(["fips", "year"]).reset_index(drop=True)


def state_yields(crop_id: str) -> pd.DataFrame:
    """Same columns as nass.state_yields: state_fips, state, year, crop, value, unit."""
    cols = ["state_fips", "state", "year", "crop", "value", "unit"]
    if crop_id not in CROPS or not REF.exists():
        return pd.DataFrame(columns=cols)
    rows = [{"state_fips": e.get("state_fips") or "", "state": a, "year": int(y), "crop": crop_id, "value": float(v),
             "unit": "lb/ac"}
            for a, e in _ref()["state_yields"].items() if a not in ("US", "OT") for y, v in e["values"].items()]
    return pd.DataFrame(rows, columns=cols)


if __name__ == "__main__":
    js = build()
    b = js["budgets"]
    print("NDSU regions:", {k: sorted(v) for k, v in b.items()}, "errors:", js["meta"]["costs"]["errors"])
    print("price states:", sorted(js["prices_usd_cwt"]), "counties:", len(js["county_yields"]),
          "states:", sorted(js["state_yields"]))
