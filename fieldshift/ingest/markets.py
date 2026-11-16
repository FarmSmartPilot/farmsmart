"""Market prices for the farmer's reference: what crops sell for now, how prices moved, what USDA expects, and what
fertilizer costs (wave U7).

Every value is copied from a published source; nothing is filled in, smoothed or interpolated. A block that cannot be
read says `available: false` with the reason.

Sources (all gray, non-NASA):
    USDA NASS Quick Stats      monthly price received, state level (US fallback), last 24 months   (key: NASS_API_KEY)
    USDA ERS Costs and Returns harvest-period price by farm resource region      data/reference/ers_costs_summary.json
    USDA WASDE                 latest US season-average farm price (XML edition, checked against the text edition)
    USDA Agricultural Projections (OCE / WAOB, Interagency Agricultural Projections Committee), farm price, 10 years
    World Bank Pink Sheet      monthly world benchmarks + urea, DAP, potassium chloride   data/reference/wb_prices_monthly.json

Live fetches go through the shared cached session (config.http()); downloaded files land in data/cache/markets/.
Small committed snapshots (data/reference/markets_*.json, written by scripts/update_markets.py) keep the API
working when a publisher or the NASS key is unavailable.

Public API
    markets(state, crops, country)   the /api/markets payload
    wasde(refresh)                   parsed latest WASDE prices (live, then snapshot)
    projections()                    baseline projection snapshot
    nass_monthly(state)              {short_desc: {month: value|None}} for one state or "US"
    write_snapshots()                refresh all committed snapshots (used by scripts/update_markets.py)
"""
from __future__ import annotations

import io
import json
import re
import time
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, datetime, timezone
from typing import Any

from ..config import CACHE, DATA, env, http

REF = DATA / "reference"
RAW = CACHE / "markets"

# ======================================================================================================================
# Crop id <-> source names. ONE table: every source lookup in this module reads from here.
#   unit       planning unit used by the money calculator (price per this unit)
#   nass       NASS Quick Stats short_desc candidates, most specific first (tried at state level, then US)
#   ers        ERS Costs and Returns commodity file
#   wasde      key into WASDE_LAYOUT (US season-average farm price)
#   baseline   commodity name in the USDA baseline CSV (attribute "Farm price")
#   wb         World Bank Pink Sheet series key + plain description
#   futures    (label, url) of an exchange page; link only, numbers are never copied
# ======================================================================================================================
_PR = " - PRICE RECEIVED, MEASURED IN "
CROPS: dict[str, dict[str, Any]] = {
    "corn": {"label": "Corn", "unit": "bu", "nass": [f"CORN, GRAIN{_PR}$ / BU"], "ers": "corn", "wasde": "corn",
             "baseline": "Corn", "wb": ("maize", "maize, US No.2 yellow, FOB US Gulf"),
             "futures": ("Corn futures (CME, delayed quotes)", "https://www.cmegroup.com/markets/agriculture/grains/corn.html")},
    "soybean": {"label": "Soybeans", "unit": "bu", "nass": [f"SOYBEANS{_PR}$ / BU"], "ers": "soybeans",
                "wasde": "soybeans", "baseline": "Soybeans", "wb": ("soybeans", "US soybeans, FOB US Gulf (from Jan 2025)"),
                "futures": ("Soybean futures (CME, delayed quotes)", "https://www.cmegroup.com/markets/agriculture/grains/soybean.html")},
    "winter_wheat": {"label": "Winter wheat", "unit": "bu", "nass": [f"WHEAT, WINTER{_PR}$ / BU", f"WHEAT{_PR}$ / BU"],
                     "ers": "wheat", "wasde": "wheat", "baseline": "Wheat",
                     "wb": ("wheat_us_hrw", "wheat, US No.1 hard red winter, FOB Gulf"),
                     "futures": ("KC hard red winter wheat futures (CME, delayed quotes)", "https://www.cmegroup.com/markets/agriculture/grains/kc-wheat.html")},
    "spring_wheat": {"label": "Spring wheat", "unit": "bu", "nass": [f"WHEAT, SPRING, (EXCL DURUM){_PR}$ / BU", f"WHEAT{_PR}$ / BU"],
                     "ers": "wheat", "wasde": "wheat", "baseline": "Wheat",
                     "wb": ("wheat_us_hrw", "wheat, US hard red winter (no spring-wheat series in the Pink Sheet; nearest benchmark)"),
                     "futures": None},
    "durum": {"label": "Durum wheat", "unit": "bu", "nass": [f"WHEAT, SPRING, DURUM{_PR}$ / BU", f"WHEAT{_PR}$ / BU"],
              "ers": "wheat", "wasde": "wheat", "baseline": "Wheat",
              "wb": ("wheat_us_hrw", "wheat, US hard red winter (no durum series in the Pink Sheet; nearest benchmark)"),
              "futures": None},
    "wheat": {"label": "Wheat", "unit": "bu", "nass": [f"WHEAT{_PR}$ / BU"], "ers": "wheat", "wasde": "wheat",
              "baseline": "Wheat", "wb": ("wheat_us_hrw", "wheat, US No.1 hard red winter, FOB Gulf"),
              "futures": ("Chicago SRW wheat futures (CME, delayed quotes)", "https://www.cmegroup.com/markets/agriculture/grains/wheat.html")},
    "sorghum": {"label": "Sorghum", "unit": "bu", "nass": [f"SORGHUM, GRAIN{_PR}$ / CWT"], "ers": "sorghum",
                "wasde": "sorghum", "baseline": "Sorghum", "wb": ("sorghum", "US No.2 milo yellow, FOB Gulf"),
                "futures": None},
    "barley": {"label": "Barley", "unit": "bu", "nass": [f"BARLEY{_PR}$ / BU"], "ers": "barley", "wasde": "barley",
               "baseline": "Barley", "wb": ("barley", "US feed barley No.2, delivered Minneapolis"), "futures": None},
    "oats": {"label": "Oats", "unit": "bu", "nass": [f"OATS{_PR}$ / BU"], "ers": "oats", "wasde": "oats",
             "baseline": "Oats", "wb": None,
             "futures": ("Oat futures (CME, delayed quotes)", "https://www.cmegroup.com/markets/agriculture/grains/oats.html")},
    "cotton": {"label": "Cotton (upland)", "unit": "lb", "nass": [f"COTTON, UPLAND{_PR}$ / LB"], "ers": "cotton",
               "wasde": "cotton", "baseline": "Upland Cotton", "wb": ("cotton_a_index", "Cotlook A Index, middling 1-3/32 inch, Far East"),
               "futures": ("Cotton No. 2 futures (ICE)", "https://www.ice.com/products/254/Cotton-No-2-Futures")},
    "rice": {"label": "Rice (rough)", "unit": "cwt",
             "nass": [f"RICE{_PR}$ / CWT", f"RICE, LONG GRAIN{_PR}$ / CWT", f"RICE, MEDIUM-SHORT GRAIN{_PR}$ / CWT"],
             "ers": "rice", "wasde": "rice", "baseline": "Rice",
             "wb": ("rice_thai_5", "rice, Thai 5% broken, milled (world benchmark, not US rough rice)"),
             "futures": ("Rough rice futures (CME, delayed quotes)", "https://www.cmegroup.com/markets/agriculture/grains/rough-rice.html")},
    "alfalfa": {"label": "Alfalfa hay", "unit": "ton", "nass": [f"HAY, ALFALFA{_PR}$ / TON"], "ers": None, "wasde": None,
                "baseline": None, "wb": None, "futures": None},
    "canola": {"label": "Canola", "unit": "cwt", "nass": [f"CANOLA{_PR}$ / CWT"], "ers": None, "wasde": None,
               "baseline": None, "wb": None, "futures": None},
    "flax": {"label": "Flaxseed", "unit": "bu", "nass": [f"FLAXSEED{_PR}$ / BU"], "ers": None, "wasde": None,
             "baseline": None, "wb": None, "futures": None},
    "sunflower": {"label": "Sunflower", "unit": "cwt", "nass": [f"SUNFLOWER{_PR}$ / CWT"], "ers": None, "wasde": None,
                  "baseline": None, "wb": None, "futures": None},
    "lentil": {"label": "Lentils", "unit": "cwt", "nass": [f"LENTILS{_PR}$ / CWT"], "ers": None, "wasde": None,
               "baseline": None, "wb": None, "futures": None},
    "chickpea": {"label": "Chickpeas", "unit": "cwt", "nass": [f"CHICKPEAS{_PR}$ / CWT"], "ers": None, "wasde": None,
                 "baseline": None, "wb": None, "futures": None},
    "processing_tomato": {"label": "Processing tomatoes", "unit": "ton", "nass": [], "ers": None, "wasde": None,
                          "baseline": None, "wb": None, "futures": None,
                          "no_monthly": "NASS publishes processing-tomato prices only as an annual marketing-year "
                                        "average ($/ton), not monthly."},
}
DEFAULT_CROPS = ["corn", "soybean", "winter_wheat", "spring_wheat", "sorghum", "barley", "oats", "cotton", "rice"]

# Price unit of each source string -> (display unit, multiplier to the crop's planning unit given that unit).
# Weights: USDA standard bushel weights (corn/sorghum 56 lb, soybeans/wheat 60 lb, barley 48 lb, oats 32 lb, flax 56 lb);
# 1 cwt = 100 lb; 1 t = 2204.62 lb.
LB_PER_BU = {"corn": 56, "sorghum": 56, "soybean": 60, "winter_wheat": 60, "spring_wheat": 60, "durum": 60, "wheat": 60,
             "barley": 48, "oats": 32, "flax": 56}
LB_PER_T = 2204.62

# WASDE: sub-report title fragment + n-th "Avg. Farm Price" row in that sub-report (the XML does not name the
# commodity inside the Sorghum/Barley/Oats and Rice pages), the text-edition anchor used to cross-check it,
# the unit printed in the row label (footnote for cotton) and the marketing-year start from the page footnotes.
WASDE_LAYOUT = {
    "wheat": {"title": "U.S. Wheat Supply and Use", "nth": 0, "txt": ("U.S. Wheat Supply and Use", None), "unit": "$/bu",
              "my_start": "Jun 1", "what": "all wheat classes"},
    "corn": {"title": "U.S. Feed Grain and Corn Supply and Use", "nth": 0, "txt": ("U.S. Feed Grain and Corn Supply and Use", "CORN"),
             "unit": "$/bu", "my_start": "Sep 1", "what": "corn"},
    "sorghum": {"title": "U.S. Sorghum, Barley, and Oats", "nth": 0, "txt": ("U.S. Sorghum, Barley, and Oats", "SORGHUM"),
                "unit": "$/bu", "my_start": "Sep 1", "what": "sorghum"},
    "barley": {"title": "U.S. Sorghum, Barley, and Oats", "nth": 1, "txt": ("U.S. Sorghum, Barley, and Oats", "BARLEY"),
               "unit": "$/bu", "my_start": "Jun 1", "what": "barley"},
    "oats": {"title": "U.S. Sorghum, Barley, and Oats", "nth": 2, "txt": ("U.S. Sorghum, Barley, and Oats", "OATS"),
             "unit": "$/bu", "my_start": "Jun 1", "what": "oats"},
    "rice": {"title": "U.S. Rice Supply and Use", "nth": 0, "txt": ("U.S. Rice Supply and Use", "TOTAL RICE"), "unit": "$/cwt",
             "my_start": "Aug 1", "what": "all rice, rough basis"},
    "soybeans": {"title": "U.S. Soybeans and Products", "nth": 0, "txt": ("U.S. Soybeans and Products", None), "unit": "$/bu",
                 "my_start": "Sep 1", "what": "soybeans"},
    "cotton": {"title": "U.S. Cotton Supply and Use", "nth": 0, "txt": ("U.S. Cotton Supply and Use", None), "unit": "¢/lb",
               "my_start": "Aug 1", "what": "upland cotton (cents per pound, WASDE footnote 3)"},
}
WASDE_PAGE = ("https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/"
              "commodity-markets/wasde-report")
WASDE_FILE = "https://www.usda.gov/oce/commodity/wasde/wasde{mmyy}.{ext}"
WASDE_CITATION = ("USDA World Agricultural Outlook Board, World Agricultural Supply and Demand Estimates (WASDE), "
                  "{month}. https://www.usda.gov/oce/commodity/wasde")

BASELINE_PAGE = "https://www.ers.usda.gov/data-products/agricultural-baseline-database"
BASELINE_CITATION = ("U.S. Department of Agriculture, Office of the Chief Economist, World Agricultural Outlook Board. "
                     "USDA Agricultural Projections to {to}. Data prepared by the Interagency Agricultural Projections "
                     "Committee; Agricultural Baseline Database, USDA ERS.")

NASS_API = "https://quickstats.nass.usda.gov/api"
NASS_CITATION = ("USDA National Agricultural Statistics Service, Quick Stats, Agricultural Prices (survey, monthly "
                 "price received). This product uses the NASS API but is not endorsed or certified by NASS.")
NASS_COMMODITIES = sorted({s.split(",")[0].split(" - ")[0] for c in CROPS.values() for s in c["nass"]})

WB_INPUTS = [("urea", "Urea", "Urea", "urea"), ("dap", "DAP (diammonium phosphate)", "DAP (fosfato diamónico)", "dap"),
             ("potash", "Potassium chloride (potash)", "Cloruro de potasio (potasa)", "potassium_chloride")]

MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
WINDOW = 24  # months of history
LIVE_TTL = 12 * 3600  # seconds a live NASS / WASDE landing-page response is reused

US_STATES = {  # USPS code -> (FIPS, name)
    "AL": ("01", "Alabama"), "AK": ("02", "Alaska"), "AZ": ("04", "Arizona"), "AR": ("05", "Arkansas"),
    "CA": ("06", "California"), "CO": ("08", "Colorado"), "CT": ("09", "Connecticut"), "DE": ("10", "Delaware"),
    "DC": ("11", "District of Columbia"), "FL": ("12", "Florida"), "GA": ("13", "Georgia"), "HI": ("15", "Hawaii"),
    "ID": ("16", "Idaho"), "IL": ("17", "Illinois"), "IN": ("18", "Indiana"), "IA": ("19", "Iowa"),
    "KS": ("20", "Kansas"), "KY": ("21", "Kentucky"), "LA": ("22", "Louisiana"), "ME": ("23", "Maine"),
    "MD": ("24", "Maryland"), "MA": ("25", "Massachusetts"), "MI": ("26", "Michigan"), "MN": ("27", "Minnesota"),
    "MS": ("28", "Mississippi"), "MO": ("29", "Missouri"), "MT": ("30", "Montana"), "NE": ("31", "Nebraska"),
    "NV": ("32", "Nevada"), "NH": ("33", "New Hampshire"), "NJ": ("34", "New Jersey"), "NM": ("35", "New Mexico"),
    "NY": ("36", "New York"), "NC": ("37", "North Carolina"), "ND": ("38", "North Dakota"), "OH": ("39", "Ohio"),
    "OK": ("40", "Oklahoma"), "OR": ("41", "Oregon"), "PA": ("42", "Pennsylvania"), "RI": ("44", "Rhode Island"),
    "SC": ("45", "South Carolina"), "SD": ("46", "South Dakota"), "TN": ("47", "Tennessee"), "TX": ("48", "Texas"),
    "UT": ("49", "Utah"), "VT": ("50", "Vermont"), "VA": ("51", "Virginia"), "WA": ("53", "Washington"),
    "WV": ("54", "West Virginia"), "WI": ("55", "Wisconsin"), "WY": ("56", "Wyoming"),
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


_REF_MEMO: dict[str, tuple[float, Any]] = {}


def _ref(name: str) -> dict | None:
    """Committed reference JSON, re-read only when the file changes."""
    p = REF / name
    if not p.exists():
        return None
    mt = p.stat().st_mtime
    hit = _REF_MEMO.get(name)
    if hit and hit[0] == mt:
        return hit[1]
    obj = json.loads(p.read_text(encoding="utf-8"))
    _REF_MEMO[name] = (mt, obj)
    return obj


def _num(v: Any) -> float | None:
    s = str(v or "").strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None  # NASS codes: (D) withheld, (S) insufficient reports, (NA), (X), (Z)


def _month_index(ym: str) -> int:
    y, m = ym.split("-")
    return int(y) * 12 + int(m) - 1


def _ym(idx: int) -> str:
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def _unit_factor(crop: str, unit: str) -> float | None:
    """Multiplier from a source price unit to the crop's planning unit (None when no standard conversion)."""
    cu = CROPS[crop]["unit"]
    u = unit.replace(" ", "").lower()
    if u in (f"$/{cu}", f"dollarsper{cu}"):
        return 1.0
    if u == "¢/lb" and cu == "lb":
        return 0.01
    lbbu = LB_PER_BU.get(crop)
    if u == "$/cwt" and cu == "bu" and lbbu:
        return lbbu / 100.0
    if u == "$/mt":
        if cu == "bu" and lbbu:
            return lbbu / LB_PER_T
        if cu == "cwt":
            return 100.0 / LB_PER_T
    if u == "$/kg" and cu == "lb":
        return 1 / 2.20462
    return None


# ======================================================================================================================
# NASS Quick Stats: monthly price received
# ======================================================================================================================
def _nass_get(params: dict) -> list[dict]:
    key = env("NASS_API_KEY")
    if not key:
        raise RuntimeError("NASS_API_KEY is not set")
    q = {"key": key, "source_desc": "SURVEY", "sector_desc": "CROPS", "statisticcat_desc": "PRICE RECEIVED",
         "freq_desc": "MONTHLY", "commodity_desc": NASS_COMMODITIES, "format": "JSON", **params}
    try:
        r = http().get(f"{NASS_API}/api_GET/", params=q, timeout=120, expire_after=LIVE_TTL)
    except Exception as e:  # the key is in the URL: report only the exception type
        raise RuntimeError(f"NASS request failed ({type(e).__name__})") from None
    if r.status_code == 400 and "no data" in r.text.lower():
        return []
    if r.status_code != 200:
        raise RuntimeError(f"NASS HTTP {r.status_code}")
    return r.json().get("data", [])


def _tidy_nass(rows: list[dict]) -> dict[str, dict[str, dict[str, float | None]]]:
    """{location: {short_desc: {YYYY-MM: value or None (withheld)}}}; location = state alpha or 'US'."""
    want = {s for c in CROPS.values() for s in c["nass"]}
    out: dict[str, dict[str, dict[str, float | None]]] = {}
    for x in rows:
        sd = x.get("short_desc", "")
        per = x.get("reference_period_desc", "")
        if sd not in want or per not in MONTHS or x.get("domain_desc", "TOTAL") != "TOTAL":
            continue
        loc = "US" if x.get("agg_level_desc") == "NATIONAL" else x.get("state_alpha")
        if not loc:
            continue
        out.setdefault(loc, {}).setdefault(sd, {})[f"{int(x['year']):04d}-{MONTHS.index(per) + 1:02d}"] = _num(x.get("Value"))
    return {loc: {sd: dict(sorted(v.items())) for sd, v in sorted(d.items())} for loc, d in sorted(out.items())}


def nass_monthly(loc: str) -> tuple[dict[str, dict[str, float | None]], dict]:
    """Monthly price-received series for a state (USPS code) or 'US'. Live (cached 12 h), then the committed
    snapshot. Returns (series, provenance)."""
    y0 = date.today().year - 2
    params = {"agg_level_desc": "NATIONAL"} if loc == "US" else {"agg_level_desc": "STATE", "state_alpha": loc}
    try:
        data = _tidy_nass(_nass_get({**params, "year__GE": str(y0)})).get(loc, {})
        return data, {"mode": "live", "retrieved": date.today().isoformat()}
    except Exception as e:
        snap = _ref("markets_nass_monthly.json")
        if not snap:
            raise RuntimeError(f"{e}; no committed snapshot") from None
        return snap["series"].get(loc, {}), {"mode": "snapshot", "retrieved": snap["meta"]["retrieved"][:10],
                                             "live_error": str(e)}


def _received_block(crop: str, state: str, cache: dict) -> dict:
    spec = CROPS[crop]
    if not spec["nass"]:
        return {"available": False,
                "reason": spec.get("no_monthly") or f"NASS publishes no monthly price received for {spec['label'].lower()}."}
    today_idx = date.today().year * 12 + date.today().month - 1
    errors = []
    for loc in ([state] if state != "US" else []) + ["US"]:
        if loc not in cache:
            try:
                cache[loc] = nass_monthly(loc)
            except Exception as e:
                cache[loc] = None
                errors.append(str(e))
        if cache[loc] is None:
            continue
        data, prov = cache[loc]
        for sd in spec["nass"]:
            ser = data.get(sd) or {}
            have = sorted(m for m, v in ser.items() if v is not None)
            if not have or today_idx - _month_index(have[-1]) > 12:  # nothing usable in the last year
                continue
            hi = _month_index(have[-1])
            months = [_ym(i) for i in range(hi - WINDOW + 1, hi + 1)]
            series = [{"month": m, "usd": ser[m]} for m in months if ser.get(m) is not None]
            withheld = [m for m in months if m in ser and ser[m] is None]
            unit = "$/" + sd.rsplit("$ / ", 1)[1].lower()
            sname = "United States" if loc == "US" else US_STATES[loc][1]
            what = sd.split(" - ")[0].title().replace("(Excl Durum)", "(excl. durum)")
            notes = []
            if loc == "US" and state != "US":
                notes.append(f"NASS publishes no monthly {spec['label'].lower()} price for {US_STATES[state][1]}; "
                             "showing the US average.")
            if withheld:
                notes.append("NASS withheld or did not publish these months: " + ", ".join(withheld) + ".")
            if sd != spec["nass"][0]:
                notes.append(f"NASS publishes no '{spec['nass'][0].split(' - ')[0].title()}' monthly price for "
                             f"{sname}; closest published series shown: {what}.")
            if prov["mode"] == "snapshot":
                notes.append(f"Live NASS request failed; values from the committed snapshot of {prov['retrieved']}.")
            fac = _unit_factor(crop, unit)
            return {"available": True,
                    "source": f"USDA NASS Quick Stats, price received, monthly, {sname}",
                    "series_name": sd, "what": what, "unit": unit,
                    "to_crop_unit": fac, "crop_unit": spec["unit"],
                    "series": series, "latest": series[-1],
                    "scope": "state average" if loc != "US" else "US average",
                    "location": loc, "retrieved": prov["retrieved"], "citation": NASS_CITATION,
                    "is_nasa": False, "notes": notes}
    tried = [state, "US"] if state != "US" else ["US"]
    if all(cache.get(k) is None for k in tried):
        why = "; ".join(errors) or "earlier request in this call failed"
        return {"available": False, "reason": f"USDA NASS Quick Stats could not be reached ({why})."}
    return {"available": False,
            "reason": f"NASS publishes no monthly {spec['label'].lower()} price received for "
                      f"{US_STATES[state][1] if state != 'US' else 'the US'} or the US in the last 12 months."}


# ======================================================================================================================
# ERS harvest-period price history (read-only reuse of the committed ERS summary)
# ======================================================================================================================
def _harvest_block(crop: str, state: str) -> dict:
    f = CROPS[crop]["ers"]
    if not f:
        return {"available": False, "reason": f"USDA ERS Costs and Returns does not cover {CROPS[crop]['label'].lower()}."}
    ers = _ref("ers_costs_summary.json")
    regions = (_ref("ers_regions_state.json") or {}).get("states", {})
    if not ers or f not in ers.get("data", {}):
        return {"available": False, "reason": "ERS summary file data/reference/ers_costs_summary.json is missing."}
    want = regions.get(US_STATES[state][0], {}).get("dominant") if state in US_STATES else None
    d = ers["data"][f]
    if state in US_STATES and US_STATES[state][1] in d:  # ERS rice regions include whole states (California)
        want = US_STATES[state][1]
    used = want if want in d and "price" in d[want] else "U.S. total"
    p = d[used]["price"]
    notes = []
    if want and used != want:
        notes.append(f"ERS does not report {f} for the {want} region; showing the U.S. total.")
    if f == "wheat":
        notes.append("ERS reports all wheat classes together.")
    unit = {"dollars per bushel at harvest": "$/bu", "dollars per pound": "$/lb",
            "dollars per hundredweight at harvest": "$/cwt"}.get(p["units"], p["units"])
    return {"available": True, "source": f"USDA ERS harvest price (farm resource region: {used})",
            "region": used, "region_requested": want, "unit": unit, "unit_text": p["units"],
            "to_crop_unit": _unit_factor(crop, unit), "years": p["years"], "usd": p["values"],
            "scope": "ERS farm resource region average (not field-specific)",
            "citation": ers["meta"]["citation"], "retrieved": ers["meta"]["retrieved"][:10], "is_nasa": False,
            "notes": notes}


# ======================================================================================================================
# WASDE: latest US season-average farm price
# ======================================================================================================================
def _latest_wasde_links() -> dict:
    """Latest WASDE files and release date from the USDA landing page (cached 12 h)."""
    r = http().get(WASDE_PAGE, timeout=60, expire_after=LIVE_TTL)
    if r.status_code != 200:
        raise RuntimeError(f"WASDE landing page HTTP {r.status_code}")
    codes = set(re.findall(r"wasde(\d{4})\.xml", r.text))
    if not codes:
        raise RuntimeError("no wasdeMMYY.xml link on the WASDE landing page")
    mmyy = max(codes, key=lambda c: (int(c[2:]), int(c[:2])))
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", r.text))
    month = datetime(2000 + int(mmyy[2:]), int(mmyy[:2]), 1).strftime("%B %Y")
    m = re.search(re.escape(month) + r" WASDE Report \(Release time:[^,)]*,\s*([A-Z][a-z]+)\.?\s+(\d{1,2})\)", text)
    released = None
    if m:
        try:
            released = datetime.strptime(f"{m.group(1)[:3]} {m.group(2)} {2000 + int(mmyy[2:])}", "%b %d %Y").date().isoformat()
        except ValueError:
            released = None
    return {"mmyy": mmyy, "report_month": month, "report_date": released,
            "xml": WASDE_FILE.format(mmyy=mmyy, ext="xml"), "txt": WASDE_FILE.format(mmyy=mmyy, ext="txt"),
            "page": WASDE_PAGE}


def _download(url: str, dest) -> bytes:
    if dest.exists() and dest.stat().st_size > 0:
        return dest.read_bytes()
    r = http().get(url, timeout=120)
    if r.status_code != 200:
        raise RuntimeError(f"{url.rsplit('/', 1)[-1]} HTTP {r.status_code}")
    RAW.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)
    return r.content


def parse_wasde_xml(raw: bytes) -> tuple[dict, dict]:
    """{crop: {"label", "rows": [(market_year, forecast_month, value)]}}, meta from the XML edition."""
    root = ET.fromstring(raw)
    found: dict[str, dict] = {}
    meta: dict[str, Any] = {}
    for rep in root.iter("Report"):
        title = rep.get("sub_report_title") or ""
        if not title:
            continue
        meta.setdefault("report_month", rep.get("Report_Month"))
        pg = (rep.get("page_title") or "").strip()
        meta.setdefault("report_number", pg.rsplit(" - ", 1)[0] if pg else None)
        hits = []
        for el in rep.iter():
            lab = next((v for k, v in el.attrib.items() if re.fullmatch(r"attribute\d+", k)), None)
            if not lab or not re.search(r"Avg\.?\s*Farm\s*Price", lab):
                continue
            rows, my, fm = [], None, None
            for c in el.iter():
                for k, v in c.attrib.items():
                    if k.startswith("market_year"):
                        my = v.strip()
                    elif k.startswith("forecast_month"):
                        fm = v.strip()[:3] or None  # "Oct" / "October" -> "Oct"
                    elif k.startswith("cell_value"):
                        rows.append((my, fm, _num(v)))
            hits.append({"label": re.sub(r"\s+", " ", lab).strip(), "rows": rows, "page": pg})
        for crop, lay in WASDE_LAYOUT.items():
            if lay["title"] in title and len(hits) > lay["nth"] and crop not in found:
                found[crop] = hits[lay["nth"]]
    return found, meta


def _txt_values(txt: str, anchor: tuple[str, str | None]) -> list[float] | None:
    lines = txt.splitlines()
    i = next((k for k, ln in enumerate(lines) if anchor[0] in ln), None)
    if i is None:
        return None
    if anchor[1]:
        i = next((k for k in range(i, len(lines)) if lines[k].strip() == anchor[1]), None)
        if i is None:
            return None
    for ln in lines[i:]:
        m = re.match(r"\s*Avg\.?\s*Farm\s*Price\s*(\([^)]*\))?\s*((\d+/\s*)*)", ln)
        if m:
            nums = re.findall(r"-?\d+(?:\.\d+)?", ln[m.end():])
            return [float(n) for n in nums[-4:]] if len(nums) >= 4 else None
    return None


def _build_wasde(xml: bytes, txt: str | None, links: dict) -> dict:
    found, meta = parse_wasde_xml(xml)
    prices: dict[str, Any] = {}
    for crop, lay in WASDE_LAYOUT.items():
        h = found.get(crop)
        if not h or not h["rows"]:
            prices[crop] = {"available": False, "reason": f"'{lay['title']}' farm-price row not found in the XML edition"}
            continue
        rows = h["rows"]
        proj = [r for r in rows if r[0] and "Proj" in r[0] and r[2] is not None]
        est = [r for r in rows if r[0] and "Est" in r[0] and r[2] is not None]
        hist = [r for r in rows if r[0] and "Proj" not in r[0] and "Est" not in r[0] and r[2] is not None]
        unit_ok = lay["unit"] in h["label"] or (crop == "cotton")  # cotton unit sits in footnote 3/
        if not proj or not unit_ok:
            prices[crop] = {"available": False, "reason": "unexpected WASDE layout (no projection column or unit changed)"}
            continue
        check = None
        if txt:
            tv = _txt_values(txt, lay["txt"])
            check = tv is not None and [round(r[2], 2) for r in rows if r[2] is not None][-4:] == [round(v, 2) for v in tv]
            if tv is not None and not check:
                prices[crop] = {"available": False, "reason": "XML and text editions of WASDE disagree; not shown"}
                continue
        cur = proj[-1]
        prev_month = proj[-2] if len(proj) > 1 else None
        prices[crop] = {
            "available": True, "label": h["label"], "unit": lay["unit"], "what": lay["what"],
            "marketing_year": cur[0].split()[0], "marketing_year_begins": lay["my_start"],
            "forecast_month": cur[1], "value": cur[2],
            "previous_report": {"forecast_month": prev_month[1], "value": prev_month[2]} if prev_month else None,
            "previous_year": {"marketing_year": est[-1][0].split()[0], "value": est[-1][2], "status": "estimate"} if est else None,
            "history": [{"marketing_year": r[0].split()[0], "value": r[2]} for r in hist],
            "page": h["page"], "text_edition_match": check,
        }
    return {"meta": {"source": "USDA WASDE", "report": meta.get("report_number"), "report_month": links.get("report_month") or meta.get("report_month"),
                     "report_date": links.get("report_date"), "xml": links.get("xml"), "txt": links.get("txt"),
                     "page": WASDE_PAGE, "licence": "Public domain (USDA)",
                     "citation": WASDE_CITATION.format(month=links.get("report_month") or meta.get("report_month")),
                     "retrieved": _now()},
            "prices": prices}


_WASDE_MEMO: dict[str, Any] = {"t": 0.0, "v": None}


def wasde(refresh: bool = False) -> dict:
    """Latest WASDE prices. Live (landing page re-read at most every 12 h, files cached under data/cache/markets/),
    falling back to the committed snapshot data/reference/markets_wasde.json."""
    if not refresh and _WASDE_MEMO["v"] is not None and time.time() - _WASDE_MEMO["t"] < LIVE_TTL:
        return _WASDE_MEMO["v"]
    snap = _ref("markets_wasde.json")
    try:
        links = _latest_wasde_links()
        if not refresh and snap and snap["meta"].get("xml") == links["xml"]:
            out = {**snap, "mode": "snapshot (same report as live)"}
        else:
            xml = _download(links["xml"], RAW / f"wasde{links['mmyy']}.xml")
            try:
                txt = _download(links["txt"], RAW / f"wasde{links['mmyy']}.txt").decode("utf-8", "replace")
            except Exception:
                txt = None
            out = {**_build_wasde(xml, txt, links), "mode": "live"}
    except Exception as e:
        if not snap:
            out = {"meta": {}, "prices": {}, "mode": "unavailable", "error": str(e)}
        else:
            out = {**snap, "mode": "snapshot", "live_error": str(e)}
    _WASDE_MEMO.update(t=time.time(), v=out)
    return out


def _wasde_block(crop: str) -> dict:
    key = CROPS[crop]["wasde"]
    if not key:
        return {"available": False, "reason": f"WASDE does not forecast {CROPS[crop]['label'].lower()} prices."}
    w = wasde()
    p = w.get("prices", {}).get(key)
    if not p or not p.get("available"):
        reason = (p or {}).get("reason") or w.get("error") or "WASDE price not found"
        return {"available": False, "reason": f"USDA WASDE: {reason}"}
    m = w["meta"]
    notes = []
    if crop in ("winter_wheat", "spring_wheat", "durum"):
        notes.append("WASDE forecasts the all-wheat price; it is not class-specific.")
    if p["unit"] == "¢/lb":
        notes.append("WASDE prints the upland cotton price in cents per pound; multiply by 0.01 for $/lb.")
    if w.get("mode") == "snapshot":
        notes.append("Live WASDE check failed; using the committed snapshot.")
    return {"available": True, "source": "USDA WASDE", "report": m.get("report"), "report_month": m.get("report_month"),
            "report_date": m.get("report_date"), "marketing_year": p["marketing_year"],
            "marketing_year_begins": p["marketing_year_begins"],
            "season_avg_price": {"low": None, "mid": p["value"], "high": None},
            "previous_report": p.get("previous_report"),
            "previous_year": (p.get("previous_year") or {}).get("value"),
            "previous_year_label": f"{(p.get('previous_year') or {}).get('marketing_year')} estimate" if p.get("previous_year") else None,
            "unit": p["unit"], "to_crop_unit": _unit_factor(crop, p["unit"]), "what": p["what"],
            "scope": "US season-average farm price (forecast)", "url": m.get("xml"), "page": WASDE_PAGE,
            "citation": m.get("citation"), "is_nasa": False, "notes": notes}


# ======================================================================================================================
# USDA Agricultural Projections (baseline)
# ======================================================================================================================
def _baseline_links() -> dict[int, str]:
    r = http().get(BASELINE_PAGE, timeout=60, expire_after=LIVE_TTL)
    if r.status_code != 200:
        raise RuntimeError(f"baseline database page HTTP {r.status_code}")
    out = {}
    for href, yr in re.findall(r'href="([^"]*usda-agricultural-baseline-projections-to-(\d{4})\.zip[^"]*)"', r.text):
        out[int(yr)] = href if href.startswith("http") else "https://www.ers.usda.gov" + href.replace("&amp;", "&")
    return out


def _parse_baseline_zip(raw: bytes, to_year: int, url: str) -> dict:
    import pandas as pd
    z = zipfile.ZipFile(io.BytesIO(raw))
    names = z.namelist()
    csv = next((n for n in names if re.fullmatch(r"Projections\d{4}\.csv", n)), None)
    if not csv:
        raise RuntimeError(f"no Projections*.csv in the {to_year} baseline zip")
    d = pd.read_csv(z.open(csv), encoding="utf-8-sig")
    readme = next((n for n in names if n.lower().startswith("readme")), None)
    rtxt = z.read(readme).decode("utf-8", "replace") if readme else ""
    upd = re.search(r"Updated\s+(\d{1,2})/(\d{1,2})/(\d{2,4})", rtxt)
    avail = re.search(r"available on ([A-Z][a-z]+ \d{1,2}, \d{4})", rtxt)
    pdf = next((n for n in names if n.lower().endswith(".pdf")), None)
    pdf_date = None
    if pdf:
        m = re.search(rb"/CreationDate\s*\(D:(\d{4})(\d{2})(\d{2})", z.read(pdf))
        pdf_date = f"{m.group(1).decode()}-{m.group(2).decode()}-{m.group(3).decode()}" if m else None
    cur = re.search(r"current year \(reflective of the ([A-Za-z]+ \d{4}) WASDE", rtxt)
    hist_years = re.search(r"covering 1 year of\s+history \((\d{4})\)", rtxt)
    crops = {}
    for _, spec in CROPS.items():
        b = spec["baseline"]
        if not b or b in crops:
            continue
        s = d[(d["commodity"] == b) & (d["attribute"] == "Farm price")].copy()
        if s.empty:
            continue
        s = s.sort_values("year")
        crops[b] = {"unit": str(s["unit"].iloc[0]), "years": s["year"].astype(str).tolist(),
                    "values": [float(v) for v in s["value"]]}
    yop = int(d["year_of_projection"].iloc[0]) if "year_of_projection" in d else None
    released = None
    if avail:
        released = datetime.strptime(avail.group(1), "%B %d, %Y").date().isoformat()
    return {"to_year": to_year, "title": f"USDA Agricultural Projections to {to_year}", "url": url, "csv": csv,
            "year_of_projection": yop, "report_pdf": pdf, "report_pdf_created": pdf_date,
            "csv_available": released,
            "readme_updated": (f"20{upd.group(3)[-2:]}-{int(upd.group(1)):02d}-{int(upd.group(2)):02d}" if upd else None),
            "current_year_basis": cur.group(1) + " WASDE" if cur else None,
            "history_year": int(hist_years.group(1)) if hist_years else None,
            "kind": "full report" if pdf else "early-release tables (report text not yet published)",
            "citation": BASELINE_CITATION.format(to=to_year), "licence": "Public domain (USDA)",
            "crops": crops}


def fetch_projections() -> dict:
    """Download the newest full baseline report (with PDF) and any newer early-release tables."""
    links = _baseline_links()
    if not links:
        raise RuntimeError("no baseline zip links on the ERS Agricultural Baseline Database page")
    out = {}
    for yr in sorted(links, reverse=True)[:3]:
        raw = _download(links[yr], RAW / f"baseline_to_{yr}.zip")
        info = _parse_baseline_zip(raw, yr, links[yr])
        if info["report_pdf"] and "report" not in out:
            out["report"] = info
        elif not info["report_pdf"] and "report" not in out and "early" not in out:
            out["early"] = info
        if "report" in out:
            break
    return {"meta": {"source": "USDA Agricultural Projections (OCE / WAOB, Interagency Agricultural Projections Committee)",
                     "page": BASELINE_PAGE, "retrieved": _now(), "licence": "Public domain (USDA)"}, **out}


def projections() -> dict:
    return _ref("markets_projections.json") or {}


def _published(info: dict) -> str | None:
    d = info.get("report_pdf_created") or info.get("csv_available")
    return d[:7] if d else None


def _proj_block(crop: str, which: str = "report") -> dict:
    b = CROPS[crop]["baseline"]
    if not b:
        return {"available": False, "reason": f"USDA Agricultural Projections do not cover {CROPS[crop]['label'].lower()}."}
    info = projections().get(which)
    if not info:
        return {"available": False, "reason": "baseline projection snapshot data/reference/markets_projections.json "
                                              "is missing (run scripts/update_markets.py)"}
    c = info["crops"].get(b)
    if not c:
        return {"available": False, "reason": f"{info['title']} has no '{b}' farm price"}
    unit = {"Dollars per bushel": "$/bu", "Dollars per cwt.": "$/cwt", "Dollars per pound": "$/lb"}.get(c["unit"], c["unit"])
    hist_y = info.get("history_year")
    first_proj = 2 if hist_y else 0  # CSV rows: 1 history year, the current year, then 10 projection years
    notes = [f"Rows: {c['years'][0]} is history, {c['years'][1]} the current year"
             + (f" (as of the {info['current_year_basis']})" if info.get("current_year_basis") else "")
             + f", {c['years'][first_proj]}..{c['years'][-1]} are projections."]
    if crop in ("winter_wheat", "spring_wheat", "durum"):
        notes.append("Projected all-wheat price; not class-specific.")
    if which == "early":
        notes.append("Early-release baseline tables: USDA had not published the full report text when this snapshot was taken.")
    return {"available": True, "source": f"{info['title']} (baseline)", "kind": info["kind"],
            "published": _published(info), "published_detail": {"report_pdf_created": info.get("report_pdf_created"),
                                                                 "csv_available": info.get("csv_available"),
                                                                 "readme_updated": info.get("readme_updated")},
            "years": c["years"][first_proj:], "usd": c["values"][first_proj:],
            "history": {"years": c["years"][:first_proj], "usd": c["values"][:first_proj]},
            "unit": unit, "to_crop_unit": _unit_factor(crop, unit),
            "scope": "US season-average farm price (projection)", "url": info["url"], "table": info["csv"],
            "citation": info["citation"], "is_nasa": False, "notes": notes}


# ======================================================================================================================
# World Bank Pink Sheet
# ======================================================================================================================
def _wb() -> dict | None:
    return _ref("wb_prices_monthly.json")


def _wb_series(key: str) -> tuple[list[dict], str | None, str | None]:
    """Last 24 monthly values, unit, and a reason when unusable."""
    wb = _wb()
    if not wb or key not in wb.get("series", {}):
        return [], None, f"World Bank series '{key}' is not in data/reference/wb_prices_monthly.json"
    s = wb["series"][key]
    y, m = (int(v) for v in s["start"].split("-"))
    i0 = y * 12 + m - 1
    vals = s["values"]
    pts = [(i0 + k, v) for k, v in enumerate(vals) if v is not None]
    if not pts:
        return [], s["units"], "series is empty"
    last = pts[-1][0]
    today_idx = date.today().year * 12 + date.today().month - 1
    if today_idx - last > 12:
        return [], s["units"], f"World Bank stopped publishing this series; last value {_ym(last)}"
    series = [{"month": _ym(i), "value": v} for i, v in pts if i > last - WINDOW]
    return series, s["units"], None


def _wb_meta() -> dict:
    m = (_wb() or {}).get("meta", {})
    return {"citation": m.get("citation"), "licence": m.get("licence"), "url": m.get("landing"),
            "updated": m.get("updated"), "retrieved": (m.get("retrieved") or "")[:10], "is_nasa": False}


def _global_block(crop: str) -> dict:
    wbk = CROPS[crop]["wb"]
    if not wbk:
        return {"available": False, "reason": f"The World Bank Pink Sheet has no {CROPS[crop]['label'].lower()} benchmark."}
    key, desc = wbk
    series, unit, why = _wb_series(key)
    if why:
        return {"available": False, "source": f"World Bank Pink Sheet ({desc})", "reason": why}
    # milled Thai rice is a different product from US rough rice: no unit conversion offered
    fac = None if crop == "rice" else _unit_factor(crop, unit)
    return {"available": True, "source": f"World Bank Pink Sheet ({desc})", "unit": unit,
            "to_crop_unit": fac, "series": series, "latest": series[-1],
            "scope": "world benchmark price, nominal US$ (not a farm-gate price)", **_wb_meta()}


def _inputs_block() -> dict:
    items = []
    for iid, en, es, key in WB_INPUTS:
        series, unit, why = _wb_series(key)
        it = {"id": iid, "label_en": en, "label_es": es, "unit": unit, "available": not why}
        if why:
            it["reason"] = why
        else:
            it.update(series=series, latest=series[-1])
        items.append(it)
    return {"source": "World Bank Pink Sheet", "available": any(i["available"] for i in items),
            "scope": "world benchmark fertilizer price, nominal US$ per metric ton (not a delivered farm price)",
            "notes": ["World Bank definitions: urea, prill, spot FOB Middle East (from March 2022); DAP, spot FOB US Gulf; "
                      "potassium chloride, granular spot CFR Brazil (from January 2020)."],
            "items": items, **_wb_meta()}


# ======================================================================================================================
# Payload
# ======================================================================================================================
def markets(state: str | None, crops: list[str] | None, country: str | None = None) -> dict:
    st = (state or "").upper()
    ctry = (country or ("US" if st else "")).upper()
    us = ctry in ("US", "USA") and st in US_STATES
    crops = [c for c in (crops or DEFAULT_CROPS)][:20]
    nass_cache: dict = {}
    out_crops: dict[str, Any] = {}
    us_reason = None
    if not us:
        us_reason = ("USDA price series cover the United States only; the request is outside the US."
                     if ctry and ctry not in ("US", "USA") else
                     f"'{state}' is not a US state code; USDA state prices need a 2-letter US state.")
    for c in crops:
        spec = CROPS.get(c)
        if not spec:
            nope = {"available": False, "reason": f"No market price series for '{c}' in the sources used here "
                                                  "(NASS monthly prices, ERS, WASDE, USDA baseline, World Bank)."}
            out_crops[c] = {"label": c, "unit": None, "received": nope, "harvest_history": nope, "wasde": nope,
                            "projections": nope, "global": nope}
            continue
        blk: dict[str, Any] = {"label": spec["label"], "unit": spec["unit"]}
        if us:
            blk["received"] = _received_block(c, st, nass_cache)
            blk["harvest_history"] = _harvest_block(c, st)
            blk["wasde"] = _wasde_block(c)
            blk["projections"] = _proj_block(c, "report")
            early = _proj_block(c, "early")
            if early.get("available"):
                blk["projections_early_release"] = early
        else:
            for k in ("received", "harvest_history", "wasde", "projections"):
                blk[k] = {"available": False, "reason": us_reason}
        blk["global"] = _global_block(c)
        out_crops[c] = blk
    links = [{"label_en": CROPS[c]["futures"][0], "label_es": CROPS[c]["futures"][0].replace(" futures", "")
              .replace("(CME, delayed quotes)", "(CME, cotizaciones diferidas)") + " - futuros", "url": CROPS[c]["futures"][1],
              "crop": c, "kind": "futures (link only)"}
             for c in crops if c in CROPS and CROPS[c]["futures"]]
    links.append({"label_en": "USDA Agricultural Prices report (NASS, monthly)",
                  "label_es": "Informe Agricultural Prices del USDA (NASS, mensual)",
                  "url": "https://usda.library.cornell.edu/concern/publications/c821gj76b"})
    links.append({"label_en": "WASDE report (USDA)", "label_es": "Informe WASDE (USDA)", "url": WASDE_PAGE})
    w = wasde() if us else {}
    return {
        "retrieved": date.today().isoformat(), "us_available": us, "state": st if us else None,
        "state_name": US_STATES[st][1] if us else None, "country": ctry or None,
        **({"us_reason": us_reason} if not us else {}),
        "crops": out_crops,
        "inputs": _inputs_block(),
        "wasde_report": ({"report": w.get("meta", {}).get("report"), "report_month": w.get("meta", {}).get("report_month"),
                          "report_date": w.get("meta", {}).get("report_date"), "mode": w.get("mode")} if us else None),
        "links": links,
        "notes": [
            "Forecasts are USDA's published expectations, not guarantees.",
            "Prices received are state or US averages, not the price at your elevator or gin.",
            "World Bank prices are world benchmark prices (export or import points), not farm-gate prices.",
            "Futures quotes are linked, not copied: they are not freely redistributable.",
            "to_crop_unit converts a block's price to the crop's planning unit using USDA standard weights "
            "(for example sorghum $/cwt x 0.56 = $/bu).",
        ],
    }


# ======================================================================================================================
# Snapshots (scripts/update_markets.py)
# ======================================================================================================================
def _write(name: str, obj: dict) -> None:
    (REF / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_snapshots(nass: bool = True) -> dict:
    report = {}
    w = wasde(refresh=True)
    if w.get("mode") == "live":
        _write("markets_wasde.json", {k: v for k, v in w.items() if k in ("meta", "prices")})
        report["wasde"] = f"{w['meta'].get('report')} {w['meta'].get('report_month')} released {w['meta'].get('report_date')}"
    else:
        report["wasde"] = f"not refreshed: {w.get('live_error') or w.get('error')}"
    try:
        p = fetch_projections()
        _write("markets_projections.json", p)
        report["projections"] = {k: p[k]["title"] for k in ("report", "early") if k in p}
    except Exception as e:
        report["projections"] = f"not refreshed: {e}"
    if nass:
        try:
            y0 = date.today().year - 2
            rows = _nass_get({"agg_level_desc": "STATE", "year__GE": str(y0)}) + \
                _nass_get({"agg_level_desc": "NATIONAL", "year__GE": str(y0)})
            series = _tidy_nass(rows)
            _write("markets_nass_monthly.json",
                   {"meta": {"source": "USDA NASS Quick Stats", "statistic": "PRICE RECEIVED, MONTHLY", "from_year": y0,
                             "citation": NASS_CITATION, "licence": "Public domain (USDA)", "retrieved": _now()},
                    "series": series})
            report["nass"] = f"{len(series)} locations, {sum(len(v) for v in series.values())} series"
        except Exception as e:
            report["nass"] = f"not refreshed: {e}"
    return report
