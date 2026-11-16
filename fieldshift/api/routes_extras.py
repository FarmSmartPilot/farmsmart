"""Decision extras: rainfall by year (NASA POWER), the validation summary assembled from existing reports and model
artifacts, and the PDF report with an action plan.

Every number comes from a file that already exists (weather parquet, qc/reports/*, models/*, precomputed M3 runs).
A block whose source file is missing is left out with a note; nothing is filled in."""
from __future__ import annotations

import gzip
import json
import re
from collections import Counter
from datetime import date, timedelta
from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from .. import config

router = APIRouter()

_FID = re.compile(r"^[0-9a-f]{6,40}$")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NOTES_MAX = 10_000
CHECK_MAX = 200
LABEL_MAX = 500


def _ctx(fid: str) -> dict:
    if not _FID.match(fid):
        raise HTTPException(404, "unknown field")
    from .main import _ctx as main_ctx  # lazy: main imports this module at start-up
    return main_ctx(fid)


def _rel(p) -> str:
    return p.relative_to(config.ROOT).as_posix()


# --------------------------------------------------------------------------- rainfall by year
def _main_crop(ctx: dict) -> Optional[str]:
    """The baseline rotation's main crop: the user's/typical rotation if set, else detected from crop maps.
    Most frequent crop; a tie goes to the crop with the higher seasonal water need (its rain matters most)."""
    from ..engine import analysis, kb, strategies
    hist = analysis.history_list(ctx)
    if ctx.get("default_baseline") and not hist:
        seq = ctx["default_baseline"].get("sequence") or []
    else:
        seq = strategies.detect_baseline(hist).get("sequence") or []
    ids = [s["cash"] for s in seq if s.get("cash") and s["cash"] != "fallow"]
    if not ids:
        return None
    cnt = Counter(ids)
    C = kb.crops()
    return max(ids, key=lambda c: (cnt[c], ((C.get(c) or {}).get("water_need_mm") or [0])[-1] or 0, -ids.index(c)))


def _md(doy0: int) -> tuple[int, int]:
    d = date(2001, 1, 1) + timedelta(days=int(doy0) % 365)
    return d.month, d.day


def _season(ctx: dict) -> dict:
    """Growing season of the main crop from the region calendar (middle of planting to middle of harvest),
    else Apr–Oct (northern hemisphere) / Oct–Mar (southern)."""
    from ..engine import kb
    lat = ctx["centroid"][1]
    region = (ctx.get("region") or {}).get("region")
    crop = _main_crop(ctx) if region else None
    C = kb.crops()
    if crop and crop in C:
        c = C[crop]
        w = (kb.calendars().get(region, {}).get("crops") or {}).get(crop) or {}
        if c.get("season") == "perennial":
            p, h = kb.doy("04-01"), kb.doy("10-31")
        else:
            p, h = kb.window_mid(w.get("plant")), kb.window_mid(w.get("harvest"))
        if p is not None and h is not None:
            name = c["name"].split(" (")[0]
            return {"start_doy": p + 1, "end_doy": h + 1, "start_md": _md(p), "end_md": _md(h), "crop_id": crop,
                    "basis": f"{name}: middle of the usual planting window to the middle of the usual harvest window "
                             f"({(ctx.get('region') or {}).get('label') or region} crop calendar)"}
    if lat >= 0:
        p, h, basis = kb.doy("04-01"), kb.doy("10-31"), "April to October (northern hemisphere default; no crop calendar here)"
    else:
        p, h, basis = kb.doy("10-01"), kb.doy("03-31"), "October to March (southern hemisphere default; no crop calendar here)"
    return {"start_doy": p + 1, "end_doy": h + 1, "start_md": _md(p), "end_md": _md(h), "crop_id": None, "basis": basis}


@router.get("/api/fields/{fid}/rainfall-years")
def rainfall_years(fid: str):
    """Growing-season and calendar-year rain for every year of NASA POWER at the field (≈50 km regional value)."""
    import numpy as np
    import pandas as pd
    ctx = _ctx(fid)
    if not ctx.get("_wx_path"):
        return {"available": False, "reason": "No NASA POWER weather for this field", "years": []}
    try:
        wx = pd.read_parquet(ctx["_wx_path"])
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"Weather file unreadable ({type(e).__name__})", "years": []}
    pr = wx["PRECTOTCORR"].dropna()
    se = _season(ctx)
    (sm, sd), (em, ed) = se["start_md"], se["end_md"]
    s_key, e_key = sm * 100 + sd, em * 100 + ed
    md = pr.index.month * 100 + pr.index.day
    wraps = e_key < s_key
    in_season = ((md >= s_key) | (md <= e_key)) if wraps else ((md >= s_key) & (md <= e_key))
    # a season that crosses New Year belongs to the year it ends in (e.g. Oct 2011–Mar 2012 -> 2012)
    s_year = pr.index.year + ((md >= s_key) & wraps).astype(int)
    first, last = pr.index.min(), pr.index.max()
    years = []
    for y in range(first.year, last.year + 1):
        ann = pr[pr.index.year == y]
        n_days = 366 if pd.Timestamp(year=y, month=12, day=31).is_leap_year else 365
        mask = in_season & (s_year == y)
        seas = pr[mask]
        s_start = pd.Timestamp(year=y - (1 if wraps else 0), month=sm, day=sd)
        s_end = pd.Timestamp(year=y, month=em, day=ed)
        season_complete = s_start >= first and s_end <= last and len(seas) >= (s_end - s_start).days + 1 - 2
        if not len(seas) and not len(ann):
            continue
        years.append({"year": int(y), "season_mm": round(float(seas.sum()), 1) if len(seas) else None,
                      "annual_mm": round(float(ann.sum()), 1), "partial": bool(len(ann) < n_days or not season_complete),
                      "season_partial": not season_complete,
                      "season_days": int(len(seas)), "annual_days": int(len(ann))})
    full = [v["season_mm"] for v in years if not v["partial"] and v["season_mm"] is not None]
    label = f"{MONTHS[sm - 1]}–{MONTHS[em - 1]}"
    return {"available": True, "field_id": fid, "years": years,
            "season": {"label": label, "start_doy": se["start_doy"], "end_doy": se["end_doy"],
                       "start": f"{sm:02d}-{sd:02d}", "end": f"{em:02d}-{ed:02d}", "crop_id": se["crop_id"],
                       "basis": se["basis"]},
            "median_season_mm": round(float(np.median(full)), 1) if full else None,
            "median_years": [min(v["year"] for v in years if not v["partial"]),
                             max(v["year"] for v in years if not v["partial"])] if full else None,
            "partial_note": "Years marked partial are incomplete in the record (the current year, or a first season "
                            "that started before the record); they are left out of the median.",
            "source": "NASA POWER (PRECTOTCORR)", "is_nasa": True,
            "period": [str(first.date()), str(last.date())], "scale_note": "regional value (≈50 km)",
            "evidence": {"source": "NASA POWER", "product": "daily precipitation, bias-corrected (PRECTOTCORR)",
                         "is_nasa": True, "url": "https://power.larc.nasa.gov", "scale": "regional value (≈50 km)",
                         "citation": "NASA Langley Research Center POWER Project"}}


# --------------------------------------------------------------------------- validation
def _md_table(text: str, header_start: str) -> list[list[str]]:
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        if ln.startswith(header_start):
            rows = []
            for r in lines[i + 2:]:
                if not r.startswith("|"):
                    break
                rows.append([c.strip() for c in r.strip().strip("|").split("|")])
            return rows
    return []


def _num(s: str):
    try:
        return float(s.replace(",", "").replace("*", ""))
    except ValueError:
        return None


def _m2_block() -> tuple[Optional[dict], Optional[str]]:
    import numpy as np
    import pandas as pd
    vp = config.MODELS_DIR / "m02_yield" / "validation.json"
    hp = config.MODELS_DIR / "m02_yield" / "holdout_predictions.parquet"
    ap = config.MODELS_DIR / "m02_yield" / "m02_yield.json.gz"
    if not vp.exists():
        return None, f"M2 validation file missing ({_rel(vp)})"
    val = json.loads(vp.read_text(encoding="utf-8"))
    deployed, reasons, cutoff = {}, {}, None
    if ap.exists():
        with gzip.open(ap, "rt", encoding="utf-8") as f:
            art = json.load(f)
        cutoff = art.get("cutoff")
        for c, p in (art.get("crops") or {}).items():
            deployed[c] = bool(p.get("deployed"))
            if p.get("not_deployed_reason"):
                reasons[c] = p["not_deployed_reason"]
    crops = [c for c in val if c != "practice_mapping" and isinstance(val[c], dict) and "temporal" in val[c]]
    cov, detail, test_years = {}, {}, None
    for c in crops:
        t = val[c]["temporal"]
        m = t["model"]
        lo = (val[c].get("loso") or {}).get("pooled") or {}
        dep = deployed.get(c, True)
        if dep:
            cov[c] = m.get("coverage80")
        detail[c] = {"deployed": dep, "not_deployed_reason": reasons.get(c), "n": m.get("n"),
                     "coverage_80": m.get("coverage80"), "width80_bu": m.get("width80_bu"),
                     "mae_p50_bu": m.get("mae_p50_bu"), "pinball_bu": m.get("pinball_bu"),
                     "loso_coverage_80": lo.get("coverage80"), "loso_n": lo.get("n"),
                     "by_year": t.get("by_year"),
                     "baselines": {b: {"coverage_80": (t.get(b) or {}).get("coverage80"),
                                       "pinball_bu": (t.get(b) or {}).get("pinball_bu"),
                                       "mae_p50_bu": (t.get(b) or {}).get("mae_p50_bu")} for b in ("B1", "B2") if t.get(b)},
                     "baseline_desc": {"B1": "the county's last 5-year mean anomaly as P50, with its own training-anomaly P10/P90 (climatology)", "B2": t.get("B2_desc")}}
        if t.get("by_year"):
            ys = sorted(int(y) for y in t["by_year"])
            test_years = f"{ys[0]}–{ys[-1]}"
    out = {"coverage_80": cov, "detail": detail, "test_years": test_years, "information_cutoff": cutoff,
           "split": "temporal hold-out (trained before the test years, scored on them)",
           "model_card": "models/model_cards/m02_yield.md", "source": _rel(vp),
           "scale": "county statistics (USDA NASS county averages), not your field"}
    if hp.exists():
        H = pd.read_parquet(hp)
        H = H[(H["split"] == "temporal") & H["crop"].isin([c for c in cov])].copy()
        H = H.dropna(subset=["yield", "p10", "p50", "p90"])
        names = {}
        gz = config.CACHE / "gazetteer" / "2023_Gaz_counties_national.txt"
        if gz.exists():
            g = pd.read_csv(gz, sep="\t", dtype={"GEOID": str}, usecols=[0, 1, 3])
            g.columns = [c.strip() for c in g.columns]
            names = dict(zip(g["GEOID"], g["NAME"].str.replace(" County", "", regex=False)))
        pilots = {"19169", "20055"}  # Story County IA, Finney County KS (pilot counties first)
        H["fips"] = H["fips"].astype(str)
        first = H[H["fips"].isin(pilots)]
        rest = H[~H["fips"].isin(pilots)]
        k = max(0, 200 - len(first))
        per = max(1, k // max(len(cov), 1))
        rng = np.random.default_rng(7)
        picks = [first]
        for c in cov:
            rc = rest[rest["crop"] == c]
            if len(rc):
                picks.append(rc.iloc[rng.choice(len(rc), size=min(per, len(rc)), replace=False)])
        S = pd.concat(picks).head(200)
        out["points"] = [{"crop": str(r.crop), "state": str(r.state), "fips": r.fips, "county": names.get(r.fips),
                          "year": int(r.year), "p10": round(float(r.p10), 1), "p50": round(float(r.p50), 1),
                          "p90": round(float(r.p90), 1), "actual": round(float(r.actual), 1), "pilot_county": r.fips in pilots}
                         for r in S[["crop", "state", "fips", "year", "p10", "yield", "p50", "p90"]]
                         .rename(columns={"yield": "actual"}).itertuples(index=False)]
        held = [(p["actual"] >= p["p10"]) and (p["actual"] <= p["p90"]) for p in out["points"]]
        out["points_note"] = (f"{len(out['points'])} of {len(H):,} held-out county-years: every row for the pilot "
                              f"counties (Story IA, Finney KS), then a fixed random sample per crop. The sample's 80% "
                              f"range held {np.mean(held):.0%}; the coverage figures above use all rows.")
        out["points_unit"] = "bu/ac (per harvested acre)"
    else:
        out["points"] = []
        out["points_note"] = f"Held-out predictions file missing ({_rel(hp)}); coverage figures still come from {_rel(vp)}."
    return out, None


def _m10_block() -> tuple[Optional[dict], Optional[str]]:
    p = config.ROOT / "qc" / "reports" / "calibration_m10.md"
    if not p.exists():
        return None, f"M10 calibration report missing ({_rel(p)})"
    text = p.read_text(encoding="utf-8")
    rows = _md_table(text, "| Split | Level | County-years")
    if not rows:
        return None, "M10 calibration table not found in the report"
    lv = {"temporal": [], "loso": []}
    for r in rows:
        if len(r) < 5 or r[0] not in lv:
            continue
        lv[r[0]].append({"level": r[1].title(), "coverage": _num(r[3]), "n": int(_num(r[2]) or 0),
                         "mean_relative_width": _num(r[4])})
    rel = _md_table(text, "| Split | Level | 20%")
    reliability = [{"split": r[0], "level": r[1].title(),
                    "empirical": {k: _num(v) for k, v in zip(("20", "40", "50", "60", "80"), r[2:7])}}
                   for r in rel if len(r) >= 7]
    m = re.search(r"Run (\d{4}-\d{2}-\d{2})", text)
    return {"levels": lv["temporal"], "levels_loso": lv["loso"], "target_coverage": 0.8,
            "reliability": reliability, "run": m.group(1) if m else None,
            "what": "How often each confidence level's 80% county-yield range held the observed USDA NASS county yield",
            "report": _rel(p), "plot": "qc/reports/calibration_m10.png",
            "model_card": "models/model_cards/m10_uncertainty.md"}, None


def _weather_block() -> tuple[Optional[dict], Optional[str]]:
    p = config.ROOT / "qc" / "reports" / "weather_agreement.json"
    if not p.exists():
        return None, f"Weather validation file missing ({_rel(p)})"
    sites = json.loads(p.read_text(encoding="utf-8"))
    names = {"tmax_daily": "daily maximum temperature (°C)", "tmin_daily": "daily minimum temperature (°C)",
             "precip_daily": "daily rain (mm)", "precip_monthly": "monthly rain (mm)"}
    pairs, rain = [], []
    for s in sites:
        for k, lbl in names.items():
            v = s.get(k)
            if not v:
                continue
            pairs.append({"site": s.get("pilot"), "station": s.get("station_name") or s.get("station"),
                          "variable": k.split("_")[0] if k.startswith("t") else k, "label": lbl,
                          "n": v.get("n"), "r": v.get("r"), "bias": v.get("bias"), "mae": v.get("mae"),
                          "period": s.get("period")})
        if s.get("annual_precip_mean_mm"):
            rain.append({"site": s.get("pilot"), **s["annual_precip_mean_mm"],
                         "heavy_rain_hit_rate_within_1_day": (s.get("heavy_rain_days") or {}).get("hit_rate_within_1_day")})
    rep = config.ROOT / "qc" / "reports" / "weather_agreement.md"
    return {"pairs": pairs, "annual_rain_mm": rain, "comparison": "NASA POWER (≈50 km grid) vs NOAA GHCN-Daily rain gauges and "
            "thermometers (a point)", "report": _rel(rep) if rep.exists() else _rel(p), "source": _rel(p),
            "script": "qc/validate_weather.py"}, None


def _m3_block() -> tuple[Optional[dict], Optional[str]]:
    pp = config.PRECOMP / "pilots.json"
    if not pp.exists():
        return None, "Pilot list missing, so the M3 pilot runs can't be found"
    areas = []
    for p in json.loads(pp.read_text(encoding="utf-8")).get("pilots", []):
        f = config.PRECOMP / f"m3_{p['field_id']}.json"
        if not f.exists():
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        v = d.get("validation") if d.get("available") else None
        if not v:
            continue
        areas.append({"area": p.get("label"), "field_id": p["field_id"], "n_fields": v.get("n"),
                      "held_out_year": v.get("held_out_year"), "top1": v.get("top1_accuracy"), "top3": v.get("top3_accuracy"),
                      "baselines": {"same_as_last_year": v.get("baseline_same_as_last_year"),
                                    "most_common_crop": v.get("baseline_most_common_crop")}})
    if not areas:
        return None, "No M3 validation runs found in data/precomputed/m3_*.json"
    a0 = areas[0]
    return {"top1": a0["top1"], "top3": a0["top3"], "baselines": a0["baselines"], "area": a0["area"],
            "areas": areas, "what": "Predicting each nearby field's 2024 crop from its 2017–2023 sequence (USDA Crop "
            "Sequence Boundaries); top-3 means the real crop was among the three most likely",
            "model_card": "models/model_cards/m03_rotation_sequence.md"}, None


@lru_cache(maxsize=1)
def _validation_cached(stamp: tuple) -> dict:
    out: dict = {}
    for key, fn in (("m2", _m2_block), ("m10", _m10_block), ("weather", _weather_block), ("m3", _m3_block)):
        try:
            blk, note = fn()
        except Exception as e:  # noqa: BLE001 - a broken artifact is reported, never patched over
            blk, note = None, f"could not read the source ({type(e).__name__}: {str(e)[:120]})"
        if blk is None:
            out[f"{key}_note"] = note
        else:
            out[key] = blk
    out["generated"] = date.today().isoformat()
    out["note"] = ("Assembled from existing validation reports and model files; no new claims. County-level yield "
                   "checks describe county averages, not a single field.")
    return out


@router.get("/api/validation")
def validation():
    files = [config.MODELS_DIR / "m02_yield" / "validation.json",
             config.MODELS_DIR / "m02_yield" / "holdout_predictions.parquet",
             config.ROOT / "qc" / "reports" / "calibration_m10.md", config.ROOT / "qc" / "reports" / "weather_agreement.json",
             config.PRECOMP / "pilots.json"]
    stamp = tuple((str(f), f.stat().st_mtime if f.exists() else None) for f in files) + (date.today().isoformat(),)
    return _validation_cached(stamp)


# --------------------------------------------------------------------------- PDF with action plan
class PlanIn(BaseModel):
    chosen: Optional[str] = None
    checklist: Optional[list[dict]] = None
    notes: Optional[str] = None


class ReportPdfIn(BaseModel):
    farm: Optional[dict] = None
    priorities: Optional[list[str]] = None
    baseline: Optional[list[dict]] = None
    scenario: str = "normal"
    budgets: Optional[dict] = None
    custom: Optional[list[dict]] = None
    plan: Optional[PlanIn] = None


@router.post("/api/fields/{fid}/report.pdf")
def report_pdf_plan(fid: str, body: ReportPdfIn):
    from . import pdf
    from .main import CompareIn, _public, compare
    ctx = _ctx(fid)
    plan = body.plan or PlanIn()
    if plan.notes and len(plan.notes) > NOTES_MAX:
        raise HTTPException(422, f"Adviser notes are limited to {NOTES_MAX:,} characters")
    items = plan.checklist or []
    if len(items) > CHECK_MAX:
        raise HTTPException(422, f"The checklist is limited to {CHECK_MAX} items")
    checklist = [{"id": str(x.get("id") or "")[:80], "label": str(x.get("label") or "")[:LABEL_MAX],
                  "done": bool(x.get("done"))} for x in items if isinstance(x, dict)]
    cmp = compare(fid, CompareIn(**body.model_dump(exclude={"plan"})))
    if not cmp.get("supported"):
        raise HTTPException(409, cmp.get("reason") or "no comparison available")
    data = pdf.build(_public(ctx), cmp, plan={"chosen": (plan.chosen or "")[:200], "checklist": checklist,
                                              "notes": plan.notes or ""})
    return Response(data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="farmsmart-plan-{fid}.pdf"'})
