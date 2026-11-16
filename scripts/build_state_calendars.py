"""Build engine/rules/calendars_us_states.yaml: a planting / harvest calendar for every US state, read from
USDA NASS Agricultural Handbook 628 (Field Crops Usual Planting and Harvesting Dates, October 2010).

The handbook's crop-section tables ("<Crop> Usual Planting and Harvesting Dates - States") give one row per state:
planting begin, most active, end, then harvesting begin, most active, end. These are STATE-level usual dates.

Usage (pdftotext from xpdf 4 must be on PATH; Git Bash ships it):
    python scripts/build_state_calendars.py [path/to/ah628.pdf]
Without a path the PDF is downloaded to data/cache/ah628.pdf (git-ignored).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
URL = "https://downloads.usda.library.cornell.edu/usda-esmis/files/vm40xr56k/dv13zw65p/w9505297d/planting-10-29-2010.pdf"
OUT_YAML = ROOT / "engine" / "rules" / "calendars_us_states.yaml"
OUT_JSON = ROOT / "data" / "reference" / "nass_ah628_states.json"

# handbook section -> crops.yaml id. Fall-sown barley / oats are a different crop type from the spring crops in
# crops.yaml, so they are kept in the raw JSON but not used as calendars.
SECTIONS = {
    "Fall Barley": None, "Spring Barley": "barley", "Corn for Grain": "corn", "All Cotton": "cotton",
    "Alfalfa Hay": "alfalfa", "Other Hay": None, "Fall Oat": None, "Spring Oat": "oats", "Peanut": None,
    "All Rice": "rice", "Sorghum for Grain": "sorghum", "Soybean": "soybean", "Sugarbeet": "sugar_beet",
    "All Sunflower": "sunflower", "Durum Wheat": "durum", "Spring Wheat": "spring_wheat", "Winter Wheat": "winter_wheat",
}
STATES = {  # name -> (FIPS, postal)
    "Alabama": ("01", "AL"), "Alaska": ("02", "AK"), "Arizona": ("04", "AZ"), "Arkansas": ("05", "AR"),
    "California": ("06", "CA"), "Colorado": ("08", "CO"), "Connecticut": ("09", "CT"), "Delaware": ("10", "DE"),
    "Florida": ("12", "FL"), "Georgia": ("13", "GA"), "Hawaii": ("15", "HI"), "Idaho": ("16", "ID"),
    "Illinois": ("17", "IL"), "Indiana": ("18", "IN"), "Iowa": ("19", "IA"), "Kansas": ("20", "KS"),
    "Kentucky": ("21", "KY"), "Louisiana": ("22", "LA"), "Maine": ("23", "ME"), "Maryland": ("24", "MD"),
    "Massachusetts": ("25", "MA"), "Michigan": ("26", "MI"), "Minnesota": ("27", "MN"), "Mississippi": ("28", "MS"),
    "Missouri": ("29", "MO"), "Montana": ("30", "MT"), "Nebraska": ("31", "NE"), "Nevada": ("32", "NV"),
    "New Hampshire": ("33", "NH"), "New Jersey": ("34", "NJ"), "New Mexico": ("35", "NM"), "New York": ("36", "NY"),
    "North Carolina": ("37", "NC"), "North Dakota": ("38", "ND"), "Ohio": ("39", "OH"), "Oklahoma": ("40", "OK"),
    "Oregon": ("41", "OR"), "Pennsylvania": ("42", "PA"), "Rhode Island": ("44", "RI"), "South Carolina": ("45", "SC"),
    "South Dakota": ("46", "SD"), "Tennessee": ("47", "TN"), "Texas": ("48", "TX"), "Utah": ("49", "UT"),
    "Vermont": ("50", "VT"), "Virginia": ("51", "VA"), "Washington": ("53", "WA"), "West Virginia": ("54", "WV"),
    "Wisconsin": ("55", "WI"), "Wyoming": ("56", "WY"),
}
MON = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
D = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}"
CELL = re.compile(rf"\(NA\)|{D}(?: - {D})?")
ROW = re.compile(r"^(?P<state>[A-Z][A-Za-z ]+?) \.{2,}\s+(?P<rest>.*)$")
HEAD = re.compile(r"^(?P<crop>[A-Z][A-Za-z ]+?) Usual Planting and Harvesting Dates (?:by Class )?. States$")


def mmdd(s: str) -> str:
    m, d = s.split()
    return f"{MON[m]:02d}-{int(d):02d}"


def window(b: str, ma: str, e: str) -> dict | None:
    if b == "(NA)" and e == "(NA)":
        return None
    w: dict = {"begin": None if b == "(NA)" else mmdd(b), "end": None if e == "(NA)" else mmdd(e)}
    if ma != "(NA)" and " - " in ma:
        w["most_active"] = [mmdd(x) for x in ma.split(" - ")]
    if w["begin"] is None or w["end"] is None:
        return None  # a window needs both ends; never filled by guessing
    if "most_active" not in w:
        w["most_active"] = [w["begin"], w["end"]]
        w["most_active_na"] = True
    return {"begin": w["begin"], "most_active": w["most_active"], "end": w["end"]}


def parse(txt: str) -> tuple[dict, list[str]]:
    raw: dict[str, dict[str, dict]] = {}
    problems: list[str] = []
    section = None
    for line in txt.splitlines():
        line = line.rstrip()
        if "by Crop" in line:
            section = None  # state pages start: the crop-section tables are done
            continue
        h = HEAD.match(" ".join(line.split()))  # headings are spread across columns in the table text
        if h and "...." not in line:
            section = h.group("crop").strip()
            if section not in SECTIONS:
                if section != "Tobacco":
                    problems.append(f"unknown section {section!r}")
                section = None
            continue
        if not section:
            continue
        m = ROW.match(line.strip())
        if not m or m.group("state").strip() not in STATES:
            continue
        cells = CELL.findall(m.group("rest"))
        st = m.group("state").strip()
        if len(cells) != 6:
            problems.append(f"{section} / {st}: {len(cells)} cells in {m.group('rest')!r}")
            continue
        raw.setdefault(st, {})[section] = {"plant": cells[:3], "harvest": cells[3:]}
    return raw, problems


def main() -> None:
    pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "cache" / "ah628.pdf"
    if not pdf.exists():
        pdf.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(URL, pdf)
    txt = subprocess.run(["pdftotext", "-table", "-enc", "UTF-8", str(pdf), "-"], capture_output=True, check=True).stdout
    raw, problems = parse(txt.decode("utf-8", "replace"))
    for p in problems:
        print("WARN", p)

    regions = {}
    for st, secs in sorted(raw.items()):
        fips, post = STATES[st]
        crops = {}
        for sec, row in secs.items():
            cid = SECTIONS.get(sec)
            if not cid:
                continue
            plant, harvest = window(*row["plant"]), window(*row["harvest"])
            if cid == "alfalfa":
                if harvest:
                    crops[cid] = {"plant": None, "harvest": harvest, "sources": ["nass_ah628"],
                                  "note": "Hay cutting window; AH-628 gives no seeding dates (NA)."}
                continue
            if plant and harvest:
                crops[cid] = {"plant": plant, "harvest": harvest, "sources": ["nass_ah628"]}
        if not crops:
            continue
        regions[f"us_{post.lower()}"] = {
            "label": st, "statefips": fips,
            "scale_note": f"{st} state-level usual dates (NASS AH-628, 2010); local dates can differ",
            "covers_from": "iowa_central",
            "crops": dict(sorted(crops.items())),
        }

    head = (
        "# GENERATED by scripts/build_state_calendars.py - do not edit by hand.\n"
        "# Planting / harvest calendars for every US state with field-crop rows in USDA NASS Agricultural Handbook 628\n"
        "# (Field Crops Usual Planting and Harvesting Dates, October 2010), crop-section tables. STATE-level usual dates,\n"
        "# not county or field level. A window is left out when AH-628 gives (NA) for its begin or end (never guessed).\n"
        "# Fall-sown barley and oats are not used (crops.yaml models the spring crops). Cover-crop windows are\n"
        "# anchor-relative SARE rules and are shared from the iowa_central block (covers_from).\n"
        "# The pilot regions in calendars.yaml (iowa_central, kansas_west, california_sjv...) take precedence.\n"
    )
    OUT_YAML.write_text(head + yaml.safe_dump({"schema_version": 1, "regions": regions}, sort_keys=False, width=140),
                        encoding="utf-8")
    OUT_JSON.write_text(json.dumps({"source": URL, "table": "crop-section tables, all states", "rows": raw},
                                   indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(regions)} states, {sum(len(r['crops']) for r in regions.values())} crop calendars -> {OUT_YAML}")


if __name__ == "__main__":
    main()
