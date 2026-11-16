"""Iowa State University Extension and Outreach, Ag Decision Maker A1-20 "Estimated Costs of Crop Production in
Iowa" (latest edition): published per-acre crop budgets for Iowa fields (money calculator benchmarks, wave U9).

ISU publishes each A1-20 budget table as an Excel decision tool whose "Example" sheet holds the publication's
values (e.g. corn following soybeans at 211 bu/acre). The tool files and the PDF are linked from
https://www.extension.iastate.edu/agdm/crops/html/a1-20.html; this module reads the landing page (edition year and
links), downloads the tools, parses every cost line from the Example sheet, and checks each budget's total cost per
acre against the text of the published PDF. Nothing is typed in by hand: if a file can't be read the budget is
left out and the reason is kept.

Build:   python -m fieldshift.ingest.budgets_isu      (writes data/reference/isu_a1_20.json; files in data/cache/isu_a1_20/)
API:     benchmarks(crop_id, state_fips) -> {available, items: [...]} or {available: False, reason}
"""
from __future__ import annotations

import json
import re
import time
import zlib
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import requests

from ..config import CACHE, DATA, USER_AGENT

AGDM = "https://www.extension.iastate.edu/agdm/crops"
LANDING = f"{AGDM}/html/a1-20.html"
RAW = CACHE / "isu_a1_20"
REF = DATA / "reference" / "isu_a1_20.json"
IOWA_FIPS = "19"
CITATION = ("{author}Estimated Costs of Crop Production in Iowa – {year}. Ag Decision Maker File A1-20{fm}. Iowa State "
            "University Extension and Outreach. " + LANDING)

# tool file stem -> (FarmSmart crop id, EN label, ES label). Labels follow the tool's own title.
TABLES = {
    "a1-20cfs_tbl2": ("corn", "Corn following soybeans", "Maíz después de soya"),
    "a1-20cfc_tbl1": ("corn", "Corn following corn", "Maíz después de maíz"),
    "a1-20striptillcfstbl5": ("corn", "Corn following soybeans, strip-till", "Maíz después de soya, labranza en franjas"),
    "a1-20lowtillcfstbl6": ("corn", "Corn following soybeans, low-till", "Maíz después de soya, labranza reducida"),
    "a1-20sfc_tbl4": ("soybean", "Herbicide-tolerant soybeans following corn", "Soya tolerante a herbicidas después de maíz"),
    "a1-20nontolerant_sfc": ("soybean", "Non-herbicide-tolerant soybeans following corn",
                             "Soya no tolerante a herbicidas después de maíz"),
    "a1-20striptillsfctbl5": ("soybean", "Soybeans following corn, strip-till", "Soya después de maíz, labranza en franjas"),
    "a1-20lowtillsfctbl6": ("soybean", "Soybeans following corn, low-till", "Soya después de maíz, labranza reducida"),
    "a1-15-20oatsmallgrainbudget": ("oats", "Oats (small grain) for grain and straw", "Avena (cereal menor) para grano y paja"),
}

# ISU line -> money-calculator cost line id (the USDA ERS line ids in fieldshift.ingest.econ.ERS_LINES, plus
# crop_insurance, which USDA ERS does not hold). Machinery: ISU "variable" = fuel, oil and repairs, "fixed" =
# depreciation, interest, insurance and housing (the tool's own note).
_INPUT_LINE = [(("seed",), "seed"), (("nitrogen", "phosphate", "potash", "lime", "fertilizer", "manure"), "fertilizer"),
               (("herbicide", "insecticide", "fungicide"), "chemicals"), (("crop insurance",), "crop_insurance"),
               (("interest",), "interest"), (("custom",), "custom")]


# Spanish names for ISU's line labels (the labels themselves are read from the files)
LABEL_ES = {
    "Apply nitrogen": "Aplicar nitrógeno", "Cash rent equivalent": "Equivalente de renta en efectivo",
    "Chisel plow": "Arado de cincel", "Combine": "Cosechadora", "Crop insurance": "Seguro agrícola",
    "Cultivate": "Cultivar", "Drill": "Sembradora de chorrillo", "Drying": "Secado", "Field cultivate": "Cultivador de campo",
    "Grain cart": "Carro granelero", "Handling": "Manejo del grano", "Harrow": "Rastra", "Haul": "Acarreo",
    "Haul Straw": "Acarreo de paja", "Herbicide": "Herbicida", "Insecticide": "Insecticida",
    "Interest on preharvest variable costs": "Intereses sobre costos variables antes de la cosecha",
    "Lime (annual cost)": "Cal (costo anual)", "Miscellaneous": "Varios", "Nitrogen": "Nitrógeno",
    "No-till drill": "Sembradora de siembra directa", "Operator": "Operador (mano de obra propia)",
    "Phosphate": "Fosfato", "Plant": "Siembra", "Potash": "Potasa", "Rake": "Rastrillo", "Seed": "Semilla",
    "Seed (drill)": "Siembra (sembradora)", "Small square baler": "Empacadora de pacas pequeñas",
    "Spray": "Pulverización", "Spread fertilizer": "Esparcir fertilizante", "Strip till": "Labranza en franjas",
    "Tandem disk": "Rastra de discos", "Tandem disk (2 times)": "Rastra de discos (2 pasadas)",
    "Custom hire": "Servicios contratados", "Hired": "Mano de obra contratada",
}
SECTION_LABELS = {"preharvest_machinery": ("Machinery before harvest", "Maquinaria antes de la cosecha"),
                  "inputs": ("Seed, fertilizer, chemicals and other inputs", "Semilla, fertilizantes, agroquímicos y otros insumos"),
                  "harvest_machinery": ("Harvest machinery, hauling, drying and handling",
                                        "Maquinaria de cosecha, acarreo, secado y manejo"),
                  "labor": ("Labour", "Mano de obra"), "land": ("Land", "Tierra")}
OVERHEAD_LINES = {"machinery", "labor", "land"}


def _session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def _num(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return None


def _line_for(section: str, label: str, part: str) -> str:
    t = label.lower()
    if section in ("preharvest_machinery", "harvest_machinery"):
        if "custom" in t:
            return "custom"
        if part == "fixed":
            return "machinery"
        return "other" if "drying" in t else "fuel"  # per-bushel drying: ERS keeps commercial drying in "other"
    if section == "labor":
        return "labor"
    if section == "land":
        return "land"
    for keys, lid in _INPUT_LINE:
        if any(k in t for k in keys):
            return lid
    return "other"


def parse_tool(path: Path) -> dict:
    """Every cost line of the tool's Example sheet: section, label, fixed, variable and total $/acre."""
    import openpyxl  # noqa: PLC0415

    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = next((w for w in wb.worksheets if "example" in w.title.lower()), wb.worksheets[0])
    rows = [[c.value for c in r] for r in ws.iter_rows(max_col=15)]
    wb.close()
    col = {k: i for i, k in enumerate("ABCDEFGHIJKLMNO")}
    title = next((str(r[0]).strip() for r in rows if r and r[0]), None)
    out = {"sheet": ws.title, "title": title, "yield": None, "yield_unit": None, "items": [], "totals": None,
           "version": None, "date": None}
    section = None
    for r in rows:
        r = list(r) + [None] * (15 - len(r))
        a = str(r[0]).strip() if r[0] is not None else ""
        al = a.lower()
        unit = str(r[col["E"]] or "")
        if out["yield"] is None and _num(r[col["D"]]) and "bu" in unit.lower() and "acre" in unit.lower():
            out["yield"], out["yield_unit"] = _num(r[col["D"]]), "bu/ac"
        if al.startswith("version"):
            out["version"] = a
        if isinstance(r[0], datetime):
            out["date"] = r[0].date().isoformat()
        if al.startswith("preharvest machinery"):
            section = "preharvest_machinery"
            continue
        if al.startswith("seed, chemicals") or al.startswith("seed, fertilizer"):
            section = "inputs"
            continue
        if al.startswith("harvest machinery"):
            section = "harvest_machinery"
            continue
        if al.startswith("labor"):
            section = "labor"
            continue
        if al == "land":
            section = "land"
            continue
        if al.startswith("total fixed, variable"):
            section = "totals"
            continue
        if not a or section is None:
            continue
        g, h, i = _num(r[col["G"]]), _num(r[col["H"]]), _num(r[col["I"]])
        if section == "totals":
            if al == "per acre":
                out["totals"] = {"fixed_usd_ac": g, "variable_usd_ac": h, "total_usd_ac": i}
            continue
        if al.startswith("total") or i is None or abs(i) < 1e-9:
            continue
        out["items"].append({"section": section, "label": a, "fixed_usd_ac": round(g or 0.0, 2),
                             "variable_usd_ac": round(h or 0.0, 2), "usd_ac": round(i, 2)})
    if not out["totals"]:
        raise ValueError(f"no 'Per acre' total row in {path.name}")
    s = sum(x["usd_ac"] for x in out["items"])
    out["items_sum_usd_ac"] = round(s, 2)
    out["items_match_total"] = abs(s - (out["totals"]["total_usd_ac"] or 0)) < 0.5
    return out


def _pdf_text(path: Path) -> str:
    """Text of the PDF's content streams (Flate-compressed text-show strings), enough to find printed totals."""
    data = path.read_bytes()
    parts = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S):
        try:
            s = zlib.decompress(m.group(1))
        except zlib.error:
            continue
        parts.append(b"".join(re.findall(rb"\(((?:[^()\\]|\\.)*)\)", s)).decode("latin-1"))
    return "\n".join(parts)


def _calculator_lines(items: list[dict]) -> list[dict]:
    lines: dict[str, dict] = {}
    for x in items:
        for part in ("fixed", "variable"):
            v = x[f"{part}_usd_ac"]
            if not v:
                continue
            lid = _line_for(x["section"], x["label"], part)
            e = lines.setdefault(lid, {"id": lid, "usd_ac": 0.0, "from": []})
            e["usd_ac"] += v
            e["from"].append(f"{x['label']} ({part})" if x["section"].endswith("machinery") else x["label"])
    for e in lines.values():
        e["usd_ac"] = round(e["usd_ac"], 2)
        e["group"] = "overhead" if e["id"] in OVERHEAD_LINES else "operating"
    notes = {"fuel": "ISU's variable machinery cost: fuel, oil and repairs together (USDA ERS splits fuel and repairs)",
             "machinery": "ISU's fixed machinery cost: depreciation, interest, insurance and housing",
             "crop_insurance": "Crop insurance premium: not a USDA ERS cost line",
             "labor": "Operator labour valued at ISU's hourly rate", "land": "Cash rent equivalent"}
    for k, v in notes.items():
        if k in lines:
            lines[k]["note"] = v
    order = ["seed", "fertilizer", "chemicals", "custom", "fuel", "other", "interest", "crop_insurance",
             "machinery", "labor", "land"]
    return sorted(lines.values(), key=lambda e: order.index(e["id"]) if e["id"] in order else 99)


def build(log=print) -> dict:
    """Read the landing page, download the tools and the PDF, parse, verify and write data/reference/isu_a1_20.json."""
    RAW.mkdir(parents=True, exist_ok=True)
    s = _session()
    html = s.get(LANDING, timeout=60).text
    m = re.search(r"Estimated Costs of Crop Production in Iowa\s*[-–]\s*(\d{4})", html)
    if not m:
        raise RuntimeError("edition year not found on " + LANDING)
    year = int(m.group(1))
    links = {Path(x).stem: f"{AGDM}/xls/{Path(x).name}" for x in re.findall(r'href="\.\./xls/([^"]+\.xlsx)"', html)}
    pdf_rel = re.search(r'href="\.\./pdf/(a1-20\.pdf)"', html)
    pdf_url = f"{AGDM}/pdf/{pdf_rel.group(1)}" if pdf_rel else f"{AGDM}/pdf/a1-20.pdf"
    pdf_path = RAW / f"a1-20_{year}.pdf"
    r = s.get(pdf_url, timeout=120)
    r.raise_for_status()
    pdf_path.write_bytes(r.content)
    pdf_txt = _pdf_text(pdf_path)
    budgets, problems = [], {}
    for stem, (crop, en, es) in TABLES.items():
        url = links.get(stem)
        if not url:
            problems[stem] = "not linked on the A1-20 page"
            continue
        p = RAW / f"{stem}_{year}.xlsx"
        try:
            rr = s.get(url, timeout=120)
            rr.raise_for_status()
            p.write_bytes(rr.content)
            t = parse_tool(p)
        except Exception as e:  # noqa: BLE001 - recorded, never filled in
            problems[stem] = f"{type(e).__name__}: {str(e)[:160]}"
            log(f"{stem}: {problems[stem]}")
            continue
        tot = t["totals"]["total_usd_ac"]
        in_pdf = f"${tot:,.2f}" in pdf_txt
        y = t["yield"]
        yield_in_pdf = bool(y) and f"{y:g} bushels" in pdf_txt
        budgets.append({"id": stem, "crop": crop, "label": en, "label_es": es, "title": t["title"],
                        "url": url, "year": year, "yield_assumption": y, "unit": t["yield_unit"],
                        "operating_usd_ac": round(t["totals"]["variable_usd_ac"], 2),
                        "fixed_usd_ac": round(t["totals"]["fixed_usd_ac"], 2),
                        "total_usd_ac": round(tot, 2), "items": t["items"],
                        "calculator_lines": _calculator_lines(t["items"]),
                        "items_match_total": t["items_match_total"], "total_in_pdf": in_pdf,
                        "yield_in_pdf": yield_in_pdf, "tool_version": t["version"], "tool_date": t["date"]})
        log(f"{stem}: {en} {y} bu/ac, variable {t['totals']['variable_usd_ac']:.2f}, total {tot:.2f} $/ac, "
            f"lines sum ok={t['items_match_total']}, total in PDF={in_pdf}")
    au = re.search(r"Prepared by ([^,]+),", pdf_txt)
    fm = re.search(r"(FM \d+)\s+Revised ([A-Z][a-z]+ \d{4})", pdf_txt)
    citation = CITATION.format(author=f"{au.group(1).strip()}. " if au else "", year=year,
                               fm=f" ({fm.group(1)}, revised {fm.group(2)})" if fm else "")
    js = {"meta": {"source": "Iowa State University Extension and Outreach, Ag Decision Maker",
                   "product": f"A1-20 Estimated Costs of Crop Production in Iowa – {year}", "year": year,
                   "url": LANDING, "pdf_url": pdf_url, "citation": citation, "state_fips": IOWA_FIPS,
                   "retrieved": datetime.now(timezone.utc).isoformat(timespec="seconds"), "problems": problems,
                   "method": "Each budget is the Example sheet of ISU's A1-20 Excel tool (the publication's values at "
                             "its middle yield level); total cost per acre checked against the PDF text.",
                   "operating_definition": "ISU 'variable' costs: seed, fertilizer and lime, pesticides, crop "
                                           "insurance, miscellaneous, interest on pre-harvest variable costs, and "
                                           "machinery fuel, oil and repairs (incl. drying, hauling and handling "
                                           "per bushel)",
                   "fixed_definition": "ISU 'fixed' costs: machinery depreciation, interest, insurance and housing; "
                                       "operator labour; land (cash rent equivalent)"},
          "budgets": budgets}
    REF.parent.mkdir(parents=True, exist_ok=True)
    REF.write_text(json.dumps(js, indent=1, ensure_ascii=False), encoding="utf-8")
    _ref.cache_clear()
    return js


@lru_cache(maxsize=1)
def _ref() -> dict | None:
    if REF.exists():
        return json.loads(REF.read_text(encoding="utf-8"))
    return None


def benchmarks(crop_id: str, state_fips: str | None) -> dict:
    """Published budgets for this crop in the field's state (Iowa: ISU A1-20)."""
    st = str(state_fips or "").zfill(2)[:2] if state_fips else None
    if st != IOWA_FIPS:
        return {"available": False, "reason": "No state extension crop budget is connected for this state yet "
                                              "(Iowa State University's A1-20 is connected for Iowa fields)."}
    js = _ref()
    if js is None:
        return {"available": False, "reason": "The ISU A1-20 budgets have not been read on this server "
                                              "(run python -m fieldshift.ingest.budgets_isu)."}
    meta = js["meta"]
    items = [b for b in js["budgets"] if b["crop"] == crop_id]
    if not items:
        why = meta["problems"]
        return {"available": False, "reason": f"ISU A1-20 ({meta['year']}) has no budget for this crop"
                                              + (f"; files that could not be read: {', '.join(why)}" if why else "") + "."}
    keep = ("id", "label", "label_es", "url", "year", "yield_assumption", "unit", "operating_usd_ac", "fixed_usd_ac",
            "total_usd_ac", "items", "calculator_lines", "total_in_pdf")
    out = []
    for b in items:
        e = {k: b[k] for k in keep}
        e["items"] = [{**x, "label_es": LABEL_ES.get(x["label"], x["label"]),
                       "section_en": SECTION_LABELS.get(x["section"], (x["section"],) * 2)[0],
                       "section_es": SECTION_LABELS.get(x["section"], (x["section"],) * 2)[1]} for x in b["items"]]
        e["source"] = meta["source"] + ", " + meta["product"]
        e["pdf_url"] = meta["pdf_url"]
        e["notes"] = ("Iowa statewide budget at the yield shown, not your farm. Operating = ISU 'variable' costs ("
                      "includes machinery fuel, oil and repairs, and crop insurance); total adds machinery ownership, "
                      "operator labour and land (cash rent equivalent).")
        e["notes_es"] = ("Presupuesto estatal de Iowa al rendimiento indicado, no su finca. Operativo = costos "
                         "'variables' de ISU (incluye combustible, aceite y reparaciones de maquinaria, y el seguro "
                         "agrícola); el total suma la propiedad de maquinaria, la mano de obra del operador y la tierra "
                         "(equivalente de renta en efectivo).")
        if not b["total_in_pdf"]:
            e["notes"] += (" This is the worked example of an ISU worksheet linked from the A1-20 page; it is not one "
                           "of the tables printed in the A1-20 PDF.")
            e["notes_es"] += (" Es el ejemplo resuelto de una hoja de cálculo de ISU enlazada desde la página A1-20; no "
                              "es una de las tablas impresas en el PDF A1-20.")
        out.append(e)
    return {"available": True, "items": out, "source": meta["source"], "product": meta["product"], "url": meta["url"],
            "year": meta["year"], "citation": meta["citation"], "retrieved": meta["retrieved"],
            "operating_definition": meta["operating_definition"], "fixed_definition": meta["fixed_definition"],
            "scale": "Iowa statewide budget, not your farm", "scale_es": "presupuesto estatal de Iowa, no su finca",
            "calculator_lines_note": "calculator_lines regroups ISU's lines onto the money calculator's cost-line ids "
                                     "(USDA ERS ids, plus crop_insurance); group says operating or overhead.",
            "is_nasa": False}


if __name__ == "__main__":
    t0 = time.time()
    js = build()
    print(f"{len(js['budgets'])} budgets, problems: {js['meta']['problems']}, {time.time() - t0:.0f}s")
