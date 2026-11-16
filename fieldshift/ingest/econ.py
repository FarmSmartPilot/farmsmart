"""M8 economics inputs: USDA ERS Commodity Costs and Returns + World Bank Pink Sheet monthly prices.

All values come from the downloaded files. Links are scraped from the publishers' landing pages so a new
release is picked up automatically. Offline fallback: the compact committed JSON in data/reference/.

Public API
    ers_costs()               tidy DataFrame (commodity, region, year, item, item_label, value, units, ...)
    wb_prices()               tidy DataFrame (series, date, value, units)
    region_for(statefips)     dominant ERS Farm Resource Region of a state (by county count)
    region_for_county(fips5)  exact ERS region of a county
    crop_economics(crop_id, region)
    price_ensemble(crop_id)
"""
from __future__ import annotations

import io
import json
import re
import time
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd

from ..config import CACHE, DATA, http

REF = DATA / "reference"
RAW = CACHE / "econ_raw"

# ---------------------------------------------------------------- ERS Costs and Returns
ERS_BASE = "https://www.ers.usda.gov"
ERS_LANDING = f"{ERS_BASE}/data-products/commodity-costs-and-returns"
ERS_REGLINK = f"{ERS_BASE}/sites/default/files/images/reglink.xls"
ERS_COMMODITIES = ["corn", "soybeans", "wheat", "sorghum", "oats", "barley", "cotton", "rice", "peanuts"]
ERS_ITEMS = {  # ERS "Item" (stripped) -> our key
    "Total, operating costs": "operating_cost",
    "Total, allocated overhead": "overhead",
    "Yield": "yield",
    "Price": "price",  # harvest-period price
    "Total, gross value of production": "gross_value",
}
SUMMARY_REGIONS = {"Heartland", "Prairie Gateway", "Northern Great Plains", "Fruitful Rim", "U.S. total"}
ERS_CITATION = ("USDA Economic Research Service, Commodity Costs and Returns. "
                "https://www.ers.usda.gov/data-products/commodity-costs-and-returns")
ERS_REGION_CODES = {1: "Heartland", 2: "Northern Crescent", 3: "Northern Great Plains", 4: "Prairie Gateway",
                    5: "Eastern Uplands", 6: "Southern Seaboard", 7: "Fruitful Rim", 8: "Basin and Range",
                    9: "Mississippi Portal"}

# FarmSmart crop id -> ERS commodity file
CROP_TO_ERS = {"corn": "corn", "soybean": "soybeans", "winter_wheat": "wheat", "spring_wheat": "wheat",
               "durum": "wheat", "sorghum": "sorghum", "oats": "oats", "barley": "barley", "cotton": "cotton",
               "rice": "rice", "peanut": "peanuts", "peanuts": "peanuts"}


def _ers_links() -> dict[str, str]:
    html = http().get(ERS_LANDING, timeout=60).text
    out = {}
    for m in re.finditer(r'href="(/media/\d+/([a-z-]+)\.csv[^"]*)"', html):
        out.setdefault(m.group(2), ERS_BASE + m.group(1))
    return out


def ers_costs(refresh: bool = False) -> pd.DataFrame:
    """All ERS cost-and-return rows for the 9 field crops (all items), tidy. Cached to data/cache/ers_costs.parquet."""
    pq = CACHE / "ers_costs.parquet"
    if pq.exists() and not refresh:
        return pd.read_parquet(pq)
    links = _ers_links()
    frames = []
    for c in ERS_COMMODITIES:
        if c not in links:
            continue
        r = http().get(links[c], timeout=120)
        r.raise_for_status()
        d = pd.read_csv(io.BytesIO(r.content))
        d["source_url"] = links[c]
        frames.append(d)
    if not frames:
        raise RuntimeError("no ERS CSV links found on the landing page")
    df = pd.concat(frames, ignore_index=True)
    df["Item"] = df["Item"].astype(str).str.strip()
    out = pd.DataFrame({
        "commodity": df["Commodity"].astype(str).str.strip().str.lower(),
        "file": df["source_url"].str.extract(r"/([a-z-]+)\.csv")[0],
        "region": df["Region"].astype(str).str.strip(),
        "year": df["Year"].astype(int),
        "category": df["Category"].astype(str).str.strip(),
        "item_label": df["Item"],
        "item": df["Item"].map(ERS_ITEMS),
        "value": pd.to_numeric(df["Value"], errors="coerce"),
        "units": df["Units"].astype(str).str.strip(),
        "survey_base": df["Survey base year"].astype(str),
        "source_url": df["source_url"],
    })
    out.to_parquet(pq)
    return out


def write_ers_summary(df: pd.DataFrame | None = None, years: int = 10) -> dict:
    """Compact committed JSON: last `years` years, five key items. Keeps the ERS summary regions plus any
    crop-specific ERS regions (rice and peanuts use their own region names)."""
    df = ers_costs() if df is None else df
    d = df[df["item"].notna()].copy()
    last = int(d["year"].max())
    d = d[d["year"] > last - years]
    data: dict[str, Any] = {}
    for (f, reg, item), g in d.groupby(["file", "region", "item"]):
        g = g.sort_values("year")
        data.setdefault(f, {}).setdefault(reg, {})[item] = {
            "units": g["units"].iloc[0], "years": g["year"].tolist(), "values": [round(float(v), 4) for v in g["value"]]}
    js = {"meta": {"source": "USDA ERS", "product": "Commodity Costs and Returns (annual, per planted acre)",
                   "url": ERS_LANDING, "citation": ERS_CITATION, "licence": "Public domain (USDA)",
                   "years": [last - years + 1, last], "retrieved": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "files": sorted(df["source_url"].unique().tolist()),
                   "items": ERS_ITEMS, "summary_regions": sorted(SUMMARY_REGIONS)},
          "data": data}
    REF.mkdir(parents=True, exist_ok=True)
    (REF / "ers_costs_summary.json").write_text(json.dumps(js, separators=(",", ":")), encoding="utf-8")
    return js


@lru_cache(maxsize=1)
def _ers_key_items() -> pd.DataFrame:
    """Five key items, from the parquet/online source, else the committed JSON summary."""
    try:
        d = ers_costs()
        return d[d["item"].notna()][["file", "region", "year", "item", "value", "units", "source_url"]]
    except Exception as e:  # offline
        p = REF / "ers_costs_summary.json"
        if not p.exists():
            raise RuntimeError(f"ERS data unavailable offline and online ({e})")
        js = json.loads(p.read_text(encoding="utf-8"))
        rows = [dict(file=f, region=r, year=y, item=i, value=v, units=s["units"], source_url=js["meta"]["url"])
                for f, regs in js["data"].items() for r, items in regs.items() for i, s in items.items()
                for y, v in zip(s["years"], s["values"])]
        out = pd.DataFrame(rows)
        out.attrs["offline"] = True
        return out


# ---------------------------------------------------------------- ERS line items (money calculator)
# FarmSmart cost-line id -> (ERS item names, EN label, ES label). Operating lines sum to ERS "Total, operating
# costs"; overhead lines sum to "Total, allocated overhead" (per planted acre).
ERS_LINES = {
    "operating": {
        "seed": (["Seed"], "Seed", "Semilla"),
        "fertilizer": (["Fertilizer"], "Fertilizer", "Fertilizante"),
        "chemicals": (["Chemicals"], "Chemicals (herbicides, insecticides, fungicides)", "Agroquímicos (herbicidas, insecticidas, fungicidas)"),
        "custom": (["Custom services"], "Custom services (hired field work)", "Servicios contratados (labores de campo)"),
        "fuel": (["Fuel, lube, and electricity"], "Fuel, lube and electricity", "Combustible, lubricantes y electricidad"),
        "repairs": (["Repairs"], "Repairs", "Reparaciones"),
        "irrigation_water": (["Purchased irrigation water"], "Purchased irrigation water", "Agua de riego comprada"),
        "interest": (["Interest on operating capital", "Interest on operating inputs"], "Interest on operating capital",
                     "Intereses del capital operativo"),
        "other": (["Commercial drying", "Ginning", "Other variable expenses"], "Other operating costs (drying, ginning, other)",
                  "Otros costos operativos (secado, desmotado, otros)"),
    },
    "overhead": {
        "land": (["Opportunity cost of land"], "Land (rent or what it could rent for)", "Tierra (renta o lo que podría rentarse)"),
        "machinery": (["Capital recovery of machinery and equipment"], "Machinery and equipment ownership",
                      "Propiedad de maquinaria y equipo"),
        "labor": (["Opportunity cost of unpaid labor", "Hired labor"], "Your own and hired labour", "Mano de obra propia y contratada"),
        "general": (["General farm overhead", "Taxes and insurance"], "General overhead, taxes and insurance",
                    "Gastos generales, impuestos y seguros"),
    },
}
ERS_ITEMS_YEARS = 5


def write_ers_items_summary(df: pd.DataFrame | None = None, years: int = ERS_ITEMS_YEARS) -> dict:
    """Committed reference data: ERS cost line items (grouped into FarmSmart line ids) per commodity file and
    region, last `years` years, with the median. data/reference/ers_items_summary.json."""
    df = ers_costs() if df is None else df
    last = int(df["year"].max())
    d = df[(df["year"] > last - years) & df["category"].isin(["Operating costs", "Allocated overhead"])]
    data: dict[str, Any] = {}
    for (f, reg), g in d.groupby(["file", "region"]):
        w = g.pivot_table(index="year", columns="item_label", values="value", aggfunc="first").sort_index()
        yrs = [int(y) for y in w.index]
        ent: dict[str, Any] = {"years": yrs}
        for grp, total in (("operating", "Total, operating costs"), ("overhead", "Total, allocated overhead")):
            lines = []
            for lid, (names, _, _) in ERS_LINES[grp].items():
                have = [n for n in names if n in w.columns]
                if not have:
                    continue
                v = w[have].sum(axis=1, min_count=1)
                if v.notna().sum() == 0:
                    continue
                lines.append({"id": lid, "ers_items": have, "values": [None if pd.isna(x) else round(float(x), 2) for x in v],
                              "median": round(float(v.median()), 2)})
            ent[grp] = lines
            if total in w.columns:
                ent[grp + "_total"] = {"values": [None if pd.isna(x) else round(float(x), 2) for x in w[total]],
                                       "median": round(float(w[total].median()), 2)}
        data.setdefault(f, {})[reg] = ent
    js = {"meta": {"source": "USDA ERS", "product": "Commodity Costs and Returns, cost line items (per planted acre)",
                   "url": ERS_LANDING, "citation": ERS_CITATION, "licence": "Public domain (USDA)",
                   "years": [last - years + 1, last], "statistic": f"{years}-year median of each line",
                   "retrieved": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "files": sorted(df["source_url"].unique().tolist()),
                   "lines": {grp: {k: {"ers_items": v[0], "label_en": v[1], "label_es": v[2]} for k, v in L.items()}
                             for grp, L in ERS_LINES.items()},
                   "note": "Each line is the median of its own yearly values, so the lines add up to within a few "
                           "dollars of the median total (the total is kept as operating_total / overhead_total)."},
          "data": data}
    REF.mkdir(parents=True, exist_ok=True)
    (REF / "ers_items_summary.json").write_text(json.dumps(js, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return js


@lru_cache(maxsize=1)
def _ers_items_ref() -> dict:
    p = REF / "ers_items_summary.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return write_ers_items_summary()


def ers_line_items(crop_id: str, region: str = "U.S. total") -> dict:
    """ERS cost lines for one crop and region: operating lines (`costs`) and allocated overhead (`overhead`), each a
    5-year median per planted acre with EN/ES labels and ERS's own item names. Same region fallback as
    crop_economics (U.S. total when ERS does not report the crop in that region)."""
    f = CROP_TO_ERS.get(crop_id)
    if f is None:
        from . import ground_econ as G  # crops ERS does not survey (sunflower): state extension budget lines
        if G.covers(crop_id):
            return G.line_items(crop_id, region)
        return {"available": False, "crop_id": crop_id,
                "reason": f"USDA ERS Costs and Returns does not cover '{crop_id}'."}
    js = _ers_items_ref()
    regs = js["data"].get(f) or {}
    used = region if region in regs else "U.S. total"
    ent = regs.get(used)
    if not ent:
        return {"available": False, "crop_id": crop_id, "reason": f"no ERS line items for {f} / {used}"}
    meta = js["meta"]

    def lines(grp):
        L = ERS_LINES[grp]
        return [{"id": x["id"], "label_en": L[x["id"]][1], "label_es": L[x["id"]][2], "usd_ac": x["median"],
                 "ers_items": x["ers_items"], "values": x["values"]} for x in ent.get(grp, [])]
    y0, y1 = ent["years"][0], ent["years"][-1]
    notes = []
    if used != region:
        notes.append(f"ERS does not report {f} for '{region}'; showing U.S. total.")
    if crop_id in ("spring_wheat", "durum", "winter_wheat"):
        notes.append("ERS reports all wheat classes together; values are not class-specific.")
    return {"available": True, "crop_id": crop_id, "ers_commodity": f, "region": used, "region_requested": region,
            "years": ent["years"], "cost_years": f"{y0}–{y1} median", "costs": lines("operating"),
            "overhead": lines("overhead"),
            "operating_total_usd_ac": (ent.get("operating_total") or {}).get("median"),
            "overhead_total_usd_ac": (ent.get("overhead_total") or {}).get("median"), "notes": notes,
            "evidence": {"source_id": "ers", "source": "USDA ERS", "product": "Commodity Costs and Returns (line items)",
                         "is_nasa": False, "years": [y0, y1], "region": used,
                         "scale": "USDA regional average per planted acre, not your farm", "url": meta["url"],
                         "citation": meta["citation"], "licence": meta["licence"], "statistic": meta["statistic"]}}


# ---------------------------------------------------------------- ERS Farm Resource Regions
@lru_cache(maxsize=1)
def _reglink() -> pd.DataFrame:
    """County FIPS -> ERS region (ERS reglink.xls). Cached as parquet; committed JSON summary as fallback."""
    pq = CACHE / "ers_reglink.parquet"
    if pq.exists():
        return pd.read_parquet(pq)
    r = http().get(ERS_REGLINK, timeout=60)
    r.raise_for_status()
    raw = pd.read_excel(io.BytesIO(r.content), header=None, engine="xlrd")
    d = raw.iloc[3:, :2].dropna()
    d.columns = ["fips", "code"]
    d = d[pd.to_numeric(d["fips"], errors="coerce").notna()]
    d["fips"] = d["fips"].astype(int).astype(str).str.zfill(5)
    d["code"] = d["code"].astype(int)
    d["region"] = d["code"].map(ERS_REGION_CODES)
    d = d.reset_index(drop=True)
    d.to_parquet(pq)
    return d


def write_state_regions() -> dict:
    """Committed state -> region shares (by county count), so region_for works offline."""
    d = _reglink().assign(state=lambda x: x["fips"].str[:2])
    out = {}
    for st, g in d.groupby("state"):
        sh = g["region"].value_counts(normalize=True)
        out[st] = {"dominant": sh.index[0], "shares": {k: round(float(v), 3) for k, v in sh.items()},
                   "n_counties": int(len(g))}
    js = {"meta": {"source": "USDA ERS", "product": "Farm Resource Regions county link (reglink.xls)",
                   "url": ERS_REGLINK, "method": "dominant region = region holding most counties in the state",
                   "licence": "Public domain (USDA)"}, "states": out}
    REF.mkdir(parents=True, exist_ok=True)
    (REF / "ers_regions_state.json").write_text(json.dumps(js, separators=(",", ":")), encoding="utf-8")
    return js


@lru_cache(maxsize=1)
def _state_regions() -> dict:
    p = REF / "ers_regions_state.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))["states"]
    return write_state_regions()["states"]


def region_for(statefips: str) -> str:
    """Dominant ERS Farm Resource Region for a state (2-digit FIPS). A state can span several regions:
    this returns the one holding the most counties (see region_detail for the shares; use
    region_for_county for an exact answer)."""
    st = str(statefips).zfill(2)[:2]
    info = _state_regions().get(st)
    if not info:
        raise KeyError(f"no ERS region for state FIPS {st}")
    return info["dominant"]


def region_detail(statefips: str) -> dict:
    st = str(statefips).zfill(2)[:2]
    info = dict(_state_regions().get(st) or {})
    if info:
        info["note"] = ("Dominant region by county count; the state spans " + ", ".join(info["shares"]))
    return info


def region_for_county(fips5: str) -> str | None:
    d = _reglink()
    m = d.loc[d["fips"] == str(fips5).zfill(5), "region"]
    return None if m.empty else str(m.iloc[0])


# ---------------------------------------------------------------- crop economics
def _dist(years: list[int], vals: list[float]) -> dict:
    a = np.asarray(vals, float)
    return {"years": years, "values": [round(float(v), 2) for v in a], "n": int(a.size),
            "mean": round(float(a.mean()), 2), "min": round(float(a.min()), 2), "max": round(float(a.max()), 2),
            "p10": round(float(np.percentile(a, 10)), 2), "p50": round(float(np.percentile(a, 50)), 2),
            "p90": round(float(np.percentile(a, 90)), 2), "sd": round(float(a.std(ddof=1)), 2) if a.size > 1 else None}


def ers_price_window() -> tuple[int, int]:
    """First and last year of the ERS last-10 price window (the paired price years of the comparison)."""
    y1 = int(_ers_key_items()["year"].max())
    return y1 - 9, y1


def crop_economics(crop_id: str, region: str = "U.S. total", fips: str | None = None) -> dict | None:
    """Last-5 and last-10-year distributions of yield, harvest price, operating cost, allocated overhead and
    net returns for one crop in one ERS region (per planted acre). Falls back to U.S. total when ERS does not
    report the crop in that region. Crops ERS does not survey but ground_econ covers (sunflower) come from a state
    extension budget and USDA NASS prices and yields for the field's county/state (`fips`), in the same shape.
    Returns {"value": None, "reason": ...} for crops neither covers."""
    f = CROP_TO_ERS.get(crop_id)
    if f is None:
        from . import ground_econ as G
        if G.covers(crop_id):
            return G.crop_economics(crop_id, fips, ers_price_window())
        return {"value": None, "crop_id": crop_id,
                "reason": f"USDA ERS Costs and Returns does not cover '{crop_id}' (covered: corn, soybeans, wheat, "
                          "sorghum, oats, barley, cotton, rice, peanuts)."}
    d = _ers_key_items()
    d = d[d["file"] == f]
    notes = []
    if crop_id in ("spring_wheat", "durum", "winter_wheat"):
        notes.append("ERS reports all wheat classes together; values are not class-specific.")
    used = region
    if region not in set(d["region"]):
        used = "U.S. total"
        notes.append(f"ERS does not report {f} for '{region}'; showing U.S. total. "
                     f"ERS regions for {f}: {', '.join(sorted(set(d['region'])))}.")
    d = d[d["region"] == used]
    wide = d.pivot_table(index="year", columns="item", values="value", aggfunc="first").sort_index()
    wide = wide.dropna(subset=["gross_value", "operating_cost", "overhead"])
    if wide.empty:
        return {"value": None, "crop_id": crop_id, "reason": f"no ERS rows for {f} / {used}"}
    units = d.groupby("item")["units"].first().to_dict()
    wide["net_return_total"] = wide["gross_value"] - wide["operating_cost"] - wide["overhead"]
    wide["net_return_operating"] = wide["gross_value"] - wide["operating_cost"]
    units["net_return_total"] = "dollars per planted acre (gross value - operating - allocated overhead)"
    units["net_return_operating"] = "dollars per planted acre (gross value - operating costs)"
    keys = ["yield", "price", "gross_value", "operating_cost", "overhead", "net_return_total", "net_return_operating"]
    out: dict[str, Any] = {"crop_id": crop_id, "ers_commodity": f, "region": used, "region_requested": region,
                           "units": {k: units.get(k) for k in keys}, "notes": notes}
    for n in (5, 10):
        w = wide.tail(n)
        out[f"last{n}"] = {k: _dist([int(y) for y in w.index], w[k].tolist()) for k in keys if k in w}
    yrs = [int(wide.index.min()), int(wide.index.max())]
    out["latest_year"] = yrs[1]
    out["evidence"] = {"source": "USDA ERS", "product": "Commodity Costs and Returns", "is_nasa": False,
                       "years": [int(wide.tail(10).index.min()), yrs[1]], "region": used,
                       "scale": "ERS farm resource region average (not field-specific)",
                       "url": str(d["source_url"].iloc[0]), "citation": ERS_CITATION, "licence": "Public domain (USDA)",
                       "offline_fallback": bool(_ers_key_items().attrs.get("offline", False)),
                       "note": "Allocated overhead includes opportunity costs of land and unpaid labour, so "
                               "net_return_total equals ERS 'value of production less total costs listed'."}
    return out


# ---------------------------------------------------------------- World Bank Pink Sheet
WB_LANDING = "https://www.worldbank.org/en/research/commodity-markets"
WB_CITATION = "World Bank Commodity Price Data (The Pink Sheet), CMO Historical Data Monthly. CC BY 4.0."
WB_SERIES = {  # Pink Sheet column header (stripped) -> our key
    "Maize": "maize", "Soybeans": "soybeans", "Wheat, US HRW": "wheat_us_hrw", "Wheat, US SRW": "wheat_us_srw",
    "Sorghum": "sorghum", "Barley": "barley", "Rice, Thai 5%": "rice_thai_5", "Cotton, A Index": "cotton_a_index",
    "Palm oil": "palm_oil", "Rapeseed oil": "rapeseed_oil", "Groundnuts": "groundnuts", "Soybean oil": "soybean_oil",
    "Sunflower oil": "sunflower_oil", "Urea": "urea", "DAP": "dap", "Potassium chloride **": "potassium_chloride",
}
# FarmSmart crop -> (series, note). Physical conversion: t per bushel/cwt/lb from standard weights.
CROP_TO_WB = {
    "corn": ("maize", "US No.2 yellow, FOB US Gulf"), "soybean": ("soybeans", "Soybeans, c.i.f. Rotterdam"),
    "winter_wheat": ("wheat_us_hrw", "US No.1 hard red winter, FOB Gulf"),
    "spring_wheat": ("wheat_us_hrw", "Pink Sheet has no spring-wheat series; HRW used as proxy"),
    "durum": ("wheat_us_hrw", "Pink Sheet has no durum series; HRW used as proxy"),
    "sorghum": ("sorghum", "US No.2 milo yellow, FOB Gulf"), "barley": ("barley", "Barley (see Pink Sheet notes)"),
    "rice": ("rice_thai_5", "Thai 5% broken, milled (world reference, not US rough rice)"),
    "cotton": ("cotton_a_index", "Cotton Outlook 'A Index' (world)"), "peanut": ("groundnuts", "Groundnuts"),
}
# kg per unit for the ERS price unit (standard test weights)
UNIT_KG = {"maize": ("bushel", 25.4012), "sorghum": ("bushel", 25.4012), "soybeans": ("bushel", 27.2155),
           "wheat_us_hrw": ("bushel", 27.2155), "wheat_us_srw": ("bushel", 27.2155), "barley": ("bushel", 21.7724),
           "cotton_a_index": ("pound", 0.453592), "groundnuts": ("pound", 0.453592),
           "rice_thai_5": ("hundredweight", 45.3592)}


def _wb_link() -> str:
    html = http().get(WB_LANDING, timeout=60).text
    m = re.search(r'https?://[^"\s]+CMO-Historical-Data-Monthly\.xlsx', html)
    if not m:
        raise RuntimeError("CMO-Historical-Data-Monthly.xlsx link not found on the World Bank page")
    return m.group(0)


def wb_prices(refresh: bool = False, start: int = 2000) -> pd.DataFrame:
    """Tidy monthly nominal USD prices (series, date, value, units, label) from 2000. Cached parquet."""
    pq = CACHE / "wb_prices_monthly.parquet"
    if pq.exists() and not refresh:
        return pd.read_parquet(pq)
    url = _wb_link()
    r = http().get(url, timeout=180)
    r.raise_for_status()
    raw = pd.read_excel(io.BytesIO(r.content), sheet_name="Monthly Prices", header=None, engine="openpyxl")
    hdr_row = next(i for i in range(15) if str(raw.iat[i, 1]).strip().startswith("Crude oil"))
    names = [str(x).strip() for x in raw.iloc[hdr_row]]
    units = [str(x).strip() for x in raw.iloc[hdr_row + 1]]
    updated = next((str(raw.iat[i, 0]) for i in range(hdr_row) if "Updated" in str(raw.iat[i, 0])), None)
    body = raw.iloc[hdr_row + 2:]
    dates = pd.to_datetime(body.iloc[:, 0].astype(str).str.replace("M", "-"), format="%Y-%m", errors="coerce")
    rows = []
    for j, n in enumerate(names):
        key = WB_SERIES.get(n) or WB_SERIES.get(n.rstrip(" *").strip())
        if not key:
            continue
        v = pd.to_numeric(body.iloc[:, j], errors="coerce")
        s = pd.DataFrame({"series": key, "label": n, "date": dates, "value": v.values, "units": units[j].strip("()")})
        rows.append(s)
    df = pd.concat(rows, ignore_index=True).dropna(subset=["date", "value"])
    df = df[df["date"].dt.year >= start].reset_index(drop=True)
    df["source_url"] = url
    df["updated"] = updated
    df.to_parquet(pq)
    return df


def write_wb_summary(df: pd.DataFrame | None = None) -> dict:
    df = wb_prices() if df is None else df
    series = {}
    for k, g in df.groupby("series"):
        g = g.sort_values("date")
        idx = pd.period_range(g["date"].min(), g["date"].max(), freq="M")
        s = g.set_index(g["date"].dt.to_period("M"))["value"].reindex(idx)
        series[k] = {"label": g["label"].iloc[0], "units": g["units"].iloc[0], "start": str(idx[0]),
                     "values": [None if pd.isna(v) else round(float(v), 4) for v in s]}
    js = {"meta": {"source": "World Bank", "product": "Commodity Price Data (Pink Sheet), monthly nominal USD",
                   "url": str(df["source_url"].iloc[0]), "landing": WB_LANDING, "updated": df["updated"].iloc[0],
                   "citation": WB_CITATION, "licence": "CC BY 4.0",
                   "retrieved": datetime.now(timezone.utc).isoformat(timespec="seconds")},
          "series": series}
    REF.mkdir(parents=True, exist_ok=True)
    (REF / "wb_prices_monthly.json").write_text(json.dumps(js, separators=(",", ":")), encoding="utf-8")
    return js


@lru_cache(maxsize=16)
def _wb_series(key: str) -> tuple[pd.Series, dict]:
    try:
        df = wb_prices()
        g = df[df["series"] == key].sort_values("date")
        s = pd.Series(g["value"].values, index=g["date"].dt.to_period("M"))
        meta = {"units": g["units"].iloc[0], "label": g["label"].iloc[0], "url": g["source_url"].iloc[0],
                "updated": g["updated"].iloc[0], "offline_fallback": False}
    except Exception:
        js = json.loads((REF / "wb_prices_monthly.json").read_text(encoding="utf-8"))
        e = js["series"][key]
        s = pd.Series(e["values"], index=pd.period_range(e["start"], periods=len(e["values"]), freq="M"), dtype=float)
        meta = {"units": e["units"], "label": e["label"], "url": js["meta"]["url"], "updated": js["meta"]["updated"],
                "offline_fallback": True}
    return s.dropna(), meta


# ---------------------------------------------------------------- price ensemble (M8)
_HW_GRID = np.array(np.meshgrid([0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9], [0.01, 0.05, 0.1, 0.2],
                                [0.01, 0.05, 0.1, 0.2], [0.8, 0.9, 0.95, 0.98])).reshape(4, -1).T


def _holt_winters(y: np.ndarray, horizon: int, params: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Additive damped-trend, additive-seasonal (period 12) exponential smoothing, i.e. ETS(A,Ad,A).
    numpy only: statsmodels' ETS and scipy optimisers are blocked by Windows Application Control on the build
    machine. Parameters (alpha, beta, gamma, phi) are chosen by one-step SSE over a grid (vectorised), or
    fixed when `params` is given. Heuristic initial states from the first two seasons.
    Returns (forecast for steps 1..horizon, chosen params)."""
    P = _HW_GRID if params is None else np.atleast_2d(params)
    a, b_, g, phi = P[:, 0], P[:, 1], P[:, 2], P[:, 3]
    K, n = len(P), len(y)
    l0 = y[:12].mean()
    lvl = np.full(K, l0)
    tr = np.full(K, (y[12:24].mean() - l0) / 12)
    sea = np.tile(y[:12] - l0, (K, 1))
    sse = np.zeros(K)
    for t in range(n):
        j = t % 12
        e = y[t] - (lvl + phi * tr + sea[:, j])
        if t >= 24:
            sse += e * e
        ln = a * (y[t] - sea[:, j]) + (1 - a) * (lvl + phi * tr)
        tr = b_ * (ln - lvl) + (1 - b_) * phi * tr
        sea[:, j] = g * (y[t] - ln) + (1 - g) * sea[:, j]
        lvl = ln
    k = int(np.argmin(sse))
    hs = np.arange(1, horizon + 1)
    damp = np.cumsum(phi[k] ** hs)
    fc = lvl[k] + damp * tr[k] + sea[k, (n - 1 + hs) % 12]
    return fc, P[k]


def _gbm_features(x: np.ndarray, t: int, month: int) -> list[float]:
    f = [x[t] - x[t - k] for k in (1, 2, 3, 6, 9, 12, 24)]
    f += [x[t] - x[t - 24:t + 1].mean(), np.sin(2 * np.pi * month / 12), np.cos(2 * np.pi * month / 12)]
    return f


def price_ensemble(crop_id: str, harvest_months: tuple[int, int, int] = (10, 11, 12),
                   test_years: int = 3, calib_years: int = 5) -> dict:
    """Next-season price distribution (mean nominal price over the next harvest window) from the World Bank
    monthly series. Members (log space, equal weights): seasonal naive, damped additive Holt-Winters ETS(A,Ad,A)
    (numpy, grid-fitted), LightGBM gradient boosting on lagged log returns (direct target). Split-conformal P10/P90 from
    out-of-sample residuals; back-test on the last `test_years` years of origins."""
    import lightgbm as lgb  # sklearn.ensemble's compiled splitter is blocked by Windows Application Control here

    t0 = time.time()
    if crop_id not in CROP_TO_WB:
        return {"value": None, "crop_id": crop_id,
                "reason": f"No World Bank Pink Sheet price series maps to '{crop_id}'."}
    key, series_note = CROP_TO_WB[crop_id]
    s, meta = _wb_series(key)
    age = (pd.Period(datetime.now(timezone.utc).strftime("%Y-%m"), "M") - s.index[-1]).n
    if age > 12:
        return {"value": None, "crop_id": crop_id, "series": key,
                "reason": f"World Bank stopped updating '{meta['label']}' in {s.index[-1]} ({age} months ago); "
                          "no current price series to forecast from. Use the ERS harvest-price history instead."}
    s = s.reindex(pd.period_range(s.index[0], s.index[-1], freq="M"))
    if s.isna().any():
        s = s.interpolate(limit=2).dropna()
    P = s.values.astype(float)
    x = np.log(P)
    per = s.index
    T = len(x) - 1
    last = per[-1]
    # horizon offsets to the next harvest window at least 6 months away
    tgt_year = last.year + 1 if last.month >= harvest_months[0] - 6 else last.year
    h = [(pd.Period(f"{tgt_year}-{m:02d}", "M") - last).n for m in harvest_months]
    hlo, hhi = min(h), max(h)
    W = 180  # ETS fitting window (15 years)

    def snaive(t: int) -> float:
        return float(np.mean([P[t + k - 12 * int(np.ceil(k / 12))] for k in range(hlo, hhi + 1)]))

    def ets(t: int, params: np.ndarray | None) -> tuple[float, np.ndarray]:
        y = x[max(0, t - W + 1):t + 1]
        fc, p = _holt_winters(y, hhi, params)
        return float(np.mean(np.exp(fc[hlo - 1:hhi]))), p

    def target(t: int) -> float:
        return float(np.mean(P[t + hlo:t + hhi + 1]))

    first_origin = 24
    last_complete = T - hhi  # last origin whose target window is observed
    test = list(range(last_complete - 12 * test_years + 1, last_complete + 1))
    calib = list(range(test[0] - 12 * calib_years, test[0]))
    if calib[0] - hhi < first_origin + 36:
        return {"value": None, "crop_id": crop_id, "reason": "series too short for back-test"}

    def train_gbm(upto: int):  # train on origins whose target window ends before `upto`
        idx = [t for t in range(first_origin, upto - hhi)]
        X = [_gbm_features(x, t, per[t].month) for t in idx]
        y = [np.log(target(t)) - x[t] for t in idx]
        g = lgb.LGBMRegressor(n_estimators=150, max_depth=2, num_leaves=4, learning_rate=0.05, subsample=0.8,
                              subsample_freq=1, min_child_samples=10, random_state=0, verbose=-1)
        return g.fit(np.asarray(X), np.asarray(y))

    # back-test: parameters/models fitted only on data before the first calibration origin
    _, ets_params = ets(calib[0] - 1, None)
    gbm = train_gbm(calib[0])
    rec = []
    for t in calib + test:
        sn = snaive(t)
        et, _ = ets(t, ets_params)
        gb = float(np.exp(x[t] + gbm.predict(np.asarray([_gbm_features(x, t, per[t].month)]))[0]))
        ens = float(np.exp(np.mean(np.log([sn, et, gb]))))
        rec.append(dict(t=t, origin=str(per[t]), y=target(t), snaive=sn, ets=et, gbm=gb, ens=ens,
                        split="calib" if t < test[0] else "test"))
    bt = pd.DataFrame(rec)
    bt["r"] = np.log(bt["y"] / bt["ens"])

    def cq(r: np.ndarray, a: float) -> float:  # finite-sample split-conformal quantile
        n = len(r)
        lv = min(1.0, max(0.0, (np.ceil((n + 1) * a) if a > 0.5 else np.floor((n + 1) * a)) / n))
        return float(np.quantile(r, lv))

    cal, tst = bt[bt.split == "calib"], bt[bt.split == "test"]
    lo, hi = cq(cal["r"].values, 0.10), cq(cal["r"].values, 0.90)
    inside = ((tst["y"] >= tst["ens"] * np.exp(lo)) & (tst["y"] <= tst["ens"] * np.exp(hi))).mean()

    def mape(c):
        return round(float((np.abs(tst[c] - tst["y"]) / tst["y"]).mean() * 100), 2)

    metrics = {"test_origins": [str(per[test[0]]), str(per[test[-1]])],
               "n_test": len(tst), "n_calib": len(cal),
               "mape_pct": {"ensemble": mape("ens"), "seasonal_naive": mape("snaive"), "ets": mape("ets"),
                            "gbm": mape("gbm")},
               "mae": round(float((tst["ens"] - tst["y"]).abs().mean()), 2),
               "coverage_p10_p90": round(float(inside), 3), "nominal_coverage": 0.8,
               "note": "Monthly origins overlap, so the 36 test errors are strongly autocorrelated "
                       "(about 3 independent seasons)."}

    # final forecast: refit on all data; conformal residuals from all out-of-sample origins
    _, ets_params_all = ets(T, None)
    sn = snaive(T)
    et, _ = ets(T, ets_params_all)
    gbm_all = train_gbm(T + 1)
    gb = float(np.exp(x[T] + gbm_all.predict(np.asarray([_gbm_features(x, T, per[T].month)]))[0]))
    ens = float(np.exp(np.mean(np.log([sn, et, gb]))))
    r_all = bt["r"].values
    q10, q90 = cq(r_all, 0.10), cq(r_all, 0.90)
    out = {"crop_id": crop_id, "series": key, "series_label": meta["label"], "series_note": series_note,
           "units": meta["units"], "last_observation": str(last), "last_price": round(float(P[T]), 2),
           "target": f"mean nominal price {per[T] + hlo}..{per[T] + hhi} (next harvest window)",
           "p10": round(float(ens * np.exp(q10)), 2), "p50": round(ens, 2), "p90": round(float(ens * np.exp(q90)), 2),
           "members": {"seasonal_naive": round(sn, 2), "ets": round(et, 2), "gbm": round(gb, 2)},
           "ets_params": dict(zip(["alpha", "beta", "gamma", "phi"], [float(v) for v in ets_params_all])),
           "backtest": metrics}
    if key in UNIT_KG:
        unit, kg = UNIT_KG[key]
        f = kg / 1000 if meta["units"] == "$/mt" else kg if meta["units"] == "$/kg" else None
        if f:
            out["per_" + unit] = {k: round(float(out[k]) * f, 3) for k in ("p10", "p50", "p90")}
            out["conversion"] = f"{meta['units']} x {f:.6g} (standard {kg} kg per {unit})"
    out["evidence"] = {"source": "World Bank", "product": "Pink Sheet, CMO Historical Data Monthly", "is_nasa": False,
                       "years": [int(per[0].year), int(last.year)], "url": meta["url"], "updated": meta["updated"],
                       "citation": WB_CITATION, "licence": "CC BY 4.0",
                       "scale": "world reference price (export/FOB), not a local farm-gate price",
                       "offline_fallback": meta["offline_fallback"]}
    out["runtime_s"] = round(time.time() - t0, 2)
    return out


def build_all(refresh: bool = False) -> None:
    """Download everything and (re)write the committed reference JSONs."""
    write_ers_summary(ers_costs(refresh))
    write_ers_items_summary(ers_costs())
    write_wb_summary(wb_prices(refresh))
    write_state_regions()
