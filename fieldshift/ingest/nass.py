"""USDA NASS Quick Stats: county yields and acres, state prices received (marketing year).

API: https://quickstats.nass.usda.gov/api (key in .env as NASS_API_KEY; never logged).
Each (state, commodity, statistic) query is checked with get_counts first (the API caps a call at 50,000 rows),
then stored as a tidy parquet under data/cache/nass/. A compact committed copy of the county table lives in
data/reference/nass_county_yields.parquet so the deployed API works without the key.

Public API
    fetch_all(states, years)      download and cache everything (county yields/acres + state prices)
    county_table()                tidy county DataFrame (fips, year, crop, stat, value, unit)
    county_yields(crop)           county x year yield table for one FarmSmart crop id
    state_prices()                state marketing-year prices received
    write_reference()             write the committed compact parquet
"""
from __future__ import annotations

import time
from functools import lru_cache

import pandas as pd
import requests

from ..config import CACHE, DATA, USER_AGENT, env

API = "https://quickstats.nass.usda.gov/api"
RAW = CACHE / "nass"
REF = DATA / "reference" / "nass_county_yields.parquet"
CITATION = "USDA National Agricultural Statistics Service, Quick Stats (county estimates, survey). https://quickstats.nass.usda.gov"

STATES = ["IA", "IL", "MN", "NE", "MO", "KS", "CO", "OK", "TX", "CA", "ND", "SD"]
COMMODITIES = ["CORN", "SOYBEANS", "WHEAT", "SORGHUM", "OATS", "BARLEY", "COTTON", "HAY"]
STATS = ["YIELD", "AREA PLANTED", "AREA HARVESTED"]
PACE_S = 1.5  # seconds between calls

# NASS short_desc -> (FarmSmart crop id, statistic, unit). Only these rows are kept.
SERIES = {
    "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE": ("corn", "yield", "bu/ac"),
    "CORN - ACRES PLANTED": ("corn", "planted_ac", "acres"),
    "CORN, GRAIN - ACRES HARVESTED": ("corn", "harvested_ac", "acres"),
    "SOYBEANS - YIELD, MEASURED IN BU / ACRE": ("soybean", "yield", "bu/ac"),
    "SOYBEANS - ACRES PLANTED": ("soybean", "planted_ac", "acres"),
    "SOYBEANS - ACRES HARVESTED": ("soybean", "harvested_ac", "acres"),
    "WHEAT, WINTER - YIELD, MEASURED IN BU / ACRE": ("winter_wheat", "yield", "bu/ac"),
    "WHEAT, WINTER - ACRES PLANTED": ("winter_wheat", "planted_ac", "acres"),
    "WHEAT, WINTER - ACRES HARVESTED": ("winter_wheat", "harvested_ac", "acres"),
    "WHEAT, SPRING, (EXCL DURUM) - YIELD, MEASURED IN BU / ACRE": ("spring_wheat", "yield", "bu/ac"),
    "WHEAT, SPRING, (EXCL DURUM) - ACRES PLANTED": ("spring_wheat", "planted_ac", "acres"),
    "WHEAT, SPRING, (EXCL DURUM) - ACRES HARVESTED": ("spring_wheat", "harvested_ac", "acres"),
    "SORGHUM, GRAIN - YIELD, MEASURED IN BU / ACRE": ("sorghum", "yield", "bu/ac"),
    "SORGHUM - ACRES PLANTED": ("sorghum", "planted_ac", "acres"),
    "SORGHUM, GRAIN - ACRES HARVESTED": ("sorghum", "harvested_ac", "acres"),
    "OATS - YIELD, MEASURED IN BU / ACRE": ("oats", "yield", "bu/ac"),
    "OATS - ACRES PLANTED": ("oats", "planted_ac", "acres"),
    "OATS - ACRES HARVESTED": ("oats", "harvested_ac", "acres"),
    "BARLEY - YIELD, MEASURED IN BU / ACRE": ("barley", "yield", "bu/ac"),
    "BARLEY - ACRES PLANTED": ("barley", "planted_ac", "acres"),
    "BARLEY - ACRES HARVESTED": ("barley", "harvested_ac", "acres"),
    "COTTON, UPLAND - YIELD, MEASURED IN LB / ACRE": ("cotton", "yield", "lb/ac"),
    "COTTON, UPLAND - ACRES PLANTED": ("cotton", "planted_ac", "acres"),
    "COTTON, UPLAND - ACRES HARVESTED": ("cotton", "harvested_ac", "acres"),
    "HAY, ALFALFA - YIELD, MEASURED IN TONS / ACRE": ("alfalfa", "yield", "tons/ac"),
    "HAY, ALFALFA - ACRES HARVESTED": ("alfalfa", "harvested_ac", "acres"),
}
PRICE_SERIES = {
    "CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU": ("corn", "$/bu"),
    "SOYBEANS - PRICE RECEIVED, MEASURED IN $ / BU": ("soybean", "$/bu"),
    "WHEAT - PRICE RECEIVED, MEASURED IN $ / BU": ("wheat", "$/bu"),
    "SORGHUM, GRAIN - PRICE RECEIVED, MEASURED IN $ / CWT": ("sorghum", "$/cwt"),
    "OATS - PRICE RECEIVED, MEASURED IN $ / BU": ("oats", "$/bu"),
    "BARLEY - PRICE RECEIVED, MEASURED IN $ / BU": ("barley", "$/bu"),
    "COTTON, UPLAND - PRICE RECEIVED, MEASURED IN $ / LB": ("cotton", "$/lb"),
    "HAY, ALFALFA - PRICE RECEIVED, MEASURED IN $ / TON": ("alfalfa", "$/ton"),
}


# Practice-specific county yields (NASS published these mostly to 2018, in NE, KS, SD, CO, ND, TX and a few others).
# Stored as stat "yield_irrigated" / "yield_nonirrigated" on the base crop id.
PRACTICES = {"IRRIGATED": "yield_irrigated", "NON-IRRIGATED": "yield_nonirrigated"}
PRACTICE_SERIES = {
    "CORN, GRAIN, {p} - YIELD, MEASURED IN BU / ACRE": ("corn", "bu/ac"),
    "SOYBEANS, {p} - YIELD, MEASURED IN BU / ACRE": ("soybean", "bu/ac"),
    "WHEAT, WINTER, {p} - YIELD, MEASURED IN BU / ACRE": ("winter_wheat", "bu/ac"),
    "SORGHUM, GRAIN, {p} - YIELD, MEASURED IN BU / ACRE": ("sorghum", "bu/ac"),
    "COTTON, UPLAND, {p} - YIELD, MEASURED IN LB / ACRE": ("cotton", "lb/ac"),
}
PRACTICE_COMMODITIES = ["CORN", "SOYBEANS", "WHEAT", "SORGHUM", "COTTON"]


def _session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def _get(path: str, params: dict, tries: int = 4):
    key = env("NASS_API_KEY")
    if not key:
        raise RuntimeError("NASS_API_KEY is not set in .env")
    last = None
    for i in range(tries):
        try:
            r = _session().get(f"{API}/{path}/", params={"key": key, **params, "format": "JSON"}, timeout=180)
            time.sleep(PACE_S)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 403:  # throttled by the front end: back off for a while
                time.sleep(60 * (i + 1))
            if r.status_code == 400 and "no data" in r.text.lower():
                return {"data": [], "count": 0}
            last = f"HTTP {r.status_code}: {r.text[:120]}"
        except requests.RequestException as e:  # the key is in the URL: report only the exception type
            last = type(e).__name__
        time.sleep(2 + 3 * i)
    raise RuntimeError(f"NASS {path} failed after {tries} tries ({last})")


def _num(v: str) -> float | None:
    v = (v or "").strip().replace(",", "")
    try:
        return float(v)
    except ValueError:
        return None  # (D) withheld, (NA), (Z) etc.: not filled in


def _county_query(state: str, commodity: str, year0: int) -> pd.DataFrame:
    """All county survey rows of one commodity in one state (yield, planted, harvested kept)."""
    RAW.mkdir(parents=True, exist_ok=True)
    pq = RAW / f"county_{state}_{commodity}_{year0}.parquet"
    if pq.exists():
        return pd.read_parquet(pq)
    per_stat = [RAW / f"county_{state}_{commodity}_{st.replace(' ', '_')}_{year0}.parquet" for st in STATS]
    if all(p.exists() for p in per_stat if not (commodity == "HAY" and "PLANTED" in p.name)):
        df = pd.concat([pd.read_parquet(p) for p in per_stat if p.exists()], ignore_index=True)
        df.to_parquet(pq)
        return df
    q = dict(source_desc="SURVEY", sector_desc="CROPS", agg_level_desc="COUNTY", commodity_desc=commodity,
             state_alpha=state, year__GE=year0)
    n = int(_get("get_counts", q).get("count", 0))
    rows = []
    if n:
        if n > 50000:  # over the per-call cap: split by statistic
            for st in STATS:
                qs = {**q, "statisticcat_desc": st}
                if int(_get("get_counts", qs).get("count", 0)):
                    rows += _get("api_GET", qs).get("data", [])
        else:
            rows = _get("api_GET", q).get("data", [])
    keep = []
    for x in rows:
        sd = x.get("short_desc")
        if sd not in SERIES or x.get("county_code") in ("998", "999", "") or x.get("domain_desc") != "TOTAL":
            continue
        if x.get("prodn_practice_desc") not in ("ALL PRODUCTION PRACTICES",) or x.get("reference_period_desc") != "YEAR":
            continue
        crop, st, unit = SERIES[sd]
        keep.append({"fips": f"{x['state_fips_code']}{x['county_code']}", "state": x["state_alpha"],
                     "county": x["county_name"].title(), "asd": x.get("asd_desc"), "year": int(x["year"]),
                     "crop": crop, "stat": st, "value": _num(x["Value"]), "unit": unit})
    df = pd.DataFrame(keep, columns=["fips", "state", "county", "asd", "year", "crop", "stat", "value", "unit"])
    df.to_parquet(pq)
    return df


def _price_query(commodity: str, year0: int) -> pd.DataFrame:
    RAW.mkdir(parents=True, exist_ok=True)
    pq = RAW / f"state_price_{commodity}_{year0}.parquet"
    if pq.exists():
        return pd.read_parquet(pq)
    q = dict(source_desc="SURVEY", sector_desc="CROPS", agg_level_desc="STATE", commodity_desc=commodity,
             statisticcat_desc="PRICE RECEIVED", reference_period_desc="MARKETING YEAR", year__GE=year0)
    n = int(_get("get_counts", q).get("count", 0))
    rows = _get("api_GET", q).get("data", []) if n else []
    keep = [{"state": x["state_alpha"], "year": int(x["year"]), "crop": PRICE_SERIES[x["short_desc"]][0],
             "value": _num(x["Value"]), "unit": PRICE_SERIES[x["short_desc"]][1]}
            for x in rows if x.get("short_desc") in PRICE_SERIES and x.get("domain_desc") == "TOTAL"]
    df = pd.DataFrame(keep, columns=["state", "year", "crop", "value", "unit"])
    df.to_parquet(pq)
    return df


def _practice_query(commodity: str, practice: str, year0: int) -> pd.DataFrame:
    """County yields for one production practice, all states (filtered to STATES)."""
    RAW.mkdir(parents=True, exist_ok=True)
    pq = RAW / f"practice_{commodity}_{practice}_{year0}.parquet"
    if pq.exists():
        return pd.read_parquet(pq)
    q = dict(source_desc="SURVEY", sector_desc="CROPS", agg_level_desc="COUNTY", commodity_desc=commodity,
             statisticcat_desc="YIELD", prodn_practice_desc=practice, year__GE=year0)
    n = int(_get("get_counts", q).get("count", 0))
    rows = []
    if n > 50000:  # split by state
        for st in STATES:
            rows += _get("api_GET", {**q, "state_alpha": st}).get("data", []) if int(
                _get("get_counts", {**q, "state_alpha": st}).get("count", 0)) else []
    elif n:
        rows = _get("api_GET", q).get("data", [])
    series = {k.format(p=practice): v for k, v in PRACTICE_SERIES.items()}
    keep = []
    for x in rows:
        sd = x.get("short_desc")
        if sd not in series or x.get("county_code") in ("998", "999", "") or x.get("domain_desc") != "TOTAL":
            continue
        if x.get("reference_period_desc") != "YEAR" or x.get("state_alpha") not in STATES:
            continue
        crop, unit = series[sd]
        keep.append({"fips": f"{x['state_fips_code']}{x['county_code']}", "state": x["state_alpha"],
                     "county": x["county_name"].title(), "asd": x.get("asd_desc"), "year": int(x["year"]),
                     "crop": crop, "stat": PRACTICES[practice], "value": _num(x["Value"]), "unit": unit})
    df = pd.DataFrame(keep, columns=["fips", "state", "county", "asd", "year", "crop", "stat", "value", "unit"])
    df.to_parquet(pq)
    return df


def practice_yields(crop: str, practice: str) -> pd.DataFrame:
    """fips, year, value for 'irrigated' or 'nonirrigated' county yields of one crop."""
    d = county_table()
    return d[(d["crop"] == crop) & (d["stat"] == f"yield_{practice}")][["fips", "year", "value"]].astype(
        {"year": int, "value": float}).reset_index(drop=True)


def fetch_all(states: list[str] = STATES, year0: int = 2000) -> pd.DataFrame:
    """Sequential and paced: the Quick Stats front end returns 403 to bursts of parallel calls."""
    frames = [_county_query(s, c, year0) for s in states for c in COMMODITIES]
    frames += [_practice_query(c, p, year0) for c in PRACTICE_COMMODITIES for p in PRACTICES]
    for c in COMMODITIES:
        _price_query(c, year0)
    df = pd.concat([f for f in frames if len(f)], ignore_index=True).dropna(subset=["value"])
    df = df.drop_duplicates(["fips", "year", "crop", "stat"])
    df.to_parquet(CACHE / "nass_county.parquet")
    county_table.cache_clear()
    return df


@lru_cache(maxsize=1)
def county_table() -> pd.DataFrame:
    p = CACHE / "nass_county.parquet"
    return pd.read_parquet(p if p.exists() else REF)


def county_yields(crop: str) -> pd.DataFrame:
    """fips x year yield (+ harvested acres when published) for one crop id."""
    from . import ground_econ
    if ground_econ.covers(crop):  # not in the bulk table: committed data/reference/ground_sunflower.json
        return ground_econ.county_yields(crop)
    d = county_table()
    d = d[d["crop"] == crop]
    y = d[d["stat"] == "yield"][["fips", "state", "county", "year", "value", "unit"]].rename(columns={"value": "yield"})
    h = d[d["stat"] == "harvested_ac"][["fips", "year", "value"]].rename(columns={"value": "harvested_ac"})
    return y.merge(h, on=["fips", "year"], how="left").sort_values(["fips", "year"]).reset_index(drop=True)


def state_prices() -> pd.DataFrame:
    frames = [pd.read_parquet(p) for p in RAW.glob("state_price_*.parquet")]
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["state", "year", "crop", "value", "unit"])


def write_reference() -> dict:
    """Compact committed copy: county yields and acres for the listed crops/states."""
    d = county_table().copy()
    d = d[d["state"].isin(STATES)]
    out = pd.DataFrame({
        "fips": d["fips"].astype("category"), "state": d["state"].astype("category"),
        "county": d["county"].astype("category"), "year": d["year"].astype("int16"),
        "crop": d["crop"].astype("category"), "stat": d["stat"].astype("category"),
        "value": d["value"].astype("float32"), "unit": d["unit"].astype("category")})
    REF.parent.mkdir(parents=True, exist_ok=True)
    out.reset_index(drop=True).to_parquet(REF, compression="zstd")
    return {"rows": len(out), "bytes": REF.stat().st_size, "years": [int(out.year.min()), int(out.year.max())]}


# --------------------------------------------------------------------------- wave U9: yield history (money page)
STATE_REF = DATA / "reference" / "nass_state_yields.parquet"
YIELD_SERIES = {k: v for k, v in SERIES.items() if v[1] == "yield"}  # short_desc -> (crop, "yield", unit)
CROP_COMMODITY = {"corn": "CORN", "soybean": "SOYBEANS", "winter_wheat": "WHEAT", "spring_wheat": "WHEAT",
                  "sorghum": "SORGHUM", "oats": "OATS", "barley": "BARLEY", "cotton": "COTTON", "alfalfa": "HAY",
                  "sunflower": "SUNFLOWER"}  # sunflower: oil-type series, all states, from ground_econ's reference


def _state_yield_query(commodity: str, year0: int) -> pd.DataFrame:
    """Survey state yields (all states, all production practices) for one commodity, cached per commodity."""
    RAW.mkdir(parents=True, exist_ok=True)
    pq = RAW / f"state_yield_{commodity}_{year0}.parquet"
    if pq.exists():
        return pd.read_parquet(pq)
    q = dict(source_desc="SURVEY", sector_desc="CROPS", agg_level_desc="STATE", commodity_desc=commodity,
             statisticcat_desc="YIELD", reference_period_desc="YEAR", year__GE=year0)
    rows = _get("api_GET", q).get("data", []) if int(_get("get_counts", q).get("count", 0)) else []
    keep = []
    for x in rows:
        sd = x.get("short_desc")
        if sd not in YIELD_SERIES or x.get("domain_desc") != "TOTAL" or x.get("prodn_practice_desc") != "ALL PRODUCTION PRACTICES":
            continue
        crop, _, unit = YIELD_SERIES[sd]
        keep.append({"state_fips": x["state_fips_code"], "state": x["state_alpha"], "year": int(x["year"]),
                     "crop": crop, "value": _num(x["Value"]), "unit": unit})
    df = pd.DataFrame(keep, columns=["state_fips", "state", "year", "crop", "value", "unit"])
    df.to_parquet(pq)
    return df


def fetch_state_yields(year0: int = 2000) -> pd.DataFrame:
    """All states, the crops in SERIES; writes the committed data/reference/nass_state_yields.parquet."""
    frames = [_state_yield_query(c, year0) for c in COMMODITIES]
    d = pd.concat([f for f in frames if len(f)], ignore_index=True).dropna(subset=["value"])
    d = d.drop_duplicates(["state_fips", "year", "crop"])
    out = d.astype({"state_fips": "category", "state": "category", "year": "int16", "crop": "category",
                    "value": "float32", "unit": "category"}).reset_index(drop=True)
    STATE_REF.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(STATE_REF, compression="zstd")
    state_yields.cache_clear()
    return out


@lru_cache(maxsize=1)
def state_yields() -> pd.DataFrame:
    from . import ground_econ
    if STATE_REF.exists():
        d = pd.read_parquet(STATE_REF).astype({"state_fips": str, "state": str, "crop": str, "unit": str})
    else:
        d = fetch_state_yields().astype({"state_fips": str, "state": str, "crop": str, "unit": str})
    extra = [ground_econ.state_yields(c) for c in ground_econ.CROPS]  # crops outside COMMODITIES (sunflower)
    extra = [e for e in extra if len(e)]
    return pd.concat([d, *extra], ignore_index=True) if extra else d


def county_yields_live(fips: str, crop: str, year0: int = 2000) -> pd.DataFrame:
    """County yields for a county outside the bulk table's states: one Quick Stats call, cached per county and
    commodity in data/cache/nass/. Columns: year, value, unit."""
    com = CROP_COMMODITY.get(crop)
    from . import ground_econ
    if not com or ground_econ.covers(crop):  # ground_econ's reference already holds every state's counties
        return pd.DataFrame(columns=["year", "value", "unit"])
    fips = str(fips).zfill(5)
    RAW.mkdir(parents=True, exist_ok=True)
    pq = RAW / f"county1_{fips}_{com}_{year0}.parquet"
    if pq.exists():
        d = pd.read_parquet(pq)
    else:
        q = dict(source_desc="SURVEY", sector_desc="CROPS", agg_level_desc="COUNTY", commodity_desc=com,
                 statisticcat_desc="YIELD", state_fips_code=fips[:2], county_ansi=fips[2:], year__GE=year0)
        rows = _get("api_GET", q).get("data", []) if int(_get("get_counts", q).get("count", 0)) else []
        keep = [{"year": int(x["year"]), "crop": YIELD_SERIES[x["short_desc"]][0], "value": _num(x["Value"]),
                 "unit": YIELD_SERIES[x["short_desc"]][2]}
                for x in rows if x.get("short_desc") in YIELD_SERIES and x.get("domain_desc") == "TOTAL"
                and x.get("prodn_practice_desc") == "ALL PRODUCTION PRACTICES" and x.get("reference_period_desc") == "YEAR"]
        d = pd.DataFrame(keep, columns=["year", "crop", "value", "unit"])
        d.to_parquet(pq)
    d = d[(d["crop"] == crop)].dropna(subset=["value"])
    return d[["year", "value", "unit"]].sort_values("year").reset_index(drop=True)


if __name__ == "__main__":
    t0 = time.time()
    df = fetch_all()
    print(df.groupby(["crop", "stat"]).size().unstack())
    print(write_reference(), f"{time.time() - t0:.0f}s")
    print(len(fetch_state_yields()), "state yield rows")
