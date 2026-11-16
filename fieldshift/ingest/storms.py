"""NOAA NCEI Storm Events Database: reported storm events per US county (money calculator risk panel, wave U9).

Source: the bulk "details" CSV files, one per year (StormEvents_details-ftp_v1.0_dYYYY_cYYYYMMDD.csv.gz) at
https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/ (public, no key). The newest compilation of each
year is picked from the directory listing, so a re-issued file is picked up automatically.

Events are recorded per county (CZ_TYPE "C") or per NWS forecast zone (CZ_TYPE "Z"). Zone events are mapped to
counties with the NWS zone-county correlation files (https://www.weather.gov/gis/ZoneCounty, bpDDmmYY.dbx): the
releases linked there now plus the earlier releases (2004 →) kept by the Internet Archive, because some states
renumbered their zones (California's San Joaquin Valley zones, for one). A zone event maps only through releases
whose zone of that number has the same name as the event's CZ_NAME, so a renumbered zone is never sent to the
wrong county. A zone that covers several counties counts as an event in each of them, and its crop damage is split
equally between them. Zone reports that match no release stay unmapped (their share is in the summary's meta).

Build (downloads ≈ 30 gzipped files, ≈ 6–16 MB each, into data/cache/storm_events/raw, parsed rows kept per year
and the gzip deleted; ≈ 32 correlation-file releases into data/cache/storm_events/zones; about 2 minutes):
    python -m fieldshift.ingest.storms            # 1996 .. last full year
Output, committed: data/reference/storm_events_county.parquet (fips, type, year, n_county, n_zone, crop_damage_usd)
and data/reference/storm_events_county.meta.json.

Public API
    build(years)              download, parse and write the all-US county summary
    county_events(fips)       the API block for one county ({available, items, ...})
"""
from __future__ import annotations

import json
import re
import time
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path

import pandas as pd
import requests

from ..config import CACHE, DATA, USER_AGENT

BASE = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
LANDING = "https://www.ncei.noaa.gov/stormevents/"
ZONES_PAGE = "https://www.weather.gov/gis/ZoneCounty"
ZONES_BASE = "https://www.weather.gov"
RAW = CACHE / "storm_events"
REF = DATA / "reference" / "storm_events_county.parquet"
META = DATA / "reference" / "storm_events_county.meta.json"
FIRST_YEAR = 1996  # NCEI records all 48 event types from 1996; earlier years hold tornado, wind and hail only
CITATION = ("NOAA National Centers for Environmental Information (NCEI), Storm Events Database, bulk CSV "
            "\"details\" files. https://www.ncei.noaa.gov/stormevents/")

# Storm Events EVENT_TYPE -> (id, EN, ES)
TYPES = {
    "Hail": ("hail", "Hail", "Granizo"),
    "Thunderstorm Wind": ("thunderstorm_wind", "Thunderstorm wind", "Viento de tormenta"),
    "Tornado": ("tornado", "Tornado", "Tornado"),
    "Flood": ("flood", "Flood", "Inundación"),
    "Flash Flood": ("flash_flood", "Flash flood", "Inundación repentina"),
    "Heavy Rain": ("heavy_rain", "Heavy rain", "Lluvia intensa"),
    "Drought": ("drought", "Drought", "Sequía"),
    "Frost/Freeze": ("frost_freeze", "Frost or freeze", "Helada"),
    "Excessive Heat": ("excessive_heat", "Excessive heat", "Calor extremo"),
    "High Wind": ("high_wind", "High wind", "Viento fuerte"),
    "Winter Storm": ("winter_storm", "Winter storm", "Tormenta invernal"),
}
_TYPE_UPPER = {k.upper(): k for k in TYPES}
USECOLS = ["EVENT_ID", "YEAR", "STATE_FIPS", "CZ_TYPE", "CZ_FIPS", "CZ_NAME", "EVENT_TYPE", "DAMAGE_CROPS"]


def _session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def last_full_year() -> int:
    return date.today().year - 1


def _listing() -> dict[int, str]:
    """Year -> newest details file name in the NCEI directory."""
    html = _session().get(BASE, timeout=60).text
    out: dict[int, tuple[str, str]] = {}
    for m in re.finditer(r'StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz', html):
        y, c = int(m.group(1)), m.group(2)
        if y not in out or c > out[y][1]:
            out[y] = (m.group(0), c)
    return {y: v[0] for y, v in out.items()}


def _download(url: str, dest: Path) -> None:
    with _session().get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.replace(dest)


def damage_usd(v) -> float:
    """Storm Events damage strings ('10.00K', '1.5M', '2B', 'K', '0') -> dollars; blank -> 0."""
    s = str(v or "").strip().upper()
    if not s or s in ("NAN", "NONE"):
        return 0.0
    mult = {"K": 1e3, "M": 1e6, "B": 1e9, "H": 1e2}.get(s[-1], 1.0)
    num = s[:-1] if s[-1] in "KMBH" else s
    try:
        return float(num) * mult if num else 0.0
    except ValueError:
        return 0.0


def _year_rows(y: int, fname: str) -> pd.DataFrame:
    """Parsed rows of one year (the 11 event types), cached as data/cache/storm_events/details_YYYY_cSTAMP.parquet."""
    stamp = re.search(r"_c(\d{8})", fname).group(1)
    pq = RAW / f"details2_{y}_c{stamp}.parquet"
    if pq.exists():
        return pd.read_parquet(pq)
    raw_dir = RAW / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    gz = raw_dir / fname
    if not gz.exists():
        _download(BASE + fname, gz)
    d = pd.read_csv(gz, usecols=USECOLS, dtype=str, compression="gzip", encoding="latin-1")
    d["EVENT_TYPE"] = d["EVENT_TYPE"].str.strip().str.upper().map(_TYPE_UPPER)
    d = d[d["EVENT_TYPE"].notna()]
    out = pd.DataFrame({
        "event_id": pd.to_numeric(d["EVENT_ID"], errors="coerce").astype("int64"),
        "year": pd.to_numeric(d["YEAR"], errors="coerce").astype("int16"),
        "state_fips": d["STATE_FIPS"].str.strip().str.zfill(2),
        "cz_type": d["CZ_TYPE"].str.strip().str.upper(),
        "cz_fips": d["CZ_FIPS"].str.strip().str.zfill(3),
        "cz_name": d["CZ_NAME"].fillna("").str.strip().str.upper(),
        "type": d["EVENT_TYPE"].map(lambda t: TYPES[t][0]),
        "crop_damage_usd": d["DAMAGE_CROPS"].map(damage_usd).astype(float),
    })
    out.to_parquet(pq)
    for old in [*RAW.glob(f"details_{y}_c*.parquet"), *RAW.glob(f"details2_{y}_c*.parquet")]:  # an older compilation of the same year
        if old != pq:
            old.unlink()
    gz.unlink()  # keep only the parsed rows
    return out


CDX = "https://web.archive.org/cdx/search/cdx"
ZONE_ARCHIVE_PREFIXES = ["www.nws.noaa.gov/geodata/catalog/wsom/data/bp",  # 2004–2017 releases (old NWS GIS path)
                         "www.weather.gov/source/gis/Shapefiles/County/bp"]  # 2020 → releases
_ABBR = {"CTY": "COUNTY", "CO": "COUNTY", "MTNS": "MOUNTAINS", "MTN": "MOUNTAIN", "MTS": "MOUNTAINS", "VLY": "VALLEY",
         "N": "NORTH", "S": "SOUTH", "E": "EAST", "W": "WEST", "NE": "NORTHEAST", "NW": "NORTHWEST",
         "SE": "SOUTHEAST", "SW": "SOUTHWEST", "CNTRL": "CENTRAL", "CTRL": "CENTRAL", "CENT": "CENTRAL",
         "SJ": "SAN JOAQUIN", "ST": "SAINT", "FT": "FORT", "MT": "MOUNT", "LK": "LAKE", "LWR": "LOWER",
         "UPR": "UPPER", "HWY": "HIGHWAY", "ELEV": "ELEVATIONS", "&": "AND"}
_DROP = {"COUNTY", "COUNTIES", "AND", "THE", "OF", "ZONE", "AREA"}


def _norm_name(s: str) -> str:
    t = re.sub(r"S\.\s*J\.", "SJ", str(s or "").upper())
    t = re.sub(r"[^A-Z0-9& ]+", " ", t)
    toks = [_ABBR.get(w, w) for w in t.split()]
    toks = " ".join(toks).split()
    return " ".join(w for w in toks if w not in _DROP)


def _same_zone(a: str, b: str) -> bool:
    """Do two zone names (Storm Events CZ_NAME, correlation-file NAME) name the same zone?"""
    from difflib import SequenceMatcher  # noqa: PLC0415
    x, y = _norm_name(a), _norm_name(b)
    if not x or not y:
        return False
    if x == y or set(x.split()) == set(y.split()):
        return True
    return SequenceMatcher(None, x, y).ratio() >= 0.8


def _zone_file_urls() -> list[tuple[str, list[str]]]:
    """(name, candidate urls) of every NWS zone-county correlation file: the ones linked on the NWS page now, plus
    the earlier releases kept by the Internet Archive (the NWS does not list old releases; many weather.gov ones are
    still served there, so that address is tried first)."""
    s = _session()
    html = s.get(ZONES_PAGE, timeout=60).text
    out = {Path(ln).name: [ZONES_BASE + ln] for ln in re.findall(r'href="(/source/gis/Shapefiles/County/bp\w+\.dbx)"', html)}
    for pre in ZONE_ARCHIVE_PREFIXES:
        rows = []
        for i in range(4):
            try:
                r = s.get(CDX, params={"url": pre, "matchType": "prefix", "fl": "original,timestamp,statuscode",
                                       "filter": "statuscode:200", "output": "json"}, timeout=120)
                if r.status_code == 200 and r.text.lstrip().startswith("["):
                    rows = r.json()[1:]
                    break
            except requests.RequestException:
                pass
            time.sleep(5 * (i + 1))
        for orig, ts, _ in rows:
            name = Path(orig.split("?")[0]).name
            if re.fullmatch(r"bp\d\d[a-z]{2}\d\d\.dbx", name) and name not in out:
                live = [f"{ZONES_BASE}/source/gis/Shapefiles/County/{name}"] if "weather.gov" in orig else []
                out[name] = live + [f"https://web.archive.org/web/{ts}id_/{orig}"]
    return sorted(out.items())


def zone_county_map() -> tuple[pd.DataFrame, list[str]]:
    """(state_fips, zone, zone name) -> county fips from every NWS zone-county correlation file release found."""
    zdir = RAW / "zones"
    zdir.mkdir(parents=True, exist_ok=True)
    frames, used, failed = [], [], []
    for name, urls in _zone_file_urls():
        p = zdir / name
        url = urls[0]
        for i, u in enumerate(urls * 2):  # each address twice, pausing (the Internet Archive throttles bursts)
            if p.exists():
                break
            try:
                _download(u, p)
                url = u
            except Exception:  # noqa: BLE001
                time.sleep(3 + 3 * i)
        try:
            d = pd.read_csv(p, sep="|", header=None, dtype=str, encoding="latin-1", on_bad_lines="skip")
        except Exception:  # noqa: BLE001 - a release that can't be read is skipped (listed in meta)
            failed.append(name)
            continue
        d = d.iloc[:, :7]
        d.columns = ["state", "zone", "cwa", "name", "state_zone", "county", "fips"]
        d = d[d["fips"].astype(str).str.strip().str.fullmatch(r"\d{5}", na=False)]
        if d.empty:
            continue
        frames.append(pd.DataFrame({"state_fips": d["fips"].str.strip().str[:2],
                                    "zone": d["zone"].str.strip().str.zfill(3),
                                    "zname": d["name"].fillna("").str.strip(),
                                    "fips": d["fips"].str.strip(), "release": name}))
        used.append(url)
    if not frames:
        raise RuntimeError("no NWS zone-county correlation file could be read")
    zone_county_map.failed = failed
    return pd.concat(frames, ignore_index=True), used


def _map_zone_events(z: pd.DataFrame, zmap: pd.DataFrame) -> pd.DataFrame:
    """Zone event keys (state_fips, zone, cz_name) -> county fips. A key maps to the counties of every correlation
    release whose zone of that number has the same name, so a renumbered zone is never sent to the wrong county."""
    names = zmap.drop_duplicates(["state_fips", "zone", "zname", "fips"])
    by_zone = {k: g for k, g in names.groupby(["state_fips", "zone"])}
    rows = []
    for st, zn, nm in z[["state_fips", "zone", "cz_name"]].drop_duplicates().itertuples(index=False):
        g = by_zone.get((st, zn))
        if g is None:
            continue
        ok = {zname for zname in g["zname"].unique() if _same_zone(nm, zname)}
        for f in sorted(set(g.loc[g["zname"].isin(ok), "fips"])):
            rows.append((st, zn, nm, f))
    return pd.DataFrame(rows, columns=["state_fips", "zone", "cz_name", "fips"])


def build(years: list[int] | None = None, log=print) -> dict:
    """Download/parse every year and write the committed all-US county summary."""
    years = years or list(range(FIRST_YEAR, last_full_year() + 1))
    RAW.mkdir(parents=True, exist_ok=True)
    files = _listing()
    missing = [y for y in years if y not in files]
    if missing:
        raise RuntimeError(f"NCEI has no details file for {missing}")
    frames = []
    for y in years:
        t0 = time.time()
        frames.append(_year_rows(y, files[y]))
        log(f"{y}: {len(frames[-1])} rows ({files[y]}, {time.time() - t0:.0f}s)")
    ev = pd.concat(frames, ignore_index=True)
    zmap, zfiles = zone_county_map()
    # county events
    c = ev[ev["cz_type"] == "C"].assign(fips=lambda x: x["state_fips"] + x["cz_fips"])
    cg = c.groupby(["fips", "type", "year"], as_index=False).agg(n_county=("event_id", "size"),
                                                                  dmg_c=("crop_damage_usd", "sum"))
    # zone events -> every mapped county (damage split equally)
    z = ev[ev["cz_type"] == "Z"].rename(columns={"cz_fips": "zone"})
    keymap = _map_zone_events(z, zmap)
    keys = ["state_fips", "zone", "cz_name"]
    k = keymap.groupby(keys).size().rename("k").reset_index()
    zm = z.merge(keymap, on=keys, how="inner").merge(k, on=keys)
    zm["dmg"] = zm["crop_damage_usd"] / zm["k"]
    zg = zm.groupby(["fips", "type", "year"], as_index=False).agg(n_zone=("event_id", "size"), dmg_z=("dmg", "sum"))
    zone_ids = set(zip(z["state_fips"], z["zone"], z["cz_name"]))
    mapped_ids = set(zip(keymap["state_fips"], keymap["zone"], keymap["cz_name"]))
    z_mapped = z[[t in mapped_ids for t in zip(z["state_fips"], z["zone"], z["cz_name"])]]
    out = cg.merge(zg, on=["fips", "type", "year"], how="outer")
    out["n_county"] = out["n_county"].fillna(0).astype("int32")
    out["n_zone"] = out["n_zone"].fillna(0).astype("int32")
    out["crop_damage_usd"] = (out["dmg_c"].fillna(0) + out["dmg_z"].fillna(0)).round(0)
    out = out[["fips", "type", "year", "n_county", "n_zone", "crop_damage_usd"]].sort_values(["fips", "type", "year"])
    out = out.astype({"fips": "category", "type": "category", "year": "int16", "crop_damage_usd": "float64"})
    REF.parent.mkdir(parents=True, exist_ok=True)
    out.reset_index(drop=True).to_parquet(REF, compression="zstd")
    by_type = {}
    for t, g in ev.groupby("type"):
        by_type[t] = {"county_rows": int((g["cz_type"] == "C").sum()), "zone_rows": int((g["cz_type"] == "Z").sum())}
    meta = {"source": "NOAA NCEI Storm Events Database", "url": LANDING, "files_url": BASE, "citation": CITATION,
            "licence": "Public domain (US Government work)", "years": [years[0], years[-1]],
            "files": {str(y): files[y] for y in years}, "zone_county_files": zfiles,
            "event_types": {v[0]: k for k, v in TYPES.items()},
            "rows": int(len(ev)), "rows_by_type": by_type,
            "zone_rows": int(len(z)), "zone_rows_mapped": int(len(z_mapped)),
            "zones_seen": len(zone_ids), "zones_mapped": len(zone_ids & mapped_ids),
            "counties": int(out["fips"].nunique()),
            "zone_releases": sorted({u.rsplit("/", 1)[-1] for u in zfiles}),
            "zone_releases_failed": getattr(zone_county_map, "failed", []),
            "method": "County events (CZ_TYPE C) by county FIPS; zone events (CZ_TYPE Z) mapped to every county of "
                      "the zone in the NWS zone-county correlation file releases listed, using only releases whose "
                      "zone of that number carries the same name as the event's CZ_NAME (zones were renumbered in "
                      "some states). A zone's crop damage is split equally between its counties. Crop damage is "
                      "NCEI's reported estimate (DAMAGE_CROPS), nominal dollars.",
            "built": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    META.write_text(json.dumps(meta, indent=1), encoding="utf-8")
    _summary.cache_clear()
    return {**meta, "bytes": REF.stat().st_size}


@lru_cache(maxsize=1)
def _summary() -> tuple[pd.DataFrame, dict]:
    if not REF.exists():
        raise FileNotFoundError(str(REF))
    d = pd.read_parquet(REF)
    d["fips"] = d["fips"].astype(str)
    d["type"] = d["type"].astype(str)
    meta = json.loads(META.read_text(encoding="utf-8")) if META.exists() else {}
    return d, meta


def county_events(county_fips: str | None) -> dict:
    """Per event type: years with at least one reported event in the county, share of years, reported crop damage."""
    if not county_fips:
        return {"available": False, "reason": "No US county known for this field (storm reports are kept by county "
                                              "or NWS zone)."}
    try:
        d, meta = _summary()
    except FileNotFoundError:
        return {"available": False, "reason": "The NOAA Storm Events county summary is not built on this server "
                                              "(run python -m fieldshift.ingest.storms)."}
    fips = str(county_fips).zfill(5)
    y0, y1 = meta.get("years") or [FIRST_YEAR, last_full_year()]
    n = y1 - y0 + 1
    g = d[(d["fips"] == fips) & d["year"].between(y0, y1)]
    items = []
    for name, (tid, en, es) in TYPES.items():
        t = g[g["type"] == tid]
        ev = t[(t["n_county"] + t["n_zone"]) > 0]
        yrs = sorted(int(y) for y in ev["year"].unique())
        cy = sorted(int(y) for y in t[t["n_county"] > 0]["year"].unique())
        dmg = t[t["crop_damage_usd"] > 0]
        items.append({"type": tid, "event_type": name, "label_en": en, "label_es": es,
                      "years_with_event": len(yrs), "years": n, "p": round(len(yrs) / n, 3),
                      "years_list": yrs, "last": yrs[-1] if yrs else None,
                      "events": int(t["n_county"].sum() + t["n_zone"].sum()),
                      "events_county": int(t["n_county"].sum()), "events_zone": int(t["n_zone"].sum()),
                      "years_with_county_event": len(cy),
                      "crop_damage_usd_total": round(float(t["crop_damage_usd"].sum())),
                      "crop_damage_years": int(dmg["year"].nunique()),
                      "crop_damage_max_year": (int(dmg.loc[dmg["crop_damage_usd"].idxmax(), "year"]) if len(dmg) else None)})
    items.sort(key=lambda x: (-x["years_with_event"], x["type"]))
    zr, zm = meta.get("zone_rows"), meta.get("zone_rows_mapped")
    zshare = f"{zm / zr:.0%}" if zr else "n/a"
    return {"available": True, "county_fips": fips, "source": "NOAA NCEI Storm Events Database", "url": LANDING,
            "files_url": BASE, "citation": CITATION, "licence": "Public domain (US Government work)",
            "is_nasa": False, "years": [y0, y1], "items": items,
            "note": "Reported events; reporting varies by county and decade. Counted: events reported for this county "
                    "(county events) plus events reported for the NWS forecast zone(s) covering it (zone events: "
                    "drought, frost/freeze, heat, high wind and winter storms are mostly reported by zone), mapped "
                    f"with the NWS zone-county correlation file ({zshare} of zone reports US-wide could be mapped). "
                    "A zone's crop damage is split equally between its counties. Crop damage is NCEI's reported "
                    "estimate in nominal dollars and is often left at zero.",
            "in_simulation_note": "Drought, heat and frost are weather the yield simulation already runs through; "
                                  "hail, wind, tornado, flood and heavy rain are not simulated.",
            "scale": "county", "built": meta.get("built")}


if __name__ == "__main__":
    t0 = time.time()
    m = build()
    print(json.dumps({k: m[k] for k in ("years", "rows", "zone_rows", "zone_rows_mapped", "zones_seen",
                                        "zones_mapped", "counties", "bytes")}), f"{time.time() - t0:.0f}s")
