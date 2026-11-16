"""Historical losses for the money calculator's risk panel (US counties).

- USDA RMA Cause of Loss (colsom_YYYY.zip, county x crop x cause x month: indemnities) and the RMA Summary of
  Business by state/county/crop (sobcov_YYYY.zip: insured acres), public files at pubfs-rma.fpac.usda.gov, no key.
  Downloaded once per year file, aggregated to a compact all-county table for the crops FarmSmart simulates
  (data/cache/rma/*.parquet); the zips are deleted after parsing so the cache stays small (≈ a few MB).
- OpenFEMA DisasterDeclarationsSummaries v2 (public API, no key): declared disasters for a county.

Every value is a count or a sum from those files. Nothing is filled in: a source that cannot be fetched is
returned as {"available": False, "reason": ...}.
"""
from __future__ import annotations

import io
import json
import os
import time
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from ..config import CACHE, PRECOMP, USER_AGENT

RMA_DIR = CACHE / "rma"
RMA_BASE = "https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business"
COL_URL = RMA_BASE + "/cause_of_loss/colsom_{y}.zip"
SOB_URL = RMA_BASE + "/state_county_crop/sobcov_{y}.zip"
RMA_CITATION = ("USDA Risk Management Agency, Cause of Loss Historical Data Files (Summary of Business with month "
                "of loss) and State/County/Crop Summary of Business. https://www.rma.usda.gov/tools-reports/"
                "summary-of-business/cause-loss")
FEMA_URL = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries"
FEMA_CITATION = ("FEMA, OpenFEMA Dataset: Disaster Declarations Summaries - v2. https://www.fema.gov/openfema-data-page/"
                 "disaster-declarations-summaries-v2. This product uses the FEMA OpenFEMA API, but is not endorsed by FEMA.")
N_YEARS = 20

# FarmSmart crop id -> RMA commodity name (RMA "Dry Peas" includes lentils and chickpeas; "Wheat" is all classes)
CROP_TO_RMA = {"corn": "Corn", "soybean": "Soybeans", "winter_wheat": "Wheat", "spring_wheat": "Wheat",
               "durum": "Wheat", "sorghum": "Grain Sorghum", "cotton": "Cotton", "rice": "Rice", "peanut": "Peanuts",
               "peanuts": "Peanuts", "barley": "Barley", "oats": "Oats", "canola": "Canola", "sunflower": "Sunflowers",
               "dry_bean": "Dry Beans", "field_pea": "Dry Peas", "lentil": "Dry Peas", "chickpea": "Dry Peas",
               "alfalfa": "Forage Production", "sugar_beet": "Sugar Beets", "flax": "Flax", "proso_millet": "Millet",
               "processing_tomato": "Tomatoes", "triticale": "Triticale", "safflower": "Safflower"}
RMA_COMMODITIES = sorted(set(CROP_TO_RMA.values()))

# Cause groups: id -> (EN, ES, in_simulation). RMA cause descriptions changed spelling and case over the years
# ("Failure Of Irrigation Supply", "GRP/GRIP Crops Only", ...), so they are matched by keyword in _cause_group.
GROUPS = {
    "hail": ("Hail", "Granizo", False),
    "excess_moisture": ("Too much rain, wet soil", "Exceso de lluvia, suelo encharcado", False),
    "flood": ("Flood", "Inundación", False),
    "wind_storm": ("Wind, storms, tornadoes, hurricanes", "Viento, tormentas, tornados, huracanes", False),
    "freeze": ("Frost or freeze during the season (Apr–Oct)", "Helada durante la temporada (abr–oct)", True),
    "freeze_winter": ("Frost or freeze outside the season (Nov–Mar)", "Helada fuera de temporada (nov–mar)", False),
    "cold_winter": ("Cold winter (winterkill)", "Invierno frío (muerte invernal)", False),
    "cold_wet": ("Cold, wet weather", "Tiempo frío y húmedo", False),
    "drought": ("Drought", "Sequía", True),
    "heat": ("Heat and hot wind", "Calor y viento caliente", True),
    "irrigation_failure": ("Irrigation water or equipment failed", "Falló el agua o el equipo de riego", False),
    "insects": ("Insects", "Insectos", False),
    "disease": ("Plant disease and mycotoxins", "Enfermedades y micotoxinas", False),
    "fire": ("Fire", "Incendio", False),
    "wildlife": ("Wildlife", "Fauna silvestre", False),
    "other": ("Other (snow, lightning, quality, unspecified)", "Otras (nieve, rayos, calidad, sin especificar)", False),
}
# Not counted as a field hazard (group None): price declines (the calculator's price years already carry them) and
# area/index plans and endorsements (GRP/GRIP, ARPI, SCO, ECO, STAX, MP...), whose payouts follow county or
# market indexes rather than one physical cause on the farm.
_KEYWORDS = [  # first match wins
    (("price",), None), (("grp", "grip", "arpi", "sco/", "/sco", "stax", "area plan"), None),
    (("hail",), "hail"), (("excess moisture", "precipitation", "excessive rain", "salinity"), "excess_moisture"),
    (("flood",), "flood"), (("hot wind",), "heat"),
    (("wind", "tornado", "hurricane", "tropical", "cyclone"), "wind_storm"),
    (("cold winter",), "cold_winter"), (("cold wet",), "cold_wet"), (("freeze", "frost"), "freeze"),
    (("drought",), "drought"), (("heat",), "heat"), (("irrigation",), "irrigation_failure"),
    (("insect",), "insects"), (("disease", "mycotoxin", "aflatoxin", "rust"), "disease"),
    (("fire",), "fire"), (("wildlife",), "wildlife"),
]


def _years() -> list[int]:
    last = date.today().year - 1  # the current commodity year is still open
    return list(range(last - N_YEARS + 1, last + 1))


def _download(url: str, dest: Path) -> None:
    with requests.get(url, stream=True, timeout=300, headers={"User-Agent": USER_AGENT}) as r:
        r.raise_for_status()
        tmp = dest.with_suffix(".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.replace(dest)


def _read_zip(path: Path) -> pd.DataFrame:
    z = zipfile.ZipFile(path)
    name = next(n for n in z.namelist() if n.lower().endswith(".txt"))
    return pd.read_csv(io.BytesIO(z.read(name)), sep="|", header=None, dtype=str, encoding="latin-1",
                       quoting=3, on_bad_lines="skip")


_RMA_UPPER = {c.upper(): c for c in RMA_COMMODITIES}


def _commodity(col: pd.Series) -> pd.Series:
    """RMA commodity names (older files are upper case) -> the canonical names in CROP_TO_RMA."""
    u = col.fillna("").str.strip().str.upper()
    return u.map(_RMA_UPPER).fillna(col.fillna("").str.strip())


def _cause_group(desc: str, month: float) -> str | None:
    t = (desc or "").lower()
    for keys, grp in _KEYWORDS:
        if any(k in t for k in keys):
            if grp == "freeze":
                return "freeze" if 4 <= (month or 0) <= 10 else "freeze_winter"
            return grp
    return "other"


def _col_year(y: int, raw: Path) -> pd.DataFrame:
    df = _read_zip(raw)
    df = df.iloc[:, :30]
    df.columns = list(range(30))
    d = pd.DataFrame({"year": pd.to_numeric(df[0], errors="coerce"), "state": df[1].str.strip().str.zfill(2),
                      "county": df[3].str.strip().str.zfill(3), "commodity": _commodity(df[6]),
                      "cause": df[12].fillna("").str.strip(), "month": pd.to_numeric(df[13], errors="coerce"),
                      "indemnity": pd.to_numeric(df[28], errors="coerce").fillna(0.0),
                      "policies_indemnified": pd.to_numeric(df[17], errors="coerce").fillna(0)})
    d = d[d["commodity"].isin(RMA_COMMODITIES) & (d["year"] == y)]
    d = d.assign(group=[_cause_group(c, m) for c, m in zip(d["cause"], d["month"])])
    d = d[d["group"].notna()]
    out = d.groupby(["year", "state", "county", "commodity", "group"], as_index=False).agg(
        indemnity=("indemnity", "sum"), policies_indemnified=("policies_indemnified", "sum"),
        causes=("cause", lambda s: "|".join(sorted(set(s)))))
    return out


def _sob_year(y: int, raw: Path) -> pd.DataFrame:
    df = _read_zip(raw)
    df = df.iloc[:, :28]
    df.columns = list(range(28))
    d = pd.DataFrame({"year": pd.to_numeric(df[0], errors="coerce"), "state": df[1].str.strip().str.zfill(2),
                      "county": df[3].str.strip().str.zfill(3), "commodity": _commodity(df[6]),
                      "qty_type": df[17].str.strip(), "acres": pd.to_numeric(df[18], errors="coerce").fillna(0.0),
                      "indemnity_all": pd.to_numeric(df[26], errors="coerce").fillna(0.0)})
    d = d[d["commodity"].isin(RMA_COMMODITIES) & (d["qty_type"] == "Acres") & (d["year"] == y)]
    return d.groupby(["year", "state", "county", "commodity"], as_index=False).agg(
        insured_acres=("acres", "sum"), indemnity_all_causes=("indemnity_all", "sum"))


def build_rma(years: list[int] | None = None, log=print) -> dict:
    """Download, parse and aggregate the RMA files for `years` (default: last 20 complete commodity years).
    Writes data/cache/rma/col_YYYY.parquet and sob_YYYY.parquet (one small file per year), deletes the zips."""
    RMA_DIR.mkdir(parents=True, exist_ok=True)
    raw_dir = RMA_DIR / "raw"
    raw_dir.mkdir(exist_ok=True)
    status = {}
    for y in years or _years():
        for kind, url, fn in (("col", COL_URL, _col_year), ("sob", SOB_URL, _sob_year)):
            out = RMA_DIR / f"{kind}_{y}.parquet"
            if out.exists():
                status[f"{kind}_{y}"] = "cached"
                continue
            zp = raw_dir / f"{kind}_{y}.zip"
            t0 = time.time()
            try:
                if not zp.exists():
                    _download(url.format(y=y), zp)
                fn(y, zp).to_parquet(out)
                status[f"{kind}_{y}"] = f"ok {time.time() - t0:.0f}s"
            except requests.HTTPError as e:
                status[f"{kind}_{y}"] = f"HTTP {e.response.status_code if e.response is not None else '?'}"
            except Exception as e:  # noqa: BLE001 - reported, never filled in
                status[f"{kind}_{y}"] = f"{type(e).__name__}: {str(e)[:120]}"
            finally:
                if zp.exists() and out.exists():
                    zp.unlink()
            log(f"{kind} {y}: {status[f'{kind}_{y}']}")
    meta = {"retrieved": datetime.now(timezone.utc).isoformat(timespec="seconds"), "status": status,
            "years": years or _years(), "commodities": RMA_COMMODITIES}
    (RMA_DIR / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return meta


def _load(kind: str, years: list[int], fips: str | None = None) -> tuple[pd.DataFrame, list[int]]:
    """All-county yearly tables, or (with `fips`) one county, cached as data/cache/rma/county/<kind>_<fips>.parquet."""
    if fips:
        cp = RMA_DIR / "county" / f"{kind}_{fips}_{years[0]}_{years[-1]}.parquet"
        if cp.exists() and cp.with_suffix(".json").exists():
            return pd.read_parquet(cp), json.loads(cp.with_suffix(".json").read_text(encoding="utf-8"))["have"]
    frames, have = [], []
    for y in years:
        p = RMA_DIR / f"{kind}_{y}.parquet"
        if p.exists():
            d = pd.read_parquet(p)
            if fips:
                d = d[(d["state"] == fips[:2]) & (d["county"] == fips[2:])]
            frames.append(d)
            have.append(y)
    out = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if fips and len(have) == len(years):
        cp.parent.mkdir(parents=True, exist_ok=True)
        out.to_parquet(cp)
        cp.with_suffix(".json").write_text(json.dumps({"have": have}), encoding="utf-8")
    return out, have


def _cache_off() -> bool:
    """Test flag: FS_HAZARD_CACHE_OFF=1 makes the reader ignore data/cache/rma and data/cache/fema (the files stay)."""
    return os.getenv("FS_HAZARD_CACHE_OFF", "").strip().lower() in ("1", "true", "yes")


def _precomputed(fips: str) -> dict | None:
    p = PRECOMP / f"hazards_{fips}.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 - a broken file falls through to the cache / live fetch
            return None
    return None


def _commodity_summary(col: pd.DataFrame, sob: pd.DataFrame, yrs: list[int], com: str) -> dict | None:
    acres = sob[sob["commodity"] == com].groupby("year")["insured_acres"].sum()
    ins_years = [int(y) for y in yrs if acres.get(y, 0) > 0]
    if not ins_years:
        return None
    n = len(ins_years)
    c = col[(col["commodity"] == com) & col["year"].isin(ins_years)]
    rows = []
    for grp, g in c.groupby("group"):
        per_year = g.groupby("year")["indemnity"].sum()
        per_ac = (per_year / acres.reindex(per_year.index)).replace([np.inf, -np.inf], np.nan).dropna()
        hit = per_ac[per_ac > 0]
        if hit.empty:
            continue
        rows.append({"cause_id": grp, "rma_causes": sorted({x.strip('"`') for s in g["causes"] for x in s.split("|") if x}),
                     "years_hit": int(len(hit)), "years": n, "p": round(len(hit) / n, 3), "last": int(hit.index.max()),
                     "avg_loss_usd_ac_when_hit": round(float(hit.mean()), 2),
                     "mean_loss_usd_ac": round(float(hit.sum() / n), 2),
                     "worst_usd_ac": round(float(hit.max()), 2), "worst_year": int(hit.idxmax())})
    rows.sort(key=lambda r: -r["mean_loss_usd_ac"])
    return {"insured_years": n, "insured_acres_median": round(float(acres.loc[ins_years].median())),
            "years": [ins_years[0], ins_years[-1]], "rows": rows}


def county_rma_summary(county_fips: str, allow_download: bool = False) -> dict:
    """Per RMA commodity (those FarmSmart simulates) with insured acres in the county: cause-group rows.
    Built from the cached yearly tables (data/cache/rma), downloading them first when allowed."""
    if _cache_off():
        return {"available": False, "reason": "RMA cache ignored (FS_HAZARD_CACHE_OFF) and no precomputed summary"}
    years = _years()
    fips = str(county_fips).zfill(5)
    col, have_c = _load("col", years, fips)
    sob, have_s = _load("sob", years, fips)
    if (len(have_c) < len(years) or len(have_s) < len(years)) and allow_download:
        build_rma(years, log=lambda *_: None)
        col, have_c = _load("col", years, fips)
        sob, have_s = _load("sob", years, fips)
    yrs = sorted(set(have_c) & set(have_s))
    if not yrs:
        return {"available": False, "reason": "USDA RMA Cause of Loss files are not downloaded on this server yet "
                                               "(run scripts/precompute_hazards.py)."}
    col = col[(col["state"] == fips[:2]) & (col["county"] == fips[2:]) & col["year"].isin(yrs)]
    sob = sob[(sob["state"] == fips[:2]) & (sob["county"] == fips[2:]) & sob["year"].isin(yrs)]
    coms = {}
    for com in RMA_COMMODITIES:
        sm = _commodity_summary(col, sob, yrs, com)
        if sm:
            coms[com] = sm
    return {"available": True, "county_fips": fips, "years": [yrs[0], yrs[-1]], "n_years": len(yrs), "commodities": coms}


def insured_losses(county_fips: str | None, crops: list[str], county_name: str | None = None,
                   allow_download: bool = False) -> dict:
    """Per crop and cause group: years with an insurance payout, share of years, payout per insured acre.
    Payout per insured acre in a year = that cause's county indemnity / all insured acres of the crop that year.
    Reads data/precomputed/hazards_<fips>.json first (committed, pilot counties), then data/cache/rma, then
    downloads the RMA files when allow_download."""
    if not county_fips:
        return {"available": False, "reason": "No US county known for this field (USDA crop-insurance records are kept by county)."}
    fips = str(county_fips).zfill(5)
    pre = (_precomputed(fips) or {}).get("insured_losses")
    if pre and pre.get("available"):
        sm, origin = pre, "precomputed"
    else:
        sm, origin = county_rma_summary(fips, allow_download), "cache"
    if not sm.get("available"):
        return {"available": False, "reason": sm.get("reason")}
    rows, crops_out, notes = [], [], []
    seen = set()
    for cid in crops:
        com = CROP_TO_RMA.get(cid)
        if not com:
            notes.append(f"No USDA crop-insurance commodity for '{cid}'.")
            continue
        if com in seen:
            continue
        seen.add(com)
        cs = sm["commodities"].get(com)
        if not cs:
            crops_out.append({"crop": cid, "commodity": com, "insured_years": 0,
                              "note": "No insured acres of this crop in this county in these years."})
            continue
        crops_out.append({"crop": cid, "commodity": com,
                          **{k: cs[k] for k in ("insured_years", "insured_acres_median", "years")}})
        for r in cs["rows"]:
            meta = GROUPS.get(r["cause_id"]) or GROUPS["other"]
            rows.append({"crop": cid, "commodity": com, "cause_id": r["cause_id"], "cause": meta[0],
                         "cause_es": meta[1], "in_simulation": bool(meta[2]),
                         **{k: v for k, v in r.items() if k != "cause_id"}})
    rows.sort(key=lambda r: (r["crop"], -r["mean_loss_usd_ac"]))
    return {"available": True, "county_fips": fips, "county": county_name,
            "years": sm["years"], "n_years": sm["n_years"], "crops": crops_out, "rows": rows, "notes": notes,
            "from": origin,
            "method": "For each crop and cause: a year is 'hit' when the county's insurance indemnity for that cause "
                      "was above zero. Loss per acre = that year's indemnity for the cause / all insured acres of the "
                      "crop in the county that year (nominal dollars; irrigated and dryland practices together). "
                      "Payouts cover losses beyond the deductible only, so real losses were larger; price declines "
                      "and area-plan endorsements are not counted.",
            "in_simulation_note": "Drought, heat and frost during the season are weather the yield simulation already "
                                  "runs through; add only the causes with in_simulation false to avoid counting twice.",
            "scale": "county records (USDA crop insurance), not your field",
            "source": "USDA RMA", "is_nasa": False, "citation": RMA_CITATION, "licence": "Public domain (USDA)",
            "url": "https://www.rma.usda.gov/tools-reports/summary-of-business/cause-loss"}


FEMA_WEATHER = {"Severe Storm", "Flood", "Drought", "Fire", "Hurricane", "Tornado", "Snowstorm", "Severe Ice Storm",
                "Winter Storm", "Coastal Storm", "Freezing", "Typhoon", "Tropical Storm", "Mud/Landslide", "Earthquake",
                "Volcanic Eruption", "Tsunami", "Dam/Levee Break", "Straight-Line Winds"}


def declarations(county_fips: str | None, n_years: int = N_YEARS, live: bool = False) -> dict:
    """FEMA declared disasters for the county (and statewide declarations) in the last `n_years`, by incident
    type, one count per disaster number. Reads data/precomputed/hazards_<fips>.json first (pilot counties; skipped
    when live=True), then data/cache/fema/ (30 days), then the OpenFEMA API."""
    if not county_fips:
        return {"available": False, "reason": "No US county known for this field."}
    fips = str(county_fips).zfill(5)
    pre = None if live else (_precomputed(fips) or {}).get("declarations")
    if pre and pre.get("available"):
        return {**pre, "from": "precomputed"}
    st, co = fips[:2], fips[2:]
    since = date(date.today().year - n_years, 1, 1)
    cdir = CACHE / "fema"
    cdir.mkdir(parents=True, exist_ok=True)
    cp = cdir / f"{fips}_{since.year}.json"
    origin = "cache"
    if cp.exists() and not _cache_off() and not live and time.time() - cp.stat().st_mtime < 30 * 86400:
        recs = json.loads(cp.read_text(encoding="utf-8"))
    else:
        origin = "live"
        try:
            r = requests.get(FEMA_URL, timeout=60, headers={"User-Agent": USER_AGENT}, params={
                "$filter": f"fipsStateCode eq '{st}' and (fipsCountyCode eq '{co}' or fipsCountyCode eq '000') "
                           f"and declarationDate ge '{since.isoformat()}T00:00:00.000Z'",
                "$select": "disasterNumber,declarationType,declarationDate,incidentType,declarationTitle,"
                           "incidentBeginDate,designatedArea,fipsCountyCode",
                "$top": 1000})
            r.raise_for_status()
            recs = r.json().get("DisasterDeclarationsSummaries") or []
        except requests.HTTPError as e:
            code = e.response.status_code if e.response is not None else "?"
            return {"available": False, "reason": f"OpenFEMA API returned HTTP {code}"}
        except Exception as e:  # noqa: BLE001
            return {"available": False, "reason": f"OpenFEMA API unreachable: {type(e).__name__}"}
        cp.write_text(json.dumps(recs), encoding="utf-8")
    by_num: dict[int, dict] = {}
    for x in sorted(recs, key=lambda x: x.get("fipsCountyCode") == "000"):  # county row wins over statewide
        by_num.setdefault(int(x["disasterNumber"]), x)
    items = sorted(({"disaster_number": k, "type": v.get("incidentType"), "declaration": v.get("declarationType"),
                     "date": (v.get("declarationDate") or "")[:10], "year": int((v.get("declarationDate") or "0000")[:4]),
                     "title": (v.get("declarationTitle") or "").title(),
                     "area": "statewide" if v.get("fipsCountyCode") == "000" else "county",
                     "weather_related": v.get("incidentType") in FEMA_WEATHER}
                    for k, v in by_num.items()), key=lambda x: x["date"], reverse=True)
    by_type: dict[str, dict] = {}
    for it in items:
        t = by_type.setdefault(it["type"], {"type": it["type"], "count": 0, "years": set(), "last": None,
                                            "weather_related": it["weather_related"]})
        t["count"] += 1
        t["years"].add(it["year"])
        t["last"] = max(t["last"] or 0, it["year"])
    types = sorted(({**v, "years_with": len(v["years"]), "years": sorted(v["years"])} for v in by_type.values()),
                   key=lambda v: -v["count"])
    return {"available": True, "county_fips": fips, "since": since.isoformat(), "n_years": n_years,
            "total": len(items), "by_type": types, "items": items, "from": origin,
            "retrieved": datetime.fromtimestamp(cp.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
            "note": "Federal disaster declarations (Presidential major disasters DR, emergencies EM, fire management "
                    "FM) that covered this county or the whole state; each disaster counted once. A declaration "
                    "means a large event hit the area, not that this field was damaged.",
            "scale": "county or state declaration, not your field", "source": "FEMA (OpenFEMA)", "is_nasa": False,
            "citation": FEMA_CITATION, "licence": "Public (U.S. Government work; OpenFEMA terms of use)",
            "url": "https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2"}


def write_precomputed(county_fips: str, county_name: str | None = None) -> Path:
    """Committed per-county summary for the pilot counties, so a deploy without network at build time still has
    the record: data/precomputed/hazards_<fips>.json = RMA cause-group rows per commodity + FEMA declarations
    (only the summarised values the API returns)."""
    fips = str(county_fips).zfill(5)
    il = county_rma_summary(fips, allow_download=True)
    de = declarations(fips, live=True)
    js = {"county_fips": fips, "county": county_name,
          "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
          "note": "Summaries of USDA RMA Cause of Loss / Summary of Business files and OpenFEMA declarations, written by "
                  "scripts/precompute_hazards.py. The API reads this file before data/cache.",
          "insured_losses": il, "declarations": {k: v for k, v in de.items() if k != "from"}}
    out = PRECOMP / f"hazards_{fips}.json"
    out.write_text(json.dumps(js, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return out
