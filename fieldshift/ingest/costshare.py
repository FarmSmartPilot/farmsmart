"""USDA NRCS EQIP payment rates for Cover Crop (practice 340) and Conservation Crop Rotation (328), per state.

Source: the NRCS payment schedule tool (https://www.nrcs.usda.gov/getting-assistance/payment-schedules), public,
no key. It is a Drupal form: choose a state, a county and a cost list ("<State> EQIP-1") and it returns the whole
payment schedule as an HTML table (state, cost list, practice code, practice name, component = scenario, unit, unit
cost). Scenario descriptions come from the same tool's "Practice Scenarios" report. Rows prefixed "HU-" are the
historically-underserved rate (socially disadvantaged, beginning, limited-resource and veteran producers), "PR-"
high-priority practice, "WP-" source-water protection, "SU-" supplemental (NRCS legend on the same page).

Pilot states (IA, KS, CA) are committed snapshots in data/reference/costshare_{ST}.json (refresh:
`python -m fieldshift.ingest.costshare IA KS CA`). Other states are fetched on demand for the field's county and kept
30 days in data/cache/costshare/. Nothing is filled in: when the tool cannot be read the block says so.
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
from datetime import date, datetime, timezone

import requests

from ..config import CACHE, DATA

URL = "https://www.nrcs.usda.gov/getting-assistance/payment-schedules"
REF = DATA / "reference"
CACHE_DIR = CACHE / "costshare"
CACHE_TTL = 30 * 86400
PRACTICES = {"340": "Cover Crop", "328": "Conservation Crop Rotation"}
PREFIX = {"HU": "usd_ac_hu", "PR": "usd_ac_priority", "WP": "usd_ac_source_water", "SU": "usd_ac_supplemental"}
CITATION = "USDA Natural Resources Conservation Service, EQIP payment schedule (payment schedule tool)."
CAVEAT_EN = ("Payments need an approved NRCS contract; amounts and eligibility vary. Rates are per acre of the "
             "practice as published in the state's EQIP payment schedule, not a promise of payment.")
CAVEAT_ES = ("Los pagos requieren un contrato aprobado con el NRCS; los montos y la elegibilidad varían. Las tarifas son "
             "por acre de la práctica según el calendario de pagos EQIP del estado; no son una promesa de pago.")

# Whole-field scenarios a crop farmer would consider, in display order: (practice, NRCS scenario name, EN, ES)
SCENARIOS = [
    ("340", "Any Species", "Cover crop (any species)", "Cultivo de cobertura (cualquier especie)"),
    ("340", "Any Species, Organic", "Cover crop on organic land", "Cultivo de cobertura en tierra orgánica"),
    ("340", "Biomass", "Cover crop grown for high biomass", "Cultivo de cobertura para alta biomasa"),
    ("328", "Basic, Multiple Annual Crops", "Crop rotation: add a different annual crop",
     "Rotación: añadir un cultivo anual distinto"),
    ("328", "Winter or Spring Annual", "Crop rotation: add a winter or spring annual",
     "Rotación: añadir un cultivo anual de invierno o primavera"),
    ("328", "Perennial, Short-Term", "Crop rotation: add a short-term perennial",
     "Rotación: añadir un perenne de corta duración"),
    ("328", "Irrigated to Dryland", "Crop rotation: irrigated to dryland", "Rotación: de riego a secano"),
    ("328", "Add Crop Organic System", "Crop rotation: add a crop (organic)", "Rotación: añadir un cultivo (orgánico)"),
]
DEFAULT_COVER = ("340", "Any Species")

# FIPS -> USPS; same table as the markets module (no import cycle: both are leaf modules)
from .markets import US_STATES  # noqa: E402

FIPS_TO_USPS = {f: st for st, (f, _n) in US_STATES.items()}


def federal_fiscal_year(d: date) -> int:
    return d.year + 1 if d.month >= 10 else d.year


# ----------------------------------------------------------------------------------------------- fetch (Drupal form)
class _Form:
    def __init__(self, timeout: float = 60):
        # requests' own User-Agent: the NRCS site stalls requests from some custom and browser-like agents (tested
        # 2026-11-15: "Mozilla/5.0" and the project agent timed out; the default answered in 0.2 s)
        self.s = requests.Session()
        self.timeout = timeout
        page = self.s.get(URL, timeout=timeout)
        page.raise_for_status()
        m = re.search(r'name="form_build_id" value="([^"]*)"', page.text)
        if not m:
            raise RuntimeError("NRCS payment schedule form not found on the page")
        self.fb = m.group(1)

    def ajax(self, trigger: str, data: dict) -> list[tuple[str, str]]:
        d = {"form_build_id": self.fb, "form_id": "nrcs_payment_api_form", "_triggering_element_name": trigger,
             "_drupal_ajax": "1", **data}
        r = self.s.post(URL + "?ajax_form=1&_wrapper_format=drupal_ajax", data=d, timeout=self.timeout,
                        headers={"X-Requested-With": "XMLHttpRequest"})
        r.raise_for_status()
        cmds = r.json()
        for c in cmds:
            if c.get("command") == "update_build_id":
                self.fb = c["new"]
        return [(html.unescape(v), html.unescape(t).strip()) for c in cmds
                if c.get("command") == "insert" and isinstance(c.get("data"), str)
                for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)', c["data"]) if v]

    def submit(self, data: dict) -> str:
        r = self.s.post(URL, data={"form_build_id": self.fb, "form_id": "nrcs_payment_api_form", **data, "op": "Search"},
                        timeout=self.timeout * 2)
        r.raise_for_status()
        return r.text


def _cells(row_html: str) -> list[str]:
    return [html.unescape(re.sub(r"\s+", " ", re.sub("<[^>]*>", "", c))).strip()
            for c in re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.S)]


def _money(s: str) -> float | None:
    try:
        return float(s.replace("$", "").replace(",", "").strip())
    except ValueError:
        return None


def parse_schedule(page: str) -> list[dict]:
    """Rows of the 'Payment Schedule Results' table for practices 340 and 328."""
    i = page.find("Payment Schedule Results")
    if i < 0:
        raise RuntimeError("no payment schedule table in the NRCS response")
    t = page[i:page.index("</table>", i)]
    out = []
    for tr in re.findall(r"<tr>(.*?)</tr>", t, re.S):
        c = _cells(tr)
        if len(c) >= 7 and c[2] in PRACTICES:
            out.append({"practice": c[2], "practice_name": c[3], "component": c[4], "unit": c[5], "usd": _money(c[6])})
    return out


def parse_scenarios(page: str) -> dict[str, str]:
    """Scenario name -> description from the Practice Scenarios report."""
    txt = html.unescape(re.sub(r"\s+", " ", re.sub("<[^>]*>", " ", page)))
    out = {}
    for m in re.finditer(r"Scenario Name: (.*?) Scenario Description: (.*?) Before Situation:", txt):
        out[m.group(1).strip()] = m.group(2).strip()
    return out


def fetch_state(st: str, county_fips: str) -> dict:
    """Live read of one state's EQIP schedule (340 and 328 rows + scenario descriptions)."""
    st = st.upper()
    sfips = US_STATES[st][0]
    f = _Form()
    f.ajax("state_cost", {"report_type": "cost_list_report", "state_cost": sfips})
    lists = [v for v, _t in f.ajax("county_code", {"report_type": "cost_list_report", "state_cost": sfips,
                                                   "county_code": county_fips})]
    eqip = [v for v in lists if re.search(r"EQIP", v) and not re.search(r"RCPP|CStwP|CSP|ACEP", v)]
    if not eqip:
        raise RuntimeError(f"no EQIP cost list for county {county_fips} (lists: {', '.join(lists) or 'none'})")
    name = sorted(eqip, key=lambda v: (not v.endswith("EQIP-1"), v))[0]
    rows = parse_schedule(f.submit({"report_type": "cost_list_report", "state_cost": sfips,
                                    "county_code": county_fips, "cost_list_name": name}))
    if not rows:
        raise RuntimeError(f"{name} lists no Cover Crop (340) or Conservation Crop Rotation (328) rates")
    desc: dict[str, dict[str, str]] = {}
    for code in PRACTICES:  # descriptions are optional (rates are what matter): two tries each, then go without
        for _try in range(2):
            try:
                f2 = _Form()
                opts = f2.ajax("state_practice", {"report_type": "scenario_report", "state_practice": sfips})
                pv = next((v for v, t in opts if t.startswith(f"{code} -")), None)
                got = parse_scenarios(f2.submit({"report_type": "scenario_report", "state_practice": sfips,
                                                 "practice_list": pv})) if pv else {}
            except Exception:  # noqa: BLE001
                got = {}
            if got:
                desc[code] = got
                break
    today = date.today()
    return {"state": st, "state_name": US_STATES[st][1], "state_fips": sfips, "county_fips_queried": county_fips,
            "cost_list": name, "fiscal_year": federal_fiscal_year(today),
            "fiscal_year_basis": (f"Federal fiscal year in effect on the retrieval date ({today.isoformat()}). NRCS posts "
                                  "each year's schedule in October–December, so early in a fiscal year the tool can "
                                  "still show last year's rates."),
            "retrieved": datetime.now(timezone.utc).isoformat(timespec="seconds"), "url": URL,
            "citation": CITATION, "rows": rows, "scenario_descriptions": desc}


# ----------------------------------------------------------------------------------------------- read
def _snapshot(st: str) -> dict | None:
    p = REF / f"costshare_{st}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _cached(st: str, county_fips: str | None) -> dict:
    snap = _snapshot(st)
    if snap:
        return {**snap, "mode": "snapshot"}
    if not county_fips:
        raise RuntimeError("no county for this field, and the NRCS tool needs one")
    p = CACHE_DIR / f"{st}.json"
    if p.exists() and time.time() - p.stat().st_mtime < CACHE_TTL:
        return {**json.loads(p.read_text(encoding="utf-8")), "mode": "cache"}
    d = fetch_state(st, county_fips)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return {**d, "mode": "live"}


def _first_sentence(s: str | None) -> str | None:
    if not s:
        return None
    m = re.match(r"(.+?(?<!e\.g)(?<!i\.e)\.)(\s+[A-Z]|$)", s)
    return (m.group(1) if m else s)[:300]


def costshare(state: str | None = None, county_fips: str | None = None, country_code: str | None = None) -> dict:
    """Money-response block: EQIP per-acre rates for the field's state (US only)."""
    if (country_code or "").lower() not in ("", "us"):
        return {"available": False, "reason": "USDA NRCS EQIP payments cover US farms only."}
    st = (state or "").upper() or FIPS_TO_USPS.get((county_fips or "")[:2])
    if st not in US_STATES:
        return {"available": False, "reason": "No US state for this field, so no NRCS payment schedule."}
    try:
        d = _cached(st, county_fips)
    except Exception as e:  # noqa: BLE001 - reported, never filled in
        return {"available": False, "state": st, "url": URL,
                "reason": f"The NRCS payment schedule could not be read ({type(e).__name__}: {str(e)[:160]})."}
    by: dict[tuple[str, str], dict] = {}
    for r in d["rows"]:
        if (r.get("unit") or "").lower() not in ("ac", "acre") or r.get("usd") is None:
            continue
        comp = r["component"]
        m = re.match(r"^(HU|PR|WP|SU)-(.*)$", comp)
        base = (m.group(2) if m else comp).strip()
        key = (r["practice"], base)
        it = by.setdefault(key, {})
        it[PREFIX[m.group(1)] if m else "usd_ac"] = r["usd"]
    items = []
    desc = d.get("scenario_descriptions") or {}
    for prac, scen, en, es in SCENARIOS:
        v = by.get((prac, scen))
        if not v or v.get("usd_ac") is None:
            continue
        items.append({"practice": prac, "practice_name": PRACTICES[prac], "scenario": scen,
                      "id": f"{prac}:{scen}", "name_en": en, "name_es": es, "usd_ac": v["usd_ac"],
                      "usd_ac_hu": v.get("usd_ac_hu"), "usd_ac_priority": v.get("usd_ac_priority"),
                      "usd_ac_source_water": v.get("usd_ac_source_water"),
                      "notes": _first_sentence((desc.get(prac) or {}).get(scen)),
                      "is_default_cover": (prac, scen) == DEFAULT_COVER})
    if not items:
        return {"available": False, "state": st, "url": URL,
                "reason": f"{d.get('cost_list')} lists no per-acre Cover Crop (340) or Crop Rotation (328) rate."}
    return {"available": True, "state": st, "state_name": d.get("state_name"), "fiscal_year": d.get("fiscal_year"),
            "fiscal_year_basis": d.get("fiscal_year_basis"), "cost_list": d.get("cost_list"),
            "county_queried": d.get("county_fips_queried"), "retrieved": (d.get("retrieved") or "")[:10],
            "mode": d.get("mode"), "unit": "USD per acre", "items": items,
            "has_crop_rotation_328": any(i["practice"] == "328" for i in items),
            "hu_note_en": ("Higher rate for historically underserved producers (socially disadvantaged, beginning, "
                           "limited-resource and veteran farmers), where the state publishes one."),
            "hu_note_es": ("Tarifa más alta para productores históricamente desatendidos (en desventaja social, "
                           "principiantes, de recursos limitados y veteranos), si el estado la publica."),
            "source": "USDA NRCS EQIP payment schedule", "citation": CITATION, "url": URL, "is_nasa": False,
            "caveat_en": CAVEAT_EN, "caveat_es": CAVEAT_ES}


# ----------------------------------------------------------------------------------------------- snapshots
PILOT_COUNTIES = {"IA": "19169", "KS": "20055", "CA": "06019"}  # Story, Finney, Fresno (pilot fields' counties)
SNAPSHOT_FY_BASIS = {
    "IA": ("Iowa's FY2026 booklet (FA Program Scenario Booklet, April 28 2026) lists 340 'Multi-Species' at $77.54/ac "
           "and different scenario names; the schedule served on the retrieval date has the new national scenario "
           "set ('Any Species' $74.75/ac), so it is the schedule for federal fiscal year 2027 (Oct 2026–Sep 2027)."),
}


def write_snapshots(states: list[str]) -> dict:
    rep = {}
    for st in states:
        st = st.upper()
        cty = PILOT_COUNTIES.get(st)
        if not cty:
            rep[st] = "no pilot county; fetched on demand instead"
            continue
        d = fetch_state(st, cty)
        if st in SNAPSHOT_FY_BASIS:
            d["fiscal_year_basis"] = SNAPSHOT_FY_BASIS[st]
        else:
            d["fiscal_year_basis"] = (d["fiscal_year_basis"] + " Same national FY2027 scenario set as Iowa's "
                                      "('Any Species', 'Biomass', 'Basic, Multiple Annual Crops').")
        (REF / f"costshare_{st}.json").write_bytes(json.dumps(d, ensure_ascii=False, indent=1).encode("utf-8"))
        n340 = [r for r in d["rows"] if r["practice"] == "340" and r["component"] == "Any Species"]
        rep[st] = f"{d['cost_list']}: {len(d['rows'])} rows; 340 Any Species {n340[0]['usd'] if n340 else 'n/a'} $/ac"
    return rep


if __name__ == "__main__":
    print(json.dumps(write_snapshots(sys.argv[1:] or list(PILOT_COUNTIES)), indent=1))
