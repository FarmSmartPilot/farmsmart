"""NOAA Climate Prediction Center (CPC) official monthly and seasonal outlooks at a point (US only).

Products (public, no key), the KML versions of CPC's GIS polygons:
  1-month  https://www.cpc.ncep.noaa.gov/products/predictions/30day/lead14_{temp,prcp}.kml
           (the latest official monthly outlook: the 0.5-month-lead outlook issued on the third Thursday, replaced by
           the end-of-month update for the coming month when that is issued)
  3-month  https://www.cpc.ncep.noaa.gov/products/predictions/90day/lead{1,2,3}_{temp,prcp}.kml
           (the next three overlapping 3-month seasons of the latest seasonal outlook)
The same polygons are published as shapefiles at https://ftp.cpc.ncep.noaa.gov/GIS/us_tempprcpfcst/ .

Each placemark is one probability band: Category (Above / Below / Normal / EC = equal chances) and Probability (the
band's lower edge in %: 33, 40, 50, 60, 70, 80, 90; CPC map legend). Bands do not overlap, so a point falls in one.
Files are kept 12 h in data/cache/outlook/. Every value is read from those files; nothing is filled in.
"""
from __future__ import annotations

import re
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import requests
from shapely.geometry import Point, Polygon
from shapely.prepared import prep

from ..config import CACHE, USER_AGENT

BASE = "https://www.cpc.ncep.noaa.gov/products/predictions"
PRODUCTS = [("month", 0, f"{BASE}/30day/lead14_{{v}}.kml")] + \
           [("season", k, f"{BASE}/90day/lead{k}_{{v}}.kml") for k in (1, 2, 3)]
VARS = {"temp": "temp", "precip": "prcp"}
TTL = 12 * 3600
CACHE_DIR = CACHE / "outlook"
LANDING = "https://www.cpc.ncep.noaa.gov/products/predictions/long_range/"
GIS_PAGE = "https://www.cpc.ncep.noaa.gov/products/GIS/GIS_DATA/us_tempprcpfcst/seasonal.php"
CITATION = "NOAA Climate Prediction Center, official 30-day and 90-day outlooks (GIS/KML)."
NOTE_EN = "Chances for a large region, not a forecast for your field."
NOTE_ES = "Probabilidades para una región grande, no un pronóstico para su campo."
BANDS = [33, 40, 50, 60, 70, 80, 90, 100]
_K = "{http://www.opengis.net/kml/2.2}"
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MON_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
MON_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
            "November", "December"]
MON_FULL_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
               "noviembre", "diciembre"]
SEASON_START = {"".join(MON[(m + k) % 12][0] for k in range(3)): m for m in range(12)}  # "NDJ" -> 10 (0-based)

_lock = threading.Lock()
_parsed: dict[str, tuple[float, dict]] = {}  # url -> (time parsed, product)


def _fetch(url: str) -> tuple[bytes, float, bool]:
    """KML bytes, the time they were fetched, and whether that copy is stale (live fetch failed)."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = CACHE_DIR / url.rsplit("/predictions/", 1)[1].replace("/", "_")
    if p.exists() and time.time() - p.stat().st_mtime < TTL:
        return p.read_bytes(), p.stat().st_mtime, False
    try:
        r = requests.get(url, timeout=40, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        if b"<kml" not in r.content[:2000]:
            raise ValueError("not a KML file")
        p.write_bytes(r.content)
        return r.content, time.time(), False
    except Exception:
        if p.exists():  # keep serving the last good copy, marked stale
            return p.read_bytes(), p.stat().st_mtime, True
        raise


def _ring(el) -> list[tuple[float, float]]:
    txt = el.find(f".//{_K}coordinates").text.split()
    return [tuple(map(float, t.split(",")[:2])) for t in txt]


def parse_kml(raw: bytes) -> dict:
    root = ET.fromstring(raw)
    name = (root.find(f"{_K}Document/{_K}name").text or "").strip()
    bands = []
    for pm in root.iter(f"{_K}Placemark"):
        desc = pm.find(f"{_K}description").text or ""
        cells = re.findall(r"<td>([^<]*)</td>", desc)
        attrs = dict(zip(cells[1::2], cells[2::2]))  # first cell is the title row
        polys = []
        for pg in pm.iter(f"{_K}Polygon"):
            outer = _ring(pg.find(f"{_K}outerBoundaryIs"))
            inner = [_ring(i) for i in pg.findall(f"{_K}innerBoundaryIs")]
            polys.append(Polygon(outer, inner))
        bands.append({"category": attrs.get("Category"), "prob": float(attrs.get("Probability") or "nan"),
                      "issued": attrs.get("Forecast Date"), "valid": attrs.get("Valid Season"),
                      "geoms": [prep(g if g.is_valid else g.buffer(0)) for g in polys]})
    m = re.search(r"Created:\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*-\s*Valid\s*(.+)$", name)
    issued = date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat() if m else None
    if not issued and bands and bands[0]["issued"]:
        mo, d, y = bands[0]["issued"].split("/")
        issued = date(int(y), int(mo), int(d)).isoformat()
    return {"title": name, "issued": issued, "valid": (m.group(4).strip() if m else (bands[0]["valid"] if bands else None)),
            "bands": bands}


def _product(url: str) -> dict:
    with _lock:
        hit = _parsed.get(url)
        if hit and time.time() - hit[0] < TTL:
            return hit[1]
    raw, fetched, stale = _fetch(url)
    prod = {**parse_kml(raw), "url": url, "fetched": datetime.fromtimestamp(fetched, timezone.utc).isoformat(timespec="seconds"),
            "stale": stale}
    with _lock:
        _parsed[url] = (time.time() if not stale else fetched, prod)
    return prod


def _all_products() -> dict[tuple[str, int, str], dict]:
    jobs = {(kind, lead, var): tpl.format(v=code) for kind, lead, tpl in PRODUCTS for var, code in VARS.items()}
    out: dict = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {k: ex.submit(_product, u) for k, u in jobs.items()}
        for k, f in futs.items():
            try:
                out[k] = f.result()
            except Exception as e:  # noqa: BLE001 - reported per item
                out[k] = {"error": f"{type(e).__name__}: {str(e)[:120]}", "url": jobs[k]}
    return out


def _band_upper(p: float) -> float | None:
    nxt = [b for b in BANDS if b > p]
    return nxt[0] / 100 if nxt else None


CAT = {"Above": "above", "Below": "below", "Normal": "near", "EC": "equal_chances"}
WORDS = {  # (variable, category) -> (EN, ES)
    ("temp", "above"): ("warmer than normal", "más cálido de lo normal"),
    ("temp", "below"): ("colder than normal", "más frío de lo normal"),
    ("temp", "near"): ("near-normal temperatures", "temperaturas cercanas a lo normal"),
    ("precip", "above"): ("wetter than normal", "más lluvioso de lo normal"),
    ("precip", "below"): ("drier than normal", "más seco de lo normal"),
    ("precip", "near"): ("near-normal rain and snow", "lluvia y nieve cercanas a lo normal"),
}


def _at(prod: dict, pt: Point, var: str) -> dict:
    if "error" in prod:
        return {"available": False, "reason": f"NOAA CPC file could not be read ({prod['error']})", "url": prod["url"]}
    hit = next((b for b in prod["bands"] if any(g.contains(pt) for g in b["geoms"])), None)
    if hit is None:
        return {"available": False, "reason": "This point is outside the area NOAA CPC maps."}
    cat = CAT.get(hit["category"], (hit["category"] or "").lower())
    p = round(hit["prob"] / 100, 2)
    if cat == "equal_chances":
        en = ("Equal chances of warmer, near-normal or colder" if var == "temp"
              else "Equal chances of wetter, near-normal or drier")
        es = ("Iguales probabilidades de más cálido, normal o más frío" if var == "temp"
              else "Iguales probabilidades de más lluvioso, normal o más seco")
        return {"available": True, "category": cat, "p": 0.33, "p_band": None, "text_en": en, "text_es": es}
    hi = _band_upper(hit["prob"])
    w_en, w_es = WORDS.get((var, cat), (cat, cat))
    band_en = f"{int(hit['prob'])}–{int(hi * 100)} %" if hi else f"{int(hit['prob'])} % or more"
    return {"available": True, "category": cat, "p": p, "p_band": [p, hi] if hi else [p, 1.0],
            "text_en": f"{band_en} chance of {w_en}", "text_es": f"{band_en} de probabilidad de {w_es}"}


def _labels(kind: str, valid: str | None) -> tuple[str | None, str | None, str | None]:
    """('NDJ', 'Nov–Jan', 'nov–ene') or ('Nov', 'November 2026', 'noviembre 2026')."""
    if not valid:
        return None, None, None
    code = valid.split()[0]
    if kind == "season" and code in SEASON_START:
        m = SEASON_START[code]
        return code, f"{MON[m]}–{MON[(m + 2) % 12]}", f"{MON_ES[m]}–{MON_ES[(m + 2) % 12]}"
    if code[:3] in MON:
        m = MON.index(code[:3])
        yr = valid.split()[1] if len(valid.split()) > 1 else ""
        return code[:3], f"{MON_FULL[m]} {yr}".strip(), f"{MON_FULL_ES[m]} {yr}".strip()
    return code, valid, valid


def third_thursday(y: int, m: int) -> date:
    d = date(y, m, 1)
    first_thu = d + timedelta(days=(3 - d.weekday()) % 7)
    return first_thu + timedelta(days=14)


def outlook_at(lon: float, lat: float, country_code: str | None) -> dict:
    if (country_code or "").lower() != "us":
        return {"available": False, "reason": "NOAA outlooks cover the United States.",
                "reason_es": "Las perspectivas de la NOAA cubren solo los Estados Unidos.",
                "source": "NOAA CPC", "url": LANDING}
    prods = _all_products()
    pt = Point(lon, lat)
    items = []
    for kind, lead, _tpl in PRODUCTS:
        t, pr = prods[(kind, lead, "temp")], prods[(kind, lead, "precip")]
        ref = t if "error" not in t else pr
        code, en, es = _labels(kind, ref.get("valid"))
        items.append({"kind": "1-month" if kind == "month" else "3-month", "lead": lead, "season": code,
                      "label_en": en, "label_es": es, "valid": ref.get("valid"), "issued": ref.get("issued"),
                      "temp": _at(t, pt, "temp"), "precip": _at(pr, pt, "precip"),
                      "urls": {"temp": t.get("url"), "precip": pr.get("url")}})
    ok = [i for i in items if i["temp"].get("available") or i["precip"].get("available")]
    if not ok:
        why = next((i[v]["reason"] for i in items for v in ("temp", "precip") if i[v].get("reason")), "no data")
        return {"available": False, "reason": why, "source": "NOAA CPC", "url": LANDING}
    seasons = [i for i in items if i["kind"] == "3-month"]
    month = next((i for i in items if i["kind"] == "1-month"), None)
    issued = next((i["issued"] for i in seasons if i["issued"]), None)
    today = date.today()
    nxt = third_thursday(today.year, today.month)
    if nxt <= today:
        nxt = third_thursday(today.year + (today.month == 12), today.month % 12 + 1)
    stale = any(p.get("stale") for p in prods.values())
    return {"available": True, "issued": issued, "issued_month_outlook": month["issued"] if month else None,
            "items": seasons, "month": month,
            "next_update_expected": nxt.isoformat(),
            "next_update_note_en": "CPC normally issues new monthly and 3-month outlooks on the third Thursday of each month.",
            "stale": stale, "fetched": max((p.get("fetched") or "") for p in prods.values()),
            "categories_note_en": ("Above / near / below normal compare with 1991–2020. A band such as 40–50 % is the "
                                   "chance of that category; 'equal chances' means no category is favoured (33 % each)."),
            "scale": "regional outlook (CPC map region, hundreds of km)",
            "source": "NOAA CPC", "source_long": "NOAA Climate Prediction Center official outlooks", "is_nasa": False,
            "citation": CITATION, "url": LANDING, "data_url": GIS_PAGE,
            "note_en": NOTE_EN, "note_es": NOTE_ES}
